-- 宿泊地 + 航空券 を スケジュールアイテムとは別に集約するためのエンティティ。
-- 「ちょくちょく参照する」 ので 詳細フィールド (部屋番号 / 確認コード等) を保持し、
-- 必要に応じて 「スケジュールに反映」 ボタンで schedule_items に展開する。

CREATE TABLE IF NOT EXISTS adhoc_group_lodgings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  name VARCHAR(200) NOT NULL,
  location VARCHAR(500) NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  check_in_at  DATETIME NULL,
  check_out_at DATETIME NULL,
  room_number VARCHAR(60) NULL,
  url VARCHAR(2000) NULL,
  memo TEXT NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lodging_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodging_user  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_lodging_group (group_id)
);

CREATE TABLE IF NOT EXISTS adhoc_group_flights (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  airline VARCHAR(120) NULL,
  flight_number VARCHAR(40) NULL,
  dep_airport VARCHAR(80) NULL,
  dep_at DATETIME NULL,
  arr_airport VARCHAR(80) NULL,
  arr_at DATETIME NULL,
  confirmation_code VARCHAR(60) NULL,
  seat VARCHAR(60) NULL,
  url VARCHAR(2000) NULL,
  memo TEXT NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flight_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_flight_user  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_flight_group (group_id)
);
