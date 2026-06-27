-- v860 #445 制覇 リスト アプリ。 ユーザ が 自由 に 「中野区 の パン屋」 のような
-- 制覇 対象 リスト を 作って、 アイテム を 追加 + 自分が 達成 した もの を チェック していく。

DROP TABLE IF EXISTS conquest_visits;
DROP TABLE IF EXISTS conquest_items;
DROP TABLE IF EXISTS conquest_lists;

CREATE TABLE conquest_lists (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NULL,
  visibility ENUM('public', 'private') NOT NULL DEFAULT 'public',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_owner (owner_id),
  INDEX idx_visibility (visibility),
  CONSTRAINT fk_cl_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conquest_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  list_id BIGINT NOT NULL,
  name VARCHAR(160) NOT NULL,
  note VARCHAR(400) NULL,
  idx INT NOT NULL DEFAULT 0,
  added_by BIGINT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_list (list_id, idx),
  CONSTRAINT fk_ci_list FOREIGN KEY (list_id) REFERENCES conquest_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_addedby FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conquest_visits (
  list_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  visited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  comment VARCHAR(400) NULL,
  PRIMARY KEY (item_id, user_id),
  INDEX idx_list_user (list_id, user_id),
  CONSTRAINT fk_cv_item FOREIGN KEY (item_id) REFERENCES conquest_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_cv_list FOREIGN KEY (list_id) REFERENCES conquest_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_cv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
