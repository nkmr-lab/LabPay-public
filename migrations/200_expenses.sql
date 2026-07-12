-- v1002 個人家計簿 (中村さん要望「個人の家計簿機能。 領収書を写真で手軽に読み込める」)。
--   ユーザごとの支出記録。 category は 内部 enum (「食費」「交通費」等)。
--   image_path は uploads/expense_receipts/ 配下 に 保存 された 領収書 画像 (認証 済 のみ 閲覧)。
--   ocr_json は OpenAI Vision 抽出 の 生 JSON (line_items 等 の 詳細)。
CREATE TABLE expenses (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    spent_at   DATE         NOT NULL,
    amount     INT          NOT NULL,           -- 円 (整数)
    currency   VARCHAR(3)   DEFAULT 'JPY',
    category   VARCHAR(30)  NULL,               -- 食費 / 交通費 / 交際費 / …
    merchant   VARCHAR(120) NULL,               -- 店名
    memo       VARCHAR(500) NULL,               -- 自由記述
    image_path VARCHAR(255) NULL,               -- /uploads/expense_receipts/<hash>.jpg
    ocr_json   LONGTEXT     NULL,               -- OpenAI Vision の 生 JSON
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_user_date (user_id, spent_at),
    KEY idx_user_cat  (user_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
