-- v840 Deep Research / 論文要約 / 論文全訳 の結果に スター を付けられるように。
-- 1 行 = 1 ユーザの 1 スター。 同じ (kind, ref_id) に同じユーザは 1 スターまで (UNIQUE)。
-- スター数の集計はクエリ側で COUNT、 自分のスターは EXISTS で判定する。

CREATE TABLE IF NOT EXISTS ai_result_stars (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('deep_research','paper_translate','paper_full_translation') NOT NULL,
  ref_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kind_ref_user (kind, ref_id, user_id),
  KEY idx_kind_ref (kind, ref_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
