-- v1147 中村さん要望「boketeの機能をつくって」
--   bokete.jp 的な 画像大喜利: 誰かが お題 (画像 + 任意タイトル) を投稿 → 他の
--   メンバーが 面白い「ボケ」を書く → みんなが ⭐ で 評価 → ⭐ 数 で ランキング。
--   全員無料 (プレイフィーなし)。 匿名投稿は 不採用 (投稿者名は出す — ラボ内 SNS 前提)。

CREATE TABLE IF NOT EXISTS bokete_topics (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id   BIGINT NOT NULL,
  image_url         VARCHAR(500) NOT NULL COMMENT 'お題画像 (uploads/image 経由)',
  title             VARCHAR(200) NULL     COMMENT '任意タイトル / お題文',
  deadline_at       DATETIME NULL         COMMENT '期限 (NULL = 無期限、 到達後は投稿不可・閲覧のみ)',
  deleted_at        DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bokete_topic_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_bokete_topic_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bokete_answers (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  topic_id          BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  text              VARCHAR(500) NOT NULL,
  deleted_at        DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bokete_ans_topic FOREIGN KEY (topic_id) REFERENCES bokete_topics(id) ON DELETE CASCADE,
  CONSTRAINT fk_bokete_ans_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_bokete_ans_topic (topic_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bokete_stars (
  answer_id         BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (answer_id, user_id),
  CONSTRAINT fk_bokete_star_ans  FOREIGN KEY (answer_id) REFERENCES bokete_answers(id) ON DELETE CASCADE,
  CONSTRAINT fk_bokete_star_user FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_bokete_star_ans (answer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
