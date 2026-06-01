-- 011: optional pickup-location field for listings.
-- Sellers can pick from common spots (10F 冷蔵庫 etc.) or type a free description.
-- Stored as a free-text VARCHAR so we don't need a separate locations table.

SET NAMES utf8mb4;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS location VARCHAR(100) NULL AFTER completion_message;
