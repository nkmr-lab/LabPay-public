-- v552 #211 #212 論文査読 拡張: 結果保存 + 共有 URL + プロンプト編集 + 課金 + 共有対象通知

CREATE TABLE IF NOT EXISTS paper_reviews (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  share_token     CHAR(32) NOT NULL UNIQUE,
  pdf_name        VARCHAR(255) NULL,
  target_venue    VARCHAR(200) NULL,
  strictness      VARCHAR(20) NULL,
  prompt_used     MEDIUMTEXT NULL,
  sections_json   MEDIUMTEXT NULL,
  review_json     MEDIUMTEXT NULL,
  cost_points     INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pr_user (user_id, id),
  KEY idx_pr_token (share_token),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自分専用 (per-user) の設定: カスタム system prompt + 共有対象 user_ids JSON
CREATE TABLE IF NOT EXISTS user_paper_review_settings (
  user_id            BIGINT NOT NULL PRIMARY KEY,
  custom_prompt      MEDIUMTEXT NULL,
  share_target_ids   MEDIUMTEXT NULL,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_uprs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
