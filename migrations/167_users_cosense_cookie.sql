-- v822 #cosense 各 ユーザ が 自分 の Cosense (scrapbox.io) connect.sid cookie を 保存 する カラム。
-- サーバ 側 の Cosense API 呼び出し で 「読み取り は 共有 (admin) cookie / 書き込み は 本人 cookie」
-- の 出し分け を する ため。
ALTER TABLE users
  ADD COLUMN cosense_session_cookie VARCHAR(600) NULL AFTER bank_info;
