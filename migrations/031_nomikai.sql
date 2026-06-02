-- 飲み会割り勘 (nomikai). Creator records the bill, picks members + their
-- alcohol flag, adjusts per-grade weighting, and each participant marks paid.
--
-- Settlement is OUT-OF-BAND (cash / PayPay / bank transfer): this system only
-- tracks intent + status, no ledger movement. paid_proxy_user_id covers the
-- case where one member fronts the whole bill and others 'pay' that person back.

CREATE TABLE IF NOT EXISTS nomikai_sessions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  total_yen       INT NOT NULL,
  notes           TEXT NULL,
  closed_at       DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_nm_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nomikai_participants (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id          BIGINT NOT NULL,
  user_id             BIGINT NOT NULL,
  amount_yen          INT NOT NULL,
  alcohol             TINYINT(1) NOT NULL DEFAULT 1,
  weight              DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  paid_at             DATETIME NULL,
  paid_method         ENUM('cash','paypay','bank','proxy') NULL,
  paid_proxy_user_id  BIGINT NULL,
  CONSTRAINT fk_nmp_session FOREIGN KEY (session_id) REFERENCES nomikai_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_nmp_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_nmp_proxy   FOREIGN KEY (paid_proxy_user_id) REFERENCES users(id),
  UNIQUE KEY uniq_session_user (session_id, user_id),
  INDEX ix_nmp_paid (session_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional payment-info per user — sits on users so it's reusable across
-- sessions and (eventually) other features. NULL is fine.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS paypay_id  VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS bank_info  VARCHAR(300) NULL;
