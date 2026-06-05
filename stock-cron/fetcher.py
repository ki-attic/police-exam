# -*- coding: utf-8 -*-
"""資料抓取(僅上市):全部用免費 TWSE OpenAPI,一次回全市場、免 token、不限流。
波動度為唯一無單一免費全市場源,改用 FinMind(選配,沒 token 就留空)。

原則:任一欄位抓不到就留 None 並標記來源,絕不填假值。
"""
import os
import json
import time
import math
import logging
import statistics
from datetime import datetime, date, timedelta

import requests

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("fetcher")

_finmind_blocked = False

# TWSE 財報依產業分多個端點,欄位名略有不同,逐一抓取後合併
INCOME_EPS = ["t187ap06_L_ci", "t187ap06_L_basi", "t187ap06_L_bd",
              "t187ap06_L_fh", "t187ap06_L_ins", "t187ap06_L_mim"]
BALANCE_EPS = ["t187ap07_L_ci", "t187ap07_L_basi", "t187ap07_L_bd",
               "t187ap07_L_fh", "t187ap07_L_ins", "t187ap07_L_mim"]
NET_INCOME_KEYS = ["本期淨利（淨損）", "本期稅後淨利（淨損）", "繼續營業單位本期淨利（淨損）"]
ASSET_KEYS = ["資產總額", "資產總計"]
LIAB_KEYS = ["負債總額", "負債總計"]
EQUITY_KEYS = ["權益總額", "權益總計"]

# TWSE 產業別代碼 -> 名稱
INDUSTRY_MAP = {
    "01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維", "05": "電機機械",
    "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙", "10": "鋼鐵", "11": "橡膠",
    "12": "汽車", "14": "建材營造", "15": "航運", "16": "觀光餐旅", "17": "金融保險",
    "18": "貿易百貨", "19": "綜合", "20": "其他", "21": "化學", "22": "生技醫療",
    "23": "油電燃氣", "24": "半導體", "25": "電腦及週邊設備", "26": "光電",
    "27": "通信網路", "28": "電子零組件", "29": "電子通路", "30": "資訊服務",
    "31": "其他電子", "32": "文化創意", "33": "農業科技", "34": "電子商務",
    "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活", "80": "管理股票",
}


def industry_name(code):
    if code is None:
        return None
    s = str(code).strip().zfill(2)
    return INDUSTRY_MAP.get(s, str(code).strip())


# 熱門 ETF 候選池(股票型 / 高股息為主);技術面評分,無基本面
ETF_LIST = [
    "0050", "0056", "0051", "006208", "006203", "00692", "00701", "00713",
    "00850", "00878", "00881", "00891", "00892", "00900", "00905", "00915",
    "00919", "00922", "00923", "00929", "00930", "00935", "00936", "00939", "00940",
]
# 技術分權重(加重穩定):低波動 0.5 / 趨勢 0.3 / 動能 0.2
ETF_W_LOWVOL, ETF_W_TREND, ETF_W_MOM = 0.5, 0.3, 0.2


# ---------------------------------------------------------------- 共用工具
def _today():
    return date.today().isoformat()


_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}


