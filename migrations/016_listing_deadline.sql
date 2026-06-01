-- 016: optional expiration deadline for listings, mirroring the tasks.deadline pattern.
-- When NOW() crosses expires_at, the listing is swept to status='withdrawn' on the
-- next public read (see listings_sweep_expired in src/handlers/listings.php).

SET NAMES utf8mb4;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL AFTER status,
  ADD INDEX IF NOT EXISTS idx_listings_expires (status, expires_at);
