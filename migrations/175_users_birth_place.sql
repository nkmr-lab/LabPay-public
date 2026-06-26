-- v852 #439 西洋占星術: 出生地を プロフィールに保存。
--   出生時間 が ない 場合 でも 緯度経度 (or 都市名) があれば 大まかな 占い 要素
--   (= ラッキー方位 / 土地由来 ラッキー街) を 出せるように。

ALTER TABLE users ADD COLUMN birth_place VARCHAR(100) NULL;
