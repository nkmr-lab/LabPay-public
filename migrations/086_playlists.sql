-- 音楽 / 動画 プレイリスト 機能。
-- - playlists: タイトル + カバー + 説明 + ジャンル + 公開設定 + 作成者
-- - playlist_items: URL + タイトル + サムネ + メモ + 並び順
-- - playlist_likes: ❤️ 「気に入った」 (user × playlist で 一意)
-- - playlist_item_ratings: 1-5 星 + コメント (user × item で 一意)
-- 閲覧数 は playlists.view_count に 1 ずつ加算 (詳細 GET ヒット毎)。

CREATE TABLE IF NOT EXISTS playlists (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NULL,
  cover_image_url VARCHAR(2000) NULL,
  visibility      ENUM('public','private') NOT NULL DEFAULT 'public',
  genre_tag       VARCHAR(60) NULL,
  view_count      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pl_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_pl_visibility (visibility, created_at),
  INDEX ix_pl_genre (genre_tag),
  INDEX ix_pl_creator (creator_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS playlist_items (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  playlist_id       BIGINT NOT NULL,
  position          INT NOT NULL DEFAULT 0,
  title             VARCHAR(300) NOT NULL,
  url               VARCHAR(2000) NOT NULL,
  -- youtube / spotify_track / spotify_album / spotify_playlist / direct_video / other
  source_type       VARCHAR(40) NOT NULL DEFAULT 'other',
  source_id         VARCHAR(300) NULL,
  thumbnail_url     VARCHAR(2000) NULL,
  duration_sec      INT NULL,
  memo              VARCHAR(500) NULL,
  added_by_user_id  BIGINT NOT NULL,
  added_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pli_playlist FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_user FOREIGN KEY (added_by_user_id) REFERENCES users(id),
  INDEX ix_pli_pl_pos (playlist_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS playlist_likes (
  playlist_id BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, user_id),
  CONSTRAINT fk_pll_playlist FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pll_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS playlist_item_ratings (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  playlist_item_id  BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  rating            TINYINT NOT NULL,           -- 1..5
  comment           VARCHAR(500) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_plir_item FOREIGN KEY (playlist_item_id) REFERENCES playlist_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_plir_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uniq_plir_user (playlist_item_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
