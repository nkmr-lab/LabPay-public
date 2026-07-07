-- v942 public-polls: 公開 URL で 誰でも 投票 できる 汎用 poll。
-- 既存 polls (対象者 指定 + login 必須) と 用途 が 違う ので 別 テーブル。
-- 選択肢 は 複数行 テキスト で 入力、 anon cookie で 1 人 1 票 (multi_select 時 は 複数 可)。
-- 起案者 だけ が 集計 を 常に 見れる、 visibility 設定 で 開放度 調整。

CREATE TABLE public_polls (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    creator_user_id   INT           NOT NULL,
    title             VARCHAR(300)  NOT NULL,
    body              TEXT          NULL,                -- 補足 説明
    public_token      CHAR(32)      NOT NULL UNIQUE,
    opens_at          DATETIME      NULL,                -- 予約 公開 (省略 で 即公開)
    deadline_at       DATETIME      NOT NULL,
    multi_select      TINYINT(1)    NOT NULL DEFAULT 0,
    allow_free_text   TINYINT(1)    NOT NULL DEFAULT 0,  -- multi_select と セット 前提
    visibility        ENUM('creator','open','after_deadline') NOT NULL DEFAULT 'after_deadline',
    status            ENUM('scheduled','open','closed') NOT NULL DEFAULT 'open',
    closed_at         DATETIME      NULL,
    deleted_at        DATETIME      NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_creator (creator_user_id),
    KEY idx_status_opens (status, opens_at),
    KEY idx_status_deadline (status, deadline_at),
    KEY idx_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE public_poll_options (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    poll_id           INT           NOT NULL,
    label             VARCHAR(300)  NOT NULL,
    sort_order        INT           NOT NULL DEFAULT 0,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    KEY idx_poll (poll_id, sort_order),
    CONSTRAINT fk_ppo_poll FOREIGN KEY (poll_id) REFERENCES public_polls(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE public_poll_votes (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    poll_id           INT           NOT NULL,
    option_id         INT           NULL,                -- 自由記述 のみ の 場合 は NULL
    voter_anon_id     CHAR(32)      NOT NULL,
    voter_name        VARCHAR(100)  NULL,
    free_text         TEXT          NULL,                -- allow_free_text 時 のみ
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vote (poll_id, option_id, voter_anon_id),   -- multi_select でも (poll,option) 単位 で 重複 防止
    KEY idx_poll_option (poll_id, option_id),
    KEY idx_anon (voter_anon_id),
    CONSTRAINT fk_ppv_poll   FOREIGN KEY (poll_id)   REFERENCES public_polls(id)         ON DELETE CASCADE,
    CONSTRAINT fk_ppv_option FOREIGN KEY (option_id) REFERENCES public_poll_options(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
