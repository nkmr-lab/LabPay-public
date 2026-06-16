-- v635 📝 フリップ クイズ (出題者が 問題、 参加者が フリップに 答え、 一斉開示、
--   出題者が マルバツ採点、 集計)。
--
--   1 つの quiz セット = 複数 問。 出題者 が 1 問ずつ 出題 → 全員 解答 → 開示 → 採点。
--   round で 1 問 が 進む。
CREATE TABLE IF NOT EXISTS quizzes (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  -- 参加者 uid 配列
  participants_json TEXT NOT NULL,
  -- 進行 全 state を 入れる
  --   {
  --     "current_q": 1,                     // 現 問番号 (1 から)
  --     "phase": "asking",                  // asking / answering / reveal / scored / finished
  --     "question": "...",                  // 出題者が 出した 問題文 (asking 以降)
  --     "answers": { "uid": "回答文", ... },// 各 参加者 の 回答 (answering 中 は 自分の しか 見えない)
  --     "scores": { "uid": 0 or 1, ... },   // この問 の マルバツ (1=正解、 0=不正解)
  --     "history": [                        // 過去の 問 + 採点
  --       { q: "...", answers: {...}, scores: {...} }
  --     ]
  --   }
  state_json      MEDIUMTEXT NOT NULL,
  status          ENUM('active','finished','cancelled') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME NULL,
  KEY idx_qz_status (status, id),
  CONSTRAINT fk_qz_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
