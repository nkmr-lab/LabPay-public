-- グループのレシートストック。撮るだけ撮っておいて、後で 「これを ワリカ に
-- 使う」 という二段運用。 image_url は /uploads/<file>.<ext>。
-- taken_at と lat/lng は client から送信 (NULL 許容)、 GPS は許可された時のみ。
CREATE TABLE IF NOT EXISTS adhoc_group_receipts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  group_id BIGINT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  uploaded_by_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  taken_at DATETIME NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  INDEX idx_group (group_id, id)
);
