-- グループ / 募集に表紙画像を付けられるように。
-- /uploads/<file>.<ext> 形式または http(s) を validate_product_image_url で検証する。
ALTER TABLE adhoc_groups
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NULL;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NULL;
