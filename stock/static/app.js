"use strict";

const FACTORS = [
  { key: "yield",        label: "殖利率",   dir: 1 },
  { key: "roe",          label: "ROE",      dir: 1 },
  { key: "rev_yoy",      label: "營收YoY",  dir: 1 },
  { key: "per",          label: "PER",      dir: -1 },
  { key: "pbr",          label: "PBR",      dir: -1 },
  { key: "debt_ratio",   label: "負債比",   dir: -1 },
  { key: "volatility",   label: "波動",     dir: -1 },
];

const STRATEGIES = {
  value:    { yield: 1, roe: 1, rev_yoy: 1, per: 3, pbr: 3, debt_ratio: 1, volatility: 1 },
  dividend: { yield: 4, roe: 1, rev_yoy: 0, per: 1, pbr: 1, debt_ratio: 2, volatility: 2 },
  quality:  { yield: 1, roe: 3, rev_yoy: 3, per: 1, pbr: 1, debt_ratio: 1, volatility: 1 },
};

const MACRO_DEFS = [
  { id: "sox", name: "費城半導體 SOX", src: "^SOX" },
  { id: "tnx", name: "美10年期公債殖利率", src: "^TNX" },
  { id: "vix", name: "VIX 恐慌指數", src: "^VIX" },
  { id: "dxy", name: "美元指數 DXY", src: "DX-Y.NYB" },
  { id: "fed", name: "Fed 升降息預期", src: null },
  { id: "us",  name: "美股隔夜 (S&P500)", src: "^GSPC" },
];

let DATA = null;
let weights = { ...STRATEGIES.dividend };
let strat = "dividend";
let sortKey = "score", sortDir = -1;
let searchTerm = "";
let indFilter = "";
let macro = {};            // id -> -1/0/1
let scoreMap = {};         // code -> score
let reduceSet = new Set(); // code in 減碼名單
let stats = {};            // factor -> {min,max}
const POS_KEY = "twrisk_positions";

const fmt = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toFixed(d);
const fmtInt = (v) => (v === null || v === undefined || isNaN(v)) ? "—" : Math.round(v).toLocaleString();
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- 載入
let STATIC_MODE = false;

async function load() {
  try {
    let r = await fetch("/api/data").catch(() => null);
    if (!r || !r.ok) {
      // 無後端(GitHub Pages 等靜態部署):改讀同目錄的 data.json 快照
      r = await fetch("./data.json", { cache: "no-store" });
      STATIC_MODE = true;
      const btn = $("#btnRefresh");
      if (btn) btn.textContent = "重新載入";
    }
    if (!r.ok) {
      $("#liveState").textContent = "尚無資料";
      return;
    }
    DATA = await r.json();
    renderMeta();
    renderIndustryFilter();
    renderEvents();
    initMacroFromData();
    computeStats();
    renderWeights();
    renderAll();
  } catch (e) {
    $("#liveState").textContent = "讀取失敗:" + e;
  }
}

function renderMeta() {
  $("#dataDate").textContent = "資料日期 " + (DATA.fetch_date || "—");
  const pa = $("#priceAsof");
  if (pa) {
    pa.textContent = "報價 " + (DATA.price_date || "—");
    pa.style.color = DATA.realtime ? "var(--green)" : "";
  }
  const s = DATA.sources || {};
  $("#dataSource").textContent = `來源 行情:${s.price||"—"} / 基本面:${s.fundamentals||"—"} / 宏觀:${s.macro||"—"}`;
  let live = `${DATA.count||0} 檔 · ${DATA.generated_at||""}`;
  if (DATA._refreshing) live += " · 抓取中…";
  if (DATA.finmind_blocked) live += " · ⚠FinMind額度用盡";
  if (DATA._last_error) live += " · ⚠" + DATA._last_error;
  $("#liveState").textContent = live;
}

