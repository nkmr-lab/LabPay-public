-- v750 #366 paper_translate に 図表抽出 用 の pages カラム を 追加。
--   pdftoppm で PDF を ページ単位 PNG / JPEG に レンダリング → uploads/paper_pages/<token>/ に保存。
--   GPT-4o が 出した important_figures の page 番号 と 紐付けて 表示。

ALTER TABLE paper_translates
    ADD COLUMN pages_count INT DEFAULT NULL,
    ADD COLUMN pages_dir VARCHAR(255) DEFAULT NULL;
