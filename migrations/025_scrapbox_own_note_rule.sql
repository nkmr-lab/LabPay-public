-- Scrapbox 寄稿ルール変更:
--   旧: pt = base + min(cap, max(0, attachments-1)) * per_extra
--       → 編集回数ベース、5-10pt の幅
--   新: pt = (5 if any edit) + (5 if any edit on the user's own research note)
--       → 自分の研究ノートを書いたかどうかを 2 つ目の指標に
--
-- "Own research note" = page title containing 研究ノート AND the user's
-- LabPay display_name. e.g. user メンバー33 (handle 'handle02') editing
-- "2026.06 研究ノート メンバー33" qualifies; editing other people's notes
-- does not.

-- New knobs (admin can tune)
INSERT INTO config (k, v) VALUES
  ('scrapbox_any_edit_pt', '5'),
  ('scrapbox_own_note_pt', '5')
ON DUPLICATE KEY UPDATE v=VALUES(v);

-- Old knobs no longer drive the sync, but keep them in the table for now
-- so admin sees both rule families during the transition. They can be
-- deleted later via a follow-up migration.

-- Track per-day per-user how many of the edits were on the user's own
-- research note. Used purely for transparency / debugging — the pt
-- formula already collapses to (5 if any, 5 if own).
ALTER TABLE scrapbox_awards
  ADD COLUMN IF NOT EXISTS own_note_attachments INT NOT NULL DEFAULT 0 AFTER attachments;
