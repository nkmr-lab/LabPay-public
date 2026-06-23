-- v788 #386 #387 #388 論文 全訳 (要約 で なく 章ごと の フル 翻訳)。
-- direction: en2ja (英語 論文 → 日本語) / ja2en (日本語 論文 → 英語)。
-- result_json は { title_original, title_translated, language_detected, chapters: [...], overall_polish: {} }。
CREATE TABLE IF NOT EXISTS paper_full_translations (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            INT NOT NULL,
    share_token        VARCHAR(64) NOT NULL UNIQUE,
    pdf_path           VARCHAR(255) NULL,
    pdf_name           VARCHAR(255) NOT NULL,
    direction          ENUM('en2ja','ja2en') NOT NULL,
    model              VARCHAR(64) NOT NULL,
    openai_response_id VARCHAR(64) NULL,
    cost_points        INT NOT NULL DEFAULT 0,
    status             ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
    progress_text      VARCHAR(255) NULL,
    result_json        LONGTEXT NULL,
    usage_json         TEXT NULL,
    error_msg          VARCHAR(1000) NULL,
    is_shared          TINYINT(1) NOT NULL DEFAULT 0,
    shared_at          DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at        DATETIME NULL,
    KEY user_created (user_id, created_at),
    KEY status (status),
    KEY oai_resp (openai_response_id),
    KEY is_shared (is_shared, shared_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
