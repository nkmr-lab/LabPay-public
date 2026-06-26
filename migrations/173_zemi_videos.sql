-- v843 #426 ゼミの動画を URL限定でアップロードしている YouTube からまとめて検索 + 視聴。
-- title / description でキーワード検索、 YouTube 埋め込みでそのまま視聴。
-- ngram の FULLTEXT は labpay 環境で使えるか不明なので、 まずは LIKE %q% でシンプルに。

CREATE TABLE IF NOT EXISTS zemi_videos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NULL,
  youtube_id VARCHAR(20) NOT NULL,
  youtube_url VARCHAR(500) NOT NULL,
  occurred_on DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  KEY idx_youtube_id (youtube_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
