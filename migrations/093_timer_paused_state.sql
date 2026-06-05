-- v446 タイマーに 'paused' 状態 + remaining_seconds 列 を追加。
-- create 時は paused から 始まる ようにし、 ユーザが ▶ 開始 を 押したら running に。
-- ⏸ 一時停止 で paused に 戻し remaining_seconds に 残りを 保存。
-- ↻ リセット で remaining_seconds = duration_seconds に 戻す。
-- 旧データ: 実行中 (running) の行は started_at/ends_at が NOT NULL のままなので
-- 互換維持。 新規 paused 行は NULL を 許す。
ALTER TABLE timers
  MODIFY COLUMN status ENUM('paused','running','done','cancelled') NOT NULL DEFAULT 'paused';

ALTER TABLE timers
  MODIFY COLUMN started_at DATETIME NULL,
  MODIFY COLUMN ends_at    DATETIME NULL;

ALTER TABLE timers
  ADD COLUMN remaining_seconds INT NULL AFTER duration_seconds;
