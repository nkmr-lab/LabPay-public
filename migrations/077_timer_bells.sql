-- v353 タイマー に 中間ベル + リピート機能。
--   * bell1/2/3_seconds: タイマー開始からの 経過秒数。 NULL = ベル無し。
--   * repeat_max: 0 = 1 回きり (デフォ)。 N >= 1 = N 回繰返し。
--   * repeat_idx: 現在 何回目か (running 中の internal)。 完了時に +1 して closed_at を NULL のまま
--                 started_at / ends_at をスライドさせる。
ALTER TABLE timers
  ADD COLUMN bell1_seconds INT NULL AFTER duration_seconds,
  ADD COLUMN bell2_seconds INT NULL AFTER bell1_seconds,
  ADD COLUMN bell3_seconds INT NULL AFTER bell2_seconds,
  ADD COLUMN repeat_max    INT NOT NULL DEFAULT 0 AFTER bell3_seconds,
  ADD COLUMN repeat_idx    INT NOT NULL DEFAULT 0 AFTER repeat_max;
