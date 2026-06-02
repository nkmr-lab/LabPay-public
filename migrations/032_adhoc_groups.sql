-- 暫定グループ (出張中の臨時メンバー枠など). Members can post free-form
-- items (memo / URL / time) into a shared feed, and the group page links
-- through to ルーレット + 飲み会割り勘 with the member list pre-filled.

CREATE TABLE IF NOT EXISTS adhoc_groups (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NULL,
  closed_at       DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ag_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS adhoc_group_members (
  group_id  BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_agm_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_agm_user  FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS adhoc_group_items (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id            BIGINT NOT NULL,
  kind                ENUM('memo','url','time') NOT NULL DEFAULT 'memo',
  body                TEXT NULL,
  url                 VARCHAR(2000) NULL,
  scheduled_at        DATETIME NULL,
  created_by_user_id  BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agi_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_agi_user  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_agi_group_time (group_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
