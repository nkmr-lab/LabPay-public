-- v587 地雷オセロ。 各プレイヤー 2 か所 地雷 設定 → 踏むと 3x3 反転。
CREATE TABLE IF NOT EXISTS othello_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  opponent_user_id BIGINT NULL,
  status          ENUM('waiting','mine_setup','playing','finished','cancelled') NOT NULL DEFAULT 'waiting',
  fee             INT UNSIGNED NOT NULL DEFAULT 1,
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  -- 8x8 = 64 cells。 0=空, 1=黒(creator), 2=白(opponent)
  board_json      MEDIUMTEXT NOT NULL,
  -- {creator: ['00','77'], opponent: ['25','62']} など (各 2 cell)
  mines_json      MEDIUMTEXT NULL,
  -- 露見した地雷の位置 (UI に 「ここ地雷だった」 を表示)
  triggered_mines_json MEDIUMTEXT NULL,
  -- 'creator' (黒) | 'opponent' (白)
  turn_side       ENUM('creator','opponent') NOT NULL DEFAULT 'creator',
  winner          ENUM('creator','opponent','draw') NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_oth_status (status, id),
  CONSTRAINT fk_oth_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  CONSTRAINT fk_oth_opp FOREIGN KEY (opponent_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund'
) NOT NULL;
