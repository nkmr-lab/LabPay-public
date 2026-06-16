-- v643 #241 フリップ クイズ に 出題 モード を 追加。
--   text: 出題者 が テキストで 問題文 を 入力 (現在の挙動)
--   verbal: 出題者 が 口頭で 問題を出す (テキスト入力なし、 「次の問へ」 で 即 解答受付)
ALTER TABLE quizzes
  ADD COLUMN mode ENUM('text','verbal') NOT NULL DEFAULT 'text' AFTER title;
