-- ワリカ (Splitwise 風): 暫定グループ内で「誰が何を立て替えたか」を積み上げ、
-- 最後にネット残高 + 推奨送金を計算する。各支出は記録時点のメンバースナップショット
-- で等分割。新メンバーが後から追加されても過去支出には参加しない。

CREATE TABLE IF NOT EXISTS adhoc_group_expenses (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id            BIGINT NOT NULL,
  payer_user_id       BIGINT NOT NULL,
  amount_jpy          INT NOT NULL,                 -- 精算用 (常に円換算)
  amount_original     DECIMAL(12,2) NULL,           -- 入力時の現地通貨 (JPY なら NULL)
  currency            CHAR(3) NOT NULL DEFAULT 'JPY',
  rate_to_jpy         DECIMAL(12,6) NULL,           -- 入力時点のレート (JPY なら NULL)
  memo                VARCHAR(500) NULL,
  participants_json   TEXT NOT NULL,                -- 等分割対象の user_id を JSON 配列で snapshot
  created_by_user_id  BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_age_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_age_payer FOREIGN KEY (payer_user_id) REFERENCES users(id),
  CONSTRAINT fk_age_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_age_group_time (group_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
