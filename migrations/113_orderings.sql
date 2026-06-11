-- v523 #160 順番決め (発表順 / 当番割 など 任意の並び順 を 決めて 通知)。
-- ルーレット (1 人 を 選ぶ) の 全員順列 版。 シャッフルは CSPRNG (PHP random_int)。
-- 注: users.id は bigint(20) NOT NULL なので こちらも BIGINT で合わせる。
CREATE TABLE IF NOT EXISTS orderings (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  created_at      DATETIME NOT NULL,
  notified_at     DATETIME NULL,
  KEY idx_ord_creator (creator_user_id, id),
  CONSTRAINT fk_ord_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ordering_results (
  ordering_id BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  position    INT UNSIGNED NOT NULL,
  PRIMARY KEY (ordering_id, user_id),
  KEY idx_ord_pos (ordering_id, position),
  CONSTRAINT fk_ord_res_ord  FOREIGN KEY (ordering_id) REFERENCES orderings(id) ON DELETE CASCADE,
  CONSTRAINT fk_ord_res_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
