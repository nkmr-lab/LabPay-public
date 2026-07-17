-- v1144 中村さん要望「査読結果とか、原稿修正結果に対して、 AI とチャットでやり取りできると
--   良い。 全訳とか要約に対しても、 AI とのチャットで理解を深めたりできると良い。
--   実験計画書も同様」
--
--   6 種の AI 結果 (paper_review / resume_check / exp_plan / paper_summary /
--   paper_translate / paper_translate_full) の詳細ページから「🔬 この結果について
--   AI と話す」ボタンで研究 AI サブスクの新規スレッドを作れるようにする。
--   スレッドに 元 AI 結果の抜粋 を seed_context として保存、 会話開始時に
--   system prompt に前置きして 話題を導入する。

ALTER TABLE research_ai_threads
  ADD COLUMN seed_source_type VARCHAR(32) NULL COMMENT '元 AI 結果の kind (paper_review 等)',
  ADD COLUMN seed_source_id BIGINT NULL COMMENT '元 AI 結果の id',
  ADD COLUMN seed_context TEXT NULL COMMENT 'system prompt に前置きする文脈 (元結果の要約)';
