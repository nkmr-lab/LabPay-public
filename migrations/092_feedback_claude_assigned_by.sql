-- 「Claude に 任せる」 を 押した admin の id を 記録。 Claude が done に する
-- とき に この id を replied_by_user_id に セット して reply 投稿。 投稿者から
-- 見ると 通常の admin 返信と 同じ 体験になる。
ALTER TABLE feedback
  ADD COLUMN claude_assigned_by_user_id BIGINT NULL AFTER claude_assigned_at,
  ADD CONSTRAINT fk_feedback_claude_by FOREIGN KEY (claude_assigned_by_user_id)
      REFERENCES users(id) ON DELETE SET NULL;
