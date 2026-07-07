-- v941 合同研究会用投票。 中村研 + 他ラボ の 合同研究会 で セッション ごと の
-- 相手 ラボ 発表 に 投票 して 優秀 発表者 を 決める 機能。 外部 参加者 (未 login) も
-- public_token 経由 で 匿名 で 投票 できる。

CREATE TABLE joint_events (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    creator_user_id   INT           NOT NULL,
    title             VARCHAR(300)  NOT NULL,
    description       TEXT          NULL,
    host_lab          VARCHAR(100)  NOT NULL,          -- 例 '中村研'
    guest_lab         VARCHAR(100)  NOT NULL,          -- 例 '山田研'
    public_token      CHAR(32)      NOT NULL UNIQUE,   -- /public/joint.html?t=xxx
    starts_at         DATETIME      NULL,
    ends_at           DATETIME      NULL,
    finalized_at      DATETIME      NULL,              -- 集計確定 タイムスタンプ
    deleted_at        DATETIME      NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_creator (creator_user_id),
    KEY idx_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE joint_sessions (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    event_id          INT           NOT NULL,
    name              VARCHAR(200)  NOT NULL,          -- 'Session A'
    starts_at         DATETIME      NULL,
    ends_at           DATETIME      NULL,
    sort_order        INT           DEFAULT 0,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_event (event_id, sort_order),
    CONSTRAINT fk_js_event FOREIGN KEY (event_id) REFERENCES joint_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE joint_presenters (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    session_id        INT           NOT NULL,
    name              VARCHAR(200)  NOT NULL,
    affiliation       ENUM('host','guest') NOT NULL,
    title             VARCHAR(300)  NULL,
    abstract          TEXT          NULL,
    sort_order        INT           DEFAULT 0,
    is_best           TINYINT(1)    NOT NULL DEFAULT 0,  -- finalize 後 に 立つ
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_session (session_id, sort_order),
    CONSTRAINT fk_jp_session FOREIGN KEY (session_id) REFERENCES joint_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE joint_votes (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    session_id        INT           NOT NULL,
    presenter_id      INT           NOT NULL,
    voter_anon_id     CHAR(32)      NOT NULL,          -- cookie ID (32hex)
    voter_affiliation ENUM('host','guest','other') NOT NULL,
    voter_name        VARCHAR(100)  NULL,              -- 任意 (外部 参加者 が 名乗り たい 場合)
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vote (session_id, voter_anon_id),    -- 1 voter 1 vote per session
    KEY idx_presenter (presenter_id),
    CONSTRAINT fk_jv_session   FOREIGN KEY (session_id)   REFERENCES joint_sessions(id)   ON DELETE CASCADE,
    CONSTRAINT fk_jv_presenter FOREIGN KEY (presenter_id) REFERENCES joint_presenters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 公開機能 (public-timer / joint-events / 将来 public-poll 等) の 共通 短縮 コード。
-- pay.nkmr.io/#/public に 4 桁 数字 を 入れる と 対応 する 公開 URL に 飛べる。
-- QR コード は 別途 v942 で 対応 予定 (client 側 で 生成)。
CREATE TABLE public_codes (
    code              VARCHAR(8)    NOT NULL PRIMARY KEY,   -- 4 桁 数字 (拡張 余地 で 8 桁)
    kind              VARCHAR(20)   NOT NULL,               -- 'joint' | 'timer' | 'poll' 等
    ref_id            INT           NOT NULL,               -- 対象 テーブル の id (kind 依存)
    target_path       VARCHAR(500)  NOT NULL,               -- 例 '/public/joint.html?t=xxx' or '#/public-timer/8'
    created_by_user_id INT          NOT NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_kind_ref (kind, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
