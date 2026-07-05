-- v925 文献管理 (Zotero-like) MVP。 ラボ全員で 共有、 各自 note + 読状態 は 個人別。
-- refs: 文献 レコード 本体 (DOI / arXiv / URL / title / authors / year / venue / abstract / PDF / bibtex / tags)。
-- ref_notes: user 別 の note と 読状態 (unread / reading / read)。
CREATE TABLE refs (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    doi                VARCHAR(200)  NULL,           -- 例: 10.1145/3313831.3376234
    arxiv_id           VARCHAR(50)   NULL,           -- 例: 2401.12345 (バージョン付き 可)
    title              VARCHAR(1000) NOT NULL,
    authors_json       TEXT          NULL,           -- JSON array of {name, orcid?}
    year               INT           NULL,
    venue              VARCHAR(500)  NULL,           -- journal / conference 名
    abstract           MEDIUMTEXT    NULL,
    url                VARCHAR(1000) NULL,           -- 主 URL (crossref / arxiv / 出版社 等)
    pdf_path           VARCHAR(500)  NULL,           -- /uploads/refs/<sha>.pdf
    pdf_sha256         CHAR(64)      NULL,           -- 同一 PDF の 検出 用 (paper_translate と 相互リンク)
    bibtex             MEDIUMTEXT    NULL,           -- 保存時 に crossref / manual で 生成
    tags_json          TEXT          NULL,           -- JSON array of tag strings
    added_by_user_id   INT           NOT NULL,
    created_at         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_doi (doi),
    KEY idx_arxiv (arxiv_id),
    KEY idx_year (year),
    KEY idx_sha (pdf_sha256),
    KEY idx_added_by (added_by_user_id),
    FULLTEXT KEY ft_search (title, abstract)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ref_notes (
    ref_id      INT      NOT NULL,
    user_id     INT      NOT NULL,
    note        MEDIUMTEXT NULL,
    status      ENUM('unread','reading','read') NOT NULL DEFAULT 'unread',
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ref_id, user_id),
    KEY idx_user_status (user_id, status),
    CONSTRAINT fk_ref_notes_ref FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
