-- v1282 📝 原稿チェック依頼 (中村さん pr.nkmr.io チャットで仕様確定、docs/HANDOFF_manuscript_review.md)。
-- 依頼者が PDF をアップ + 複数のチェッカーを指定 → 各チェッカーが pr.nkmr.io で校閲 (音声+手書き)
-- → 結果 URL (https://pr.nkmr.io/{uuid}) が review-result 経由で戻る → 依頼者・チェッカー双方が
-- 結果を開ける。 タスクとは別種別、 依頼ハブ に並ぶ。 LabPay 台帳 (ポイント) は動かない
-- (buy_requests / room_requests と同じ「連絡ボード」設計)。

CREATE TABLE IF NOT EXISTS manuscript_reviews (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  requester_user_id  BIGINT NOT NULL,
  title              VARCHAR(300) NOT NULL,          -- アップロード時のファイル名 or 手入力
  message            TEXT NULL,                      -- 依頼者からのひとこと
  -- PDF 添付 (public/uploads/manuscript_reviews/{id}/{stored_name})
  filename           VARCHAR(255) NOT NULL,          -- 元ファイル名
  stored_name        VARCHAR(255) NOT NULL,          -- 保存名 (ランダム)
  size_bytes         INT UNSIGNED NOT NULL,
  mime               VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  status             ENUM('open','done','cancelled') NOT NULL DEFAULT 'open',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mr_requester (requester_user_id),
  CONSTRAINT fk_mr_requester FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS manuscript_review_reviewers (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id          INT UNSIGNED NOT NULL,
  reviewer_user_id   BIGINT NOT NULL,
  status             ENUM('pending','in_review','done') NOT NULL DEFAULT 'pending',
  result_url         VARCHAR(255) NULL,              -- pr が返す https://pr.nkmr.io/{uuid}
  result_at          DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mrr (review_id, reviewer_user_id),
  KEY idx_mrr_reviewer (reviewer_user_id, status),
  CONSTRAINT fk_mrr_review FOREIGN KEY (review_id) REFERENCES manuscript_reviews(id) ON DELETE CASCADE,
  CONSTRAINT fk_mrr_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
