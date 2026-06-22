-- v786 #385 Deep Research を OpenAI 背景 モード (background=true) + ポーリング 方式 に 移行。
-- (1) PHP プロセス を 数十 分 縛らない (= サーバ 側 タイムアウト 死 を 回避)
-- (2) 結果 ページ を 開く たび に OpenAI に GET /v1/responses/{id} で 進捗 を 取りに 行ける
-- (3) Web 検索 回数 / 推論 段階 を progress_text に 残して 途中 経過 を 表示
ALTER TABLE deep_researches
  ADD COLUMN openai_response_id VARCHAR(64) NULL AFTER model,
  ADD COLUMN progress_text VARCHAR(255) NULL AFTER status,
  ADD KEY idx_oai_resp (openai_response_id);
