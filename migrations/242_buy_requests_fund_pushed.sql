-- v1317 buy_requests に fund.nkmr.io 転送済フラグを追加。
--   admin (中村さん) が「buy_requests bought」の後、 fund.nkmr.io に 支払アイテム を
--   手動転送 する UI (buy_requests.js の 転送 modal) で、 成功時 に この列 を セット。
--   重複転送防止 と 一覧 での 「未転送」バッジ表示 に 使用。

ALTER TABLE buy_requests
  ADD COLUMN fund_pushed_at DATETIME NULL DEFAULT NULL COMMENT 'v1317 fund.nkmr.io に転送完了した時刻';
