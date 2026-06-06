-- v478 食べある記 (places) に メイン 写真 (image_url) を 追加。 レビュー の
-- 画像 と は 別の 「お店 を 代表する 1 枚」。 list / 地図 で 背景画像 として
-- 優先 利用 (image_url > 最新 review の image_url > 🍴 アイコン)。
ALTER TABLE places
  ADD COLUMN image_url VARCHAR(500) NULL AFTER description;
