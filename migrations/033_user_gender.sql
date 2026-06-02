-- 性別カラム (新歓ワリカン等の自動振り分け用)。
-- 'M' 男 / 'F' 女 / 'X' その他・公開しない。NULL = 未設定。
-- 新歓割り勘の [男] [女] バルク選択ボタンの絞り込みに使う。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender ENUM('M','F','X') NULL AFTER grade;
