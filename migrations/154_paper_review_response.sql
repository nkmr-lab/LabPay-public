-- v780 #404 paper_review に「回答文 (rebuttal / response to reviewers)」 を 入れ られる
-- ように 列 追加。 NULL なら 通常 の 査読、 非 NULL なら 査読 + 回答 妥当性 評価 モード。
ALTER TABLE paper_reviews
  ADD COLUMN response_text MEDIUMTEXT NULL AFTER strictness;
