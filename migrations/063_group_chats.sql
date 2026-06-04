-- グループ内チャット (LINE 的なやつ)。 フィードは投稿/メモ用、 これは日常会話用。
CREATE TABLE IF NOT EXISTS adhoc_group_chats (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_chat_group_id (group_id, id)
);
