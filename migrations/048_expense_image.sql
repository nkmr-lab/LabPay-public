-- ワリカの各支出にレシート写真を 1 枚付けられるように。
-- 後でグループ精算する時、誰がいくら何のために払ったか思い出すための
-- スナップショット。 image_url は /uploads/<file>.<ext> 形式。
ALTER TABLE adhoc_group_expenses
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NULL;