// ---------------------------------------------------------------- 題材/事件雷達
function stanceMeta(st) {
  if (st === "bull") return { cls: "ev-bull", txt: "偏多" };
  if (st === "bear") return { cls: "ev-bear", txt: "偏空" };
  return { cls: "ev-neu", txt: "中性" };
}
function renderEvents() {
  const wrap = $("#eventList");
  if (!wrap) return;
  const data = DATA.events || {};
  const ev = data.events || [];
  const hint = $("#eventHint");
  if (hint && data.updated) hint.textContent = `研判日 ${data.updated}・人工研判僅供參考,點個股 chip 帶入上方搜尋`;
  if (!ev.length) { wrap.innerHTML = '<div class="reduce-empty">尚無事件(可編輯 stock/events.json 增刪)。</div>'; return; }
  const chips = (arr, cls) => (arr || []).map((o) =>
    `<span class="ev-chip ${cls}" data-code="${o.code}">${o.code} ${o.name || ""}</span>`).join("");
  wrap.innerHTML = "";
  ev.forEach((e) => {
    const sm = stanceMeta(e.stance);
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div class="ev-head"><span class="ev-cat">${e.category || ""}</span>
        <span class="ev-stance ${sm.cls}">${sm.txt}</span></div>
      <div class="ev-title">${e.title || ""}</div>
      <div class="ev-sum">${e.summary || ""}</div>
      ${(e.benefit && e.benefit.length) ? `<div class="ev-row"><span class="ev-lab up">受惠</span>${chips(e.benefit, "up")}</div>` : ""}
      ${(e.pressure && e.pressure.length) ? `<div class="ev-row"><span class="ev-lab down">受壓</span>${chips(e.pressure, "down")}</div>` : ""}`;
    card.querySelectorAll(".ev-chip").forEach((c) => {
      c.onclick = () => {
        const code = c.dataset.code;
        const inp = $("#search");
        if (inp) inp.value = code;
        searchTerm = code;
        renderTable();
        const tbl = $("#scoreTable");
        if (tbl) tbl.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
    wrap.appendChild(card);
  });
}

// ---------------------------------------------------------------- 宏觀燈號
function stanceToVal(st) {
  if (st === "偏多") return 1;
  if (st === "偏空") return -1;
  return 0;
}
function initMacroFromData() {
  const m = DATA.macro || {};
  MACRO_DEFS.forEach((d) => {
    if (macro[d.id] !== undefined) return; // 使用者已選過,保留
    const info = d.src ? m[d.src] : null;
    macro[d.id] = info ? stanceToVal(info.stance) : 0;
  });
  renderMacro();
}
function renderMacro() {
  const m = DATA.macro || {};
  const wrap = $("#macroSignals");
  wrap.innerHTML = "";
  MACRO_DEFS.forEach((d) => {
    const info = d.src ? m[d.src] : null;
    const valTxt = info && info.last !== null
      ? `現值 ${info.last} · 趨勢 ${info.direction || "—"}`
      : (d.src ? "無自動資料" : "無公開資料源,請手動判斷");
    const cur = macro[d.id];
    const el = document.createElement("div");
    el.className = "sig";
    el.innerHTML = `
      <div class="sig-name">${d.name}</div>
      <div class="sig-val">${valTxt}</div>
      <div class="seg">
        <button data-v="1" class="${cur===1?"on-bull":""}">偏多</button>
        <button data-v="0" class="${cur===0?"on-neu":""}">中性</button>
        <button data-v="-1" class="${cur===-1?"on-bear":""}">偏空</button>
      </div>`;
    el.querySelectorAll(".seg button").forEach((b) => {
      b.onclick = () => { macro[d.id] = parseInt(b.dataset.v); renderMacro(); renderAll(); };
    });
    wrap.appendChild(el);
  });
  renderLight();
}
function renderLight() {
  const sum = Object.values(macro).reduce((a, b) => a + b, 0);
  const box = $("#macroLight"), label = $("#macroLabel"), read = $("#macroRead");
  box.className = "light";
  let cls, word, lab, msg;
  if (sum >= 2) { cls = "light-green"; word = "綠"; lab = "進攻"; msg = `總分 +${sum}:外圍偏多,可順勢提高持股、側重成長/動能。`; }
  else if (sum <= -2) { cls = "light-red"; word = "紅"; lab = "防禦"; msg = `總分 ${sum}:risk-off,降低槓桿、減碼高估值高波動股,下方已列減碼名單。`; }
  else { cls = "light-yellow"; word = "黃"; lab = "中性"; msg = `總分 ${sum}:多空拉鋸,維持均衡、汰弱留強、控制單一持股比重。`; }
  box.classList.add(cls);
  box.textContent = word; label.textContent = lab; read.textContent = msg;
  return word;
}
function isRed() { return Object.values(macro).reduce((a, b) => a + b, 0) <= -2; }
function isGreen() { return Object.values(macro).reduce((a, b) => a + b, 0) >= 2; }

// ---------------------------------------------------------------- 評分
const isEtf = (s) => s && s.type === "etf";
const indStocks = () => DATA.stocks.filter((s) => !isEtf(s)); // 個股(排除 ETF)

function computeStats() {
  stats = {};
  const base = indStocks();
  FACTORS.forEach((f) => {
    const vals = base.map((s) => s[f.key]).filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (vals.length) stats[f.key] = { min: Math.min(...vals), max: Math.max(...vals) };
  });
}
function norm(key, v) {
  const st = stats[key];
  if (!st || v === null || v === undefined || isNaN(v) || st.max === st.min) return null;
  return (v - st.min) / (st.max - st.min);
}
function factorComp(f, v) {
  const n = norm(f.key, v);
  if (n === null) return null;
  return f.dir === 1 ? n : 1 - n;
}
function scoreOf(stock) {
  let wsum = 0, acc = 0;
  FACTORS.forEach((f) => {
    const w = weights[f.key] || 0;
    if (w <= 0) return;
    const c = factorComp(f, stock[f.key]);
    if (c === null) return;
    acc += w * c; wsum += w;
  });
  return wsum > 0 ? (acc / wsum) * 100 : null;
}
function scoreColor(s) {
  if (s === null) return "var(--dim)";
  if (s >= 65) return "var(--green)";
  if (s >= 45) return "var(--yellow)";
  return "var(--red)";
}

// 減碼:risk-off 脆弱度。高PER/高PBR/高波動/高負債/低殖利率
function computeReduce() {
  const riskFactors = [
    { key: "per", label: "PER偏高", dir: 1 },
    { key: "pbr", label: "PBR偏高", dir: 1 },
    { key: "volatility", label: "波動大", dir: 1 },
    { key: "debt_ratio", label: "負債高", dir: 1 },
    { key: "yield", label: "殖利率低", dir: -1 },
  ];
  const rows = indStocks().map((s) => {
    let acc = 0, n = 0; const tags = [];
    riskFactors.forEach((rf) => {
      let c = norm(rf.key, s[rf.key]);
      if (c === null) return;
      if (rf.dir === -1) c = 1 - c;
      acc += c; n++;
      if (c >= 0.66) tags.push(rf.label);
    });
    return { stock: s, risk: n ? acc / n : null, tags };
  }).filter((r) => r.risk !== null);
  rows.sort((a, b) => b.risk - a.risk);
  return rows;
}

// 加碼:risk-on 最強。低PER/低PBR/高殖利/高ROE/高營收成長/低波動
function computeAdd() {
  const f = [
    { key: "per", label: "估值便宜", dir: -1 },
    { key: "pbr", label: "淨值比低", dir: -1 },
    { key: "yield", label: "高殖利", dir: 1 },
    { key: "roe", label: "高ROE", dir: 1 },
    { key: "rev_yoy", label: "營收成長", dir: 1 },
    { key: "volatility", label: "低波動", dir: -1 },
  ];
  const rows = indStocks().map((s) => {
    let acc = 0, n = 0; const tags = [];
    f.forEach((rf) => {
      let c = norm(rf.key, s[rf.key]);
      if (c === null) return;
      if (rf.dir === -1) c = 1 - c;
      acc += c; n++;
      if (c >= 0.66) tags.push(rf.label);
    });
    return { stock: s, strength: n ? acc / n : null, tags };
  }).filter((r) => r.strength !== null);
  rows.sort((a, b) => b.strength - a.strength);
  return rows;
}

// ---------------------------------------------------------------- 渲染
let addSet = new Set();
function renderAll() {
  scoreMap = {};
  DATA.stocks.forEach((s) => { scoreMap[s.code] = isEtf(s) ? s.tech_score : scoreOf(s); });
  const reduce = computeReduce();
  reduceSet = new Set(reduce.slice(0, 15).map((r) => r.stock.code));
  const add = computeAdd();
  addSet = new Set(add.slice(0, 15).map((r) => r.stock.code));
  renderTable();
  renderAdd(add);
  renderReduce(reduce);
  renderPositions();
}

function renderAdd(add) {
  const wrap = $("#addList");
  const hint = $("#addHint");
  if (!isGreen()) {
    hint.textContent = "目前燈號非綠,未啟動加碼名單(轉綠時自動列出)。";
    wrap.innerHTML = '<div class="reduce-empty">燈號為黃/紅,宜守不宜攻,無加碼建議。</div>';
    return;
  }
  hint.textContent = "燈號為綠:以下為 risk-on 下體質最強個股,依強度高低排序。";
  wrap.innerHTML = "";
  add.slice(0, 12).forEach((r) => {
    const s = r.stock;
    const el = document.createElement("div");
    el.className = "add-card";
    el.innerHTML = `
      <div class="rc-head"><span>${s.code} ${s.name||""}</span><span class="rc-score">強度 ${Math.round(r.strength*100)}</span></div>
      <div>${r.tags.length ? r.tags.map((t)=>`<span class="tag">${t}</span>`).join("") : '<span class="na">綜合體質佳</span>'}</div>
      <div style="margin-top:6px;color:var(--dim);font-size:12px">PER ${fmt(s.per)} · PBR ${fmt(s.pbr)} · ROE ${fmt(s.roe)} · 殖利 ${fmt(s.yield)} · YoY ${fmt(s.rev_yoy)}</div>`;
    wrap.appendChild(el);
  });
}

function renderWeights() {
  const wrap = $("#weights");
  wrap.innerHTML = "";
  FACTORS.forEach((f) => {
    const arrow = f.dir === 1 ? "↑" : "↓";
    const el = document.createElement("div");
    el.className = "wt";
    el.innerHTML = `<label>${f.label} ${arrow}<span class="wv">${weights[f.key]||0}</span></label>
      <input type="range" min="0" max="5" step="1" value="${weights[f.key]||0}">`;
    el.querySelector("input").oninput = (e) => {
      weights[f.key] = parseInt(e.target.value);
      el.querySelector(".wv").textContent = weights[f.key];
      renderAll();
    };
    wrap.appendChild(el);
  });
}

function renderIndustryFilter() {
  const sel = $("#indFilter");
  const inds = [...new Set(DATA.stocks.map((s) => s.industry).filter(Boolean))]
    .sort((a, b) => (a === "ETF" ? -1 : b === "ETF" ? 1 : a.localeCompare(b)));
  sel.innerHTML = '<option value="">全部產業</option>' +
    inds.map((i) => `<option value="${i}">${i}</option>`).join("");
  sel.value = indFilter;
}

function renderTable() {
  const body = $("#scoreBody");
  let rows = DATA.stocks.map((s) => ({ ...s, score: scoreMap[s.code] }));
  if (indFilter) rows = rows.filter((s) => (s.industry || "") === indFilter);
  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    rows = rows.filter((s) => (s.code || "").toLowerCase().includes(t) || (s.name || "").includes(searchTerm));
  }
  rows.sort((a, b) => {
    let x = a[sortKey], y = b[sortKey];
    if (x === null || x === undefined || isNaN(x)) x = -Infinity;
    if (y === null || y === undefined || isNaN(y)) y = -Infinity;
    if (typeof x === "string") return sortDir * x.localeCompare(y);
    return sortDir * (x - y);
  });
  body.innerHTML = "";
  rows.forEach((s) => {
    const tr = document.createElement("tr");
    tr.className = "row-main";
    const sc = s.score;
    const warn = reduceSet.has(s.code) && isRed() ? " ⚠" : "";
    tr.innerHTML = `
      <td><span class="score-pill" style="background:${scoreColor(sc)}22;color:${scoreColor(sc)}">${sc===null?"—":Math.round(sc)}</span>${warn}</td>
      <td class="l">${s.code}</td>
      <td class="l">${s.name||""}${isEtf(s)?' <span class="etf-tag">ETF</span>':""}${techChip(s)}</td>
      <td class="l">${s.industry||'<span class="na">—</span>'}</td>
      <td>${fmt(s.close)}</td>
      <td>${fmt(s.per)}</td>
      <td>${fmt(s.pbr)}</td>
      <td>${fmt(s.roe)}</td>
      <td>${fmt(s.yield)}</td>
      <td>${fmt(s.debt_ratio)}</td>
      <td>${fmt(s.rev_yoy)}</td>
      <td>${fmt(s.volatility)}</td>`;
    const detail = document.createElement("tr");
    detail.className = "detail";
    detail.style.display = "none";
    detail.innerHTML = `<td colspan="12"><div class="detail-inner">${isEtf(s)?techBars(s):factorBars(s)+(s.tech?stockTech(s):"")}</div></td>`;
    tr.onclick = () => { detail.style.display = detail.style.display === "none" ? "" : "none"; };
    body.appendChild(tr);
    body.appendChild(detail);
  });
}

// 技術面多空判讀(個股 / ETF 共用):站上雙均線+正動能+未超買=偏多;跌破雙均線+負動能=偏空
function techStance(s) {
  const t = s.tech;
  if (!t || s.close === null || s.close === undefined) return null;
  const up20 = t.ma20 !== null && t.ma20 !== undefined && s.close > t.ma20;
  const up60 = t.ma60 !== null && t.ma60 !== undefined && s.close > t.ma60;
  const ret = t.ret20, rsi = t.rsi;
  if (up20 && up60 && ret > 0 && (rsi === null || rsi === undefined || rsi < 70))
    return { cls: "up", txt: "偏多" };
  if (!up20 && !up60 && ret < 0) return { cls: "down", txt: "偏空" };
  return { cls: "neu", txt: "中性" };
}
function techChip(s) {
  const v = techStance(s);
  return v ? ` <span class="tech-chip t-${v.cls}">技${v.txt}</span>` : "";
}

// 個股技術面明細(參考用,不計入個股分數):趨勢/動能 + MA/RSI/波動
function stockTech(s) {
  const t = s.tech || {};
  const rows = [
    { label: "趨勢(對MA20/60)↑", c: t.trend, val: `MA20 ${fmt(t.ma20)} · MA60 ${fmt(t.ma60)}` },
    { label: "動能(20日報酬)↑", c: t.momentum,
      val: t.ret20 === null || t.ret20 === undefined ? "無資料" : fmt(t.ret20) + "%" },
  ];
  const bars = rows.map((r) => {
    const pct = r.c === null || r.c === undefined ? 0 : Math.round(r.c * 100);
    return `<div class="fbar"><div class="ft"><span>${r.label}</span><span>${r.val}</span></div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
  }).join("");
  let foot = "";
  if (t.rsi !== null && t.rsi !== undefined) {
    const tag = t.rsi >= 70 ? "超買" : (t.rsi <= 30 ? "超賣" : "中性");
    foot = `<div class="detail-foot">RSI(14) ${fmt(t.rsi)} · ${tag} · 年化波動 ${fmt(s.volatility)}%　·　技術面僅供參考,不計入個股分數</div>`;
  }
  return `<div class="detail-foot detail-sub">技術面${techChip(s)}</div>${bars}${foot}`;
}

