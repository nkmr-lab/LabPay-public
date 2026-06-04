-- 重要連絡 / 学会情報 を ピン留め型のシンプルリストで管理。
-- カテゴリで分けて 「重要連絡」 「学会情報」 を同じテーブルで扱う。
CREATE TABLE IF NOT EXISTS notices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(40) NOT NULL,   -- 'important' or 'conference'
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  url VARCHAR(2000) NULL,
  posted_by_user_id BIGINT NOT NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  CONSTRAINT fk_notice_user FOREIGN KEY (posted_by_user_id) REFERENCES users(id),
  INDEX idx_notice_cat_created (category, created_at)
);
