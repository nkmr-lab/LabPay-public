-- v810 #400 グループ ファイル / 画像 共有。 スケジュール アイテム や 航空券 に 紐 付か ない、
-- グループ 全体 の フリー 共有 領域。 画像 は サムネ 付き で grid 表示、 それ 以外 は 添付 ファイル として。
CREATE TABLE IF NOT EXISTS adhoc_group_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  uploader_user_id BIGINT NOT NULL,
  kind ENUM('image','file') NOT NULL,
  filename VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  thumb_path VARCHAR(500) NULL,
  mime VARCHAR(100) NOT NULL,
  size INT NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agfiles_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_agfiles_user  FOREIGN KEY (uploader_user_id) REFERENCES users(id),
  INDEX idx_agfiles_group (group_id, created_at)
);
