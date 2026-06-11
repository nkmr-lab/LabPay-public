-- v533 #162 筋トレ記録 + 仲間。 個人の時系列 + mutual follow で 仲間 の様子も見る。
CREATE TABLE IF NOT EXISTS workouts (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  recorded_at DATETIME NOT NULL,
  exercise    VARCHAR(60) NOT NULL,
  reps        INT UNSIGNED NULL,
  weight_kg   DECIMAL(5,1) NULL,
  sets        INT UNSIGNED NULL DEFAULT 1,
  memo        VARCHAR(200) NULL,
  KEY idx_w_user_at (user_id, recorded_at),
  CONSTRAINT fk_w_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自分 (user_id) が 仲間追加した相手 (friend_user_id)。 mutual で 双方が追加すると
-- 互いの記録が見える (片方だけだと まだ "申請中")。
CREATE TABLE IF NOT EXISTS workout_friends (
  user_id        BIGINT NOT NULL,
  friend_user_id BIGINT NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_user_id),
  KEY idx_wf_friend (friend_user_id),
  CONSTRAINT fk_wf_u FOREIGN KEY (user_id)        REFERENCES users(id),
  CONSTRAINT fk_wf_f FOREIGN KEY (friend_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
