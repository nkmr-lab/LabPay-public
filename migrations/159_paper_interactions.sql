-- v789 #389 論文 要約 / 全訳 に いいね・ブックマーク・コメント を 付ける ため の テーブル。
-- ref_type: 'paper_translate' (要約) / 'paper_full_translation' (全訳)
CREATE TABLE IF NOT EXISTS paper_reactions (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ref_type   VARCHAR(32) NOT NULL,
    ref_id     BIGINT NOT NULL,
    user_id    INT NOT NULL,
    kind       ENUM('like','bookmark') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_react (ref_type, ref_id, user_id, kind),
    KEY by_ref (ref_type, ref_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS paper_comments (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ref_type   VARCHAR(32) NOT NULL,
    ref_id     BIGINT NOT NULL,
    user_id    INT NOT NULL,
    body       MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY by_ref (ref_type, ref_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
