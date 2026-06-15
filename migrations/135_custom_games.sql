-- v617 #236 自作ゲーム フレームワーク。
--   game_kind で 種別を区別 (tictactoe / 将来の自作ゲーム)、
--   汎用 state_json で 任意の game state を 保存。
CREATE TABLE IF NOT EXISTS custom_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_kind       VARCHAR(40) NOT NULL,            -- 'tictactoe', 'connect4', etc.
  creator_user_id BIGINT NOT NULL,
  opponent_user_id BIGINT NULL,
  status          ENUM('waiting','playing','finished','cancelled') NOT NULL DEFAULT 'waiting',
  fee             INT UNSIGNED NOT NULL DEFAULT 1,  -- プレイフィー (= 起案者+参加者がそれぞれ支払う)
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  state_json      MEDIUMTEXT NOT NULL,              -- 任意 (ゲーム実装ごとに自由)
  turn_user_id    BIGINT NULL,                      -- 現手番ユーザ
  winner_user_id  BIGINT NULL,                      -- 勝者 (NULL = 引分 or 未確定)
  finished_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cg_status (game_kind, status, id),
  CONSTRAINT fk_cg_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  CONSTRAINT fk_cg_opp     FOREIGN KEY (opponent_user_id) REFERENCES users(id),
  CONSTRAINT fk_cg_winner  FOREIGN KEY (winner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund',
  'rewriter',
  'custom_game_buyin','custom_game_payout','custom_game_refund'
) NOT NULL;
