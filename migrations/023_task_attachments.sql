-- Task attachments: arbitrary files (PDF / docx / pptx / images / zip ...) that
-- a requester can hand off with a task — primarily for 原稿チェック・添削レビュー
-- style flows where the actual artifact lives in the file rather than a URL.
--
-- Files are stored on disk under public/uploads/tasks/{task_id}/{random}.{ext}.
-- This table just records the metadata so the API can serve a clean download
-- link with the original filename (Content-Disposition).
--
-- Anyone who can see the task can download; only the requester or original
-- uploader can delete. No auto-expiry for now — SSD has plenty of headroom
-- and the file is meaningful even after task close (audit trail).
CREATE TABLE IF NOT EXISTS task_attachments (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id               BIGINT NOT NULL,
  filename              VARCHAR(255) NOT NULL,    -- original, for download display
  stored_name           VARCHAR(80)  NOT NULL,    -- random hex + ext, on-disk basename
  size_bytes            BIGINT NOT NULL,
  mime                  VARCHAR(120) NOT NULL,
  uploaded_by_user_id   BIGINT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ta_task (task_id),
  CONSTRAINT fk_ta_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
