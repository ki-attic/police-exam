# 報告模式（LM 模式）使用說明

仿 NotebookLM 的「來源 → 報告」工作流。把素材放進這個資料夾，跟 Claude 說「做報告」，
就會根據來源產出簡報（.pptx）或其他格式，輸出到 `../reports/`。

## 怎麼用（3 步）
1. 把來源檔丟進這個 `sources/` 資料夾
   - 支援：PDF、Word(.docx)、純文字(.txt/.md)、圖片，或直接貼文字
2. 跟 Claude 說：「用 sources 裡的資料做一份 ○○ 報告」
3. 成品會放到 `../reports/`，檔名格式：`YYYYMMDD_主題.pptx`

## 規則（重要）
- **只根據來源寫，不憑記憶生成**。來源沒寫到的，不會自己編。
- **法條一律以全國法規資料庫（law.moj.gov.tw）官方原文為準**，並標註最新修正日期。
- 每份報告結尾附「來源清單」，標明每一頁的依據。

## 預設簡報版型
- 封面（主題 + 科目 + 日期）
- 重點頁：一個概念一頁，標題 = 概念名，內文 = 條號 + 白話拆解
- 易混淆 / 考點提醒頁
- 來源清單頁

## 目前可直接當來源的現成素材
police-exam 題庫本身就是來源，例如：
- `data/law-criminal.js`（刑法，來源：全國法規資料庫，115.03.13 修正）
- `data/law-criminal-procedure.js`（刑事訴訟法）
- `data/law-police-duty.js`、`data/law-social-order.js` 等各科法條
