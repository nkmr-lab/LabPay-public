-- v892 各 snapshot にメインの .tex ファイル (\documentclass を含むトップレベル文書) を記録。
-- これまでは全 .tex の合計をプロジェクト集計に使っていたが、 過去ファイル / サンプル / chapter include 等
-- も含まれて過大カウントになっていた。 collector が \documentclass の存在で主文書を検出して保存する。
-- 既存 snapshot は NULL のまま (新規取得から正しい値が入る)。

ALTER TABLE overleaf_snapshots
  ADD COLUMN main_file_path VARCHAR(500) NULL AFTER file_count,
  ADD COLUMN main_char_count_total INT UNSIGNED NULL AFTER main_file_path,
  ADD COLUMN main_char_count_body  INT UNSIGNED NULL AFTER main_char_count_total,
  ADD COLUMN main_jp_char_count    INT UNSIGNED NULL AFTER main_char_count_body,
  ADD COLUMN main_word_count       INT UNSIGNED NULL AFTER main_jp_char_count;
