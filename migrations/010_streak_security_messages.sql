-- 010: streak formula simplification + idempotency PK hardening + URL/completion-message fields.
--
-- Streak (new): points = base + min(cap, max(0, streak-1)) per day.
--   base = 5, cap = 15, divisor = 1  →  range 5..20pt; the cap is reached on day 16.
--   Streak advances on ANY day the user shows up (weekends/holidays included).
--   No penalty for missing weekends/holidays — only a missed workday breaks the chain.
--   We keep streak_decay_per_missed_workday so a user who skips actual workdays still resets,
--   but the prior weekday_only gate is no longer used.
--
-- Idempotency: the PK was just (ukey). Two different users hitting the same ukey collided
-- — turn it into (ukey, user_id, endpoint) so each user's keyspace is isolated.
--
-- Content: tasks/listings get optional fields for a worker-facing URL, completion thank-you
-- messages, and details. task_claims.notes is already the worker→requester feedback channel.

SET NAMES utf8mb4;

-- ===== Streak knobs =====
UPDATE config SET v = '5'  WHERE k = 'checkin_base';
UPDATE config SET v = '15' WHERE k = 'streak_bonus_cap';
UPDATE config SET v = '1'  WHERE k = 'streak_bonus_divisor';
UPDATE config SET v = '1'  WHERE k = 'streak_bonus_per_day';
-- Flip the weekday gate off: weekends/holidays now count both for streak advancement and bonus payout.
UPDATE config SET v = '0'  WHERE k = 'streak_weekday_only';

-- ===== Idempotency key isolation =====
-- Drop the existing PK on (ukey) and replace with a composite PK.
-- A duplicate row across users is highly unlikely (UUIDs) but the lookup already uses all three
-- columns; aligning the PK with the lookup prevents one user from poisoning another user's cache slot.
ALTER TABLE idempotency_keys
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (ukey, user_id, endpoint);

-- ===== Tasks: URL + completion thank-you message =====
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS url                VARCHAR(2000) NULL AFTER description,
  ADD COLUMN IF NOT EXISTS completion_message TEXT          NULL AFTER audience_grades;

-- ===== Listings: completion thank-you message (shown to buyer on purchase) =====
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS completion_message TEXT NULL AFTER status;
