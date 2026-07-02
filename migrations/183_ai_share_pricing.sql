-- v913 論文要約 / 論文全訳 / DeepResearch の 「共有 = 基本額、 非共有 = 倍額」 モデル導入。
--   share_priced フラグ: 新規 row (v913+ 作成) は 1、 旧 row は 0 で grandfather。
--   PATCH is_shared toggle 時、 share_priced=1 の row だけ 差額を Ledger で 追加課金/返金 する。
--   share_priced=0 の row は 従来通り 「toggle は 表示切替 のみ、 課金無変動」。
ALTER TABLE paper_translates ADD COLUMN share_priced TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_share;
ALTER TABLE paper_full_translations ADD COLUMN share_priced TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_share;
ALTER TABLE deep_researches ADD COLUMN share_priced TINYINT(1) NOT NULL DEFAULT 0 AFTER cost_points;
ALTER TABLE deep_researches ADD COLUMN auto_share TINYINT(1) NOT NULL DEFAULT 0 AFTER share_priced;
