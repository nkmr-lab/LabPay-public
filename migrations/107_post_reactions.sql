-- v480 SNS リアクション 多種化 (👍 ❤ ⭐)。
-- post_likes は (post_id, user_id) PK だったが、 (post_id, user_id, kind) に拡張。
-- 既存 行 は kind='heart' (これまでの 「いいね」 = ❤) として 移行。
-- DROP / ADD PRIMARY KEY を 別 ALTER に 分けると post_id への 外部キー の
--   サポート 索引 が 一瞬 消えて errno 150 で 失敗 する ので、 単一 文 に 合体。
ALTER TABLE post_likes
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'heart' AFTER user_id,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (post_id, user_id, kind),
  ADD INDEX idx_post_kind (post_id, kind);
