# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

繁體中文的台灣警察特考複習網站 — 純靜態 HTML/JS/CSS,部署在 GitHub Pages,使用者在手機開啟即用。**沒有 build step、沒有 framework、沒有 npm**;所有資料是 JS 字面值。

- **線上網址**:https://ki-attic.github.io/police-exam/
- **Repo**:`ki-attic/police-exam`(GitHub Organization。歷史 owner 為 `kikiwang351`,2026-05-31 transfer 過去以隱藏個人帳號)
- **使用者**:準備警察人員升官等考試「警佐升警正」 — 細節見 `~/.claude/projects/-Users-kiki-Desktop-FORCLAUDE/memory/`

## 互動偏好(使用者明確要求)

**每輪回應結尾,簡短(1-3 行)提示「目前可以怎麼省 token」** — 只在當下相關時提,不要每次貼同一份通用清單。判斷時機:剛完成大任務+push → 建議 `/clear`;單一對話跨多個獨立任務 → 提早 `/clear`;貼了大檔/長截圖 → 提醒下次精簡;當輪很短(<5 工具呼叫)則不提。細節見 memory `preference_token-saving.md`。

## 開發

```bash
python3 -m http.server 4173       # 本機預覽(根目錄即 web root)
# Claude Code 內呼 mcp__Claude_Preview__preview_start({name:"police-exam"})

git push                          # 即部署。origin remote 內嵌 PAT,免認證
                                   # GitHub Pages 約 1 分鐘重建
```

修改後不需 lint/test — 但 cloze 題目有個關鍵驗證:`answer` 字串必須出現在 `options` 陣列裡(否則使用者選不到正解)。寫完一批 cloze 後,在 preview console 跑:

```js
window.BANKS['<bankId>'].cloze.filter(c => !c.options.includes(c.answer))
// 應為 []
```

mcq 的 `answer` 是 0-3 整數(對應 options 索引)。

## 架構

### 三層導覽
1. `index.html` 入口 → 列各考試科目
2. `subject.html?subject=XXX` 科目樞紐 → 依該科目下的 banks 動態組裝卡片:**法條/釋字** · **申論題** · **歷年考古題** · **法條拆解題** · **總複習**
3. `law.html?law=<bankId>` 單一 bank 頁 → 上半「法條閱讀+搜尋」、下半「測驗+錯題」
4. `review.html` 跨科綜合測驗,支援 `?subject=X&type=past|law` 過濾

### 資料層
**`data/manifest.js`** 是所有 bank 的目錄,每筆:
```js
{ id, name, subject, file, law?, kind?, desc? }
```
- `law: true` → 歸到該科目的「法條」清單(法條卡 + 釋字卡 + 名言卡都用這旗標)
- `kind: "essay"` → 申論題,獨立成「申論題」卡(不算入法條也不算入拆解題)
- 沒有 `law` → 視為歷年考古題,進「歷年考古題」混合卡

**每個 bank 是一個 JS 檔**,結構統一:
```js
(window.BANKS = window.BANKS || {})["<bank-id>"] = {
  meta: { name, revised, source },
  articles: [ { no, chapter, text }, ... ],   // 條文閱讀(法條/釋字/申論題目都用此)
  mcq:      [ { ref, q, options[4], answer:0..3, explain, quote }, ... ],
  cloze:    [ { ref, text:"...【BLANK】...", answer:"<字串>", options[4], explain, quote }, ... ]
};
```

`subject.html` 在 hub 模式下會 lazy-load 該科目所有 bank 檔,計算題數渲染卡片(這就是為什麼新增 bank 要登記 manifest 才會被算進去)。

**`engine.js` 全域 `window.PE`** 是共用測驗引擎:`PE.renderRead(view, articles)` 渲染法條+搜尋、`PE.runQuiz(view, items, opts)` 跑題目流(隨機抽題、答題、解釋、即時記錯)。`assets/store.js` 全域 `window.Store` 是 localStorage 錯題庫 + 作答統計(`pe_wrong_v1` / `pe_stats_v1`)。

