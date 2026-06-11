-- v540 #171 絵しりとり Phase 1。
--   1 ゲーム = メンバー N 人で 1 周ずつ N 枚、 round_count 周で N × round_count 枚。
--   各 turn は 「前の人の絵を見て自分が描く」、 描き終わりに 「自分が何を描いたか」 ラベル
--   + 「直前の人は何を描いてたと思うか」 (= 自分の予想) を登録。
--   終了条件: round_count 周回 完了 or 起案者が giveup を押す。
--   AI 予想 / 最終当て (全員が一覧から予想を書く) は Phase 2 で実装。

CREATE TABLE IF NOT EXISTS shiritori_games (
  id               BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id  BIGINT NOT NULL,
  title            VARCHAR(200) NOT NULL,
  time_limit_sec   INT UNSIGNED NOT NULL DEFAULT 60,
  round_count      INT UNSIGNED NOT NULL DEFAULT 2,
  status           ENUM('active', 'ended') NOT NULL DEFAULT 'active',
  current_turn_idx INT UNSIGNED NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at         DATETIME NULL,
  KEY idx_sg_status (status, id),
  CONSTRAINT fk_sg_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shiritori_players (
  game_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  turn_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, user_id),
  KEY idx_sp_game_order (game_id, turn_order),
  CONSTRAINT fk_sp_game FOREIGN KEY (game_id) REFERENCES shiritori_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shiritori_drawings (
  id               BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id          BIGINT NOT NULL,
  user_id          BIGINT NOT NULL,
  turn_idx         INT UNSIGNED NOT NULL,
  round_idx        INT UNSIGNED NOT NULL,
  label_self       VARCHAR(60) NOT NULL,
  label_prev_guess VARCHAR(60) NULL,
  image_url        VARCHAR(500) NULL,
  strokes_json     MEDIUMTEXT NULL,
  ai_guess         VARCHAR(200) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sd_game (game_id, turn_idx),
  CONSTRAINT fk_sd_game FOREIGN KEY (game_id) REFERENCES shiritori_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_sd_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
