-- v529 #164 食べある記の 「行った」 (足跡) マーク。 ❤️ いいね (place_likes) とは別軸で、
--   実際に行った場所を 1 回タップで記録。 行った回数の集計や 個人の制覇感に使う。
CREATE TABLE IF NOT EXISTS place_visits (
  place_id   BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  visited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (place_id, user_id),
  KEY idx_pv_user (user_id, visited_at),
  CONSTRAINT fk_pv_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_pv_user  FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
