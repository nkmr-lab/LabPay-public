-- v1100 中村さん要望「miroみたいなアプリを作りたい。グループで部屋を作り、
--   空間にポストイットを配置できる」。差別化ポイント: 各ノートに表裏 (side per
--   user)、AI 画像生成でノートに貼れる、ユーザごとにデフォルト色を持てる。
--   スコープ確認済み: (1) ラボ全員 見える + 編集可 (2) side はユーザごと個別
--   (3) ノート内「🎨 画像生成」ボタン方式。

-- 部屋: ラボ全員が見えて全員が編集可能 (LabPay 標準の共有カルチャに合わせる)
CREATE TABLE IF NOT EXISTS miro_rooms (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,
  description         TEXT NULL,
  bg_color            VARCHAR(9) NULL,
  creator_user_id     BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at         DATETIME NULL,
  CONSTRAINT fk_miro_room_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX ix_mr_updated (updated_at),
  INDEX ix_mr_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ノート: 表裏の text/image は共有、side は miro_note_flips で個別
CREATE TABLE IF NOT EXISTS miro_notes (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id             BIGINT NOT NULL,
  x                   DOUBLE NOT NULL DEFAULT 0,
  y                   DOUBLE NOT NULL DEFAULT 0,
  width               DOUBLE NOT NULL DEFAULT 220,
  height              DOUBLE NOT NULL DEFAULT 220,
  rotation            DOUBLE NOT NULL DEFAULT 0,
  color               VARCHAR(9) NOT NULL DEFAULT '#FEF9A8',
  front_text          TEXT NULL,
  back_text           TEXT NULL,
  front_image_url     VARCHAR(500) NULL,
  back_image_url      VARCHAR(500) NULL,
  z_index             INT NOT NULL DEFAULT 0,
  created_by_user_id  BIGINT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          DATETIME NULL,
  CONSTRAINT fk_miro_note_room FOREIGN KEY (room_id) REFERENCES miro_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_miro_note_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX ix_mn_room (room_id, deleted_at, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- side はユーザごと個別 (人によってオモテ/ウラの見え方が変わる)
CREATE TABLE IF NOT EXISTS miro_note_flips (
  note_id     BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  side        TINYINT NOT NULL DEFAULT 1,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id, user_id),
  CONSTRAINT fk_miro_flip_note FOREIGN KEY (note_id) REFERENCES miro_notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_miro_flip_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