### 釋字怎麼放
「釋字」**是一個普通的 law bank**(`articles` 裡 `no: "釋字第535號"`、`chapter: "相關法規"`、`text: "公布日/爭點/要旨"`)。`engine.js` 渲染條號時用 regex `/^\d+(-\d+)?$/` 決定是否包「第 X 條」 — 純數字才包,「釋字第535號」這種字串會原樣顯示。因此每個科目都各有一個叫「釋字」的 bank 檔(`cons-interpretations.js` 警察法規、`cons-police-duty.js` 警察勤務、`cons-criminal.js` 刑事、`cons-legal-knowledge.js` 法學知識),manifest 一律以 `name: "釋字"` 註冊,各掛不同 `subject`。

## 資料來源規則(嚴守)

**法條**:一律從 `law.moj.gov.tw`(全國法規資料庫)抓官方原文,**不可憑記憶生成**。WebFetch 受 125 字符引用限制,大段條文用 `curl -sL "<url>" | python3` 解析 HTML 提取 — 範例見 `_src/parse_criminal.py`、本專案多次使用過的 regex `re.split(r'\n\s*第\s*(\d+)\s*條\s*\n', text)`。

**釋字**:一律從 `cons.judicial.gov.tw/jcc/zh-tw/jep03/show?expno=<號>` 抓官方解釋文要旨。

**考古題答案**:一律對照考選部官方標準答案 PDF。PDF 來源(已驗證可用):
- 警察特考三等內軌共同/專業:`kaozen.taipei` 站(URL 路徑含 `113三等內軌共同考題庫與答案.pdf` 等)
- 警佐升警正:`kaozen.taipei/wp-content/uploads/2024/11/113170_<code>_<科目>.pdf`
- 答案 PDF 文字佈局怪 — 第 1 題答案單獨在「第1題\n<答案>」,第 2-10 題答案會塞在 100 格表格末尾的「<10 個字母>」一行;解析時需注意

**大法部(>50 條)WebFetch 行為**:會跳過「條之一」與「刪除」條文,**務必逐一查證補抓**;驗證腳本要檢查主條號連續性與條之一數量。

## 新增/修改的常見動作

**新增一部法條**(從零):
1. WebFetch / curl 取得 `LawAll.aspx?pcode=XXXX` 全文
2. 用 Python re.split 分條,寫成 `data/law-<name>.js`,沿用 `meta`/`articles` 格式,`mcq: []`、`cloze: []` 先空著
3. 在 `data/manifest.js` 註冊一筆,`law: true`,選對 `subject`
4. preview 載入該頁確認章節分隔+搜尋 ok

**新增法條拆解題**(已存在的 `law-*.js`):
1. 直接編輯該檔,把題目 push 進 `mcq[]` / `cloze[]`(同檔內,不另開檔)
2. cloze 必須驗證 `answer ∈ options`
3. 沿用其他 bank 的題目風格:`ref: "第X條 主題"`、`explain` 引法條原文佐證、`quote` 放完整條文段

**申論題**:題目放在 `articles[]`,`no` 用 `"113升-1"` 之類字串(避免被 engine 包成「第 X 條」),`text` 用 markdown 風寫題目+爭點+應引法條+答題架構+關鍵字提示。**只寫骨架,不寫整篇擬答**(申論題無官方標準答案,寫錯誤導使用者)。

**申論題引用的條文/釋字一律要在「法條」科目下能讀到**(使用者明確要求)。引用主科法典之外的零星條文(如道交§35/§73、民§151、毒品危害§4/§10/§11、通保§5)獨立進 `data/law-essay-extras.js`,掛在最相關科目下。

## Memory(交接狀態)

長期細節在使用者個人 memory:
- `~/.claude/projects/-Users-kiki-Desktop-FORCLAUDE/memory/MEMORY.md` 索引
- `project_handoff-state.md` 是核心 — 接手前必讀,內含考試類別、各科現況、待補缺口、踩過的坑

## .nojekyll

根目錄空檔 `.nojekyll` 必須存在(讓 GitHub Pages 不跑 Jekyll,允許底線開頭目錄)。
