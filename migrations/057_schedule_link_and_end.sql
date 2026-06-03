-- スケジュール拡張:
-- (1) end_date / end_time で 1 アイテムが日をまたぐ場合に対応 (夜行便、 宿泊)。
-- (2) link_pair_id で 2 つの予定をペアにして 「出発便 → 到着便」 「行き → 帰り」
--     などを連結表示する。 UUID/ランダム文字列を共有することで同じペアと判定。
ALTER TABLE adhoc_group_schedule_items
  ADD COLUMN IF NOT EXISTS end_date     DATE         NULL,
  ADD COLUMN IF NOT EXISTS end_time     TIME         NULL,
  ADD COLUMN IF NOT EXISTS link_pair_id VARCHAR(40)  NULL,
  ADD INDEX IF NOT EXISTS ix_sched_pair (link_pair_id);
