-- v613 文字数 / 単語数制限 リライター。 GPT で原稿を制限内に書き直す。
CREATE TABLE IF NOT EXISTS rewriter_tasks (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  source_text  MEDIUMTEXT NOT NULL,
  -- 'chars_no_space' = スペースなし文字数、 'chars_with_space' = スペース込み文字数、 'words' = 英単語数
  target_mode  ENUM('chars_no_space','chars_with_space','words') NOT NULL,
  target_count INT UNSIGNED NOT NULL,
  detected_lang VARCHAR(8) NULL,            -- 'ja' or 'en'
  rewritten_text MEDIUMTEXT NULL,
  source_chars_with_space INT UNSIGNED NULL,
  source_chars_no_space   INT UNSIGNED NULL,
  source_words            INT UNSIGNED NULL,
  rewritten_chars_with_space INT UNSIGNED NULL,
  rewritten_chars_no_space   INT UNSIGNED NULL,
  rewritten_words            INT UNSIGNED NULL,
  source_translation    MEDIUMTEXT NULL,    -- 英文の場合、 和訳
  rewritten_translation MEDIUMTEXT NULL,
  iterations   INT UNSIGNED NOT NULL DEFAULT 0,
  cost_points  INT UNSIGNED NOT NULL DEFAULT 1,
  status       ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
  error_msg    TEXT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  KEY idx_user (user_id, id),
  CONSTRAINT fk_rw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund',
  'rewriter'
) NOT NULL;
