-- v619 #236 自作ゲーム kind を DB 管理化。 PHP ソース改変不要に。
CREATE TABLE IF NOT EXISTS custom_game_kinds (
  kind            VARCHAR(40) NOT NULL PRIMARY KEY,
  display_name    VARCHAR(80) NOT NULL,
  description     VARCHAR(500) NOT NULL,
  icon            VARCHAR(20) NOT NULL,
  fee             INT UNSIGNED NOT NULL DEFAULT 1,
  -- 既定: /js/views/{kind}.js (= 開発者が public/js/views に JS を置く想定)
  -- 将来: uploaded blob ベースの場合は /api/custom-games/kinds/:kind/script.js などにする
  js_module_url   VARCHAR(200) NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cgk_active (is_active, kind),
  CONSTRAINT fk_cgk_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初期 seed: 既存の マルバツ (v1068 で fee 1pt → 5pt に更新、 fee_update SQL 別途)
INSERT IGNORE INTO custom_game_kinds (kind, display_name, description, icon, fee, js_module_url, created_by_user_id)
VALUES ('tictactoe',
        '⭕❌ マルバツ',
        '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。 5pt プレイフィー、 勝者が pot 総取り (引分は半額返金)。',
        '⭕',
        5,
        '/js/views/tictactoe.js',
        1);
