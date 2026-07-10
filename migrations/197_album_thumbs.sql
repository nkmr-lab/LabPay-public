-- v964 Google Photos アルバム サムネ キャッシュ。
--   url を sha256 で dedup、 thumb_filename は /uploads/album_thumbs/xxx.jpg 直下 の
--   ハッシュ ファイル名。 fetched_at が NULL = 未取得、 error_msg が 入って いれば 失敗、
--   thumb_filename が 入って いれば 成功。 lazy に fetch する ので 最初 は 全部 未取得。
CREATE TABLE album_thumbs (
    url_hash        CHAR(64)     NOT NULL PRIMARY KEY,   -- sha256(url)
    source_url      VARCHAR(500) NOT NULL,
    thumb_filename  VARCHAR(120) NULL,                    -- xxx.jpg
    fetched_at      DATETIME     NULL,
    error_msg       VARCHAR(255) NULL,
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
