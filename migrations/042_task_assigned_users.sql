-- 指名タスク (assigned task): 特定の user に限定して送れるタスク。
-- 「発表報告書をメンバー33さんに頼む」みたいな使い方。
--
-- assigned_user_ids: CSV (例: "10,21,3"). NULL なら従来の audience_grades 経由
-- (誰でも条件を満たせば claim 可)。CSV の中に id があれば、その人だけが claim
-- でき、その人達には作成時に直接通知が飛ぶ。
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_user_ids VARCHAR(500) NULL AFTER audience_grades;
