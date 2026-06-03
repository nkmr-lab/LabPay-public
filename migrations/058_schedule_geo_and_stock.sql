-- スケジュール拡張: 緯度経度 (地図) + ストック (日付未定の行きたい場所)。
ALTER TABLE adhoc_group_schedule_items
  ADD COLUMN IF NOT EXISTS lat DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS lng DECIMAL(10,7) NULL,
  MODIFY day_date DATE NULL;
