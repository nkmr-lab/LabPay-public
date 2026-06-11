-- v531 #163 行った国 / 都道府県 を 登録 + 可視化 (「制覇したい欲」)。
-- kind = 'country' (ISO 3166-1 alpha-2 e.g. JP, IT, US) or 'prefecture' (JP-13 等)
CREATE TABLE IF NOT EXISTS visited_regions (
  user_id    BIGINT NOT NULL,
  kind       VARCHAR(20) NOT NULL,
  code       VARCHAR(20) NOT NULL,
  visited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kind, code),
  KEY idx_vr_user_kind (user_id, kind),
  CONSTRAINT fk_vr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
