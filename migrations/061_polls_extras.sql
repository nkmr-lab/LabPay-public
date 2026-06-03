-- 投票拡張:
--   allow_revote     — 再投票可否 (デフォルト 可)
--   allow_free_text  — 複数選択可かつ全く選ばないなら 自由記述を提出できる
--   poll_voters.free_text — 各投票者が書いた自由記述本文 (個人情報非公開、集計時は匿名)
ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS allow_revote    TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS allow_free_text TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE poll_voters
  ADD COLUMN IF NOT EXISTS free_text TEXT NULL;
