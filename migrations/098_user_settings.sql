-- v456 ユーザ設定 を サーバ側 で 保存 (PC / スマホ で 共有 する 用)。
-- localStorage に 散らばっていた settings (apps 表示 / home 並び替え / カレンダー
-- など) を key/value で 一括 保存。 value は JSON テキスト。
CREATE TABLE IF NOT EXISTS user_settings (
  user_id   BIGINT NOT NULL,
  k         VARCHAR(100) NOT NULL,
  v         TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, k),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
