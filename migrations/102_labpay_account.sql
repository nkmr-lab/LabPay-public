-- v465 LabPay 公式 アカウント (system user) + feedback ⇄ posts ブリッジ。
-- 1) display_name='LabPay' / kind='system' の system user を 1 つ 用意。
-- 2) posts に feedback_id 列 を 追加 — 「この 投稿 は feedback#N と 紐付く」
--    関係 を 持つ。 LabPay 公式 アカウント が:
--      a. リリースした 機能 を SNS に 投稿 (feedback_id = 元 feedback の id)
--      b. ユーザ の SNS 投稿 が @LabPay メンション なら feedback として 起票
--    に 使う。

-- 1) LabPay system user (なければ 作成)。 email は ログイン 不可 と わかる 形 で 設定。
INSERT INTO users (display_name, email, role, kind, created_at)
SELECT 'LabPay', 'labpay-system@localhost', 'member', 'system', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE display_name='LabPay' AND kind='system');

-- 2) posts.feedback_id を 追加。 NULL = 通常投稿。
ALTER TABLE posts
  ADD COLUMN feedback_id BIGINT NULL AFTER parent_id,
  ADD CONSTRAINT fk_post_fb FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE SET NULL,
  ADD INDEX ix_post_fb (feedback_id);
