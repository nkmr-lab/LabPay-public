-- v588 ビンゴ。 毎週 日曜 0:00 (JST) 〜 土曜 23:59 (JST) のサイクル。
--   ユーザごとに 5x5 カード を生成、 1 マス = 1 タスク。
--   タスクは 既存データから 自動判定 (平日 限定 = 月-金)。
CREATE TABLE IF NOT EXISTS bingo_cards (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  week_start  DATE NOT NULL,  -- 日曜の 日付 (JST)
  -- 25 マス分の タスク定義 (id, label, icon, threshold)。 中央 (idx 12) は フリー (常に達成済)
  cells_json  MEDIUMTEXT NOT NULL,
  -- 達成済マスの idx 配列 [0,3,12,18, ...]
  completed_idxs_json MEDIUMTEXT NOT NULL,
  -- 最初に ビンゴ になった 時刻 (NULL = まだ なし)
  first_bingo_at DATETIME NULL,
  -- 達成した ビンゴ ライン数 (横/縦/斜め)
  bingo_lines INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY u_user_week (user_id, week_start),
  CONSTRAINT fk_bingo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
