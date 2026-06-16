-- v634 ⚾ ドラフト (プロ野球風 抽選 指名)。
--   起案者が 参加者 + 候補 (人 or 自由入力) を 揃えて 開始。
--   1 位 → 2 位 → ... と 順番に 全員が 指名。 競合は くじ で 抽選。
--   候補がなくなるか creator が 終了で finished。
CREATE TABLE IF NOT EXISTS drafts (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  -- 候補の 種類: 'user' = LabPay ユーザ (uid 配列)、 'text' = 自由入力 (string 配列)
  target_type     ENUM('user','text') NOT NULL DEFAULT 'user',
  -- 候補の 配列。 user: [uid, ...]、 text: ["寿司","ピザ", ...]
  candidates_json TEXT NOT NULL,
  -- 参加者 uid 配列 (= 指名する人)
  participants_json TEXT NOT NULL,
  -- 進行 全 state を 入れる (round / phase / pending / submitted / confirmed / lottery)
  state_json      MEDIUMTEXT NOT NULL,
  status          ENUM('active','finished','cancelled') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_dr_status (status, id),
  CONSTRAINT fk_dr_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
