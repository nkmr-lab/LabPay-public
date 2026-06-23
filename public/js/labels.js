// Canonical labels for ledger row types. Same map used by home / history /
// admin — keep them all in sync by importing from here instead of redeclaring.
export const LEDGER_TYPE_LABEL = {
  initial:         '初期配布',
  checkin:         'ラボインボーナス',
  purchase:        '購入',
  fee:             '手数料',
  reversal:        '取消',
  transfer:        '送金',
  task_reward:     'タスク報酬',
  deposit:         '預け入れ',
  refund:          '返金',
  burn:            '消却',
  scrapbox_reward: 'Scrapbox編集ボーナス',
  app_open_reward: 'アプリ起動ボーナス',
  // v720 #316 ゲーム / 予想系 (mahjong_buyin が「予想 / 勝敗予測」にも流用されている。
  //   ラベルを追加して履歴で「mahjong_buyin」そのまま表示されるのを解消)。
  paper_review:           '論文査読料',
  paper_translate:        '論文要約料',          // v805
  paper_full_translate:   '論文全訳料',          // v805
  deep_research:          'Deep Research料',     // v805
  resume_check:           '原稿チェック料',
  rewriter:               'リライター料',
  mahjong_buyin:          'ゲーム参加フィー',
  mahjong_payout:         'ゲーム配当',
  mahjong_refund:         'ゲーム返金',
  mahjong_rake:           'ゲームシステム取り分',
  mahjong_ai_payout:      'AIゲーム配当',
  othello_buyin:          'オセロ参加フィー',
  othello_payout:         'オセロ配当',
  othello_refund:         'オセロ返金',
  daifugo_buyin:          '大富豪参加フィー',
  daifugo_payout:         '大富豪配当',
  daifugo_refund:         '大富豪返金',
  custom_game_buyin:      '自作ゲーム参加フィー',
  custom_game_payout:     '自作ゲーム配当',
  custom_game_refund:     '自作ゲーム返金',
  custom_game_rake:       '自作ゲームシステム取り分',
  custom_game_play_fee:   '自作ゲーム場代',
  shiritori_buyin:        'しりとり参加フィー',
};

export function ledgerTypeLabel(type) {
  return LEDGER_TYPE_LABEL[type] || type;
}
