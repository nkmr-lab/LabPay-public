-- v553 #209 麻雀 Phase 1: 4人卓の 賭けプール + 結果分配 (実ゲームは外部、 結果だけ申告)。
--   50pt × 4 人 = pot 200pt → 場代 10pt (5%) → 1位 100 (50%) / 2位 60 (30%) / 3位 30 (15%) / 4位 0

CREATE TABLE IF NOT EXISTS mahjong_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NULL,
  buy_in          INT UNSIGNED NOT NULL DEFAULT 50,
  status          ENUM('lobby','playing','reporting','finished','cancelled') NOT NULL DEFAULT 'lobby',
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  rake_pct        INT UNSIGNED NOT NULL DEFAULT 5,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  KEY idx_mg_status (status, id),
  CONSTRAINT fk_majg_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mahjong_players (
  game_id        BIGINT NOT NULL,
  user_id        BIGINT NOT NULL,
  seat_order     INT UNSIGNED NOT NULL,
  joined_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_rank    INT UNSIGNED NULL,
  payout         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, user_id),
  KEY idx_mp_game (game_id, seat_order),
  CONSTRAINT fk_majp_game FOREIGN KEY (game_id) REFERENCES mahjong_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_majp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
