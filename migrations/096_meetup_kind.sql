-- v450 待ち合わせロジック を 〆切 (deadline) にも 再利用。
-- kind = 'meetup' (default、 既存データ全件)、 'deadline' (新規)。
-- 〆切 は meetup_at を そのまま 〆切時刻 として使用、 location は 通常 null。
-- UI ラベル / アイコン / 通知文 だけ 切り替え。
ALTER TABLE meetups
  ADD COLUMN kind ENUM('meetup','deadline') NOT NULL DEFAULT 'meetup' AFTER title;
