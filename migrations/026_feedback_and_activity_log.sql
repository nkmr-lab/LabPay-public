-- User-submitted feedback (bug reports + feature requests). Each entry pings the
-- bootstrap admin via Notifier so they see it the next time they open the app.
-- We don't really need a status/resolution workflow yet — admin can read +
-- triage manually. If volume grows we'll add columns later.
CREATE TABLE IF NOT EXISTS feedback (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  kind          ENUM('bug','feature','other') NOT NULL DEFAULT 'other',
  body          TEXT NOT NULL,
  user_agent    VARCHAR(500) NULL,
  url           VARCHAR(500) NULL,   -- which page they were on
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fb_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX ix_fb_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- App usage log — every authenticated API request gets one row. Kept for
-- future research papers on small-community pt-economy adoption patterns,
-- so we capture as much non-secret context as is cheap (path/method/status,
-- ip, ua, response time). Body is intentionally NOT captured to keep PII
-- (memos, messages) out of the log.
--
-- The table is append-only; indexes are minimal to keep inserts fast.
-- Tail-side queries will be done via a separate analysis cron later.
CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NULL,                 -- NULL for unauthenticated paths
  method      VARCHAR(8)   NOT NULL,
  path        VARCHAR(255) NOT NULL,
  status      INT NOT NULL,
  duration_ms INT NULL,
  ip          VARCHAR(45) NULL,
  user_agent  VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_al_user_time (user_id, created_at),
  INDEX ix_al_path_time (path, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
