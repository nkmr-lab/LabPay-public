-- Roulette can carry a pt prize. When > 0, the creator's wallet sends
-- `reward` to the winner at the moment of spinning. Self-win (creator ==
-- winner) becomes a no-op transfer (the creator effectively keeps their pt).
ALTER TABLE roulettes
  ADD COLUMN IF NOT EXISTS reward     INT    NOT NULL DEFAULT 0 AFTER member_ids,
  ADD COLUMN IF NOT EXISTS ledger_id  BIGINT NULL              AFTER reward;