function factorBars(s) {
  return FACTORS.map((f) => {
    const c = factorComp(f, s[f.key]);
    const pct = c === null ? 0 : Math.round(c * 100);
    const valTxt = (s[f.key] === null || s[f.key] === undefined) ? '<span class="na">無資料</span>' : fmt(s[f.key]);
    return `<div class="fbar"><div class="ft"><span>${f.label}${f.dir===1?"↑":"↓"} (權重${weights[f.key]||0})</span><span>${valTxt}</span></div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
  }).join("");
}

// ETF 技術面明細(趨勢/動能/低波動 + RSI 標籤)
function techBars(s) {
  const t = s.tech || {};
  const rows = [
    { label: "趨勢(對MA20/60)↑", w: 30, c: t.trend,
      val: `MA20 ${fmt(t.ma20)} · MA60 ${fmt(t.ma60)}` },
    { label: "動能(20日報酬)↑", w: 20, c: t.momentum,
      val: t.ret20 === null || t.ret20 === undefined ? "無資料" : fmt(t.ret20) + "%" },
    { label: "低波動↓", w: 50, c: t.lowvol,
      val: `年化波動 ${fmt(s.volatility)}%` },
  ];
  const bars = rows.map((r) => {
    const pct = r.c === null || r.c === undefined ? 0 : Math.round(r.c * 100);
    return `<div class="fbar"><div class="ft"><span>${r.label} (權重${r.w})</span><span>${r.val}</span></div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
  }).join("");
  const d = s.div || {};
  const divTxt = d.ttm ? `近12月配息 ${fmt(d.ttm)} 元 · ${d.count || "—"} 次 · 殖利率 ${fmt(s.yield)}%` : "配息 無資料";
  let foot = `<div class="detail-foot">${divTxt}</div>`;
  if (t.rsi !== null && t.rsi !== undefined) {
    const tag = t.rsi >= 70 ? "超買" : (t.rsi <= 30 ? "超賣" : "中性");
    foot += `<div class="detail-foot">RSI(14) ${fmt(t.rsi)} · ${tag}　·　ETF 採技術面評分,無基本面(殖利率為配息推估)</div>`;
  }
  return `<div class="detail-foot detail-sub">技術面${techChip(s)}</div>${bars}${foot}`;
}

