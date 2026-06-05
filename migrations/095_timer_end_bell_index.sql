-- v449 学会タイマー化: 1鈴 / 2鈴 / 3鈴 の どれを 「発表終了タイミング」 とするか
-- 指定 する。
--  end_bell_index = 1/2/3 : その ベル時刻 を duration_seconds として 採用、
--                           そこで 終了音 (ding)。 他の ベル (前 / 後) は
--                           中間 tick で 鳴る (前 = 残り警告、 後 = 質疑時間 通知)。
--  end_bell_index = NULL  : 旧仕様 (duration_seconds が end、 ベル は 全部 intermediate)。
-- 旧データ は そのまま 動作 (= NULL → 旧 ロジック)。
ALTER TABLE timers
  ADD COLUMN end_bell_index TINYINT NULL AFTER bell3_seconds;
