-- v399 スケジュール の 並び順 を sort_order 主導 に 変更したことに 伴い、
-- 既存データの sort_order を 「旧 ORDER BY (start_time IS NULL, start_time,
-- sort_order, id) に従った 連番」 に再採番。 これにより 視覚順は そのまま、
-- 以降の ↑↓ / DnD は 純粋に sort_order の付け替えで 動くようになる。
-- (group_id, day_date) ごとに 1 から N の連番。 day_date IS NULL は ストック群
-- ごとに 同じ連番空間を共有 (= 1 グループ × 1 ストック)。
-- MariaDB 10.11 / MySQL 8 の ROW_NUMBER() を 利用。

UPDATE adhoc_group_schedule_items s
JOIN (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY group_id, COALESCE(day_date, '0000-00-00')
           ORDER BY (start_time IS NULL), start_time, sort_order, id
         ) AS rn
    FROM adhoc_group_schedule_items
) r ON r.id = s.id
SET s.sort_order = r.rn;
