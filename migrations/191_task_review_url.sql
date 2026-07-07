-- v935 タスク添付PDFの「校閲」連携 (pr.nkmr.io)。
-- 添付PDFを pr.nkmr.io の校閲モードへ渡し、校閲後の共有URLをこの列へ書き戻す。
ALTER TABLE task_attachments
  ADD COLUMN review_url        TEXT     NULL,
  ADD COLUMN review_updated_at DATETIME NULL;
