-- Linear-capped streak bonus + decay-on-break formula.
-- Replaces the milestone bonuses table (streak_bonuses) with three knobs.

SET NAMES utf8mb4;

-- Add the new knobs (idempotent)
INSERT IGNORE INTO config (k, v) VALUES
 ('streak_bonus_per_day',            '1'),
 ('streak_bonus_cap',                '20'),
 ('streak_decay_per_missed_workday', '5');

-- Old milestone config is no longer read; remove it so the admin UI doesn't show stale values.
DELETE FROM config WHERE k = 'streak_bonuses';
