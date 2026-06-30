-- v886 Overleaf プロジェクト 追跡 (LabPay 内 アプリ)。
--   pyoverleaf で 教員 アカウント の 全 共有 プロジェクト を 定期 スナップショット →
--   ここ に 保存 → /#/overleaf で 「最近 更新 / 文字数 推移 / 学生 ごと の 伸び」 を 可視化。

-- 1) プロジェクト 識別。 overleaf_id (Overleaf 内部 16 進 ID) で UNIQUE。
CREATE TABLE overleaf_projects (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  overleaf_id            VARCHAR(64)  NOT NULL,
  name                   VARCHAR(255) NOT NULL,
  owner_email            VARCHAR(255) NULL,
  owner_name             VARCHAR(255) NULL,
  last_remote_updated_at DATETIME     NULL,        -- Overleaf 側 lastUpdated
  is_archived            TINYINT(1)   NOT NULL DEFAULT 0,
  is_trashed             TINYINT(1)   NOT NULL DEFAULT 0,
  first_seen_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_overleaf_id (overleaf_id),
  KEY idx_last_remote (last_remote_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) 1 回 の 取得 で 1 行 per project。 全 .tex ファイル の 集計値。
CREATE TABLE overleaf_snapshots (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id          INT UNSIGNED NOT NULL,
  taken_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_char_count    INT UNSIGNED NOT NULL DEFAULT 0,  -- raw tex char count (全 .tex 合算)
  total_char_body     INT UNSIGNED NOT NULL DEFAULT 0,  -- % コメント と \command を 簡易 除いた 本文 文字数
  total_jp_char_count INT UNSIGNED NOT NULL DEFAULT 0,  -- 漢字 + ひらがな + カタカナ の 文字数
  total_word_count    INT UNSIGNED NOT NULL DEFAULT 0,  -- whitespace split word 数 (英文 向け)
  file_count          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_project_time (project_id, taken_at),
  CONSTRAINT fk_ovl_snap_proj FOREIGN KEY (project_id) REFERENCES overleaf_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) snapshot 内 の 各 .tex ファイル の カウント。 どの ファイル が 伸びた か 表示 用。
CREATE TABLE overleaf_file_snapshots (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id       INT UNSIGNED NOT NULL,
  file_path         VARCHAR(500) NOT NULL,
  char_count_total  INT UNSIGNED NOT NULL DEFAULT 0,
  char_count_body   INT UNSIGNED NOT NULL DEFAULT 0,
  jp_char_count     INT UNSIGNED NOT NULL DEFAULT 0,
  word_count        INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_snapshot (snapshot_id),
  CONSTRAINT fk_ovl_fsnap_snap FOREIGN KEY (snapshot_id) REFERENCES overleaf_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) collector 実行 ログ (運用 監視 用)。 最後 に 何時 走った か、 エラー が あれば 詳細。
CREATE TABLE overleaf_collector_runs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  ok            TINYINT(1)   NOT NULL DEFAULT 0,
  projects_seen INT UNSIGNED NOT NULL DEFAULT 0,
  error_msg     TEXT         NULL,
  PRIMARY KEY (id),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
