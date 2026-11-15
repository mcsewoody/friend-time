# 有空一起 · 朋友約時間

免登入的聚餐／上課時間協調工具。主揪圈選候選時間，朋友各自排除不能參加的時段，以月曆或週曆查看交集。

正式網站：https://comartgroup.github.io/friend-time/

## 使用

1. 選吃飯（午餐／晚餐）或上課（整天），填邀約名稱、主揪和選填名單。
2. 在月曆圈選可行時間，建立邀約。
3. 把「邀請連結」分享給朋友，保留私人「主揪管理連結」。
4. 朋友選名字、標記不行的時段，按「確認送出」。未送出不計入。
5. 查看共同時間；若無交集，顯示最多人可參加的前三個時段。
6. 主揪可追加日期、確定日期、結束或重新開放。新增日期必須補答，不會自動算大家有空。

持邀請連結可看到參與者名字及回覆。暱稱非身分驗證；已認領的名字只能使用原裝置記住的憑證或私人修改連結更新。請妥善保留管理與修改連結。沒有郵件、登入或私人連結找回功能。

## 技術

- `docs/`：原生 HTML、CSS、ES modules；不需前端建置，GitHub Pages 發布 main 的 `/docs`。
- `docs/config.js`：Supabase 公開專案 URL／publishable key；不得放 service-role 或資料庫密碼。
- `database/001_friend_time.sql`：獨立 `friend_time_private` schema，資料表開啟 RLS 且不給匿名直接存取。僅公開受限 RPC `friend_time_api`。
- 管理／個人憑證使用兩個 UUID 的隨機字串；資料庫只保存 SHA-256 雜湊。連結使用 hash fragment，且頁面設 no-referrer。
- 每次寫入鎖定單一邀約列，避免不同人同時提交互相覆蓋；提交時檢查完整候選清單，防止追加日期與送出競態。
- 名單上限 60 人（含主揪），候選時段 366 個，日期範圍今天起兩年內。建立邀約全域限制每小時 300 筆。
- 前景頁面每 20 秒同步；有未送出變更時暫停自動覆寫，較早送出的同步請求也不能蓋掉新修改。可按「更新」立即讀取，並保留未送出的選擇。
- 固定台灣日期／時段；未串接個人行事曆或自動提醒。

目前資料庫沿用使用者指定的 Platform／KMS Supabase 專案，僅新增本 App 的 schema 與 RPC，不修改 Platform/KMS 資料表、代理或登入機制。資料保存至管理者於資料庫處理，第一版沒有自動刪除或到期清除。既有專案用量與費用由原專案方案管理。

## 本機預覽與測試

需 Node.js 22+、Python 3。

```sh
npm ci
npm test
npm run serve
```

開啟 http://localhost:4173 。資料庫測試用 PGlite 的隔離記憶體 PostgreSQL，前端狀態測試用 jsdom 與模擬網路，均不連線正式資料庫。`docs/config.js` 的實際網頁則連線正式專案；請把人工測試邀約標明「測試」。

## 自行部署

1. 在自己的 Supabase 專案 SQL Editor 執行 `database/001_friend_time.sql` 一次。這是新增 migration，已套用後不要重跑；後續以新 migration 擴充。
2. 修改 `docs/config.js` 的專案網址和公開 publishable key。
3. 將程式推到 GitHub，Settings → Pages → Deploy from a branch → `main` / `/docs`。
4. 驗證建立、朋友回覆、修改、追加日期、確定日期與權限拒絕流程。

官方參考：[Supabase Database Functions](https://supabase.com/docs/guides/database/functions)、[GitHub Pages 發布來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## SOL 第二輪審查

- 修正慢速同步回應覆蓋未送出答案，以及舊同步回應覆蓋較新提交結果的競態。
- 修正統計頁同步後，切回填寫時仍顯示舊個人答案的問題。
- 私人修改連結經伺服器驗證後會在新裝置記住身分。
- 手動更新保留未送出答案，新增時段明確列為待補答，送出前另行確認。
- 送出期間鎖定主要介面，避免重複操作；網路失敗可保留答案重試。
- 日期按鈕支援鍵盤連續操作、手機觸控面積；統計畫面的輔助標籤不再混入個人答案。
- 程式格式化便於後續維護；資料庫 schema 與既有邀約資料沿用。
