-- v1276 食べある記 (places) にタグ機能追加 (中村さん要望「タグベースで絞り込みたい。
-- ジャンル (category) だと重複がある」)。
-- 半角カンマ区切り の CSV で保存 (例: "ラーメン,家系,深夜営業")。
-- places の 件数 が 数十〜数百 なので index は不要、 client-side で AND filter。
ALTER TABLE places ADD COLUMN tags VARCHAR(500) NULL DEFAULT NULL AFTER category;
