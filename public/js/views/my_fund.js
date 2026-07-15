// v1086 中村さん要望「学生が、自身に対する支払いに関する情報を確認できる仕組みを
//   作りたい」→ fund.nkmr.io の SSO 直結 API を叩いて自分宛の科研費支払を一覧表示。
//
// API 仕様:
//   GET https://fund.nkmr.io/api.php?action=executions[&year=YYYY]
//   credentials:'include' 必須。別オリジンからの呼び出しは (ドクターであっても)
//   常に自分の分だけをサーバで強制。 aitesaki (支払先) か tekiyo (摘要) に自分の氏名を
//   含む行が返る。 CORS は *.nkmr.io のみ許可。
//
// 表示:
//   - 年切替 (今年 / 前年 / 前々年 …)
//   - キーワード検索 (client-side、摘要/相手先/科目/name/code に対して substring 一致)
//   - 状態フィルタ (すべて / 支払済 / 予定)
//   - 合計サマリ (支払済 + 予定)
//   - 明細テーブル (日付降順、状態バッジ、金額右寄せ、コード + 課題名も表示)
//
// widget (home カード) とは別に、このページは全件詳細を出す + 検索/フィルタ可能。

import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const FUND_API = 'https://fund.nkmr.io/api.php';

let mfData = null;      // 現在ロード中の { ok, me, isDoctor, executions }
let mfYear = null;
let mfFilter = { status: 'all', keyword: '' };

function fmtYen(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
function fmtDate(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return String(s);
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}
function currentYear() { return new Date().getFullYear(); }

async function fetchFund(year) {
  const url = `${FUND_API}?action=executions&year=${encodeURIComponent(year)}`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
  }
  const j = await r.json();
  if (!j || j.ok === false) throw new Error(j?.error || '応答エラー');
  return j;
}

export async function renderMyFund({ query } = {}) {
  const app = document.getElementById('app');
  mfYear = Number((query && query.year) || currentYear());
  if (!Number.isFinite(mfYear) || mfYear < 2000 || mfYear > 3000) mfYear = currentYear();
  mfFilter = { status: 'all', keyword: '' };
  app.innerHTML = renderShell();
  await loadAndRender();
  wireControls();
}

function renderShell() {
  return `
    <div class="card page-header">
      <h2 style="margin:0">💴 自分宛の研究費支払い</h2>
      <div class="hint-sm" style="margin-top:4px">
        <a href="https://fund.nkmr.io" target="_blank" rel="noopener">fund.nkmr.io</a> の SSO 直結 API から取得。
        <b>ドクターも含めて全員、自分の分 (相手先か摘要に自分の氏名を含む行) だけ</b> が返ります。
        金額は円 (税込)、状態は <b>支払済</b> or <b>振込予定</b>。
      </div>
    </div>
    <div class="card">
      <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap">
        <label style="display:flex; align-items:center; gap:4px">
          <span class="lbl" style="margin:0">年</span>
          <select id="mf-year" style="padding:4px 8px"></select>
        </label>
        <label style="display:flex; align-items:center; gap:4px">
          <span class="lbl" style="margin:0">状態</span>
          <select id="mf-status" style="padding:4px 8px">
            <option value="all">すべて</option>
            <option value="paid">✅ 支払済</option>
            <option value="scheduled">📅 予定</option>
          </select>
        </label>
        <label style="display:flex; align-items:center; gap:4px; flex:1; min-width:180px">
          <span class="lbl" style="margin:0">🔍</span>
          <input type="text" id="mf-kw" placeholder="摘要 / 相手先 / 科目 / 課題名で検索" style="width:100%; padding:4px 8px">
        </label>
        <button class="btn" id="mf-refresh" title="キャッシュを無視して再取得">🔄</button>
      </div>
    </div>
    <div id="mf-summary"></div>
    <div id="mf-list"></div>
    <div id="mf-modal"></div>
  `;
}

async function loadAndRender({ force = false } = {}) {
  const listEl = document.getElementById('mf-list');
  const summaryEl = document.getElementById('mf-summary');
  listEl.innerHTML = `<div class="card"><div class="hint-sm">読み込み中… (fund.nkmr.io)</div></div>`;
  summaryEl.innerHTML = '';
  try {
    mfData = await fetchFund(mfYear);
    // year セレクタを埋める (今年〜 5 年前 + データが古い年含めば追加)
    const yearSel = document.getElementById('mf-year');
    const years = new Set();
    const y0 = currentYear();
    for (let y = y0; y >= y0 - 5; y--) years.add(y);
    (mfData.executions || []).forEach(x => { if (x.year) years.add(Number(x.year)); });
    yearSel.innerHTML = [...years].sort((a, b) => b - a).map(y =>
      `<option value="${y}" ${y === mfYear ? 'selected' : ''}>${y}年度</option>`
    ).join('');
    document.getElementById('mf-status').value  = mfFilter.status;
    document.getElementById('mf-kw').value      = mfFilter.keyword;
    renderSummaryAndList();
  } catch (e) {
    const msg = String(e?.message || e);
    const isAuth = /401|403|unauth|forbidden/i.test(msg);
    listEl.innerHTML = `<div class="card" style="color:#dc2626">
      ${isAuth
        ? `<div>fund.nkmr.io に SSO ログインしていないようです。 <a href="https://fund.nkmr.io" target="_blank" rel="noopener">fund.nkmr.io を開いて中村研 SSO でログイン</a> してから戻ってきてください。</div>`
        : `<div>読み込み失敗: ${escapeHtml(msg)}</div>`
      }
    </div>`;
  }
}

