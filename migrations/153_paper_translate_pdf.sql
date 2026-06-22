-- v758 #377 論文要約 を「やりなおす」 ため に サーバ 側 で PDF を 保持。
--   旧版は OpenAI Files API に upload 後 削除 して いた ので 再 処理 が できなかった。
--   /var/www/labpay/public/uploads/paper_pdfs/<token>/original.pdf に 保存 し、
--   pdf_path カラム に 相対 path を 記録。 model カラム で どの モデル で 動いた か も 記録。

ALTER TABLE paper_translates
    ADD COLUMN pdf_path VARCHAR(255) DEFAULT NULL,
    ADD COLUMN model    VARCHAR(64)  DEFAULT NULL;
