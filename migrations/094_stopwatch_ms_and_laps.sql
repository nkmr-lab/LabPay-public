-- v447 ストップウォッチ を ミリ秒精度 + ラップ機能 対応 に。
--  - 旧: elapsed_offset_seconds (秒) + started_at (DATETIME) のみ
--  - 新: elapsed_offset_ms (ms) + started_at_ms (epoch ms) を 加え、 ms が
--    primary。 秒列は ホーム画面 後方互換 用に floor(ms/1000) で 同期。
--  - ラップ は stopwatch_laps に 別テーブルで 蓄積。 リセット で カスケード削除。

ALTER TABLE stopwatches
  ADD COLUMN started_at_ms      BIGINT NULL  AFTER started_at,
  ADD COLUMN elapsed_offset_ms  BIGINT NOT NULL DEFAULT 0 AFTER elapsed_offset_seconds;

-- 既存 paused データ の 秒 を ms に 反映 (s × 1000)。
UPDATE stopwatches
   SET elapsed_offset_ms = elapsed_offset_seconds * 1000
 WHERE elapsed_offset_ms = 0 AND elapsed_offset_seconds > 0;

CREATE TABLE IF NOT EXISTS stopwatch_laps (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  stopwatch_id        BIGINT NOT NULL,
  lap_index           INT    NOT NULL,
  elapsed_ms          BIGINT NOT NULL,       -- 累計 (ラップ時点 の 経過 ms)
  split_ms            BIGINT NOT NULL,       -- 前ラップ から の 差
  recorded_by_user_id BIGINT NOT NULL,
  recorded_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_swl_sw   FOREIGN KEY (stopwatch_id)        REFERENCES stopwatches(id) ON DELETE CASCADE,
  CONSTRAINT fk_swl_user FOREIGN KEY (recorded_by_user_id) REFERENCES users(id),
  INDEX ix_swl_sw_index (stopwatch_id, lap_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
