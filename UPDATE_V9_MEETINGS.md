# v9 會議主題

2026-11-17。新增 D・會議：上午 1（09:00–10:30）、上午 2（10:30–12:00）、下午 1（13:30–15:30）、下午 2（15:30–17:00）。

## 檔案

- docs/domain.mjs：meeting 類型、am1/am2/pm1/pm2 與四時段排序。
- docs/app.js：建立主題、預設時段、月週曆四列、時間摘要、無障礙標籤與統計時間範圍。
- docs/style.css、docs/index.html：四列版型與 v9 快取參數。
- database/004_meeting_slots.sql：擴充驗證與 API 類型；保留主揪權限、編輯版本核對、回覆、追加、存檔及可還原刪除。不變更既有邀約文件。
- tests/domain.test.mjs、tests/database.test.mjs、tests/browser-state.test.mjs：排序、四時段、類型隔離、時間驗證、回覆、追加待補答、時段修改與存檔回歸測試。
- README.md：使用與 migration 說明。

## 檢查

66 項隔離測試通過；JavaScript 語法與 Git 空白檢查通過。使用前次隔離套件目錄，未變更原 node_modules。正式環境只需套用 004，禁止重跑 001／002。
