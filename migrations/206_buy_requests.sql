-- v1080 中村さん要望「今、研究室では #want_to_buy というチャンネルで私への購入を
--   依頼している。これを、もう Slack でのやり取りじゃなく、LabPay 上でやってしまいたい。
--   基本的には、これを購入してほしいという依頼 (URL とセットで)、買いましたという返事を
--   する感じ」
-- 決定事項:
--   * アプリタブに独立ページ /#/buy-requests
--   * 「買った」アクションは admin (中村さん) のみ
--   * LabPay 台帳のお金の動きは無し (現物受け渡しだけ)

-- users.id は BIGINT(20) なので FK 側も BIGINT に揃える
CREATE TABLE buy_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_user_id BIGINT NOT NULL,
  url VARCHAR(2048) NOT NULL,
  title VARCHAR(200) NOT NULL,
  reason TEXT,
  quantity INT NOT NULL DEFAULT 1,
  price_estimate INT NULL,              -- 想定価格 (円、任意)
  urgency ENUM('normal','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open','bought','declined','cancelled') NOT NULL DEFAULT 'open',
  fulfiller_user_id BIGINT NULL,        -- 「買った」or「却下」した人
  bought_at DATETIME NULL,
  actual_price INT NULL,                -- 実費 (円、任意)
  fulfiller_note TEXT NULL,             -- 到着予定 / 置き場所 / 却下理由など
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_requester (requester_user_id),
  KEY idx_created (created_at),
  CONSTRAINT fk_br_requester FOREIGN KEY (requester_user_id) REFERENCES users(id),
  CONSTRAINT fk_br_fulfiller FOREIGN KEY (fulfiller_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
