-- v1171 中村さん要望
--   「Miro に論文一覧から貼ったときには、その論文情報のページへのリンクも取っておいて欲しい」
--   「Miro に、たべあるきから張り込む機能もほしい (サムネ画像を積極的に使いたい)」
-- miro_notes に link_url を追加、 refs/places どちらから貼っても後で リンクを辿れるように。
ALTER TABLE miro_notes ADD COLUMN link_url VARCHAR(500) NULL AFTER back_image_url;
