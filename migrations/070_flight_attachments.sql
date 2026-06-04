-- 航空券 (e-ticket PDF, QR コード画像, 予約画面のスクショ など) を 航空券
-- エンティティに紐づけて添付。 owner_user_id で 「誰のチケットか」 を持つので、
-- 同じ便に乗る複数メンバー分の チケットが整理できる。

CREATE TABLE IF NOT EXISTS adhoc_group_flight_attachments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  flight_id BIGINT NOT NULL,
  owner_user_id BIGINT NOT NULL,            -- 「誰のチケットか」 (グループメンバーから選ぶ)
  uploaded_by_user_id BIGINT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  thumb_path VARCHAR(500) NULL,
  mime VARCHAR(100) NOT NULL,
  size INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fa_flight FOREIGN KEY (flight_id) REFERENCES adhoc_group_flights(id) ON DELETE CASCADE,
  CONSTRAINT fk_fa_owner  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_fa_upload FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
  INDEX idx_fa_flight (flight_id)
);
