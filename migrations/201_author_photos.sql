-- v1006 論文著者 の 顔画像 (手動アップロード)。 中村さん要望 「著者情報のページで、
--   プロフィール画像を明示的に設定できるようにしたいな」。
--   name_key で dedup (小文字化 + 空白 統一)、 photo_path は /uploads/author_photos/
--   ハッシュ ファイル名。 source は 'manual' が 主。 uploaded_by_user_id は 誰が
--   アップロードしたか、 verified_at は 予備 (今後 admin verify に使う想定)。
CREATE TABLE author_photos (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    name_key              VARCHAR(200) NOT NULL UNIQUE,      -- 正規化後の name
    name_original         VARCHAR(300) NOT NULL,             -- 表示用
    email                 VARCHAR(200) NULL,
    photo_path            VARCHAR(500) NULL,                 -- /uploads/author_photos/xxx.jpg
    source                VARCHAR(30)  NULL,                 -- 'manual' / 'gravatar' 等
    uploaded_by_user_id   INT          NULL,                 -- v1006 誰が上げたか
    verified_at           DATETIME     NULL,                 -- 予備 (admin verify)
    created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_email    (email),
    KEY idx_uploader (uploaded_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
