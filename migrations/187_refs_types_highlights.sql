-- v929 refs: item_type (article/book/thesis/patent 等) + extra_json (type別 拡張 field)
-- + ref_highlights (PDF ハイライト、 簡易 実装: page + quote_text + comment + color)。
-- rich text note は schema 変更 不要 (既存 note を Markdown として レンダリング)。

ALTER TABLE refs ADD COLUMN item_type
    ENUM('article','book','book_chapter','thesis','conference','patent','dataset','preprint','web','misc')
    NOT NULL DEFAULT 'article' AFTER title;
ALTER TABLE refs ADD COLUMN extra_json TEXT NULL AFTER tags_json;
ALTER TABLE refs ADD KEY idx_type (item_type);

CREATE TABLE ref_highlights (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    ref_id             INT           NOT NULL,
    user_id            INT           NOT NULL,             -- 作成者 (highlight は 個人別 想定 だが 共有 表示)
    page               INT           NULL,                 -- PDF ページ 番号
    quote_text         MEDIUMTEXT    NULL,                 -- 引用 抜き取り (直接入力)
    comment            MEDIUMTEXT    NULL,                 -- 自分 の コメント
    color              VARCHAR(20)   DEFAULT 'yellow',     -- yellow/red/green/blue/purple
    is_shared          TINYINT(1)    NOT NULL DEFAULT 1,   -- 1=ラボ 共有、 0=自分 のみ
    created_at         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_ref (ref_id),
    KEY idx_user (user_id),
    CONSTRAINT fk_hl_ref FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
