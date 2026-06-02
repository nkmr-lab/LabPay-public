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
};

export function ledgerTypeLabel(type) {
  return LEDGER_TYPE_LABEL[type] || type;
}
