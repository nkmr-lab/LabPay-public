-- LabPay calendar (workday awareness for streaks) + room geolocation.
-- Apply: sudo bash -c "mysql labpay < /var/www/labpay/migrations/003_calendar_geo.sql"

SET NAMES utf8mb4;

-- Japanese national holidays (auto-synced from Cabinet Office CSV).
CREATE TABLE IF NOT EXISTS national_holidays (
  holiday_date  DATE PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  synced_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Manual calendar overrides set by admin:
--   lab_closed = a weekday/workday that is NOT a workday (lab closed)
--   lab_open   = a weekend/holiday that IS a workday (lab open: e.g. 補講・休日授業日)
CREATE TABLE IF NOT EXISTS calendar_overrides (
  override_date DATE PRIMARY KEY,
  kind          ENUM('lab_closed','lab_open') NOT NULL,
  label         VARCHAR(200) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id BIGINT NULL,
  CONSTRAINT fk_co_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Geolocation per room. NULL lat/lng means geo-checkin not available for that room.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS lat          DECIMAL(10, 7) NULL,
  ADD COLUMN IF NOT EXISTS lng          DECIMAL(10, 7) NULL,
  ADD COLUMN IF NOT EXISTS geo_radius_m INT NULL;

-- New runtime config keys
INSERT IGNORE INTO config (k, v) VALUES
 ('geo_default_radius_m', '50'),
 ('national_holidays_last_sync', '');
