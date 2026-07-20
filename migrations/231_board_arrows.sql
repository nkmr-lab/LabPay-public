-- 231: board arrows (note-to-note connectors, Miro 風)
-- 中村さん要望「Miro って 付箋 から 付箋 に 矢印 を つけられる」
CREATE TABLE IF NOT EXISTS board_arrows (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id       BIGINT NOT NULL,
  from_note_id  BIGINT NOT NULL,
  to_note_id    BIGINT NOT NULL,
  color         VARCHAR(7)  NOT NULL DEFAULT '#111827',
  style         ENUM('solid','dashed') NOT NULL DEFAULT 'solid',
  label         VARCHAR(120) NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL,
  KEY idx_room  (room_id, deleted_at),
  KEY idx_from  (from_note_id),
  KEY idx_to    (to_note_id),
  CONSTRAINT fk_ba_room FOREIGN KEY (room_id) REFERENCES board_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_ba_from FOREIGN KEY (from_note_id) REFERENCES board_notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ba_to   FOREIGN KEY (to_note_id)   REFERENCES board_notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ba_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
