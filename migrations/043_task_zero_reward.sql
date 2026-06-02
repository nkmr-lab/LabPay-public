-- 0 pt タスクを許可 (お願いベース、ボランティア依頼)。
-- 既存の CHECK (reward > 0) を外し、reward >= 0 で許容。
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_task_reward;
ALTER TABLE tasks ADD CONSTRAINT chk_task_reward CHECK (reward >= 0);
