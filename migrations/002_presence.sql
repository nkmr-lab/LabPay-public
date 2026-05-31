-- LabPay presence (in-lab detection via per-room WiFi scanner)
-- Apply: sudo bash -c "mysql labpay < /var/www/labpay/migrations/002_presence.sql"

SET NAMES utf8mb4;

-- Rooms: one row per physical space we monitor.
-- scanner_token_hash = sha256(plaintext token). Plaintext is shown only once at create time.
CREATE TABLE IF NOT EXISTS rooms (
  id                 VARCHAR(20) PRIMARY KEY,
  display_name       VARCHAR(100) NOT NULL,
  scanner_token_hash CHAR(64) NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_scan_at       DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Devices registered by each user (typically their phone). MAC is lowercase aa:bb:cc:dd:ee:ff.
CREATE TABLE IF NOT EXISTS presence_devices (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  mac         VARCHAR(17) NOT NULL,
  label       VARCHAR(100) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_mac (user_id, mac),
  INDEX idx_mac (mac),
  CONSTRAINT fk_pd_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Observation table: one row per (room, MAC). Upsert keeps it tiny (~hundreds of rows max).
CREATE TABLE IF NOT EXISTS presence_seen (
  room_id      VARCHAR(20) NOT NULL,
  mac          VARCHAR(17) NOT NULL,
  ip           VARCHAR(45) NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (room_id, mac),
  INDEX idx_last_seen (last_seen_at),
  CONSTRAINT fk_ps_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Runtime config keys (added to existing config table)
INSERT IGNORE INTO config (k, v) VALUES
 ('presence_window_minutes', '5');
