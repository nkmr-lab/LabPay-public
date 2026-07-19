-- v1173 中村さん要望「Board で 手書きもできるようにしたい / 軸を書いたり分類したり」
--   Board (旧 Miro) に 手書きストローク を追加。 ペン線 と 消しゴム を実装。
--   points_json は [{x,y}, ...] の array を JSON 文字列 で保存。 世界座標 (note と同じ)。
CREATE TABLE IF NOT EXISTS miro_strokes (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id             BIGINT NOT NULL,
  points_json         MEDIUMTEXT NOT NULL COMMENT '[{"x":..,"y":..}, ...] 世界座標',
  color               VARCHAR(9) NOT NULL DEFAULT '#111827',
  width               DOUBLE NOT NULL DEFAULT 2.0,
  created_by_user_id  BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at          DATETIME NULL,
  CONSTRAINT fk_miro_stroke_room FOREIGN KEY (room_id) REFERENCES miro_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_miro_stroke_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_ms_room (room_id, deleted_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
