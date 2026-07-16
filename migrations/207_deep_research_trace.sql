-- v1096 中村さん要望「DeepResearch 機能、実際にどのような探索行動を行ったのか？
--   みたいなことを後で確認できるようにして欲しい。トレーサビリティ的観点からも」
--   → OpenAI Responses API の output 配列から web_search_call の query と reasoning
--   の summary をトレースとして保存 → 結果ページで確認できるように。
ALTER TABLE deep_researches
  ADD COLUMN trace_json longtext NULL AFTER usage_json;
