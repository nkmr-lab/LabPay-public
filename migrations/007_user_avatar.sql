-- User profile avatar (image URL stored in /uploads/avatars/<random>.<ext>).

SET NAMES utf8mb4;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) NULL AFTER display_name;
