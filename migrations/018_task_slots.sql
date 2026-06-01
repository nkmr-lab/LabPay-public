-- 018: time slots for tasks (experimental subject recruitment etc.)
--
-- A task can optionally have a list of (started_at, ended_at, capacity) slots.
-- When slots are present, the worker picks a specific slot when claiming and
-- the claim is bound to that slot. Tasks without slots keep the previous
-- single-bucket behavior (slot_id is NULL).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS task_slots (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT NOT NULL,
  started_at  DATETIME NOT NULL,
  ended_at    DATETIME NOT NULL,
  capacity    INT      NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_slot_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT chk_slot_capacity CHECK (capacity > 0),
  INDEX idx_slot_task (task_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE task_claims
  ADD COLUMN IF NOT EXISTS slot_id BIGINT NULL AFTER user_id,
  ADD INDEX IF NOT EXISTS idx_claim_slot (slot_id);

-- Add FK separately so the migration is idempotent if the column existed.
ALTER TABLE task_claims
  ADD CONSTRAINT fk_claim_slot FOREIGN KEY (slot_id) REFERENCES task_slots(id);
