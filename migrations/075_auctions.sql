-- v347 オークション (MVP)。 出品 + 入札 + 締切 → 最高額者が落札。
-- 落札後の pt 移動は無し (本人同士で やり取り)。 締切時刻過ぎても 自動 cron で
-- 締めず、 API アクセスのタイミングで lazy settle する。

CREATE TABLE IF NOT EXISTS auctions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  seller_user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  image_url VARCHAR(500) NULL,
  min_price INT NOT NULL DEFAULT 1,
  closes_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  settled_at DATETIME NULL,
  winner_user_id BIGINT NULL,
  winning_bid INT NULL,
  CONSTRAINT fk_au_seller FOREIGN KEY (seller_user_id) REFERENCES users(id),
  CONSTRAINT fk_au_winner FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_au_closes (closes_at)
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  auction_id BIGINT NOT NULL,
  bidder_user_id BIGINT NOT NULL,
  amount INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ab_auction FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ab_bidder FOREIGN KEY (bidder_user_id) REFERENCES users(id),
  INDEX idx_auction_amount (auction_id, amount DESC, id DESC)
);
