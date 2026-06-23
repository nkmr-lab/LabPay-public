-- v804 ラボ メン が 名言 を 登録 できる ように。 ホーム の 「今日 の 名言」 ウィジェット は
-- 静的 配列 (quotes_daily.js) + これ ら の DB エントリ を 合算 し 日 単位 で deterministic に 1 個 選ぶ。
CREATE TABLE IF NOT EXISTS quotes (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    quote_text TEXT NOT NULL,
    author     VARCHAR(100) NOT NULL DEFAULT '',
    source     VARCHAR(200) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    KEY user_active (user_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
