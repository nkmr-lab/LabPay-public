-- v825 Cosense page で 使う 名前 (例: 「中村聡史」) を 個別 に 保存 する 列。
--   user_scrapbox_handles.scrapbox_name (= Slack の display name、 例: 「Satoshi Nakamura」) と
--   別 で、 Cosense 上 の 表示名 で 「YYYY.MM_研究ノート_<name>」 を 組み立てる。
--   未 設定 の 場合 は users.display_name を fallback。
ALTER TABLE users
  ADD COLUMN cosense_page_handle VARCHAR(120) NULL AFTER cosense_pat;
