-- v797 同じ PDF を 何 度 も アップロード しても 既存 結果 を 流用 する ため の 重複 排除 用 列。
-- pdf_sha256 = アップロード された PDF バイト の SHA-256 (16 進 64 字)。
-- 同 ユーザ で 同 PDF + 同 モデル (要約) / + 同 方向・モデル (全訳) が ある なら 既存 row を 流用 し
-- 新規 課金 / OpenAI Files API へ の 再 アップロード を 行わ ない。
ALTER TABLE paper_translates
  ADD COLUMN pdf_sha256 CHAR(64) NULL,
  ADD KEY idx_dedup_pt (user_id, pdf_sha256, model);

ALTER TABLE paper_full_translations
  ADD COLUMN pdf_sha256 CHAR(64) NULL,
  ADD KEY idx_dedup_pft (user_id, pdf_sha256, direction, model);
