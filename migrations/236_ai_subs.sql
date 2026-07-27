-- v1251 AI サブスク (1 週間 単位 500pt、 自動更新)。 chai.nkmr.io / file.nkmr.io 等 の
-- 外部 サービス から も /api/ai-sub/check で 契約状況 を 参照 できる ように する。
--
-- 1 user あたり 1 行。 状態:
--   active   := canceled_at IS NULL かつ current_period_end > NOW()
--   graceful := canceled_at IS NOT NULL かつ current_period_end > NOW() (解約予約中、 期限まで 利用可)
--   expired  := current_period_end <= NOW() (再購入 UPDATE で 復活)
-- 自動更新 は cron (bin/ai_sub_renew_cron.php) が hourly で 実行:
--   auto_renew=1 かつ current_period_end < NOW() の 行 に つき、
--   残高 >= 500pt なら 500pt 引き落し + 期限 +7 日、 不足 なら 自動 解約 (auto_renew=0)。

CREATE TABLE IF NOT EXISTS ai_subs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,

  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- 初回 契約 開始 (履歴用、 再購入 で は 更新 しない)
  current_period_start DATETIME NOT NULL,                   -- 現行 期間 の 開始
  current_period_end DATETIME NOT NULL,                     -- 現行 期間 の 終了 (これ を 過ぎたら 失効)
  auto_renew TINYINT(1) NOT NULL DEFAULT 1,                 -- 更新時 に 自動 で 500pt 引き落す か
  canceled_at DATETIME NULL,                                -- 「解約 予約」タイムスタンプ (期限まで は 使える)

  last_charged_at DATETIME NULL,                            -- 直近 の 引き落し 成功 時刻
  last_charge_failed_at DATETIME NULL,                      -- 残高 不足 で 更新 失敗 した 時刻
  total_paid INT UNSIGNED NOT NULL DEFAULT 0,               -- 累積 支払 額 (pt)
  cycle_count INT UNSIGNED NOT NULL DEFAULT 0,              -- 更新 サイクル 数 (初回 含む)

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_user (user_id),                             -- 1 user 1 row
  KEY idx_period_end (current_period_end),
  KEY idx_auto_renew_period (auto_renew, current_period_end),
  CONSTRAINT fk_ai_subs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
