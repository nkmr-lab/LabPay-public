-- v609 #235 勝敗予測 (score prediction)。 試合のスコア (X 対 Y) を予想して 完璧に当てた人が総取り。
CREATE TABLE IF NOT EXISTS score_pred_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,    -- 試合の概要 (例: 「W杯 決勝 日本 vs ブラジル」)
  team_home       VARCHAR(80) NOT NULL,
  team_away       VARCHAR(80) NOT NULL,
  match_at        DATETIME NULL,             -- 試合 開始時刻 (任意)
  deadline_at     DATETIME NULL,             -- 予想 締切 (任意、 試合開始時刻と同じが普通)
  fee             INT UNSIGNED NOT NULL DEFAULT 20,
  status          ENUM('open','closed','finished','cancelled') NOT NULL DEFAULT 'open',
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  actual_home     TINYINT UNSIGNED NULL,     -- 結果 (起案者が登録)
  actual_away     TINYINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_spg_status (status, id),
  CONSTRAINT fk_spg_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS score_pred_entries (
  game_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  guess_home TINYINT UNSIGNED NOT NULL,
  guess_away TINYINT UNSIGNED NOT NULL,
  payout     INT NOT NULL DEFAULT 0,
  is_winner  TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  KEY idx_spe_game (game_id),
  CONSTRAINT fk_spe_game FOREIGN KEY (game_id) REFERENCES score_pred_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_spe_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
