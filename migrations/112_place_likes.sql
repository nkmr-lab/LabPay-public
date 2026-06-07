-- v486 #80 食べある記 いいね 機能。 1 人 1 いいね (PK で 二重 防止)。
-- 外部キー の 名前 は MySQL が 自動 採番 する (固定 名 だと 他 テーブル の 制約 と
-- 名前 衝突 して errno 121 で 失敗 する)。
CREATE TABLE IF NOT EXISTS place_likes (
    place_id   BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (place_id, user_id),
    INDEX idx_user (user_id),
    FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
