-- v532 #161 体重・BMI 記録 (レコーディングダイエット)。 個人の時系列データ。
CREATE TABLE IF NOT EXISTS health_records (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  recorded_at  DATETIME NOT NULL,
  weight_kg    DECIMAL(5,2) NULL,
  height_cm    DECIMAL(5,1) NULL,
  body_fat_pct DECIMAL(4,1) NULL,
  memo         VARCHAR(200) NULL,
  KEY idx_hr_user_at (user_id, recorded_at),
  CONSTRAINT fk_hr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
