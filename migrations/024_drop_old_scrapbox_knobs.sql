-- Drop obsolete Scrapbox direct-API config rows. These were used by the
-- old bin/scrapbox_sync.php (removed in this same cleanup) and the legacy
-- /api/admin/scrapbox/sync endpoint. The current Slack-bridge sync uses
-- scrapbox_base_pt / scrapbox_pt_per_extra / scrapbox_bonus_cap /
-- scrapbox_start_date and ignores the old keys.
DELETE FROM config WHERE k IN (
  'scrapbox_project',
  'scrapbox_pt_per_page',
  'scrapbox_pt_daily_cap'
);
