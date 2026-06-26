-- v841 #424 ハート/ブックマーク を 一覧の ⭐ と統合。
-- 既存 paper_reactions.like → ai_result_stars に転送、
-- paper_reactions.bookmark → 新規 ai_result_bookmarks に転送。
-- paper_reactions テーブル自体は当面残す (ロールバック用)。 古いコード経路は v841 以降使わない。

CREATE TABLE IF NOT EXISTS ai_result_bookmarks (
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

-- paper_reactions の like → ai_result_stars に コピー (重複は INSERT IGNORE)
INSERT IGNORE INTO ai_result_stars (kind, ref_id, user_id, created_at)
SELECT pr.ref_type, pr.ref_id, pr.user_id, pr.created_at
  FROM paper_reactions pr
 WHERE pr.kind = 'like'
   AND pr.ref_type IN ('paper_translate','paper_full_translation');

-- paper_reactions の bookmark → ai_result_bookmarks に コピー
INSERT IGNORE INTO ai_result_bookmarks (kind, ref_id, user_id, created_at)
SELECT pr.ref_type, pr.ref_id, pr.user_id, pr.created_at
  FROM paper_reactions pr
 WHERE pr.kind = 'bookmark'
   AND pr.ref_type IN ('paper_translate','paper_full_translation');
