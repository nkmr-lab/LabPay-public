-- 請求 (集金): 発起人がメンバーを選んで、全員同額 or 指定額で請求する。
-- 支払いは外 (現金/PayPay/銀行) でやり取り、本テーブルは「請求 + 支払い済
-- チェック」を追跡するだけ (ledger は動かない)。飲み会割り勘と似た構造だが、
-- 発端が「使った後の精算」ではなく「これから集金」なので別テーブルにする。

CREATE TABLE IF NOT EXISTS money_requests (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  memo            TEXT NULL,
  closed_at       DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mr_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS money_request_recipients (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id           BIGINT NOT NULL,
  user_id              BIGINT NOT NULL,
  amount_yen           INT NOT NULL,
  paid_at              DATETIME NULL,
  paid_method          ENUM('cash','paypay','bank','proxy') NULL,
  paid_proxy_user_id   BIGINT NULL,
  paid_note            VARCHAR(500) NULL,
  CONSTRAINT fk_mrr_request FOREIGN KEY (request_id) REFERENCES money_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_mrr_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_mrr_proxy   FOREIGN KEY (paid_proxy_user_id) REFERENCES users(id),
  UNIQUE KEY uniq_request_user (request_id, user_id),
  INDEX ix_mrr_paid (request_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
