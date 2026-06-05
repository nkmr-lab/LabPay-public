-- AI 画像 翻訳の ログ。 自分専用 (group_id IS NULL) か、 グループ 共有 (group_id 指定)。
-- グループに 紐づけた ものは そのグループ メンバー 全員 閲覧可能。

CREATE TABLE IF NOT EXISTS translations (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  group_id     BIGINT NULL,
  image_url    VARCHAR(2000) NOT NULL,
  hint         VARCHAR(500) NULL,
  result_text  MEDIUMTEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tr_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  CONSTRAINT fk_tr_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  INDEX ix_tr_user (user_id, created_at),
  INDEX ix_tr_group (group_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
