-- v756 #372 論文 和訳要約 を 共有 ON/OFF + キーワード 検索 で 他人 も 閲覧可 に。
--   is_shared=1 の 行 だけ 公開 一覧 + 検索 で ヒット する。 検索 は result_json + pdf_name の
--   LIKE %q% で 十分 (現状 1000 件 オーダー想定)。

ALTER TABLE paper_translates
    ADD COLUMN is_shared TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN shared_at DATETIME DEFAULT NULL,
    ADD KEY idx_shared (is_shared, shared_at);