function renderReduce(reduce) {
  const wrap = $("#reduceList");
  const hint = $("#reduceHint");
  if (!isRed()) {
    hint.textContent = "目前燈號非紅,未啟動減碼名單(轉紅時自動列出)。";
    wrap.innerHTML = '<div class="reduce-empty">燈號為綠/黃,無減碼建議。</div>';
    return;
  }
  hint.textContent = "燈號為紅:以下為 risk-off 下最脆弱個股,依風險高低排序。";
  wrap.innerHTML = "";
  reduce.slice(0, 12).forEach((r) => {
    const s = r.stock;
    const el = document.createElement("div");
    el.className = "reduce-card";
    el.innerHTML = `
      <div class="rc-head"><span>${s.code} ${s.name||""}</span><span class="rc-risk">風險 ${Math.round(r.risk*100)}</span></div>
      <div>${r.tags.length ? r.tags.map((t)=>`<span class="tag">${t}</span>`).join("") : '<span class="na">綜合風險偏高</span>'}</div>
      <div style="margin-top:6px;color:var(--dim);font-size:12px">PER ${fmt(s.per)} · PBR ${fmt(s.pbr)} · 波動 ${fmt(s.volatility)} · 負債 ${fmt(s.debt_ratio)} · 殖利 ${fmt(s.yield)}</div>`;
    wrap.appendChild(el);
  });
}

