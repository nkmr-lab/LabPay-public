-- グループのオプション機能 (スケジュール / 宿泊地 / 航空券)。
-- 基本のグループ (飲み会 / 連幹事 など) では不要なので デフォルト OFF。
-- 学会・出張のときだけ ON にして関連 UI を出す。

ALTER TABLE adhoc_groups
  ADD COLUMN IF NOT EXISTS feat_schedule TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feat_lodging  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feat_flight   TINYINT(1) NOT NULL DEFAULT 0;

-- 既存グループの後方互換: 既に schedule items / lodgings / flights が入ってる
-- グループは 当該機能を ON にして 互換性を保つ。
UPDATE adhoc_groups g SET feat_schedule = 1
 WHERE g.schedule_start_date IS NOT NULL
    OR EXISTS (SELECT 1 FROM adhoc_group_schedule_items s WHERE s.group_id = g.id);

UPDATE adhoc_groups g SET feat_lodging = 1
 WHERE EXISTS (SELECT 1 FROM adhoc_group_lodgings l WHERE l.group_id = g.id);

UPDATE adhoc_groups g SET feat_flight = 1
 WHERE EXISTS (SELECT 1 FROM adhoc_group_flights f WHERE f.group_id = g.id);
