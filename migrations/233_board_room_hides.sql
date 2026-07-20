-- 233: board_room_hides — ユーザ が Board を「抜けた/隠した」状態 を 記録
--   中村さん要望「グループのボードから抜ける機能」対応。 room 本体 は 消さず、
--   自分 の 一覧 から だけ 見えなくする (undo 可能な soft hide)。
CREATE TABLE IF NOT EXISTS board_room_hides (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id       BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,
  hidden_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_pair (room_id, user_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_brh_room FOREIGN KEY (room_id) REFERENCES board_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_brh_user FOREIGN KEY (user_id) REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