def http_json(url, params=None, headers=None):
    hdr = {**_DEFAULT_HEADERS, **(headers or {})}
    for attempt in range(1, config.MAX_RETRY + 1):
        try:
            r = requests.get(url, params=params, headers=hdr, timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json()
            log.warning("GET %s -> HTTP %s (第%d次)", url, r.status_code, attempt)
            if r.status_code == 402:
                return {"_status": 402, "_msg": r.text}
        except Exception as e:
            log.warning("GET %s 失敗: %s (第%d次)", url, e, attempt)
        time.sleep(config.RETRY_BACKOFF * attempt)
    return None


def twse_open(endpoint):
    """TWSE OpenAPI /v1/opendata/<endpoint>,回 list。"""
    return http_json(f"https://openapi.twse.com.tw/v1/opendata/{endpoint}") or []


def to_float(v):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    neg = False
    if s.startswith("(") and s.endswith(")"):  # 會計負數表示
        neg = True
        s = s[1:-1]
    if s in ("", "-", "--", "N/A", "null", "None"):
        return None
    try:
        f = float(s)
        return -f if neg else f
    except ValueError:
        return None


def first_of(row, keys):
    for k in keys:
        if k in row:
            v = to_float(row.get(k))
            if v is not None:
                return v
    return None


def roc_to_ad(roc_date):
    s = str(roc_date).strip()
    if len(s) < 7:
        return None
    try:
        y = int(s[:-4]) + 1911
        return f"{y}-{s[-4:-2]}-{s[-2:]}"
    except ValueError:
        return None


# ---------------------------------------------------------------- 行情(上市)
def fetch_day_all():
    """STOCK_DAY_ALL 原始 list(全上市證券,含 ETF/權證)。"""
    return http_json(config.TWSE_DAY_ALL) or []


def all_prices(day):
    """{code: {name, close}} — 不過濾,供持倉查任何股號/ETF 現價。"""
    out = {}
    for r in day:
        code = (r.get("Code") or "").strip()
        if not code:
            continue
        out[code] = {
            "name": (r.get("Name") or "").strip(),
            "close": to_float(r.get("ClosingPrice")),
        }
    return out


def _mis_price(s):
    """MIS 當前價:優先成交價 z;z 為「-」(該 tick 無成交)時改用最佳買賣中價。"""
    z = to_float(s.get("z"))
    if z is not None:
        return z
    ask = to_float((s.get("a") or "").split("_")[0])
    bid = to_float((s.get("b") or "").split("_")[0])
    if ask is not None and bid is not None:
        return (ask + bid) / 2.0
    return ask if ask is not None else bid


def fetch_realtime(codes):
    """TWSE MIS 即時報價。回 {code: {price, date, time, prev_close}}。
    price 為當前價(成交價或買賣中價);盤前無報價時為 None,降級不中斷。
    """
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://mis.twse.com.tw/stock/index.jsp",
    }
    out = {}
    codes = list(codes)
    for i in range(0, len(codes), config.MIS_BATCH):
        batch = codes[i:i + config.MIS_BATCH]
        ex_ch = "|".join(f"tse_{c}.tw" for c in batch)
        try:
            res = http_json(config.TWSE_MIS,
                            params={"ex_ch": ex_ch, "json": "1", "delay": "0"},
                            headers=headers)
            for s in (res or {}).get("msgArray", []):
                code = (s.get("c") or "").strip()
                if not code:
                    continue
                out[code] = {
                    "price": _mis_price(s),
                    "date": s.get("d"),
                    "time": s.get("t"),
                    "prev_close": to_float(s.get("y")),
                }
        except Exception as e:
            log.warning("MIS 即時批次失敗(%d-%d): %s", i, i + len(batch), e)
        time.sleep(config.MIS_SLEEP)
    log.info("即時報價:%d 檔(MIS)", len(out))
    return out


def fetch_quotes(day=None):
    """{code: {name, close, trade_value, per, pbr, yield, price_date}}。"""
    out = {}
    if day is None:
        day = fetch_day_all()
    for r in day:
        code = (r.get("Code") or "").strip()
        if not code or len(code) != 4 or not code.isdigit():
            continue  # 只保留 4 碼一般個股,排除 ETF/權證等
        out[code] = {
            "code": code,
            "name": (r.get("Name") or "").strip(),
            "close": to_float(r.get("ClosingPrice")),
            "trade_value": to_float(r.get("TradeValue")),
            "per": None, "pbr": None, "yield": None,
            "price_date": roc_to_ad(r.get("Date")),
        }
    bw = http_json(config.TWSE_BWIBBU_ALL) or []
    for r in bw:
        code = (r.get("Code") or "").strip()
        if code in out:
            out[code]["per"] = to_float(r.get("PEratio"))
            out[code]["yield"] = to_float(r.get("DividendYield"))
            out[code]["pbr"] = to_float(r.get("PBratio"))
    log.info("上市行情:%d 檔(一般個股), %d 檔本益比", len(out), len(bw))
    return out


# ---------------------------------------------------------------- 基本資料/市值/產業
def fetch_basic():
    """t187ap03_L → {code: {shares, industry, name}}。"""
    rows = twse_open("t187ap03_L")
    out = {}
    for r in rows:
        code = (r.get("公司代號") or "").strip()
        if not code:
            continue
        out[code] = {
            "shares": to_float(r.get("已發行普通股數或TDR原股發行股數")),
            "industry": industry_name(r.get("產業別")),
            "name": r.get("公司簡稱"),
        }
    log.info("基本資料(含股數/產業):%d 檔", len(out))
    return out


