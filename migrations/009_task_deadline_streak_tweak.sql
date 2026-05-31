-- Task deadline + streak bonus formula adjustment + lower initial points.

SET NAMES utf8mb4;

-- Task deadline: NULL = no deadline. When deadline passes, task auto-cancels
-- and refunds the unused escrow.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS deadline DATETIME NULL AFTER per_user_limit,
  ADD INDEX IF NOT EXISTS idx_task_deadline (status, deadline);

-- Streak: new formula is base + floor(min(cap, max(0, streak-1)) * per_day / divisor).
-- Defaults (per current request): base=10, cap=10, per_day=1, divisor=2
-- → max bonus is floor(10 * 1 / 2) = 5pt, so daily max = 15pt.
INSERT IGNORE INTO config (k, v) VALUES ('streak_bonus_divisor', '2');
UPDATE config SET v = '10'  WHERE k = 'streak_bonus_cap';
UPDATE config SET v = '500' WHERE k = 'initial_points';
