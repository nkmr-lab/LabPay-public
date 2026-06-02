-- Casual invitation board:
--   「お昼ご飯食べに行こう」「ビアガーデン」「ポケモン GO」「スキー」など、
--   pt のやり取りが無いカジュアルな募集を投稿 → 誰でも参加表明できる。
--   実装はタスクとは別。エスクロー・承認フローを持たないシンプル設計。

CREATE TABLE IF NOT EXISTS invitations (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NULL,
  starts_at       DATETIME NULL,      -- イベント開始時刻 (NULL なら未定)
  location        VARCHAR(200) NULL,
  capacity        INT NULL,           -- NULL = 上限なし
  closed_at       DATETIME NULL,      -- 募集停止 (cancel or 期限切れ)
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_user FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_inv_open (closed_at, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invitation_joins (
  invitation_id BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,
  joined_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invitation_id, user_id),
  CONSTRAINT fk_invjoin_inv  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
  CONSTRAINT fk_invjoin_user FOREIGN KEY (user_id)       REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
