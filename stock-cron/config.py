# -*- coding: utf-8 -*-
"""台股風控分析工具 — 設定檔。請在此填入你的 FinMind token。"""
import os

# === FinMind(選配:只用於「波動度」) ===
# 市值/負債比/ROE/營收YoY/產業 全改用免費 TWSE OpenAPI,不需 token。
# 只有波動度沒有單一免費全市場源,才用 FinMind;不填就留空。
# 免費註冊: https://finmindtrade.com/ ;也可用環境變數 FINMIND_TOKEN(優先)。
FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip() or ""  # <-- 想要波動度才填

# === 候選池 ===
TOP_N = 100                 # 取市值前幾名(僅上市)

# === 刷新 ===
REFRESH_INTERVAL_MIN = 30   # 背景自動重抓間隔(分鐘);台股盤後資料一天一更,設小只是更勤確認
SERVER_PORT = 8000

# === 抓取策略(避免 FinMind 限流) ===
FINMIND_SLEEP = 0.7         # 每次 FinMind 請求之間 sleep 秒數
FINMIND_BATCH = 20          # 每批檔數,批與批之間多 sleep
BATCH_PAUSE = 3.0           # 每批之間額外 sleep 秒
HTTP_TIMEOUT = 15
MAX_RETRY = 3
RETRY_BACKOFF = 2.0         # retry 間隔 = RETRY_BACKOFF * 次數

# === 路徑 ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(BASE_DIR, "data.json")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
STATIC_DIR = os.path.join(BASE_DIR, "static")

# === 來源端點 ===
TWSE_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TWSE_BWIBBU_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"
TWSE_MIS = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"  # 即時報價
MIS_BATCH = 100            # MIS 每批查詢檔數
MIS_SLEEP = 0.3            # MIS 批與批之間 sleep 秒
FINMIND_API = "https://api.finmindtrade.com/api/v4/data"

# 宏觀標的(yfinance) -> 顯示名稱
MACRO_TICKERS = {
    "^SOX": "費城半導體",
    "^TNX": "美10年期公債殖利率",
    "^VIX": "VIX 恐慌指數",
    "DX-Y.NYB": "美元指數 DXY",
    "^GSPC": "標普500",
}
MACRO_LOOKBACK_DAYS = 90  # 抓近 N 日,程式自動判斷趨勢
