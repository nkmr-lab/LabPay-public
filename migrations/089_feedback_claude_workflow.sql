-- feedback (バグ報告 / 機能要望) に Claude 自動対応 ワークフローを 追加。
--   * claude_status = 'none' (デフォ) → admin がレビュー後 'approved' に
--     昇格すると Claude が 拾って 'working' → 完了で 'done' / 中断で 'blocked'
--   * 各遷移タイミングを *_at で 記録、 完了サマリを 1 段落 で 残す。
--   * (claude_status, claude_assigned_at) で indexed → cron が 「approved 最古」 を
--     LIMIT 1 で 取得しやすい。

ALTER TABLE feedback
  ADD COLUMN claude_status        ENUM('none','approved','working','done','blocked') NOT NULL DEFAULT 'none',
  ADD COLUMN claude_assigned_at   DATETIME NULL,
  ADD COLUMN claude_started_at    DATETIME NULL,
  ADD COLUMN claude_finished_at   DATETIME NULL,
  ADD COLUMN claude_summary       TEXT NULL,
  ADD INDEX ix_feedback_claude (claude_status, claude_assigned_at);
