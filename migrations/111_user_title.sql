-- v483 #76 実績 から AI 生成 した 称号 を キャッシュ。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS achievements_title       VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS achievements_title_hash  VARCHAR(64)  NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS achievements_title_at    DATETIME     NULL DEFAULT NULL;
