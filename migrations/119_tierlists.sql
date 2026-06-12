-- v549 #210 ティア表 (Tier List)。 起案者がお題 + 候補リストを作って、 参加者が
--   各候補を S/A/B/C/D/F の 6 段階に振り分け。 提出後、 他の人の表が見える。

CREATE TABLE IF NOT EXISTS tierlists (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     VARCHAR(500) NULL,
  -- 候補リスト JSON: [{"id":"a1","label":"候補名","image_url":null}, ...]
  items_json      MEDIUMTEXT NOT NULL,
  -- 段階の定義 JSON: [{"key":"S","label":"S","color":"#ff6b6b"}, ...]
  tiers_json      MEDIUMTEXT NULL,
  is_closed       TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tl_created (created_at),
  CONSTRAINT fk_tl_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 各 user の 解答。 各 item を 各 tier に置く。
-- assignments_json: {"a1":"S","a2":"B",...}
CREATE TABLE IF NOT EXISTS tierlist_answers (
  tierlist_id      BIGINT NOT NULL,
  user_id          BIGINT NOT NULL,
  assignments_json MEDIUMTEXT NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tierlist_id, user_id),
  KEY idx_ta_user (user_id),
  CONSTRAINT fk_tieransw_list FOREIGN KEY (tierlist_id) REFERENCES tierlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_tieransw_user FOREIGN KEY (user_id)    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
