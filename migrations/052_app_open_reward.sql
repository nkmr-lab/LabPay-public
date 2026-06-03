-- アプリ起動ボーナス: 1 日 1 回、 通知の未読が 0 の状態で LabPay を開いたら
-- +5 pt (デフォルト)。 「お知らせを溜め込まない」 動機づけ。 未読通知がそもそも
-- 来ていない日も付与 (通知 0 → ボーナス) 。
ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward'
) NOT NULL;

CREATE TABLE IF NOT EXISTS app_open_rewards (
  user_id    BIGINT   NOT NULL,
  awarded_on DATE     NOT NULL,
  points     INT      NOT NULL,
  ledger_id  BIGINT   NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, awarded_on),
  KEY (ledger_id)
) ENGINE=InnoDB;

INSERT INTO config (k, v) VALUES ('app_open_reward_pt', '5')
ON DUPLICATE KEY UPDATE v = v;
