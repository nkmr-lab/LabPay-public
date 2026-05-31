-- LabPay initial schema + seed
-- Engine: InnoDB / charset: utf8mb4
-- Apply: mysql -u labpay -p labpay < migrations/001_init.sql

SET NAMES utf8mb4;
SET time_zone = '+09:00';

-- ===== 設定（管理者が変更可能なランタイム設定）=====
CREATE TABLE IF NOT EXISTS config (
  k            VARCHAR(64) PRIMARY KEY,
  v            TEXT NOT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 許可リスト =====
CREATE TABLE IF NOT EXISTS allowlist (
  email        VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  role         ENUM('member','admin') NOT NULL DEFAULT 'member',
  active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== ユーザー =====
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL,
  role          ENUM('member','admin') NOT NULL DEFAULT 'member',
  kind          ENUM('human','system') NOT NULL DEFAULT 'human',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 口座 =====
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(32) NULL UNIQUE,
  owner_user_id BIGINT NULL,
  kind          ENUM('user','system','escrow') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_acc_user FOREIGN KEY (owner_user_id) REFERENCES users(id),
  UNIQUE KEY uq_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== セッション =====
CREATE TABLE IF NOT EXISTS sessions (
  id           CHAR(64) PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_sess_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 台帳（追記専用）=====
CREATE TABLE IF NOT EXISTS ledger (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  from_account_id BIGINT NOT NULL,
  to_account_id   BIGINT NOT NULL,
  amount          INT NOT NULL,
  type            ENUM('initial','checkin','purchase','fee','reversal',
                       'transfer','task_reward','deposit','refund','burn') NOT NULL,
  ref_type        VARCHAR(32) NULL,
  ref_id          BIGINT NULL,
  memo            VARCHAR(255) NULL,
  reversed_of     BIGINT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_led_from FOREIGN KEY (from_account_id) REFERENCES accounts(id),
  CONSTRAINT fk_led_to   FOREIGN KEY (to_account_id)   REFERENCES accounts(id),
  CONSTRAINT chk_amount  CHECK (amount > 0),
  INDEX idx_led_from (from_account_id),
  INDEX idx_led_to   (to_account_id),
  INDEX idx_led_ref  (ref_type, ref_id),
  INDEX idx_led_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 冪等キー =====
CREATE TABLE IF NOT EXISTS idempotency_keys (
  ukey          VARCHAR(80) PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  endpoint      VARCHAR(64) NOT NULL,
  response_json MEDIUMTEXT NOT NULL,
  status_code   INT NOT NULL DEFAULT 200,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_idem_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 商品マスタ =====
CREATE TABLE IF NOT EXISTS products (
  jan                VARCHAR(20) PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  image_url          VARCHAR(500) NULL,
  source             ENUM('manual','api') NOT NULL DEFAULT 'manual',
  created_by_user_id BIGINT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 出品 =====
CREATE TABLE IF NOT EXISTS listings (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  jan            VARCHAR(20) NOT NULL,
  seller_user_id BIGINT NOT NULL,
  price          INT NOT NULL,
  qty            INT NOT NULL,
  status         ENUM('on_sale','withdrawn','sold_out') NOT NULL DEFAULT 'on_sale',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lst_prod   FOREIGN KEY (jan) REFERENCES products(jan),
  CONSTRAINT fk_lst_seller FOREIGN KEY (seller_user_id) REFERENCES users(id),
  CONSTRAINT chk_price CHECK (price > 0),
  CONSTRAINT chk_qty   CHECK (qty >= 0),
  INDEX idx_lst_jan_status (jan, status),
  INDEX idx_lst_seller (seller_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 購入記録 =====
CREATE TABLE IF NOT EXISTS purchases (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id      BIGINT NOT NULL,
  jan             VARCHAR(20) NOT NULL,
  buyer_user_id   BIGINT NOT NULL,
  seller_user_id  BIGINT NOT NULL,
  unit_price      INT NOT NULL,
  fee             INT NOT NULL,
  qty             INT NOT NULL DEFAULT 1,
  idempotency_key VARCHAR(80) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pur_listing FOREIGN KEY (listing_id) REFERENCES listings(id),
  CONSTRAINT fk_pur_buyer   FOREIGN KEY (buyer_user_id)  REFERENCES users(id),
  CONSTRAINT fk_pur_seller  FOREIGN KEY (seller_user_id) REFERENCES users(id),
  INDEX idx_pur_buyer (buyer_user_id),
  INDEX idx_pur_seller (seller_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 来室・連続記録 =====
CREATE TABLE IF NOT EXISTS checkins (
  user_id        BIGINT NOT NULL,
  checkin_date   DATE NOT NULL,
  points_awarded INT NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, checkin_date),
  CONSTRAINT fk_chk_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS streaks (
  user_id           BIGINT PRIMARY KEY,
  current_streak    INT NOT NULL DEFAULT 0,
  longest_streak    INT NOT NULL DEFAULT 0,
  last_checkin_date DATE NULL,
  CONSTRAINT fk_str_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 通知 =====
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  type        VARCHAR(40) NOT NULL,
  body        VARCHAR(255) NOT NULL,
  ref_type    VARCHAR(32) NULL,
  ref_id      BIGINT NULL,
  read_at     DATETIME NULL,
  emailed_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ntf_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_ntf_user_read (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== FUTURE: 個人送金 =====
CREATE TABLE IF NOT EXISTS transfers (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  from_user_id    BIGINT NOT NULL,
  to_user_id      BIGINT NOT NULL,
  amount          INT NOT NULL,
  memo            VARCHAR(255) NULL,
  idempotency_key VARCHAR(80) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trf_from FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_trf_to   FOREIGN KEY (to_user_id)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== FUTURE: チャット =====
CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  from_user_id BIGINT NOT NULL,
  to_user_id   BIGINT NOT NULL,
  body         TEXT NOT NULL,
  ref_type     VARCHAR(32) NULL,
  ref_id       BIGINT NULL,
  read_at      DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_from FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_msg_to   FOREIGN KEY (to_user_id)   REFERENCES users(id),
  INDEX idx_msg_pair (from_user_id, to_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== FUTURE: タスク =====
CREATE TABLE IF NOT EXISTS tasks (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  requester_user_id BIGINT NOT NULL,
  funder        ENUM('system','requester') NOT NULL DEFAULT 'requester',
  title         VARCHAR(200) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  reward        INT NOT NULL,
  completion_code VARCHAR(100) NOT NULL,
  capacity      INT NOT NULL,
  filled        INT NOT NULL DEFAULT 0,
  status        ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_req FOREIGN KEY (requester_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_submissions (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id       BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,
  submitted_code VARCHAR(100) NOT NULL,
  status        ENUM('approved','rejected') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_user (task_id, user_id),
  CONSTRAINT fk_sub_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== FUTURE: 本の貸出 =====
CREATE TABLE IF NOT EXISTS books (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  title     VARCHAR(300) NOT NULL,
  deposit   INT NOT NULL,
  status    ENUM('available','lent') NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loans (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  book_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  deposit    INT NOT NULL,
  lent_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at DATETIME NULL,
  CONSTRAINT fk_loan_book FOREIGN KEY (book_id) REFERENCES books(id),
  CONSTRAINT fk_loan_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SEED
-- ============================================================

-- 特別口座のための system ユーザー（ログイン不可：kind=system）
INSERT IGNORE INTO users (email, display_name, role, kind)
VALUES ('system@labpay.local','SYSTEM','admin','system'),
       ('escrow@labpay.local','ESCROW','member','system');

-- 特別口座
INSERT IGNORE INTO accounts (code, owner_user_id, kind)
SELECT 'SYSTEM', id, 'system' FROM users WHERE email='system@labpay.local';
INSERT IGNORE INTO accounts (code, owner_user_id, kind)
SELECT 'ESCROW', id, 'escrow' FROM users WHERE email='escrow@labpay.local';

-- 設定デフォルト
INSERT IGNORE INTO config (k, v) VALUES
 ('fee_rate', '0.05'),
 ('initial_points', '1000'),
 ('checkin_base', '10'),
 ('streak_bonuses', '{"3":5,"5":10,"10":30}'),
 ('streak_weekday_only', '1'),
 ('session_ttl_days', '30');
