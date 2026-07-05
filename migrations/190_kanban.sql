-- v934 かんばん ボード (Trello-like)。 ラボ共有 デフォルト、 全 members が 見え て 触れる。
-- boards → lists (列) → cards (タスク) の 3 階層 + assignees / labels / checklist / comments / activity。

CREATE TABLE kanban_boards (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    title         VARCHAR(200) NOT NULL,
    description   TEXT NULL,
    icon          VARCHAR(10) DEFAULT '📋',
    owner_user_id INT NOT NULL,
    archived_at   DATETIME NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_owner (owner_user_id),
    KEY idx_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_lists (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    board_id    INT NOT NULL,
    title       VARCHAR(100) NOT NULL,
    sort_order  INT DEFAULT 0,
    archived_at DATETIME NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_board (board_id, sort_order),
    CONSTRAINT fk_kl_board FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_cards (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    list_id            INT NOT NULL,
    title              VARCHAR(500) NOT NULL,
    description        MEDIUMTEXT NULL,
    sort_order         INT DEFAULT 0,
    due_at             DATETIME NULL,
    is_done            TINYINT(1) DEFAULT 0,
    archived_at        DATETIME NULL,
    created_by_user_id INT NOT NULL,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_list (list_id, sort_order),
    KEY idx_due (due_at),
    KEY idx_created_by (created_by_user_id),
    CONSTRAINT fk_kc_list FOREIGN KEY (list_id) REFERENCES kanban_lists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_card_assignees (
    card_id     INT NOT NULL,
    user_id     INT NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (card_id, user_id),
    KEY idx_user (user_id),
    CONSTRAINT fk_kca_card FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_labels (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    board_id   INT NOT NULL,
    name       VARCHAR(50) NOT NULL,
    color      VARCHAR(20) DEFAULT 'gray',   -- gray, red, orange, yellow, green, blue, purple, pink
    sort_order INT DEFAULT 0,
    KEY idx_board (board_id),
    CONSTRAINT fk_klb_board FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_card_labels (
    card_id  INT NOT NULL,
    label_id INT NOT NULL,
    PRIMARY KEY (card_id, label_id),
    KEY idx_label (label_id),
    CONSTRAINT fk_kcl_card  FOREIGN KEY (card_id)  REFERENCES kanban_cards(id)  ON DELETE CASCADE,
    CONSTRAINT fk_kcl_label FOREIGN KEY (label_id) REFERENCES kanban_labels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_checklist_items (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    card_id    INT NOT NULL,
    text       VARCHAR(500) NOT NULL,
    is_done    TINYINT(1) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_card (card_id, sort_order),
    CONSTRAINT fk_kci_card FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_card_comments (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    card_id    INT NOT NULL,
    user_id    INT NOT NULL,
    body       MEDIUMTEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_card (card_id, id),
    CONSTRAINT fk_kcc_card FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kanban_activity (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    board_id     INT NOT NULL,
    card_id      INT NULL,
    user_id      INT NOT NULL,
    action       VARCHAR(50) NOT NULL,        -- create_card / move_card / edit_desc / add_comment 等
    details_json TEXT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_board (board_id, id),
    KEY idx_card (card_id, id),
    CONSTRAINT fk_ka_board FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
