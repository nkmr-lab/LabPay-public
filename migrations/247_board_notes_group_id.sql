-- fb#522 中村研 （氏名02）要望: ノート同士のグループ化 (永続) + 一括移動。
-- board_notes.group_id を追加 (NULL = グループなし)。同一 room 内で group_id が一致する
-- ノートは「一緒に動く1つのまとまり」として扱う。
ALTER TABLE board_notes ADD COLUMN group_id INT UNSIGNED NULL AFTER z_index;
ALTER TABLE board_notes ADD KEY idx_room_group (room_id, group_id);
