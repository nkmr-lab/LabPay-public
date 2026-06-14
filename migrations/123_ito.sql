-- v568 #223 Phase 1: ito アプリ (協力ゲーム: 1〜100 の数字を表現で当てる)
CREATE TABLE IF NOT EXISTS ito_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  theme           VARCHAR(200) NOT NULL,
  status          ENUM('lobby','input','reveal','finished','cancelled') NOT NULL DEFAULT 'lobby',
  buy_in          INT UNSIGNED NOT NULL DEFAULT 1,
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  KEY idx_ig_status (status, id),
  CONSTRAINT fk_itog_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ito_players (
  game_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  number     INT UNSIGNED NULL,
  expression VARCHAR(500) NULL,
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  KEY idx_ip_game (game_id),
  CONSTRAINT fk_itop_game FOREIGN KEY (game_id) REFERENCES ito_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_itop_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
