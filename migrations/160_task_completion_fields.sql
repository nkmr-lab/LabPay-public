-- v790 #393 タスク 完了 時 に 起案者 が 指定 した 入力 欄 を 受諾者 に 埋め させる 仕組み。
-- tasks.completion_fields_json: 起案者 が 定義 した 入力 欄 リスト [{key,label,type,required,options}]
-- task_claims.completion_data_json: 受諾者 が 完了 報告 時 に 埋めた 値 のセット
ALTER TABLE tasks
  ADD COLUMN completion_fields_json MEDIUMTEXT NULL AFTER description;
ALTER TABLE task_claims
  ADD COLUMN completion_data_json MEDIUMTEXT NULL;
