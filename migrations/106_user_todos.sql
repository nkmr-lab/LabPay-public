-- v478 ユーザ ごと の TODO (やる こと メモ)。 サーバ側 で 保持、 端末間 共有。
CREATE TABLE IF NOT EXISTS user_todos (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  body       VARCHAR(1000) NOT NULL,
  done_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_ut_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_ut_user_open (user_id, done_at, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
