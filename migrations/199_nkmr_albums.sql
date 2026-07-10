-- v970 中村研 アルバム を DB 化。 従来 は nkmr_albums.js の RAW 文字列 で 管理 して
--   コード 変更 → デプロイ が 必要 だった が、 「随時 登録 したい」 との 要望 で
--   ラボ メンバー が UI から 直接 追加 / 編集 / 削除 できる ように する。
--
-- section: 「2026」 「2025」 「過去のもの」 等 の 年度 グループ 見出し。
-- flag: 「🇯🇵」 「🇮🇹」 等 の 国旗 絵文字 (無い なら 空)。
-- location: 「沖縄」 「宮古島」 「イタリア」 等 の 場所 ラベル。 「場所別」 ソート/グループ で 使う。
-- sort_order: 同一 セクション 内 の 表示 順 (小さい ほど 上)、 新規 追加 は MAX+1。
-- created_by: 追加者 の user_id、 削除 / 編集 の 権限 判定 に 使う。
CREATE TABLE nkmr_albums (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    section     VARCHAR(60)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    url         VARCHAR(500) NOT NULL,
    flag        VARCHAR(20)  NULL,
    location    VARCHAR(80)  NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_by  INT          NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_section_sort (section, sort_order),
    KEY idx_created_by (created_by),
    KEY idx_location (location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
