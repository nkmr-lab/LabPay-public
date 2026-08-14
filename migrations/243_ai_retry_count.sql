-- v1325 AI job (要約/全訳/査読) の 自動リトライ 用列 を 3 テーブル に 追加。
--   retry_count: 何回 再実行 したか (3 で 打ち止め)
--   last_attempt_at: 直近 の 開始 時刻 (NULL の 場合 は created_at で 代替判定)
--   watchdog cron (bin/ai_watchdog.php) が processing で 15 分 以上 沈黙 の job を 拾って
--   再実行 or 諦め+返金 する。

ALTER TABLE paper_translates
  ADD COLUMN retry_count int unsigned NOT NULL DEFAULT 0 COMMENT 'v1325 リトライ回数',
  ADD COLUMN last_attempt_at datetime NULL DEFAULT NULL COMMENT 'v1325 最新 attempt 時刻';

ALTER TABLE paper_full_translations
  ADD COLUMN retry_count int unsigned NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at datetime NULL DEFAULT NULL;

ALTER TABLE paper_reviews
  ADD COLUMN retry_count int unsigned NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at datetime NULL DEFAULT NULL;
