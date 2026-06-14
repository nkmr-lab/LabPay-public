-- v583 #225 レジュメ原稿チェック (paper-review の 軽量版、 1-2 ページ短原稿向け)
CREATE TABLE IF NOT EXISTS resume_checks (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  title        VARCHAR(200) NULL,
  input_text   MEDIUMTEXT NOT NULL,
  result_json  MEDIUMTEXT NULL,
  cost_points  INT UNSIGNED NOT NULL DEFAULT 5,
  status       ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
  error_msg    TEXT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  KEY idx_user (user_id, id),
  CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout'
) NOT NULL;
