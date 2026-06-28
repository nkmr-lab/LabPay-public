-- v872 #454 早押し クイズ (リアル現場 で 出題者 が 出題、 参加者 が スマホ で 早押し)。
-- 反応時間 は クライアント が ラウンド 開始 を 検知 した 瞬間 から の 経過 ms を 自前 計測 +
-- サーバ に 送る (= サーバ ラウンド トリップ を 待たない)。

DROP TABLE IF EXISTS buzzer_taps;
DROP TABLE IF EXISTS buzzer_sessions;

CREATE TABLE buzzer_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title VARCHAR(160) NOT NULL,
  status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
  round_no INT UNSIGNED NOT NULL DEFAULT 0,
  round_started_at DATETIME(3) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_updated (status, updated_at),
  CONSTRAINT fk_bs_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE buzzer_taps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT NOT NULL,
  round_no INT UNSIGNED NOT NULL,
  user_id BIGINT NOT NULL,
  elapsed_ms INT UNSIGNED NOT NULL,
  server_received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_session_round_user (session_id, round_no, user_id),
  INDEX idx_round (session_id, round_no, elapsed_ms),
  CONSTRAINT fk_bt_session FOREIGN KEY (session_id) REFERENCES buzzer_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_bt_user    FOREIGN KEY (user_id)    REFERENCES users(id)            ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
