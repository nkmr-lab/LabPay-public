-- v457 シンプル SNS (旧 Twitter 風)。
--  posts          = 投稿 (本文 / 画像 / 位置情報 / 親投稿 ID = 返信用)
--  post_likes     = いいね (post_id × user_id ユニーク)
--  post_mentions = @メンション (受信者 通知用 関連)
-- フォローは なし — 全員 が 全投稿 を 見る。 リポストは なし、 いいね のみ。
CREATE TABLE IF NOT EXISTS posts (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  body        TEXT,
  image_url   VARCHAR(500),
  lat         DECIMAL(9,6),
  lng         DECIMAL(9,6),
  parent_id   BIGINT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_post_parent FOREIGN KEY (parent_id) REFERENCES posts(id) ON DELETE CASCADE,
  INDEX ix_post_created (created_at),
  INDEX ix_post_parent  (parent_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_pl_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pl_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS post_mentions (
  post_id   BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_pm_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
