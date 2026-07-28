-- v1256 ledger.type ENUM に 'ai_sub' を 追加 (v1251 で PHP 側 (Ledger::TYPES) には 追加 済み
-- だ が、 DB 側 の ENUM 定義 の migration が 抜けて いた の で subscribe が 500
-- (SQLSTATE 1265 Data truncated for column 'type') で 失敗 して いた)。
--
-- ENUM は 既存 値 の 順序 を 保った まま 末尾 に 追加 (前 の 値 を 動かすと 既存 row の
-- 数値表現 が ズレる リスク が あるので 末尾追加 が 安全)。

ALTER TABLE ledger MODIFY COLUMN type ENUM(
  'initial','checkin','purchase','fee','reversal',
  'transfer','task_reward','deposit','refund','burn',
  'scrapbox_reward','app_open_reward',
  'paper_review',
  'resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund',
  'daifugo_buyin','daifugo_payout','daifugo_refund',
  'rewriter',
  'custom_game_buyin','custom_game_payout','custom_game_refund','custom_game_rake',
  'custom_game_play_fee',
  'shiritori_buyin',
  'paper_translate','paper_full_translate','deep_research',
  'exp_plan_check',
  'ai_sub'
) NOT NULL;
