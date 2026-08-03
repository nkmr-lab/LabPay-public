-- v1274 娯楽ミッション (中村さん要望 D)。
-- 主催者 が pt を 出資 して 「setlog に 投稿すれば 20pt もらえる」等 の ゲリラミッション
-- を 起票、参加者 は 対象機能 で 行動 すると 自動 で 報酬 が 支給される。
-- 主催者 の 出資額 と 同額 を SYSTEM が 補助 (中村さん 判断 「C 案 = 主催者 + System 50%」)。
--   例) 主催者 100pt 出資 → SYSTEM 100pt 補助 → プール 200pt = 20pt × 10 人 分。
--
-- ledger 動線:
--   起票時: host      → ESCROW (host_deposit_pt, type='mission_deposit')
--           SYSTEM    → ESCROW (system_grant_pt, type='mission_deposit')
--   達成時: ESCROW    → 参加者 (reward_per_participant, type='mission_reward')
--   終了 (期限 or キャンセル or 定員 達成) 時 に 未消化 分 を 半々 で 返還:
--           ESCROW    → host   (half, type='mission_refund')
--           ESCROW    → SYSTEM (half, type='mission_refund')

CREATE TABLE game_missions (
  id                     BIGINT PRIMARY KEY AUTO_INCREMENT,
  host_user_id           BIGINT NOT NULL,
  title                  VARCHAR(200) NOT NULL,
  description            TEXT NULL,                      -- 詳細 (任意)
  target_feature         VARCHAR(50) NOT NULL,           -- 'setlog', 'profile_book', 'bokete', 'trading_cards', 'tomorrow_lab'
  target_condition_json  TEXT NULL,                      -- 将来の追加条件 (min_length 等) 用
  host_deposit_pt        INT NOT NULL,                   -- 主催者 出資
  system_grant_pt        INT NOT NULL,                   -- SYSTEM 補助 (= host_deposit_pt)
  reward_per_participant INT NOT NULL,                   -- 参加者 1 人 あたり 支給 pt
  max_participants       INT NOT NULL,                   -- 定員 (先着)
  claimed_count          INT NOT NULL DEFAULT 0,         -- 既 支給人数 (denorm)
  started_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at                DATETIME NOT NULL,              -- 期限 (自動終了)
  status                 ENUM('active','ended','cancelled') NOT NULL DEFAULT 'active',
  ended_at               DATETIME NULL,                  -- ended/cancelled になった時刻
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status_ends (status, ends_at),
  KEY idx_host (host_user_id),
  KEY idx_target (target_feature, status)
);

CREATE TABLE game_mission_completions (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  mission_id   BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reward_pt    INT NOT NULL,
  ledger_id    BIGINT NULL,                              -- 支給 ledger.id
  UNIQUE KEY uq_mission_user (mission_id, user_id),      -- 同一人物は 1 mission に つき 1 回まで
  KEY idx_user (user_id),
  KEY idx_mission (mission_id)
);

-- ledger.type ENUM に 3 種追加。
ALTER TABLE ledger MODIFY COLUMN type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund',
  'rewriter',
  'custom_game_buyin','custom_game_payout','custom_game_refund','custom_game_rake','custom_game_play_fee',
  'shiritori_buyin',
  'paper_translate','paper_full_translate','deep_research',
  'exp_plan_check',
  'ai_sub',
  'mission_deposit','mission_reward','mission_refund'
) NOT NULL;
