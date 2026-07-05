-- v931 refs: Semantic Scholar 連携 用 の 3 カラム 追加。
-- semantic_scholar_id: SS 側 の paperId (40 桁 hex)。 SS API の references/citations 呼出 に 使う。
-- citation_count: SS が 集計 する 被引用 数 (enrichment で 取得)。
-- reference_count: SS が 集計 する 参考文献 数。
ALTER TABLE refs ADD COLUMN semantic_scholar_id VARCHAR(50) NULL AFTER arxiv_id;
ALTER TABLE refs ADD COLUMN citation_count INT NULL AFTER abstract;
ALTER TABLE refs ADD COLUMN reference_count INT NULL AFTER citation_count;
ALTER TABLE refs ADD KEY idx_ss (semantic_scholar_id);
