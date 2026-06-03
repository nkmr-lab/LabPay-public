-- レシート = 「下書き状態の支出」 として一つの adhoc_group_expenses テーブルで扱う。
-- 撮影時に is_draft=1 + amount=0 + payer=NULL で 1 行作り、後から金額/対象人/メモ
-- を埋めて精緻化していく。 amount > 0 が入ったら backend が auto で is_draft=0 に。
-- ワリカ一覧 / 精算は is_draft=0 のみ参照する。
ALTER TABLE adhoc_group_expenses
  ADD COLUMN IF NOT EXISTS is_draft TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taken_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS lat DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS lng DECIMAL(10,7) NULL,
  MODIFY COLUMN payer_user_id BIGINT NULL;

-- v225 で別テーブルに作っていた receipt 行を draft として吸収。空でも問題なし。
INSERT INTO adhoc_group_expenses
  (group_id, payer_user_id, amount_jpy, amount_original, currency, rate_to_jpy,
   memo, image_url, participants_json, created_by_user_id, created_at,
   is_draft, taken_at, lat, lng)
SELECT r.group_id, NULL, 0, NULL, 'JPY', NULL,
       NULL, r.image_url, '[]', r.uploaded_by_user_id, r.created_at,
       1, r.taken_at, r.lat, r.lng
FROM adhoc_group_receipts r;
