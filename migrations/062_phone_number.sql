-- 緊急連絡用の電話番号 (任意)。 ラボメンバ間に共有 (ログインユーザのみ閲覧可)。
-- 形式は柔軟に文字列で持つ (国際フォーマット, ハイフン許容)。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50) NULL;
