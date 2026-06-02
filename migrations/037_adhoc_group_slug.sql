-- グループに URL 用の slug (人間が読める短い識別子) を追加。
-- /#/groups/1 はそのまま動かしつつ、/#/groups/avi2026 みたいなのも許容する。
-- slug は省略可。設定する場合は ^[A-Za-z0-9_-]{1,64}$ かつ全数字は禁止
-- (数字オンリーは既存の numeric id 解決と衝突するため、アプリ層で弾く)。
ALTER TABLE adhoc_groups
  ADD COLUMN IF NOT EXISTS slug VARCHAR(64) NULL UNIQUE AFTER id;
