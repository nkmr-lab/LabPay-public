-- 012: per-listing display name override.
-- Sellers sometimes want a different label than the catalog name (e.g. add 「賞味期限近」
-- to clarify a clearance item, or use a friendlier name for a no-JAN handmade item).
-- NULL = fall back to products.name (current behavior).

SET NAMES utf8mb4;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(200) NULL AFTER qty;
