-- v1120 中村さん要望「発表順オークション / 論文紹介, ポスターセッションの希望の順番,
--   セッションをオークションできる」
--   → sealed 入札で「早い順番」を勝ち取るオークション。締切後に一斉開票 →
--   金額降順で slot 1, 2, ... を割り当て、勝者は入札額を pot に支払う。

CREATE TABLE IF NOT EXISTS pres_order_auctions (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,
  description         TEXT NULL,
  deadline            DATETIME NULL,
  creator_user_id     BIGINT NOT NULL,
  status              ENUM('open','closed','cancelled') NOT NULL DEFAULT 'open',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at           DATETIME NULL,
  CONSTRAINT fk_poa_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_poa_status (status, deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pres_order_bids (
  auction_id      BIGINT NOT NULL,
  user_id         BIGINT NOT NULL,
  amount          INT NOT NULL,               -- pt
  assigned_slot   INT NULL,                   -- close 後に埋まる (1 = 一番早い)
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (auction_id, user_id),
  CONSTRAINT fk_pob_auction FOREIGN KEY (auction_id) REFERENCES pres_order_auctions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pob_user    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
