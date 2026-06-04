-- 点呼 (roll call): 「いる？」 「起きてる？」 を 短時間で集めるための仕組み。
-- 投票と似てるが、 選択肢 が無く 「応答済 / 未応答」 だけ。 オプションでメモ
-- (例: 「あと 5 分で行く」 「起きました」)。

CREATE TABLE IF NOT EXISTS roll_calls (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(500) NULL,
  creator_user_id BIGINT NOT NULL,
  deadline_at DATETIME NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  CONSTRAINT fk_rc_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX idx_rc_deadline (deadline_at, status)
);

CREATE TABLE IF NOT EXISTS roll_call_targets (
  roll_call_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  responded_at DATETIME NULL,
  note VARCHAR(300) NULL,
  PRIMARY KEY (roll_call_id, user_id),
  CONSTRAINT fk_rct_rc   FOREIGN KEY (roll_call_id) REFERENCES roll_calls(id) ON DELETE CASCADE,
  CONSTRAINT fk_rct_user FOREIGN KEY (user_id) REFERENCES users(id)
);
