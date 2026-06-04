-- 共有タイマー: 参加者全員で 同じカウントダウンを 見る。
-- サーバ側に started_at / ends_at を持って、 client は server_now を受け取って
-- ローカル時計とのズレを補正 + 自前で 1 秒刻みでカウントダウン。
CREATE TABLE IF NOT EXISTS timers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  creator_user_id BIGINT NOT NULL,
  duration_seconds INT NOT NULL,
  started_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('running','done','cancelled') NOT NULL DEFAULT 'running',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  CONSTRAINT fk_timer_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX idx_timer_status_ends (status, ends_at)
);

CREATE TABLE IF NOT EXISTS timer_participants (
  timer_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (timer_id, user_id),
  CONSTRAINT fk_tp_timer FOREIGN KEY (timer_id) REFERENCES timers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_user  FOREIGN KEY (user_id)  REFERENCES users(id)
);
