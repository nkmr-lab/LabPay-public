-- v928 refs の 整理 強化 (Zotero の Collections + Saved Searches + Trash + Related Items 相当)。

-- 1) refs に soft delete
ALTER TABLE refs ADD COLUMN deleted_at DATETIME NULL AFTER updated_at;
ALTER TABLE refs ADD KEY idx_deleted (deleted_at);

-- 2) Collections (フォルダ 階層)。 ラボ 共有、 作成者 or admin が 編集/削除。
CREATE TABLE ref_collections (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(200)  NOT NULL,
    description       TEXT          NULL,
    parent_id         INT           NULL,               -- NULL = top level
    owner_user_id     INT           NOT NULL,
    icon              VARCHAR(10)   DEFAULT '📁',
    sort_order        INT           DEFAULT 0,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_parent (parent_id),
    KEY idx_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Collection ↔ Refs (many-to-many)
CREATE TABLE ref_collection_items (
    collection_id     INT           NOT NULL,
    ref_id            INT           NOT NULL,
    added_by_user_id  INT           NOT NULL,
    added_at          DATETIME      DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, ref_id),
    KEY idx_ref (ref_id),
    CONSTRAINT fk_rci_col FOREIGN KEY (collection_id) REFERENCES ref_collections(id) ON DELETE CASCADE,
    CONSTRAINT fk_rci_ref FOREIGN KEY (ref_id)        REFERENCES refs(id)            ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Saved searches (個人 別)
CREATE TABLE ref_saved_searches (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id     INT           NOT NULL,
    name              VARCHAR(200)  NOT NULL,
    filter_json       TEXT          NOT NULL,  -- {q, tag, year, status, sort, collection_id?}
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Related items (bidirectional、 kind で 種別 分け)
CREATE TABLE ref_relations (
    a_ref_id          INT           NOT NULL,
    b_ref_id          INT           NOT NULL,
    kind              ENUM('related','cites','same_topic') NOT NULL DEFAULT 'related',
    note              VARCHAR(500)  NULL,
    created_by_user_id INT          NOT NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (a_ref_id, b_ref_id, kind),
    KEY idx_b (b_ref_id),
    CONSTRAINT fk_rel_a FOREIGN KEY (a_ref_id) REFERENCES refs(id) ON DELETE CASCADE,
    CONSTRAINT fk_rel_b FOREIGN KEY (b_ref_id) REFERENCES refs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
