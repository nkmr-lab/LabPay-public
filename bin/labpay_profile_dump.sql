-- LabPay users.slack_member_id / cosense_pat を auth 移行用に JSON dump する。
-- 使い方 (中村 の PowerShell から):
--   ssh nakamura@pay.nkmr.io "mysql --defaults-extra-file=/var/www/labpay/config/db.cnf labpay -N -B --raw < /var/www/labpay/bin/labpay_profile_dump.sql" > labpay_profiles.tsv
-- 出力: <email>\t<slack_member_id>\t<cosense_pat> (NULL は空文字)
-- 空行(email 無し) は除外。 tab 区切り + Base64 で secret を 安全 に。
-- MySQL の TO_BASE64 は 76 char で改行を挟むため REPLACE で除去 (TSV が壊れる)。
SELECT
  email,
  IFNULL(slack_member_id, ''),
  IFNULL(REPLACE(REPLACE(TO_BASE64(cosense_pat), '\n', ''), '\r', ''), '')
FROM users
WHERE email IS NOT NULL AND email <> ''
  AND (slack_member_id IS NOT NULL OR cosense_pat IS NOT NULL);