# ---------------------------------------------------------------- 月營收 YoY
def fetch_revenue_yoy():
    rows = twse_open("t187ap05_L")
    out = {}
    for r in rows:
        code = (r.get("公司代號") or "").strip()
        yoy = to_float(r.get("營業收入-去年同月增減(%)"))
        if code and yoy is not None:
            out[code] = yoy
    log.info("月營收 YoY:%d 檔", len(out))
    return out


# ---------------------------------------------------------------- 財報:負債比 / ROE
def fetch_financials():
    """回 {code: {debt_ratio, roe}}。ROE 以本期淨利依季別年化 / 權益總額。"""
    # 資產負債表
    bs = {}
    for ep in BALANCE_EPS:
        for r in twse_open(ep):
            code = (r.get("公司代號") or "").strip()
            if not code:
                continue
            assets = first_of(r, ASSET_KEYS)
            liab = first_of(r, LIAB_KEYS)
            equity = first_of(r, EQUITY_KEYS)
            bs[code] = {"assets": assets, "liab": liab, "equity": equity}
    # 綜合損益表
    inc = {}
    for ep in INCOME_EPS:
        for r in twse_open(ep):
            code = (r.get("公司代號") or "").strip()
            if not code:
                continue
            ni = first_of(r, NET_INCOME_KEYS)
            q = to_float(r.get("季別"))
            inc[code] = {"ni": ni, "q": int(q) if q else None}

    out = {}
    for code in set(bs) | set(inc):
        b = bs.get(code, {})
        i = inc.get(code, {})
        rec = {"debt_ratio": None, "roe": None}
        if b.get("liab") is not None and b.get("assets"):
            rec["debt_ratio"] = b["liab"] / b["assets"] * 100.0
        ni, q, eq = i.get("ni"), i.get("q"), b.get("equity")
        if ni is not None and eq and q:
            ni_annual = ni * (4.0 / q)  # 累計淨利年化:Q1×4, Q2×2, Q3×4/3, Q4×1
            rec["roe"] = ni_annual / eq * 100.0
        out[code] = rec
    log.info("財報:負債比/ROE 解析 %d 檔", len(out))
    return out


# ---------------------------------------------------------------- 波動度(FinMind 選配)
def finmind(dataset, data_id, start_date, end_date):
    global _finmind_blocked
    if not config.FINMIND_TOKEN or _finmind_blocked:
        return []
    os.makedirs(config.CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(config.CACHE_DIR, f"{dataset}__{data_id}__{_today()}.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    params = {"dataset": dataset, "data_id": data_id,
              "start_date": start_date, "end_date": end_date, "token": config.FINMIND_TOKEN}
    headers = {"Authorization": f"Bearer {config.FINMIND_TOKEN}"}
    res = http_json(config.FINMIND_API, params=params, headers=headers)
    time.sleep(config.FINMIND_SLEEP)
    if isinstance(res, dict) and res.get("_status") == 402:
        log.error("FinMind 額度用盡(402),波動度後續留空。")
        _finmind_blocked = True
        return []
    if not res or res.get("status") != 200:
        return []
    rows = res.get("data", []) or []
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False)
    except Exception:
        pass
    return rows


def annual_volatility(rows):
    closes = []
    for r in sorted(rows, key=lambda x: x.get("date", "")):
        c = to_float(r.get("close"))
        if c and c > 0:
            closes.append(c)
    if len(closes) < 30:
        return None
    rets = [(closes[i] / closes[i - 1] - 1.0) for i in range(1, len(closes))]
    if len(rets) < 2:
        return None
    return statistics.pstdev(rets) * math.sqrt(252) * 100.0


# ---------------------------------------------------------------- ETF 技術面
def _vol_from_closes(closes):
    if len(closes) < 30:
        return None
    rets = [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes))]
    if len(rets) < 2:
        return None
    return statistics.pstdev(rets) * math.sqrt(252) * 100.0


