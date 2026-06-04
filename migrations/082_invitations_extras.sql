-- v370 募集 機能の 細部改善:
--   1) starts_at に 「日付だけ」 のモードを追加 (時刻なし)。 starts_at_has_time=0 のとき
--      starts_at は その日の 00:00:00 を表すが、 表示は "YYYY-MM-DD" まで、 auto-close は
--      その日の終わり (= start_at + 1 day) で判定。
--   2) 既存の全募集について 発起人を 参加者として 追加 (INSERT IGNORE)。 v370 以降は
--      作成時に 自動で 1 人 join するので、 過去の分にも 同じルールを 遡及適用。
ALTER TABLE invitations
  ADD COLUMN starts_at_has_time TINYINT(1) NOT NULL DEFAULT 1 AFTER starts_at;

INSERT IGNORE INTO invitation_joins (invitation_id, user_id, joined_at)
  SELECT id, creator_user_id, created_at FROM invitations;
