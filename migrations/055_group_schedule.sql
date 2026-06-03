-- グループ (主に学会 / 旅行) のスケジュール機能。 開始日と終了日を持ち、
-- その範囲内の各日に時刻付きアイテム (飛行機 / 宿 / 学会 / 食事 / 観光 / 他)
-- を投下する。 並び順は start_time (NULL は最後)、 タイブレークは sort_order。
ALTER TABLE adhoc_groups
  ADD COLUMN IF NOT EXISTS schedule_start_date DATE NULL,
  ADD COLUMN IF NOT EXISTS schedule_end_date   DATE NULL;

CREATE TABLE IF NOT EXISTS adhoc_group_schedule_items (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id            BIGINT NOT NULL,
  day_date            DATE NOT NULL,
  start_time          TIME NULL,
  duration_minutes    INT  NULL,
  kind                VARCHAR(20) NOT NULL DEFAULT 'other',
  title               VARCHAR(200) NOT NULL,
  location            VARCHAR(500) NULL,
  memo                TEXT NULL,
  sort_order          INT NOT NULL DEFAULT 0,
  created_by_user_id  BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sched_group   FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_sched_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_sched_day (group_id, day_date, start_time, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
