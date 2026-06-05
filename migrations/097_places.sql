-- v454 行きたい店 / 行ったお店 共有 機能 (food-log 的)。
--  places          = 店 (タイトル + 住所 + lat/lng + 紹介文 + 起案者)
--  place_comments  = 口コミ (body + image_url + rating 1-5)
-- 写真は /api/uploads/image で 上げて URL を 入れる (既存 仕組みの 流用)。
-- ラボメンバー 誰でも 投稿可 (削除は 起案者 / 投稿者 + admin)。

CREATE TABLE IF NOT EXISTS places (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(200) NOT NULL,
  category        VARCHAR(50)  NOT NULL DEFAULT '',
  address         VARCHAR(500),
  lat             DECIMAL(9,6),
  lng             DECIMAL(9,6),
  description     TEXT,
  creator_user_id BIGINT NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_places_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_places_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS place_comments (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  place_id    BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  body        TEXT,
  image_url   VARCHAR(500),
  rating      TINYINT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pc_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX ix_pc_place_created (place_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
