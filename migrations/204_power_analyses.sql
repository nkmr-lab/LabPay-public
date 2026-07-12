-- v1026 サンプルサイズ / 検定力 の 設定 を 名前付き で 保存 + 共有 (中村さん要望)。
--   config_json は state を そのまま JSON 化 (test, mode, alpha, tails, effect,
--   power, n_per_group, n_total, k, df)。 サイズ 小 (1KB 未満)。 view 側 で 復元。
CREATE TABLE IF NOT EXISTS power_analyses (
    id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    name         VARCHAR(200) NOT NULL,
    config_json  TEXT NOT NULL,
    share_token  VARCHAR(20) NULL,
    is_shared    TINYINT NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_share_token (share_token),
    KEY idx_user (user_id, id),
    CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
