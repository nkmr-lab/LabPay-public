-- v590 大富豪 (シンプル MVP)。 4 人 対戦、 1 ゲーム 1pt。
CREATE TABLE IF NOT EXISTS daifugo_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  status          ENUM('lobby','playing','finished','cancelled') NOT NULL DEFAULT 'lobby',
  fee             INT UNSIGNED NOT NULL DEFAULT 1,
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  -- {players: [{uid, hand: [cards], rank: null, passed: false}], turn: 0, last_play: null,
  --   pass_count: 0, finished_ranks: []}
  state_json      MEDIUMTEXT NOT NULL,
  state_ver       INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_df_status (status, id),
  CONSTRAINT fk_df_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daifugo_players (
  game_id     BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  seat        TINYINT NOT NULL,
  joined_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  CONSTRAINT fk_dfp_game FOREIGN KEY (game_id) REFERENCES daifugo_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_dfp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund'
) NOT NULL;
