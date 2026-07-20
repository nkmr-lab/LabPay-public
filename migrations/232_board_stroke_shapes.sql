-- 232: board_strokes に shape / dashed を 追加 (中村さん要望「図形モード (四角囲い/点線 等) が 欲しい」)
--   shape='freehand' (デフォ) / 'rect' / 'ellipse' / 'line'
--   dashed=1 で 破線 描画
ALTER TABLE board_strokes
  ADD COLUMN shape  VARCHAR(20) NOT NULL DEFAULT 'freehand' AFTER points_json,
  ADD COLUMN dashed TINYINT     NOT NULL DEFAULT 0 AFTER shape;
