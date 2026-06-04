-- v350 運動実績。 DeviceMotion で 歩数を取って ラボメンバー間で 競う。
--   * exercise_sessions: 1 セッション = ON にしてから OFF にするまでの 区間
--   * 集計は (user_id, DATE(started_at)) で 日次。 今週 / 今月 などは集計関数で。
CREATE TABLE IF NOT EXISTS exercise_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  step_count INT NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_es_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_es_user_when (user_id, started_at)
);
