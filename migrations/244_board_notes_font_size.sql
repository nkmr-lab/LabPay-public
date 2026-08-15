-- v1328 fb#512 中村さん要望「boardsで文字のフォントサイズを自由に指定させて欲しい」
--   note ごと に font_size (px) を 保持。 NULL の 時 は dynamicFontSize (文字数+幅 から 自動計算)
--   の 従来挙動、 明示値 が あれば それを 優先。
ALTER TABLE board_notes
  ADD COLUMN font_size int NULL DEFAULT NULL COMMENT 'v1328 note の 明示 フォントサイズ (px)、 NULLで自動';