// ---------------------------------------------------------------- 持倉
function getPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || []; } catch { return []; }
}
function setPositions(p) { localStorage.setItem(POS_KEY, JSON.stringify(p)); }

function evalOf(code) {
  const sc = scoreMap[code];
  const onReduce = reduceSet.has(code) && isRed();
  if (onReduce) return { cls: "eval-reduce", txt: "考慮減碼 ⚠", note: "在紅燈減碼名單上" };
  if (isGreen() && addSet.has(code)) return { cls: "eval-hold", txt: "可加碼 ✦", note: "在綠燈加碼名單上" };
  if (sc === null || sc === undefined) return { cls: "eval-watch", txt: "資料不足", note: "" };
  if (sc >= 65) return { cls: "eval-hold", txt: "續抱", note: "" };
  if (sc >= 45) return { cls: "eval-watch", txt: "留意", note: "" };
  return { cls: "eval-reduce", txt: "考慮減碼", note: "" };
}

function renderPositions() {
  const positions = getPositions();
  const stockMap = {};
  if (DATA) DATA.stocks.forEach((s) => stockMap[s.code] = s);
  const body = $("#posBody");
  body.innerHTML = "";
  let totalCost = 0, totalVal = 0;
  const prices = (DATA && DATA.prices) || {};
  positions.forEach((p, idx) => {
    const s = stockMap[p.code];
    const px = prices[p.code];
    const close = s ? s.close : (px ? px.close : null);
    const dispName = s ? (s.name || "") : (px ? `${px.name||""} <span class="na">(不在分析池)</span>` : '<span class="na">查無此股號</span>');
    const cost = p.price * p.shares;
    const val = close !== null ? close * p.shares : null;
    const pl = val !== null ? val - cost : null;
    const ret = val !== null && cost ? (pl / cost) * 100 : null;
    totalCost += cost;
    if (val !== null) totalVal += val;
    const sc = scoreMap[p.code];
    const ev = evalOf(p.code);
    const plCls = pl === null ? "" : (pl >= 0 ? "profit" : "loss");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="l">${p.code}</td>
      <td class="l">${dispName}</td>
      <td>${fmt(p.price)}</td>
      <td>${fmtInt(p.shares)}</td>
      <td>${fmtInt(cost)}</td>
      <td>${fmt(close)}</td>
      <td>${val===null?"—":fmtInt(val)}</td>
      <td class="${plCls}">${pl===null?"—":fmtInt(pl)}</td>
      <td class="${plCls}">${ret===null?"—":fmt(ret)+"%"}</td>
      <td>${sc!==null&&sc!==undefined?Math.round(sc)+" ":""}<span class="eval-tag ${ev.cls}">${ev.txt}</span></td>
      <td><button class="del" title="刪除">✕</button></td>`;
    tr.querySelector(".del").onclick = () => {
      const arr = getPositions(); arr.splice(idx, 1); setPositions(arr); renderPositions();
    };
    body.appendChild(tr);
  });
  const totalPl = totalVal - totalCost;
  const totalRet = totalCost ? (totalPl / totalCost) * 100 : 0;
  const cls = totalPl >= 0 ? "profit" : "loss";
  $("#posSummary").innerHTML = positions.length ? `
    <div><span class="k">總成本</span><span class="v">${fmtInt(totalCost)}</span></div>
    <div><span class="k">總現值</span><span class="v">${fmtInt(totalVal)}</span></div>
    <div><span class="k">總損益</span><span class="v ${cls}">${fmtInt(totalPl)}</span></div>
    <div><span class="k">總報酬</span><span class="v ${cls}">${fmt(totalRet)}%</span></div>` : '<span class="na">尚無持倉,於上方加入。</span>';
}

function exportCSV() {
  const positions = getPositions();
  if (!positions.length) { alert("尚無持倉可匯出"); return; }
  const stockMap = {};
  DATA.stocks.forEach((s) => stockMap[s.code] = s);
  const head = ["股號","股名","買價","股數","成本","現價","現值","損益","報酬%","綜合分數","評估"];
  const lines = [head.join(",")];
  const prices = (DATA && DATA.prices) || {};
  positions.forEach((p) => {
    const s = stockMap[p.code];
    const px = prices[p.code];
    const close = s ? s.close : (px ? px.close : null);
    const nm = s ? (s.name||"") : (px ? (px.name||"") : "");
    const cost = p.price * p.shares;
    const val = close !== null ? close * p.shares : null;
    const pl = val !== null ? val - cost : null;
    const ret = val !== null && cost ? (pl / cost) * 100 : null;
    const sc = scoreMap[p.code];
    const ev = evalOf(p.code);
    lines.push([p.code, nm, p.price, p.shares, cost,
      close??"", val??"", pl??"", ret!==null?ret.toFixed(2):"",
      sc!==null&&sc!==undefined?Math.round(sc):"", ev.txt].join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `持倉_${DATA.fetch_date||""}.csv`;
  a.click();
}

// ---------------------------------------------------------------- 事件
document.querySelectorAll(".strat").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".strat").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    strat = b.dataset.strat;
    weights = { ...STRATEGIES[strat] };
    renderWeights();
    renderAll();
  };
});
document.querySelectorAll("#scoreTable th").forEach((th) => {
  th.onclick = () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === "code" || k === "name") ? 1 : -1; }
    renderTable();
  };
});
$("#search").oninput = (e) => { searchTerm = e.target.value.trim(); renderTable(); };
$("#indFilter").onchange = (e) => { indFilter = e.target.value; renderTable(); };
$("#posForm").onsubmit = (e) => {
  e.preventDefault();
  const code = $("#posCode").value.trim();
  const price = parseFloat($("#posPrice").value);
  const shares = parseFloat($("#posShares").value);
  if (!code || isNaN(price) || isNaN(shares)) return;
  const arr = getPositions();
  arr.push({ code, price, shares });
  setPositions(arr);
  e.target.reset();
  renderPositions();
};
$("#btnExport").onclick = exportCSV;
$("#btnRefresh").onclick = async () => {
  if (STATIC_MODE) {
    // 靜態部署:無後端可抓,改重新載入雲端排程更新後的快照
    $("#liveState").textContent = "重新載入快照…";
    await load();
    $("#liveState").textContent = "";
    return;
  }
  $("#liveState").textContent = "已要求重新抓取…";
  await fetch("/api/refresh", { method: "POST" });
  setTimeout(load, 3000);
};

// 持倉先用快取顯示;資料載入後再補評估
renderPositions();
load();
setInterval(load, 60000); // 每分鐘同步背景更新
