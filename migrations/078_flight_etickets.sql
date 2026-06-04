-- v354 航空券 e-ticket (QR 表示) を 人ごとに 登録。
--   * qr_payload: QR にエンコードする 文字列 (Apple Wallet パスやチェックイン URL、 予約番号など)
--   * seat: 座席番号 (任意)
--   * booking_ref: 予約番号 / PNR (任意)
--   * note: メモ (任意)
-- 1 flight x 1 user に複数 e-ticket を許す (往復 で 2 個など)。

CREATE TABLE IF NOT EXISTS adhoc_group_flight_etickets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  flight_id BIGINT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  created_by_user_id BIGINT NOT NULL,
  qr_payload VARCHAR(2048) NOT NULL,
  seat VARCHAR(50) NULL,
  booking_ref VARCHAR(100) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fe_flight FOREIGN KEY (flight_id) REFERENCES adhoc_group_flights(id) ON DELETE CASCADE,
  CONSTRAINT fk_fe_owner  FOREIGN KEY (owner_user_id)     REFERENCES users(id),
  CONSTRAINT fk_fe_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_fe_flight (flight_id)
);
