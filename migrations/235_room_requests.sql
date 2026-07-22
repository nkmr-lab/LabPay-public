-- v1230 fb#502 教室予約依頼 (中村さんに教室予約を頼むフォーム)
-- 発表練習など。教室番号を具体的に指定できない代わりに
-- 条件 (プロジェクター/大人数/階など) を指定して中村さんが実際に予約する。
-- 台帳は動かない、通知だけの軽い連絡ボード (buy_requests と同じ設計思想)。

CREATE TABLE IF NOT EXISTS room_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  requester_user_id BIGINT NOT NULL,

  purpose VARCHAR(200) NOT NULL,               -- 用途 (例: 発表練習、会議、勉強会)
  event_date DATE NOT NULL,                    -- 使用したい日
  time_start TIME NOT NULL,                    -- 開始時刻
  time_end TIME NOT NULL,                      -- 終了時刻
  expected_participants INT UNSIGNED NULL,     -- 想定人数 (nullable)

  needs_projector TINYINT(1) NOT NULL DEFAULT 0,
  needs_whiteboard TINYINT(1) NOT NULL DEFAULT 0,
  needs_screen TINYINT(1) NOT NULL DEFAULT 0,
  needs_pc TINYINT(1) NOT NULL DEFAULT 0,
  needs_mic TINYINT(1) NOT NULL DEFAULT 0,
  needs_camera TINYINT(1) NOT NULL DEFAULT 0,

  min_capacity INT UNSIGNED NULL,              -- 最低収容人数
  preferred_floor VARCHAR(40) NULL,            -- 希望階 (例: 「3階以上」「低層階」)
  other_conditions TEXT NULL,                  -- 自由記述の追加条件
  notes TEXT NULL,                             -- 依頼者からの補足

  status ENUM('pending','confirmed','declined','cancelled') NOT NULL DEFAULT 'pending',
  room_assigned VARCHAR(120) NULL,             -- confirm 時に押さえた教室名
  admin_note TEXT NULL,                        -- 中村さんからの返信
  resolved_by_user_id BIGINT NULL,
  resolved_at DATETIME NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_room_req_requester (requester_user_id),
  KEY idx_room_req_status_date (status, event_date),
  KEY idx_room_req_event_date (event_date),
  CONSTRAINT fk_room_req_requester FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_room_req_resolver  FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
