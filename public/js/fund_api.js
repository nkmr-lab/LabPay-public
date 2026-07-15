// v1089 fund.nkmr.io の書き込み API を LabPay から叩くための共通ヘルパ。
//   すべて credentials:'include' で *.nkmr.io 共通 SSO 前提。 form-encoded POST は
//   プリフライトが飛ばないので application/x-www-form-urlencoded (URLSearchParams) を使う。
//
// エンドポイント:
//   GET  /api.php?action=budgets       予算一覧 (プルダウン用)
//   GET  /api.php?action=executions    自分宛支払一覧 (my_fund.js が使用)
//   POST /api.php?action=baito_add     学生: 自分のアルバイト代を登録
//   POST /api.php?action=add           ドクター: 支払いアイテムを追加

const FUND_ORIGIN = 'https://fund.nkmr.io';
const FUND_API = FUND_ORIGIN + '/api.php';

export async function fundGet(action, params = {}) {
  const url = new URL(FUND_API);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { credentials: 'include' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${t ? ': ' + t.slice(0, 200) : ''}`);
  }
  const j = await r.json();
  if (j && j.ok === false) throw new Error(j?.error || '応答エラー');
  return j;
}

export async function fundPostForm(action, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    body.append(k, String(v));
  }
  const r = await fetch(`${FUND_API}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    credentials: 'include',
    // URLSearchParams は自動で application/x-www-form-urlencoded になる (プリフライトなし)
    body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${t ? ': ' + t.slice(0, 200) : ''}`);
  }
  const j = await r.json();
  if (!j || j.ok === false) throw new Error(j?.error || '応答エラー');
  return j;
}

// 予算一覧を取得 (プルダウン用)。応答形式が {items:[...]} でも [...] でも吸収。
// 学生は金額抜き {fiscal_year, fund, label, plan, work1, work2}
// ドクターは全項目
export async function fundBudgets(fiscalYear) {
  const j = await fundGet('budgets', fiscalYear ? { fiscal_year: fiscalYear } : {});
  const list = Array.isArray(j) ? j
             : (j.budgets || j.items || j.data || []);
  return Array.isArray(list) ? list : [];
}

// 学生: 自分のアルバイト代を登録
// { fund, item, month, hourly, hours, fiscal_year? }
export async function fundBaitoAdd(params) {
  return fundPostForm('baito_add', params);
}

// ドクター: 支払いアイテムを追加
// { fiscal_year, fund, type, item, amount, status, entry_date, extra? }
export async function fundItemAdd(params) {
  return fundPostForm('add', params);
}

// fund.nkmr.io の全ページ URL (「詳細は fund で」導線用)
export const FUND_HOME_URL = FUND_ORIGIN;