def _rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(len(closes) - period, len(closes))]
    gains = sum(d for d in deltas if d > 0) / period
    losses = sum(-d for d in deltas if d < 0) / period
    if losses == 0:
        return 100.0
    rs = gains / losses
    return 100.0 - 100.0 / (1.0 + rs)


def _etf_history(code):
    """回 (收盤序列, yfinance代號);先試上市 .TW 再試上櫃 .TWO。失敗回 (None, None)。"""
    try:
        import yfinance as yf
    except Exception:
        return None, None
    for suf in (".TW", ".TWO"):
        try:
            df = yf.Ticker(code + suf).history(period="160d")
            closes = [float(x) for x in df["Close"].dropna().tolist()]
            if len(closes) >= 60:
                return closes, code + suf
        except Exception:
            continue
    return None, None


def _tech_from_closes(closes, close_now):
    """由收盤序列算技術面;回 (tech_dict, 年化波動)。個股/ETF 共用。"""
    ma20 = sum(closes[-20:]) / 20.0
    ma60 = sum(closes[-60:]) / 60.0
    ret20 = (closes[-1] / closes[-21] - 1.0) * 100.0 if len(closes) >= 21 else None
    rsi = _rsi(closes)
    trend = ((1 if close_now > ma20 else 0) + (1 if close_now > ma60 else 0)) / 2.0
    momentum = None if ret20 is None else max(0.0, min(1.0, (ret20 + 10.0) / 20.0))
    tech = {"trend": trend, "momentum": momentum, "ma20": ma20, "ma60": ma60,
            "ret20": ret20, "rsi": rsi}
    return tech, _vol_from_closes(closes)


def _etf_dividends(ticker, close_now):
    """近 12 個月配息總額、殖利率(%)、配息次數。回 dict 或 None。"""
    try:
        import yfinance as yf
        import pandas as pd
        div = yf.Ticker(ticker).dividends
        if div is None or len(div) == 0:
            return None
        cutoff = pd.Timestamp.now(tz=div.index.tz) - pd.Timedelta(days=365)
        recent = div[div.index >= cutoff]
        ttm = float(recent.sum())
        if ttm <= 0:
            return None
        return {
            "ttm": ttm,
            "yield": (ttm / close_now * 100.0) if close_now else None,
            "count": int(len(recent)),
        }
    except Exception:
        return None


def fetch_etfs(prices_all):
    """熱門 ETF 技術面評分(無基本面)。回 list of stock-like records(type=etf)。"""
    raw = []
    for code in ETF_LIST:
        closes, ticker = _etf_history(code)
        if not closes:
            log.warning("ETF %s 無歷史價(yfinance),略過", code)
            continue
        p = prices_all.get(code, {})
        close_now = p.get("close") or closes[-1]
        name = p.get("name") or code
        ma20 = sum(closes[-20:]) / 20.0
        ma60 = sum(closes[-60:]) / 60.0
        ret20 = (closes[-1] / closes[-21] - 1.0) * 100.0 if len(closes) >= 21 else None
        vol = _vol_from_closes(closes)
        rsi = _rsi(closes)
        trend = ((1 if close_now > ma20 else 0) + (1 if close_now > ma60 else 0)) / 2.0
        momentum = None if ret20 is None else max(0.0, min(1.0, (ret20 + 10.0) / 20.0))
        div = _etf_dividends(ticker, close_now)
        raw.append({
            "code": code, "name": name, "close": close_now, "vol": vol,
            "ma20": ma20, "ma60": ma60, "ret20": ret20, "rsi": rsi,
            "trend": trend, "momentum": momentum, "div": div,
            "live": p.get("live", False), "price_date": p.get("date"),
        })
    if not raw:
        return []
    vols = [r["vol"] for r in raw if r["vol"] is not None]
    vmin, vmax = (min(vols), max(vols)) if vols else (None, None)

    etfs = []
    for r in raw:
        if r["vol"] is None or vmin is None or vmax == vmin:
            lowvol = 0.5
        else:
            lowvol = 1.0 - (r["vol"] - vmin) / (vmax - vmin)
        mom = r["momentum"] if r["momentum"] is not None else 0.5
        tech_score = (lowvol * ETF_W_LOWVOL + r["trend"] * ETF_W_TREND
                      + mom * ETF_W_MOM) * 100.0
        div = r.get("div") or {}
        etfs.append({
            "code": r["code"], "name": r["name"], "market": "上市", "type": "etf",
            "industry": "ETF",
            "close": r["close"], "price_date": r.get("price_date") or _today(),
            "live": r.get("live", False),
            "market_value": None, "per": None, "pbr": None,
            "yield": div.get("yield"),
            "roe": None, "debt_ratio": None, "rev_yoy": None,
            "volatility": r["vol"],
            "tech_score": tech_score,
            "div": {"ttm": div.get("ttm"), "count": div.get("count")} if div else None,
            "tech": {
                "trend": r["trend"], "momentum": mom, "lowvol": lowvol,
                "ma20": r["ma20"], "ma60": r["ma60"], "ret20": r["ret20"], "rsi": r["rsi"],
            },
            "src": {
                "price": "twse:MIS即時/STOCK_DAY_ALL",
                "tech": "yfinance:歷史價(MA/動能/波動/RSI)",
                "yield": "yfinance:近12月配息" if div else None,
            },
        })
    log.info("ETF 技術面:%d 檔", len(etfs))
    return etfs


