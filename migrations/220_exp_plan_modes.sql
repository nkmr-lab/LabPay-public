-- v1131 中村さん要望「実験計画書については、厳密にチェックするバージョンと、
--   特に初学者向けのバージョンが欲しい。両方チェックしてタブで切り替えられると良い」
--   → experiment_plan_checks に mode + result_strict_json + result_student_json を追加。
--   既存の result_json は下位互換用に残す (旧レコードは student 相当扱いで読み出し)。
ALTER TABLE experiment_plan_checks
  ADD COLUMN mode VARCHAR(16) NULL COMMENT 'strict|student|both (v1131)',
  ADD COLUMN result_strict_json  LONGTEXT NULL COMMENT '厳密モードの結果 JSON (v1131)',
  ADD COLUMN result_student_json LONGTEXT NULL COMMENT '初学者モードの結果 JSON (v1131)';
