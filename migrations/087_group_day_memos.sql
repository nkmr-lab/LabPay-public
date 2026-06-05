-- グループ スケジュール の 「1 日 1 行」 のメモ。 行程表 とは 別に、 「この日の
-- 目当て・注意点」 などを 自由テキストで 1 ブロック 書き残す用途。 (group_id, day_date)
-- で UNIQUE。 ストック (day_date IS NULL) には 持たせない。

CREATE TABLE IF NOT EXISTS adhoc_group_day_memos (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id            BIGINT NOT NULL,
  day_date            DATE NOT NULL,
  memo                TEXT NULL,
  updated_by_user_id  BIGINT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agdm_group FOREIGN KEY (group_id) REFERENCES adhoc_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_agdm_user  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_group_day (group_id, day_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
