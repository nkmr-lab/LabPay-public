-- v781 #376 Deep Research テーブル。 ChatGPT の Deep Research を 真似て、
-- OpenAI Responses API + web_search tool で 多段 調査 を 行い 構造化 レポート を 返す。
CREATE TABLE IF NOT EXISTS deep_researches (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    share_token   VARCHAR(64) NOT NULL UNIQUE,
    query_text    MEDIUMTEXT NOT NULL,
    model         VARCHAR(64) NOT NULL,
    depth         VARCHAR(16) NOT NULL DEFAULT 'standard',  -- light | standard | deep
    cost_points   INT NOT NULL DEFAULT 0,
    status        ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
    result_json   LONGTEXT NULL,
    usage_json    TEXT NULL,            -- {input_tokens, output_tokens, total_tokens, search_count}
    error_msg     VARCHAR(1000) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at   DATETIME NULL,
    KEY user_created (user_id, created_at),
    KEY status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
