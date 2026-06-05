-- ストップウォッチ (カウントアップ タイマー)。
-- - 共有メンバ間で 同じ 経過時間を 表示 (sync は detail GET 時の server_now で 補正)
-- - 状態: running (動いている) / paused (一時停止) / stopped (リセット 直後 = 0)
-- - elapsed_offset_seconds: paused 時 までに 累積した 秒。 running 中は
--   offset + (NOW() - started_at) が 現在の 経過。 paused 化 で += 経過分。

CREATE TABLE IF NOT EXISTS stopwatches (
  id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
  title                    VARCHAR(200) NOT NULL,
  creator_user_id          BIGINT NOT NULL,
  status                   ENUM('running','paused','stopped') NOT NULL DEFAULT 'stopped',
  started_at               DATETIME NULL,
  elapsed_offset_seconds   INT NOT NULL DEFAULT 0,
  ended_at                 DATETIME NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sw_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_sw_creator (creator_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stopwatch_participants (
  stopwatch_id BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  added_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stopwatch_id, user_id),
  CONSTRAINT fk_swp_sw FOREIGN KEY (stopwatch_id) REFERENCES stopwatches(id) ON DELETE CASCADE,
  CONSTRAINT fk_swp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
