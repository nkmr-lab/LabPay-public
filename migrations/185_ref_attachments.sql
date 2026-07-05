-- v927 refs に 複数 添付 を 持たせる (PDF / 補足資料 / スライド / 動画 / その他)。
-- 既存 の refs.pdf_path は 「主 PDF」 として そのまま 残す (SHA 相互リンク 用)。
-- ref_attachments は 追加分 (「補足資料」「関連スライド」 等) を 束ねる。
CREATE TABLE ref_attachments (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    ref_id             INT           NOT NULL,
    kind               ENUM('pdf','supplement','slides','video','image','other') NOT NULL DEFAULT 'other',
    path               VARCHAR(500)  NOT NULL,      -- /uploads/refs/attachments/<sha>.<ext>
    sha256             CHAR(64)      NULL,
    filename           VARCHAR(255)  NOT NULL,
    mime               VARCHAR(100)  NULL,
    size_bytes         INT           NULL,
    caption            VARCHAR(500)  NULL,
    uploaded_by_user_id INT          NOT NULL,
    created_at         DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ref (ref_id),
    KEY idx_sha (sha256),
    CONSTRAINT fk_ref_att_ref FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
