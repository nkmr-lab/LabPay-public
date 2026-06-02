-- feedback (バグ報告 / 機能要望) に admin から返信できるように。
-- 返信が打たれたら replied_at + reply_body を埋めて、投稿者には通知が飛ぶ。
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS replied_at         DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reply_body         TEXT NULL,
  ADD COLUMN IF NOT EXISTS replied_by_user_id BIGINT NULL;
