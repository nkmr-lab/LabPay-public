-- v795 論文 査読 で アップロード した PDF (本体 + 回答 文) を サーバ 側 に 保存 して、
-- 結果 ページ から リンク で 取り 出せる ように する 列 追加。
ALTER TABLE paper_reviews
  ADD COLUMN pdf_path          VARCHAR(255) NULL AFTER pdf_name,
  ADD COLUMN response_pdf_path VARCHAR(255) NULL AFTER response_text;
