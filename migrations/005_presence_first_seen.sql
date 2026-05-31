-- Add first_seen_at to presence_seen so the settings UI can highlight MACs that just appeared.
-- (Helps users find their own MAC via "WiFi off → on" trick.)

SET NAMES utf8mb4;

ALTER TABLE presence_seen
  ADD COLUMN IF NOT EXISTS first_seen_at DATETIME NULL AFTER last_seen_at;

-- Backfill existing rows with last_seen_at so old observations don't all look "brand new"
UPDATE presence_seen SET first_seen_at = last_seen_at WHERE first_seen_at IS NULL;