function renderSummaryAndList() {
  if (!mfData) return;
  const items = (mfData.executions || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const filtered = items.filter(x => {
    if (mfFilter.status !== 'all' && x.status !== mfFilter.status) return false;
    if (mfFilter.keyword) {
      const kw = mfFilter.keyword.toLowerCase();
      const hay = [x.tekiyo, x.aitesaki, x.kamoku, x.name, x.code].join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  const paidSum      = filtered.filter(x => x.status === 'paid').reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const scheduledSum = filtered.filter(x => x.status === 'scheduled').reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const totalSum     = paidSum + scheduledSum;

  document.getElementById('mf-summary').innerHTML = `
    <div class="card" style="padding:12px 16px">
      <div class="row" style="gap:12px; align-items:center; flex-wrap:wrap">
        <div><span class="hint-sm">${escapeHtml(mfData.me || '自分')}${mfData.isDoctor ? ' 🎓' : ''} の ${mfYear} 年度</span></div>
        <div style="margin-left:auto; display:flex; gap:12px; flex-wrap:wrap">
          <div><span class="hint-sm" style="color:#059669">✅ 支払済</span> <b style="color:#059669; font-size:16px">${fmtYen(paidSum)}</b></div>
          <div><span class="hint-sm" style="color:#a16207">📅 予定</span> <b style="color:#a16207; font-size:16px">${fmtYen(scheduledSum)}</b></div>
          <div><span class="hint-sm">合計</span> <b style="font-size:16px">${fmtYen(totalSum)}</b></div>
        </div>
      </div>
      <div class="hint-sm" style="margin-top:4px; color:#6b7280">
        ${filtered.length} 件 (全 ${items.length} 件中)${mfFilter.keyword ? ` / 検索: 「${escapeHtml(mfFilter.keyword)}」` : ''}${mfFilter.status !== 'all' ? ` / 状態: ${mfFilter.status === 'paid' ? '支払済' : '予定'}` : ''}
      </div>
    </div>
  `;
  const listEl = document.getElementById('mf-list');
  if (!filtered.length) {
    listEl.innerHTML = `<div class="card" style="text-align:center; padding:30px; color:#6b7280">該当する明細はありません</div>`;
    return;
  }
  listEl.innerHTML = filtered.map(x => renderRow(x)).join('');
}

function renderRow(x) {
  const isPaid = x.status === 'paid';
  const color = isPaid ? '#059669' : '#a16207';
  const bg    = isPaid ? '#f0fdf4' : '#fef3c7';
  const badge = isPaid
    ? '<span style="font-size:11px; padding:2px 8px; border-radius:4px; background:#059669; color:#fff; font-weight:600">✅ 支払済</span>'
    : '<span style="font-size:11px; padding:2px 8px; border-radius:4px; background:#a16207; color:#fff; font-weight:600">📅 予定</span>';
  return `
    <div class="card" style="border-left:3px solid ${color}; background:${bg}22; padding:10px 14px">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        ${badge}
        <span style="font-size:12px; color:#6b7280; font-family:monospace">${escapeHtml(fmtDate(x.date))}</span>
        <span style="font-weight:600; font-size:15px; margin-left:auto">${escapeHtml(fmtYen(x.amount))}</span>
      </div>
      <div style="font-weight:600; margin-top:4px">${escapeHtml(x.tekiyo || '(摘要なし)')}</div>
      <div class="hint-sm" style="margin-top:2px; color:#374151">
        <span style="color:#6b7280">相手先:</span> ${escapeHtml(x.aitesaki || '-')}
        · <span style="color:#6b7280">科目:</span> ${escapeHtml(x.kamoku || '-')}
      </div>
      ${x.name || x.code ? `<div class="hint-sm" style="margin-top:2px; color:#6b7280">${escapeHtml(x.name || '')}${x.code ? ` (${escapeHtml(x.code)})` : ''}</div>` : ''}
    </div>
  `;
}

function wireControls() {
  document.getElementById('mf-year')?.addEventListener('change', async (e) => {
    const y = Number(e.target.value);
    if (Number.isFinite(y)) {
      mfYear = y;
      // URL にも反映
      const q = new URLSearchParams(); q.set('year', String(y));
      navigate('#/my-fund?' + q.toString());
    }
  });
  document.getElementById('mf-status')?.addEventListener('change', (e) => {
    mfFilter.status = e.target.value;
    renderSummaryAndList();
  });
  document.getElementById('mf-kw')?.addEventListener('input', (e) => {
    mfFilter.keyword = e.target.value.trim();
    renderSummaryAndList();
  });
  document.getElementById('mf-refresh')?.addEventListener('click', async () => {
    try { localStorage.removeItem('labpay-myfund-cache'); } catch {}
    await loadAndRender({ force: true });
  });
}
