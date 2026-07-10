-- v969 アルバム の 写真枚数。 Google Photos の og:description から 抽出、
--   NULL は 「不明 / 未取得」 (og:description が 定型 と 違って 拾え なかった 場合 含む)。
ALTER TABLE album_thumbs
    ADD COLUMN photo_count INT NULL AFTER thumb_filename;
