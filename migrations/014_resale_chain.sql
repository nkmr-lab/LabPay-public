-- 014: resale lineage — link a new listing to the purchase the seller is reselling from.
--
-- When you list a product (by JAN) that you yourself recently bought on LabPay, the listing
-- is implicitly a resale. The link lets the UI walk the chain backwards
--   listing -> purchase -> the listing that purchase came from -> the purchase before that ...
-- and show e.g. "中村 -> 田中 -> あなた" on the product page.
--
-- The lookup is best-effort: we don't track unit identity, so we just point at the seller's
-- most recent purchase of the same JAN at insert time.

SET NAMES utf8mb4;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS resold_from_purchase_id BIGINT NULL AFTER display_name,
  ADD INDEX IF NOT EXISTS idx_listings_resold (resold_from_purchase_id);

-- FK is added separately so the migration is idempotent if the column already existed.
ALTER TABLE listings
  ADD CONSTRAINT fk_listings_resold
    FOREIGN KEY (resold_from_purchase_id) REFERENCES purchases(id);
