-- v368 募集に 「募集締切」 を別途追加。
-- starts_at は イベント開始時刻、 signup_closes_at は 「これ以降は参加表明を受け付けない」 時刻。
-- 例: 「19:00 始まりだけど 17:00 までに参加表明してね」 = starts_at 19:00, signup_closes_at 17:00。
ALTER TABLE invitations
  ADD COLUMN signup_closes_at DATETIME NULL AFTER starts_at,
  ADD INDEX ix_inv_signup_closes (signup_closes_at);
