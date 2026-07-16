-- v1122 中村さん要望「チケット生成アプリ。ポイントで買って使う。設定: 使える状況・
--   使える対象 (誰に使うのか)・有効期限・ポイント数。例: 次のお店を決められるチケット、
--   課題のやり方教えますチケット、運転しますチケット、カラオケで最初に歌えるチケット等」
--
-- MVP: 個人発行のチケット。誰でも作成 → 対象者が pt を払って使う → 発行者に pt が入る。
-- 全体承認 / グループ山分け は将来の拡張。

CREATE TABLE IF NOT EXISTS tickets (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,          -- 「次のお店を決められるチケット」
  description         TEXT NULL,                       -- 詳細説明
  usable_in           VARCHAR(400) NULL,              -- 「B3 のみ」「懇親会限定」等 (自由記述)
  issuer_user_id      BIGINT NOT NULL,                 -- 発行者 (使わせる側、pt を受け取る)
  price               INT NOT NULL,                    -- 使用時に払う pt
  max_uses            INT NOT NULL DEFAULT 1,          -- 発行枚数 (総使用可能回数)
  uses_count          INT NOT NULL DEFAULT 0,          -- 使用済回数
  target_scope        ENUM('all','grade') NOT NULL DEFAULT 'all',
  target_grade        VARCHAR(8) NULL,                 -- target_scope='grade' 時: 'B3'|'B4'|'M1'|'M2'|'D'
  expires_at          DATETIME NULL,                   -- NULL = 無期限
  image_url           VARCHAR(500) NULL,
  emoji               VARCHAR(8) NULL,                 -- サムネの絵文字 (画像無いとき)
  status              ENUM('active','revoked','sold_out','expired') NOT NULL DEFAULT 'active',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  revoked_at          DATETIME NULL,
  CONSTRAINT fk_tk_issuer FOREIGN KEY (issuer_user_id) REFERENCES users(id),
  INDEX ix_tk_status (status, expires_at),
  INDEX ix_tk_issuer (issuer_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_uses (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id     BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,                       -- 使った人
  note          VARCHAR(400) NULL,                     -- 使う時のメモ (任意)
  used_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_tku_user (user_id, used_at),
  INDEX ix_tku_ticket (ticket_id),
  CONSTRAINT fk_tku_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tku_user   FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
