-- v805 ledger.type に 論文 要約 / 全訳 / Deep Research を 個別 の type と して 追加。
-- これ まで すべて 'paper_review' で 一括 計上 されて いた の を、 取引 履歴 で 正しい 名称
-- (= 論文要約料 / 論文全訳料 / Deep Research 料) で 表示 できる ように 分ける。
ALTER TABLE ledger MODIFY COLUMN type ENUM(
  'initial','checkin','purchase','fee','reversal','transfer','task_reward','deposit',
  'refund','burn','scrapbox_reward','app_open_reward','paper_review','resume_check',
  'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
  'othello_buyin','othello_payout','othello_refund','daifugo_buyin','daifugo_payout',
  'daifugo_refund','rewriter','custom_game_buyin','custom_game_payout','custom_game_refund',
  'paper_translate','paper_full_translate','deep_research'
) NOT NULL;
