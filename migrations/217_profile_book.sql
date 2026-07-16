-- v1124 中村さん要望「プロフアプリ。基本情報はみんな埋めておく (入会 50pt)、
--   すでに埋まっているところを見るにはポイント (10pt)、追加の質問を書いて欲しい
--   相手に追加 (10pt/回、匿名可)、回答したら 5pt/回、心理テスト、手書き風、平成デザ」

CREATE TABLE IF NOT EXISTS profile_answers (
  user_id       BIGINT NOT NULL,
  q_key         VARCHAR(60) NOT NULL,           -- 質問キー (nickname / hobby / etc)
  answer_text   TEXT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, q_key),
  CONSTRAINT fk_prof_ans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 追加質問: from_user → to_user へ (10pt 支払)、to_user が回答すると 5pt もらう
CREATE TABLE IF NOT EXISTS profile_questions (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  from_user_id      BIGINT NOT NULL,
  to_user_id        BIGINT NOT NULL,
  question_text     VARCHAR(400) NOT NULL,
  is_anonymous      TINYINT(1) NOT NULL DEFAULT 1,   -- 匿名がデフォルト
  answer_text       TEXT NULL,
  answered_at       DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prof_q_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_prof_q_to   FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_pq_to_status (to_user_id, answered_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 誰が誰のプロフをアンロックしたか (10pt 支払後は無制限閲覧、二重課金しない)
CREATE TABLE IF NOT EXISTS profile_unlocks (
  viewer_user_id    BIGINT NOT NULL,
  target_user_id    BIGINT NOT NULL,
  unlocked_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (viewer_user_id, target_user_id),
  CONSTRAINT fk_prof_unlock_v FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_prof_unlock_t FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 基本プロフ 初回埋め reward の flag (users.profile_base_rewarded 相当を独立テーブルで)
CREATE TABLE IF NOT EXISTS profile_reward_claims (
  user_id       BIGINT NOT NULL PRIMARY KEY,
  claimed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prof_reward_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