# ---------------------------------------------------------------- 宏觀 yfinance
def _trend_signal(closes, higher_is_riskon=True):
    if not closes or len(closes) < 20:
        return None, None
    recent = closes[-1]
    ma = sum(closes[-20:]) / 20.0
    base = closes[-20]
    chg = (recent - base) / base * 100.0 if base else 0.0
    if recent > ma and chg > 1:
        direction = "上升"
    elif recent < ma and chg < -1:
        direction = "下降"
    else:
        direction = "盤整"
    if direction == "盤整":
        stance = "中性"
    else:
        up = direction == "上升"
        stance = "偏多" if (up == higher_is_riskon) else "偏空"
    return direction, stance


def fetch_macro():
    out = {}
    try:
        import yfinance as yf
    except Exception:
        log.warning("未安裝 yfinance,跳過宏觀。")
        return out
    polarity = {"^SOX": True, "^GSPC": True, "^VIX": False, "^TNX": False, "DX-Y.NYB": False}
    for tk, name in config.MACRO_TICKERS.items():
        try:
            df = yf.Ticker(tk).history(period=f"{config.MACRO_LOOKBACK_DAYS}d")
            closes = [float(x) for x in df["Close"].dropna().tolist()]
            if not closes:
                out[tk] = {"name": name, "last": None, "direction": None, "stance": None}
                continue
            direction, stance = _trend_signal(closes, polarity.get(tk, True))
            out[tk] = {"name": name, "last": round(closes[-1], 2),
                       "direction": direction, "stance": stance}
            log.info("宏觀 %s(%s): %.2f %s -> %s", tk, name, closes[-1], direction, stance)
        except Exception as e:
            log.warning("宏觀 %s 抓取失敗: %s", tk, e)
            out[tk] = {"name": name, "last": None, "direction": None, "stance": None}
    return out


