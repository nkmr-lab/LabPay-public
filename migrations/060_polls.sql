-- 投票アプリ (polls): タイトル + 締切 + 単複選択 + 集計可視性 + 対象者指定。
-- 個人の投票内容はデフォルト非公開、 投票したかどうか (済 / 未) のみ晒す。
-- 集計可視性 visibility:
--   'creator'       : 主催者だけがいつでも見られる
--   'open'          : 投票した瞬間から全員見える
--   'after_deadline': 締切後にだけ全員見える (デフォルト)
CREATE TABLE IF NOT EXISTS polls (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  creator_user_id BIGINT NOT NULL,
  deadline_at DATETIME NOT NULL,
  multi_select TINYINT(1) NOT NULL DEFAULT 0,
  visibility ENUM('creator','open','after_deadline') NOT NULL DEFAULT 'after_deadline',
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  CONSTRAINT fk_poll_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX idx_polls_deadline (deadline_at, status)
);

CREATE TABLE IF NOT EXISTS poll_options (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  poll_id BIGINT NOT NULL,
  label VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_poll_opt_poll FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  INDEX idx_poll_opt_poll (poll_id)
);

-- 対象者 (誰に投票を求めるか)。 voted_at が NULL の間 = 未投票。
CREATE TABLE IF NOT EXISTS poll_voters (
  poll_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  voted_at DATETIME NULL,
  PRIMARY KEY (poll_id, user_id),
  CONSTRAINT fk_poll_vot_poll FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_vot_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 個別の票。 (poll_id, user_id, option_id) UNIQUE。 複数選択時は同じ poll/user で複数行。
CREATE TABLE IF NOT EXISTS poll_votes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  poll_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  option_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_poll_vote (poll_id, user_id, option_id),
  CONSTRAINT fk_poll_v_poll FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_v_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_poll_v_opt  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE,
  INDEX idx_poll_v_poll (poll_id)
);
