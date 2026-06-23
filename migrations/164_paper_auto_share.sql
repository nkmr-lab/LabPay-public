-- v804 論文 要約 / 全訳 の アップロード 時 に 「終わった 瞬間 共有 ON」 を 指定 できる ように。
-- 処理 完了 (status='done') 時 に auto_share=1 なら is_shared=1 + shared_at=NOW() を セット。
ALTER TABLE paper_translates          ADD COLUMN auto_share TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE paper_full_translations   ADD COLUMN auto_share TINYINT(1) NOT NULL DEFAULT 0;
