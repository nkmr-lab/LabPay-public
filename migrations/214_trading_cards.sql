-- v1121 中村さん要望「ゼミの人のトレーディングカード・リアクション。 主に男子?
--   ガチャ回すのにかかるお金: 30pt (10連 250pt)」+「トレカについては、本人の許可
--   ありのときのみ。 作るのは誰でもできるけど、公開の前に許可申請がある感じ」
--
-- 挙動:
--   * 誰でもカード作成 (target_user + catchphrase + image + rarity + stats)
--   * 作成時は status='pending' で本人 (target) へ通知 → 本人が approve or reject
--   * approved で ガチャ pool 入り
--   * ガチャ 1 連 30pt, 10 連 250pt。 10 連は R 以上確定
--   * 引いたカードは collection に count 加算

CREATE TABLE IF NOT EXISTS trading_cards (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  target_user_id      BIGINT NOT NULL,             -- 描かれる人
  created_by_user_id  BIGINT NOT NULL,             -- 作った人
  catchphrase         VARCHAR(120) NULL,
  reaction_text       VARCHAR(60) NULL,            -- 「今日もがんばるぞ!」など短い決め台詞
  rarity              ENUM('N','R','SR','SSR') NOT NULL DEFAULT 'R',
  image_url           VARCHAR(500) NULL,
  background_color    VARCHAR(9) NULL,
  stats_json          TEXT NULL,                   -- {研究力:90, 論文力:80, ...} 任意
  status              ENUM('pending','approved','rejected','archived') NOT NULL DEFAULT 'pending',
  reject_reason       VARCHAR(200) NULL,
  approved_at         DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_target  FOREIGN KEY (target_user_id) REFERENCES users(id),
  CONSTRAINT fk_tc_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_tc_status_target (status, target_user_id),
  INDEX ix_tc_status_rarity (status, rarity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trading_card_collection (
  user_id       BIGINT NOT NULL,
  card_id       BIGINT NOT NULL,
  count         INT NOT NULL DEFAULT 1,
  first_got_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_got_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_id),
  CONSTRAINT fk_tcc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcc_card FOREIGN KEY (card_id) REFERENCES trading_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trading_card_pulls (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  card_id       BIGINT NOT NULL,
  cost          INT NOT NULL,
  pulled_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_tcp_user_time (user_id, pulled_at),
  CONSTRAINT fk_tcp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcp_card FOREIGN KEY (card_id) REFERENCES trading_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
