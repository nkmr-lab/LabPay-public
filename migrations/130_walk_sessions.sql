-- v589 散歩 セッション (歩いた軌跡を 記録)。
CREATE TABLE IF NOT EXISTS walk_sessions (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at    DATETIME NULL,
  points_json MEDIUMTEXT NOT NULL,  -- [[lat,lon,t], ...]
  total_meters INT UNSIGNED NOT NULL DEFAULT 0,
  total_steps INT UNSIGNED NOT NULL DEFAULT 0,
  KEY idx_user (user_id, id),
  CONSTRAINT fk_ws_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
