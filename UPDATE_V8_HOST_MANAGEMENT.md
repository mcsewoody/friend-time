# v8 主揪管理更新

2026-11-17。依使用者確認：「結束就是進入存檔，不是兩個按鈕」；只限制首頁紀錄，朋友原連結仍可查看統計。

## 異動

- docs/app.js：主揪編輯名稱、時間與候選日期；修改自己的時間；首頁只列管理憑證紀錄；結束並存檔單一按鈕。
- docs/index.html：資源版本參數 v8。
- database/003_host_edit_private_library.sql：原 friend_time_api 新增 edit_event 與 host_respond；單邀約鎖、管理憑證、候選版本核對；保留未變動答案，時段變動需補答，既有不可改存檔規則保留。不修改 Platform/KMS 或既有邀約資料。
- tests/database.test.mjs、tests/browser-state.test.mjs：新增主揪權限與候選變更、首頁隱私等回歸測試。
- README.md：功能、部署與免登入身分界線。

## 驗證

隔離副本依現有鎖檔安裝測試套件（原 node_modules 載入 jsdom 卡住，未修改原套件目錄）。61 項測試通過，包含 28 項前端、16 項資料庫、17 項日曆／交集。JavaScript 語法與 Git 空白檢查通過。

## 注意

主揪身分依私人管理憑證，不依姓名判定。朋友邀請連結維持單次邀約唯讀查看及進行中填寫權限，不提供任何全庫邀約列表。存檔不可重開；換裝置請保存並使用自己的管理連結。
