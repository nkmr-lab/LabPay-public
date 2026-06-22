-- v748 #359 #360 #361 論文 和訳 要約 アプリ (paper_translate)。
--   既存 paper_reviews と は 別物 (査読 ではなく 落合メソッド の 構造化 要約)。
--   料金 は 20pt。 OpenAI Files API + GPT-4o の PDF 直接読み で 図表 解釈 まで お任せ。

CREATE TABLE IF NOT EXISTS paper_translates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    share_token VARCHAR(64) NOT NULL,
    file_id VARCHAR(255) DEFAULT NULL,
    pdf_name VARCHAR(255) NOT NULL,
    prompt_used MEDIUMTEXT,
    result_json LONGTEXT,
    cost_points INT NOT NULL DEFAULT 20,
    status ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
    error_msg VARCHAR(1000) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_user (user_id, created_at),
    UNIQUE KEY uk_share_token (share_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
