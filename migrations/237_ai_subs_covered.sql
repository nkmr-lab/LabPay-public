-- v1252 AI サブスク 契約中 に カバー された 支払 の 統計 列 を 追加。
-- (LabPay 内 の AI 機能 = 論文要約 / 全訳 / 査読 / DeepResearch / 原稿チェック /
--  実験計画書チェック / リライター が 契約中 は 無料 に なる、 その 「本来 いくら
--  だった か」を 累計)

ALTER TABLE ai_subs
  ADD COLUMN covered_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER cycle_count,
  ADD COLUMN covered_pt    INT UNSIGNED NOT NULL DEFAULT 0 AFTER covered_count;
