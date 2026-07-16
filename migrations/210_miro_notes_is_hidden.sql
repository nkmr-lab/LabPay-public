-- v1108 中村さん指示「隠すと見せる、自分には見えるけど、相手には見えないようにして欲しい」
--   → note 単位の is_hidden フラグを導入。 作成者本人だけは常に中身が見え、他人からは
--   裏 (隠し) 状態に見える。 per-user side (miro_note_flips) は今後未使用。

ALTER TABLE miro_notes
  ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER z_index;
