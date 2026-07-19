-- v1176 中村さん指示「いますぐ いっちゃおう」 (v1174 の続き)
-- DB テーブル miro_* → board_* にリネーム。 FK 制約は RENAME TABLE で 自動 追随。
RENAME TABLE miro_rooms       TO board_rooms,
             miro_notes       TO board_notes,
             miro_note_flips  TO board_note_flips,
             miro_cursors     TO board_cursors,
             miro_strokes     TO board_strokes;

-- user_settings は k/v の KV ストア。 k='miro_default_color' の 行が あれば
-- k='board_default_color' に UPDATE (無ければ noop)。
UPDATE user_settings SET k='board_default_color' WHERE k='miro_default_color';
