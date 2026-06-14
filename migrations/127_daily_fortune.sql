-- v584 1 日 1 回 占い。 user × date で UNIQUE (= 同じ日に 2 回引けない)。
CREATE TABLE IF NOT EXISTS user_daily_fortunes (
  user_id     BIGINT NOT NULL,
  date_jst    DATE NOT NULL,
  fortune_idx SMALLINT NOT NULL,
  drawn_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date_jst),
  CONSTRAINT fk_udf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
