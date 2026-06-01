-- 017: log of completed presence sessions.
--
-- When the scan handler detects a "fresh entry" (gap from previous last_seen_at
-- exceeds presence_reentry_threshold_minutes), the old session is over. Before
-- the session_start_at gets overwritten, the closed session is logged here so
-- we can aggregate cumulative lab time later (per user, per day, per room).
--
-- user_id may be NULL if the MAC was never registered to anyone.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS presence_sessions (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT NULL,
  mac              VARCHAR(17)  NOT NULL,
  room_id          VARCHAR(20)  NOT NULL,
  started_at       DATETIME     NOT NULL,
  ended_at         DATETIME     NOT NULL,
  duration_minutes INT          NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pres_sess_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_pres_sess_user (user_id, started_at),
  INDEX idx_pres_sess_room (room_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
