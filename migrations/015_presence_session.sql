-- 015: presence session tracking.
--
-- New column: presence_seen.session_start_at.
--   Set to NOW() whenever the (room, mac) row is freshly created OR the gap from the
--   previous last_seen_at exceeds presence_reentry_threshold_minutes (default 10).
--   Otherwise preserved.
--
-- This unlocks two features:
--   * Stay duration display ("ラボに居て XX 分" on the home presence card).
--   * Streak gating: auto-checkin only fires on a fresh entry (gap >= threshold).
--     Leaving a phone in the lab overnight no longer counts the next day's scan
--     as "showed up" — you actually have to step out and come back.

SET NAMES utf8mb4;

ALTER TABLE presence_seen
  ADD COLUMN IF NOT EXISTS session_start_at DATETIME NULL AFTER last_seen_at;

-- New runtime knob; threshold (in minutes) for "you have re-entered the lab".
INSERT IGNORE INTO config (k, v) VALUES ('presence_reentry_threshold_minutes', '10');
