-- v784 #382 Deep Research の 共有 / 検索 機能。
ALTER TABLE deep_researches
  ADD COLUMN is_shared TINYINT(1) NOT NULL DEFAULT 0 AFTER finished_at,
  ADD COLUMN shared_at DATETIME NULL AFTER is_shared,
  ADD KEY idx_shared (is_shared, shared_at);
