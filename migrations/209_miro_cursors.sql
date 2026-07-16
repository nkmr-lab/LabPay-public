-- v1104 中村さん要望「ここの現在のカーソルを Miro みたいに提示して欲しい。
--   他の人のカーソルが画面の外にある場合はどこかを示して欲しい」
--   → 各ユーザの部屋ごとの最終カーソル位置 (world 座標) を貯めるだけの軽い表。
--   更新頻度は 250 ms スロットル、 サーバで 15 秒より古いものは stale 扱い。

CREATE TABLE IF NOT EXISTS miro_cursors (
  room_id     BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  x           DOUBLE NOT NULL,
  y           DOUBLE NOT NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_miro_cursor_room FOREIGN KEY (room_id) REFERENCES miro_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_miro_cursor_user FOREIGN KEY (user_id) REFERENCES users(id)     ON DELETE CASCADE,
  INDEX ix_mc_room_updated (room_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
