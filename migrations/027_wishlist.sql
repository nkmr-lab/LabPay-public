-- Wishlist: lab members can post "this is what I want someone to bring in"
-- requests. Each entry is just a free-text product name + optional notes.
-- If a seller later registers a matching JAN / listing, it stays as a manual
-- match for now (no auto-fulfill — too easy to mismatch).
CREATE TABLE IF NOT EXISTS wishlist (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  requester_user_id BIGINT NOT NULL,
  product_name  VARCHAR(200) NOT NULL,
  jan           VARCHAR(20)  NULL,  -- optional, if known
  note          VARCHAR(500) NULL,
  fulfilled_listing_id BIGINT NULL,  -- set if a listing comes in that satisfies it
  fulfilled_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wl_user    FOREIGN KEY (requester_user_id) REFERENCES users(id),
  CONSTRAINT fk_wl_listing FOREIGN KEY (fulfilled_listing_id) REFERENCES listings(id)
    ON DELETE SET NULL,
  INDEX ix_wl_open (fulfilled_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
