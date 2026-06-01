-- 013: "これどうぞ!" gift listings + thanks log.
--
-- Rather than allowing price = 0 (which framings the item as "worth nothing"), we add an
-- explicit is_gift flag. Sellers tick a 「これどうぞ!」 toggle; the listing renders with a
-- gift badge instead of a pt amount, no fee / no ledger movement on "purchase," and the
-- buyer can send a thank-you message (and optionally a tip) afterwards.
--
-- We relax the price > 0 check so gift listings can store price = 0 cleanly; the
-- application layer still requires price > 0 for sale listings.

SET NAMES utf8mb4;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_gift TINYINT(1) NOT NULL DEFAULT 0 AFTER price;

ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_price;
ALTER TABLE listings ADD CONSTRAINT chk_price CHECK (price >= 0);

-- Thanks log — one row per "お礼" sent. Anyone who appears in the purchase as buyer
-- can send a thank-you to the seller (one or more times). Tip transfer (if any) is
-- referenced by ledger_id so we can show "with X pt" in history later.
CREATE TABLE IF NOT EXISTS purchase_thanks (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT NOT NULL,
  from_user_id BIGINT NOT NULL,
  to_user_id   BIGINT NOT NULL,
  message      TEXT NULL,
  tip_amount   INT NOT NULL DEFAULT 0,
  ledger_id    BIGINT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_thanks_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_thanks_from     FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_thanks_to       FOREIGN KEY (to_user_id)   REFERENCES users(id),
  INDEX idx_thanks_purchase (purchase_id),
  INDEX idx_thanks_from (from_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
