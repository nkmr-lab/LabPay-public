-- v1023 実験計画書チェック (中村さん要望「実験計画書をチェックするアプリを追加、 Scrapbox 形式
--   で書かれた実験計画書。 RQ / 仮説の書き方、 仮説と実験の対応、 データの適切さ、 統計手法、
--   サンプルサイズを重視して精査」)。 resume_checks と 同型 で input_text ベース、 20pt/回 flat。
CREATE TABLE IF NOT EXISTS experiment_plan_checks (
    id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    title        VARCHAR(200) NULL,
    input_text   MEDIUMTEXT NOT NULL,
    result_json  MEDIUMTEXT NULL,
    cost_points  INT UNSIGNED NOT NULL DEFAULT 20,
    model        VARCHAR(50) NULL,
    status       ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
    error_msg    TEXT NULL,
    share_token  VARCHAR(64) NULL,
    is_shared    TINYINT NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at  DATETIME NULL,
    UNIQUE KEY uq_share_token (share_token),
    KEY idx_user (user_id, id),
    CONSTRAINT fk_epc_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ledger.type に 'exp_plan_check' を 追加。 既存 の 値 は そのまま。
ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal','transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward','paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund','rewriter',
  'custom_game_buyin','custom_game_payout','custom_game_refund','custom_game_rake','custom_game_play_fee',
  'shiritori_buyin','paper_translate','paper_full_translate','deep_research',
  'exp_plan_check'
) NOT NULL;
