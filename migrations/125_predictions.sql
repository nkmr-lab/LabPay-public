-- v576 優勝予想アプリ。 ワールドカップ等の順位を予想 → 答え合わせで配分。
CREATE TABLE IF NOT EXISTS predictions_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     VARCHAR(1000) NULL,
  fee             INT UNSIGNED NOT NULL DEFAULT 50,
  predict_count   TINYINT UNSIGNED NOT NULL DEFAULT 1, -- 1, 2, 4 (1位のみ / 1-2位 / 1-4位)
  candidates_json MEDIUMTEXT NOT NULL,                  -- [{id, name, flag?}]
  status          ENUM('open','closed','finished','cancelled') NOT NULL DEFAULT 'open',
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  actual_json     MEDIUMTEXT NULL,                      -- 正解の順位 [cand_id_1, cand_id_2, ...]
  deadline_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_pg_status (status, id),
  CONSTRAINT fk_pg_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS predictions_entries (
  game_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  ranks_json MEDIUMTEXT NOT NULL,    -- [cand_id_1, cand_id_2, ...] (predict_count 個)
  score      INT NOT NULL DEFAULT 0,
  payout     INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  KEY idx_pe_game (game_id),
  CONSTRAINT fk_pe_game FOREIGN KEY (game_id) REFERENCES predictions_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_pe_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
