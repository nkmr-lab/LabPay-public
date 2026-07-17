-- v1141 中村さん要望「査読結果や原稿チェックの結果で、修正するべき点をチェックボックスに
--   しておいて、画面上部に配置しよう。 で、そのチェックボックスで進捗を管理できるように
--   しよう (これは他者ともシェア)。 また、そのTODOリストを、自身のTODOに放り込む機能を追加」
--
--   3 種の AI 結果 (paper_review / resume_check / experiment_plan_check) から抽出した
--   「修正すべき点」をチェックボックスとして 保存。 shared: 誰でも閲覧・チェックできる
--   (source が誰の物かは 結果テーブル側の権限で 制御)。
CREATE TABLE IF NOT EXISTS ai_checklist_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type VARCHAR(32) NOT NULL COMMENT 'paper_review | resume_check | exp_plan',
  source_id BIGINT NOT NULL COMMENT '各 AI 結果テーブルの id',
  item_key VARCHAR(80) NOT NULL COMMENT '結果内での安定な key (例 weakness:3, rewrite:0, issue:stat:2)',
  text_snippet VARCHAR(500) NOT NULL COMMENT '表示用スニペット (生成後不変)',
  checked TINYINT(1) NOT NULL DEFAULT 0,
  checked_by_user_id BIGINT NULL,
  checked_at DATETIME NULL,
  todo_id BIGINT NULL COMMENT '自分の TODO に転送した際の user_todos.id (二重防止)',
  todo_by_user_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_checklist_item (source_type, source_id, item_key),
  INDEX ix_ai_checklist_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
