-- Scrapbox→Slack bridge: contribution-based pt distribution.
-- We piggyback on the existing Slack #scrapbox channel (Scrapbox official
-- integration posts one Slack message per edit notification) instead of
-- talking to Scrapbox's authenticated API directly.

-- Member 05 display name maps to exactly one LabPay user. Users may claim
-- multiple handles (e.g. Latin + Japanese variants) — that's many-to-one.
-- Collation utf8mb4_bin: Scrapbox handles are case-sensitive and we want
-- exact match against author_name from Slack.
CREATE TABLE IF NOT EXISTS user_scrapbox_handles (
  scrapbox_name VARCHAR(100) NOT NULL,
  user_id       BIGINT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scrapbox_name),
  KEY ix_ush_user (user_id),
  CONSTRAINT fk_ush_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- (award_date, user_id) PK guarantees the daily sync can't double-pay the
-- same person if rerun. ledger_id links to the actual money movement so
-- reversals can locate the originating award.
CREATE TABLE IF NOT EXISTS scrapbox_awards (
  award_date    DATE NOT NULL,
  user_id       BIGINT NOT NULL,
  attachments   INT NOT NULL,
  points        INT NOT NULL,
  ledger_id     BIGINT NULL,
  awarded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (award_date, user_id),
  KEY ix_sa_ledger (ledger_id),
  CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Allow ledger.type to take 'scrapbox_reward'.
ALTER TABLE ledger MODIFY type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward'
) NOT NULL;

-- Default knobs. Formula: points = base + min(bonus_cap, max(0, attachments-1)) * per_extra
-- With defaults base=5, per_extra=1, bonus_cap=5:
--   1 update → 5 pt, 2 → 6, ..., 6 → 10 (cap), 26 → 10 (still capped).
-- "Just show up once" gets you the full base — no streak required.
-- start_date = 2026-06-01 so the first cron at 06-02 0:05 backfills today.
INSERT INTO config (k, v) VALUES
  ('scrapbox_base_pt',     '5'),
  ('scrapbox_pt_per_extra','1'),
  ('scrapbox_bonus_cap',   '5'),
  ('scrapbox_start_date',  '2026-06-01')
ON DUPLICATE KEY UPDATE v=VALUES(v);

-- Seed known handle→user mappings provided by admin. Other members will
-- claim their own handles via the settings page.
INSERT INTO user_scrapbox_handles (scrapbox_name, user_id) VALUES
  ('handle02',      10),  -- メンバー33
  ('handle04',  11),  -- メンバー10
  ('handle03',    16),  -- メンバー24
  ('handle01',      21)   -- メンバー26
ON DUPLICATE KEY UPDATE user_id=VALUES(user_id);