# ---------------------------------------------------------------- 題材/事件(人工研判)
def load_events():
    path = os.path.join(config.BASE_DIR, "events.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning("events.json 讀取失敗: %s", e)
    return {"updated": None, "note": "", "events": []}


# ---------------------------------------------------------------- 主流程
def build():
    log.info("=== 開始抓取(僅上市) ===")
    day = fetch_day_all()
    quotes = fetch_quotes(day)
    if not quotes:
        raise RuntimeError("TWSE 行情無資料,中止。")
    prices_all = all_prices(day)
    eod_date = roc_to_ad(day[0].get("Date")) if day else _today()  # STOCK_DAY_ALL 收盤日(昨日)
    # 即時報價覆蓋:抓不到的退回收盤
    rt = fetch_realtime(list(prices_all.keys()))
    live_asof = None
    for code, info in prices_all.items():
        r = rt.get(code)
        if r and r["price"] is not None:
            info["close"] = r["price"]
            info["live"] = True
            info["date"] = f"{r['date'][:4]}-{r['date'][4:6]}-{r['date'][6:8]} {r['time']}" if r.get("date") else _today()
            if live_asof is None:
                live_asof = info["date"]
        else:
            info["live"] = False
            info["date"] = eod_date
    realtime_ok = live_asof is not None
    price_date = f"{live_asof} 即時" if realtime_ok else f"{eod_date} 盤後收盤"
    basic = fetch_basic()
    yoy = fetch_revenue_yoy()
    fin = fetch_financials()

    # 市值 = 收盤 × 已發行股數,取前 N
    mv = {}
    for code, q in quotes.items():
        sh = basic.get(code, {}).get("shares")
        if sh and q["close"]:
            mv[code] = q["close"] * sh
    if mv:
        ranked = sorted(mv.items(), key=lambda x: x[1], reverse=True)
        picked = [c for c, _ in ranked[: config.TOP_N]]
        mv_source = "twse:t187ap03_L×收盤價"
        log.info("以市值取前 %d 檔(免費 TWSE)", len(picked))
    else:
        ranked = sorted(quotes.items(), key=lambda x: x[1].get("trade_value") or 0, reverse=True)
        picked = [c for c, _ in ranked[: config.TOP_N]]
        mv_source = "twse:成交值(無股數)"
        log.warning("無股數資料,改用成交值排名")

    stocks = []
    for i, code in enumerate(picked, 1):
        q = quotes[code]
        b = basic.get(code, {})
        f = fin.get(code, {})
        rec = {
            "code": code,
            "name": b.get("name") or q["name"],
            "market": "上市",
            "industry": b.get("industry"),
            "close": prices_all.get(code, {}).get("close", q["close"]),
            "price_date": prices_all.get(code, {}).get("date") or q.get("price_date"),
            "live": prices_all.get(code, {}).get("live", False),
            "market_value": mv.get(code),
            "per": q["per"], "pbr": q["pbr"], "yield": q["yield"],
            "roe": f.get("roe"),
            "debt_ratio": f.get("debt_ratio"),
            "rev_yoy": yoy.get(code),
            "volatility": None,
            "src": {
                "price": "twse:STOCK_DAY_ALL",
                "per_pbr_yield": "twse:BWIBBU_ALL",
                "industry": "twse:t187ap03_L" if b.get("industry") else None,
                "market_value": mv_source if mv.get(code) else None,
                "roe": "twse:t187ap06/07_L(年化)" if f.get("roe") is not None else None,
                "debt_ratio": "twse:t187ap07_L" if f.get("debt_ratio") is not None else None,
                "rev_yoy": "twse:t187ap05_L" if yoy.get(code) is not None else None,
                "volatility": None,
            },
        }
        # 技術面(MA/動能/RSI/波動)— 改用免費 yfinance 歷史價,個股與 ETF 一致
        closes, _tk = _etf_history(code)
        if closes:
            close_now = rec["close"] or closes[-1]
            tech, vol = _tech_from_closes(closes, close_now)
            rec["tech"] = tech
            rec["volatility"] = vol
            rec["src"]["volatility"] = "yfinance:歷史價"
            rec["src"]["tech"] = "yfinance:歷史價(MA/動能/RSI)"
        stocks.append(rec)
        if i % 20 == 0:
            log.info("個股技術面進度 %d/%d", i, len(picked))

    etfs = fetch_etfs(prices_all)
    stocks.extend(etfs)

    macro = fetch_macro()

    data = {
        "fetch_date": _today(),
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(stocks),
        "etf_count": len(etfs),
        "price_date": price_date,
        "realtime": realtime_ok,
        "events": load_events(),
        "prices": prices_all,
        "finmind_enabled": bool(config.FINMIND_TOKEN),
        "finmind_blocked": _finmind_blocked,
        "sources": {
            "price": "TWSE OpenAPI",
            "fundamentals": "TWSE OpenAPI(市值/負債比/ROE/營收YoY)",
            "volatility": "FinMind" if config.FINMIND_TOKEN else "(未設 token,留空)",
            "etf": "yfinance 技術面(熱門ETF)",
            "macro": "yfinance",
        },
        "macro": macro,
        "stocks": stocks,
    }
    with open(config.DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log.info("=== 完成:%d 檔,寫入 %s ===", len(stocks), config.DATA_JSON)
    return data


if __name__ == "__main__":
    build()
