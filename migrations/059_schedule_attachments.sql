-- 予定アイテムに対するファイル添付 (フライトチケット PDF, ホテル予約画像 など)。
-- 画像は image_url 1 枚で別管理しているが、これは複数 OK / 任意 mime 用の汎用添付。
CREATE TABLE IF NOT EXISTS adhoc_group_schedule_attachments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  schedule_item_id BIGINT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  thumb_path VARCHAR(500) NULL,
  mime VARCHAR(100) NOT NULL,
  size INT NOT NULL,
  uploaded_by_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sched_att_item FOREIGN KEY (schedule_item_id) REFERENCES adhoc_group_schedule_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_sched_att_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
  INDEX idx_sched_att_item (schedule_item_id)
);
