-- スケジュールアイテムに画像 (image_url) と URL を持たせる。
-- 画像はアップロード後の /uploads/<file>.<ext> パス、 URL は任意。
ALTER TABLE adhoc_group_schedule_items
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)  NULL,
  ADD COLUMN IF NOT EXISTS url       VARCHAR(2000) NULL;
