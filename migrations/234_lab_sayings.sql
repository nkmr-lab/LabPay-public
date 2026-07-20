-- 234: 年度別 名言/迷言 の 登録 + 投票 (中村さん要望)
--   who / when / where / what / context を 記録、 fiscal_year (April-March) で 集計、
--   年度末 に 投票 (1 人 1 票 / 名言 につき toggle)。
--   注意: 既存 の `quotes` テーブル は 別 機能 (v804 名言 daily widget) の で
--         こちら は lab_sayings という 名前 で 分離。
CREATE TABLE IF NOT EXISTS lab_sayings (
  id                 BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  said_by_user_id    BIGINT NULL,
  said_by_name       VARCHAR(80)  NOT NULL,
  said_at            DATE         NOT NULL,
  place              VARCHAR(120) NULL,
  body               TEXT         NOT NULL,
  context            TEXT         NULL,
  fiscal_year        INT          NOT NULL,
  created_by_user_id BIGINT       NOT NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME     NULL,
  KEY idx_year      (fiscal_year, deleted_at),
  KEY idx_said_by   (said_by_user_id),
  KEY idx_creator   (created_by_user_id),
  CONSTRAINT fk_ls_said    FOREIGN KEY (said_by_user_id)    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ls_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_saying_votes (
  id             BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  saying_id      BIGINT NOT NULL,
  voter_user_id  BIGINT NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vote (saying_id, voter_user_id),
  KEY idx_voter (voter_user_id),
  CONSTRAINT fk_lsv_saying FOREIGN KEY (saying_id)     REFERENCES lab_sayings(id) ON DELETE CASCADE,
  CONSTRAINT fk_lsv_voter  FOREIGN KEY (voter_user_id) REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
