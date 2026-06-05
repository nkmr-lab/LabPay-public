-- グループ 行きたい場所 / 予定 への ❤️ (= 「行った / 良いね」 マーク)。
-- (item, user) で 一意 → 各人 1 個ずつ。
CREATE TABLE IF NOT EXISTS adhoc_group_schedule_item_hearts (
  item_id     BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, user_id),
  CONSTRAINT fk_agsih_item FOREIGN KEY (item_id) REFERENCES adhoc_group_schedule_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_agsih_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_agsih_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- グループ メンバー の リアルタイム 位置共有。 (group, user) で UPSERT。
-- 1 グループ × 1 user の 直近位置だけ持つ。 古い ping は updated_at で 古さ 判定。
CREATE TABLE IF NOT EXISTS adhoc_group_locations (
  group_id     BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  lat          DECIMAL(10, 7) NOT NULL,
  lng          DECIMAL(10, 7) NOT NULL,
  accuracy_m   INT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_agl_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_agl_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_agl_updated (group_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
