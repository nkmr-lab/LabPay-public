-- 飲み会割り勘: 「ソフトドリンクは 1 人あたり N 円引き」 のルールを 1 セッション
-- 単位で持てるように。 0 = 適用なし (従来挙動)。 N > 0 の時は client が
-- 計算時に 「ソフドリの人 から -N、 飲み手の人 が weight 按分でその差額を吸収」
-- というルールで amount_yen を作って POST する (server は持ち回り保存のみ)。
ALTER TABLE nomikai_sessions
  ADD COLUMN IF NOT EXISTS softdri_discount_yen INT NOT NULL DEFAULT 0;
