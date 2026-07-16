-- v1113 中村さん要望「明日、研究室に一緒に行こう機能を作って。明日研究室行きたいけど、
--   人が居なくて寂しいことがある。明日行くと最初から決めてる人が押すボタン。
--   最初の人が、ポイントを設定する。行くと言って行かなかったら、行くと言って来た人に
--   ポイントを送付する」
--   → 1 日 1 プラン (target_date UNIQUE)、最初の join 者がフィーを設定、他の人は追加無料で
--   参加宣言。翌日以降、settlement で checkins (在室検知) を根拠に「宣言 vs 実際」を判定、
--   行かなかった人が行った人に fee ポイントを送る。

CREATE TABLE IF NOT EXISTS tomorrow_lab_plans (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  target_date         DATE NOT NULL,
  fee                 INT NOT NULL,
  memo                VARCHAR(200) NULL,
  created_by_user_id  BIGINT NOT NULL,
  status              ENUM('open','settled','cancelled') NOT NULL DEFAULT 'open',
  settled_at          DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tlp_date (target_date),
  CONSTRAINT fk_tlp_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_tlp_status (status, target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tomorrow_lab_joiners (
  plan_id           BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  joined_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  showed_up         TINYINT(1) NULL,           -- NULL = settlement 前、 0/1 で確定
  penalty_paid      INT NOT NULL DEFAULT 0,    -- no-show 時に支払った pt
  bonus_received    INT NOT NULL DEFAULT 0,    -- showed 時に受け取った pt
  PRIMARY KEY (plan_id, user_id),
  CONSTRAINT fk_tlj_plan FOREIGN KEY (plan_id) REFERENCES tomorrow_lab_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_tlj_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
