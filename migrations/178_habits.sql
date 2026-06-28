-- v870 #452 Habit Tracker。 個人 ごと に 習慣 を 登録、 日 毎 の 達成 を ✓ で 入力 +
-- カレンダー / 連続 記録 (streak) を 可視化。 公開 リスト は ラボ メン 全員 が 見えて
-- 達成 状況 を 比較 (まず は 個人 + 公開 のみ、 チーム 機能 は 次 段階)。

DROP TABLE IF EXISTS habit_checkins;
DROP TABLE IF EXISTS habits;

CREATE TABLE habits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(800) NULL,
  emoji VARCHAR(10) NULL,
  target_per_week TINYINT UNSIGNED NOT NULL DEFAULT 7,
  visibility ENUM('public', 'private') NOT NULL DEFAULT 'public',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_owner (owner_id),
  INDEX idx_visibility (visibility),
  CONSTRAINT fk_h_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE habit_checkins (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  habit_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  date DATE NOT NULL,
  note VARCHAR(400) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_habit_user_date (habit_id, user_id, date),
  INDEX idx_user_date (user_id, date),
  CONSTRAINT fk_hc_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  CONSTRAINT fk_hc_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
