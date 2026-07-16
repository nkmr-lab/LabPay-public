-- v1125 中村さん要望「研究特化 AI サブスク: 200pt/60件、 1000pt/無制限。 研究に対する
--   プロンプト / 相談テンプレート / GPTs 提供、 Scrapbox 連携 (Phase 2)、 普通のチャット」

CREATE TABLE IF NOT EXISTS research_ai_subscriptions (
  user_id         BIGINT NOT NULL PRIMARY KEY,
  plan            ENUM('quota60','unlimited') NOT NULL,
  quota_left      INT NULL,                          -- unlimited は NULL
  started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME NOT NULL,                 -- 1 ヶ月
  cost_paid       INT NOT NULL,
  CONSTRAINT fk_rai_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_rai_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS research_ai_chats (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  template_key  VARCHAR(60) NULL,
  user_message  TEXT NOT NULL,
  ai_response   MEDIUMTEXT NULL,
  tokens_est    INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_rai_chat_user_time (user_id, created_at),
  CONSTRAINT fk_rai_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
