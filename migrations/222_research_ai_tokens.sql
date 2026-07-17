-- v1142 中村さん要望「研究特化 AI サブスクは、そのチャットの履歴を、他者と共有できるように
--   して、他者もチャットに入力できるようにしたい。 チャットは件数ではなく、トークン量にすると
--   良いかもしれない。 チケットとしてトークンを買うモードと、無制限を買うモードとあるけど、
--   無制限でもトークンの1週間上限がある感じ。 チャットの履歴は、画面の左とかにあるように
--   すると良いかも。 PDFとか画像も張り込めると良いね。 ChatGPT/Claude みたいな挙動」
--
--   4 つの拡張を 1 migration で:
--   (A) subscription を tokens 化 (plan は tokens_ticket / unlimited_weekly を追加、
--       tokens_left / tokens_used / weekly_limit / week_reset_at カラム追加)
--   (B) research_ai_threads を新設 (会話 = 1 スレッド、複数チャットを紐付け、共有・他者投稿対応)
--   (C) research_ai_chats に thread_id / tokens_prompt / tokens_completion / tokens_total / speaker_user_id
--   (D) research_ai_attachments を新設 (PDF / 画像 添付、OpenAI file_id を保持)

-- (A) subscriptions: plan の ENUM を広げ、 tokens 系カラムを追加
ALTER TABLE research_ai_subscriptions
  MODIFY COLUMN plan VARCHAR(32) NOT NULL COMMENT 'quota60|unlimited|tokens_ticket|unlimited_weekly',
  ADD COLUMN tokens_left BIGINT NULL COMMENT 'tokens_ticket プランでの残トークン (NULL=無制限系)',
  ADD COLUMN tokens_used BIGINT NOT NULL DEFAULT 0 COMMENT 'このサブスク累積使用トークン',
  ADD COLUMN weekly_limit BIGINT NULL COMMENT 'unlimited_weekly プランの 1 週間上限',
  ADD COLUMN weekly_used BIGINT NOT NULL DEFAULT 0 COMMENT '今週分の使用 (week_reset_at で 0 クリア)',
  ADD COLUMN week_reset_at DATETIME NULL COMMENT '次回リセット時刻 (unlimited_weekly のみ)';

-- (B) threads: 会話単位 (= 1 チャット履歴)
CREATE TABLE IF NOT EXISTS research_ai_threads (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_user_id     BIGINT NOT NULL,
  title             VARCHAR(200) NULL COMMENT '自動生成 or ユーザ命名',
  template_key      VARCHAR(60) NULL COMMENT '会話開始時のテンプレート (system prompt 記録)',
  is_shared         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '他者に共有中 (shared_user_ids の面々)',
  shared_user_ids   JSON NULL COMMENT '共有先 user_id 配列 (owner を含まない)',
  last_message_at   DATETIME NULL,
  deleted_at        DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rai_thread_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_rai_thread_owner (owner_user_id, last_message_at),
  INDEX ix_rai_thread_shared (is_shared)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (C) chats に thread_id とトークン情報 + 発言者 (共有時に他者投稿を判別)
ALTER TABLE research_ai_chats
  ADD COLUMN thread_id BIGINT NULL COMMENT 'v1142 スレッドに紐付け (旧 chat は NULL のまま = 自分専用の孤立)',
  ADD COLUMN speaker_user_id BIGINT NULL COMMENT 'v1142 実際に投稿した user (owner と違うこともある = 共有)',
  ADD COLUMN tokens_prompt INT NULL,
  ADD COLUMN tokens_completion INT NULL,
  ADD COLUMN tokens_total INT NULL,
  ADD INDEX ix_rai_chat_thread (thread_id, id);

-- (D) attachments: PDF / 画像 添付
CREATE TABLE IF NOT EXISTS research_ai_attachments (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  chat_id           BIGINT NULL COMMENT '関連チャット (NULL = アップロード直後 pending)',
  uploader_user_id  BIGINT NOT NULL,
  kind              ENUM('image','pdf') NOT NULL,
  mime              VARCHAR(80) NOT NULL,
  size_bytes        INT NOT NULL,
  filename          VARCHAR(255) NOT NULL,
  url               VARCHAR(500) NOT NULL COMMENT 'サーバローカルの相対 URL',
  openai_file_id    VARCHAR(120) NULL COMMENT 'OpenAI Files API で発行された file_id',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rai_att_user FOREIGN KEY (uploader_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_rai_att_chat (chat_id),
  INDEX ix_rai_att_user (uploader_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
