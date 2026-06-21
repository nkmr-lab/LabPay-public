-- v740 BingoFit (feedback #288) 衣類着回しビンゴ。
--   既存 v600 ラボイベントビンゴ (bingo_cards) とは別物 (盤生成ロジック / UX 完全分離)。
--   週次サイクルは既存 bingo に合わせて日曜 00:00 (JST) 始まり。 盤は GET /api/bingofit/board
--   で初回アクセス時に自動生成。 背景透過 PNG は cron worker (毎分) が rembg で 非同期 に作る。

CREATE TABLE IF NOT EXISTS bingofit_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    label VARCHAR(80) NOT NULL DEFAULT '',
    category ENUM('top','bottom','outer','shoes','other') NOT NULL DEFAULT 'other',
    image_url VARCHAR(255) NOT NULL,
    image_url_transparent VARCHAR(255) DEFAULT NULL,
    bg_status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
    bg_error VARCHAR(500) DEFAULT NULL,
    archived_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_active (user_id, archived_at),
    KEY idx_bg_status (bg_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bingofit_boards (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    week_start DATE NOT NULL,
    cells_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_week (user_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bingofit_cell_opens (
    board_id BIGINT UNSIGNED NOT NULL,
    cell_index TINYINT UNSIGNED NOT NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (board_id, cell_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
