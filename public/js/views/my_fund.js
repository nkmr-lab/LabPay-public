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
import { fundBudgets, fundItemAdd, isFundUnauthError, FUND_HOME_URL } from '../fund_api.js';   // v1089 支払い項目 (ドクター) / v1250 未認証 判定

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
        金額は円 (税込)、状態は <b>支払済</b> or <b>振込予定</b>。
        <a href="https://fund.nkmr.io" target="_blank" rel="noopener" style="margin-left:8px">🔗 fund.nkmr.io で詳細を見る →</a>
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
    <div id="mf-doctor-add" hidden></div>
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
    renderDoctorAddSection();
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
  listEl.innerHTML = filtered.map(x => renderRow(x)).join('')
    + `<div class="card" style="text-align:center; padding:10px; margin-top:8px; background:#faf5ff; border-left:3px solid #7b3fa0">
        <div class="hint-sm">より詳しい情報 (課題の全体予算、他メンバーの執行等) は</div>
        <a href="https://fund.nkmr.io" target="_blank" rel="noopener" class="btn primary" style="margin-top:6px; text-decoration:none">🔗 fund.nkmr.io を開く →</a>
      </div>`;
}

// v1089 中村さん要望「研究の支払い登録についても、LabPay からできるようにしたい。
//   具体的には、予算名、項目名、額を登録できれば良い。事務への書類提出の有無も
//   そこから申請できるとベター」→ ドクター (mfData.isDoctor) だけに現れる追加フォーム。
//   POST /api.php?action=add に fund/type/item/amount/status/entry_date/extra を送信。
//   extra は書類提出フラグ + 任意メモを JSON 文字列で。送信後は再取得して一覧に反映。
function renderDoctorAddSection() {
  const wrap = document.getElementById('mf-doctor-add');
  if (!wrap) return;
  if (!mfData || !mfData.isDoctor) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const today = new Date().toISOString().slice(0, 10);
  wrap.innerHTML = `
    <details class="card" style="border-left:4px solid #7b3fa0">
      <summary style="cursor:pointer; font-weight:600; color:#7b3fa0">➕ 支払い項目を追加 (ドクター専用)</summary>
      <div style="margin-top:10px">
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:180px">
            <span class="lbl">予算 <span style="color:#dc2626">*</span></span>
            <select id="mfa-fund"><option value="">読み込み中…</option></select>
          </label>
          <label class="field" style="flex:1; min-width:130px">
            <span class="lbl">種別 <span style="color:#dc2626">*</span></span>
            <select id="mfa-type">
              <option value="物品">物品</option>
              <option value="人件費">人件費</option>
              <option value="旅費">旅費</option>
              <option value="サブスク">サブスク</option>
              <option value="ドクター">ドクター</option>
              <option value="その他">その他</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="lbl">項目 <span style="color:#dc2626">*</span></span>
          <input type="text" id="mfa-item" maxlength="200" placeholder="例: SSD 2TB / 学会参加費 / モニター購入">
        </label>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:140px">
            <span class="lbl">金額 (円) <span style="color:#dc2626">*</span></span>
            <input type="number" id="mfa-amount" min="0" step="1" placeholder="例: 25000">
          </label>
          <label class="field" style="flex:1; min-width:130px">
            <span class="lbl">日付</span>
            <input type="date" id="mfa-date" value="${today}">
          </label>
          <label class="field" style="flex:1; min-width:110px">
            <span class="lbl">状態</span>
            <select id="mfa-status">
              <option value="未" selected>未</option>
              <option value="済">済</option>
            </select>
          </label>
          <label class="field" style="flex:1; min-width:110px">
            <span class="lbl">年度</span>
            <input type="number" id="mfa-fy" min="2020" max="2100" value="${mfYear}">
          </label>
        </div>
        <label style="display:flex; align-items:center; gap:6px; margin:8px 0; font-size:13px">
          <input type="checkbox" id="mfa-docs">
          📄 事務に書類提出済み (extra.docs_submitted)
        </label>
        <label class="field">
          <span class="lbl">追加メモ (任意、extra.memo に入る)</span>
          <input type="text" id="mfa-memo" maxlength="500" placeholder="対象者名 / 補足など">
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <button class="btn primary" id="mfa-submit">➕ 追加</button>
        </div>
      </div>
    </details>
  `;
  // fund プルダウン埋め (今年度)
  const fundSel = document.getElementById('mfa-fund');
  fundBudgets(mfYear).then(buds => {
    if (!buds.length) {
      fundSel.innerHTML = '<option value="">(予算リスト取得失敗)</option>';
      return;
    }
    fundSel.innerHTML = '<option value="">— 選択 —</option>' + buds.map(b => {
      const label = b.label || b.fund || '';
      return `<option value="${escapeHtml(b.fund || '')}">${escapeHtml(label)}</option>`;
    }).join('');
  }).catch(e => {
    if (isFundUnauthError(e)) {
      fundSel.innerHTML = '<option value="">(fund.nkmr.io未ログイン)</option>';
      // 隣に開くボタンを差し込む (fundSelの親fieldの直後)
      const field = fundSel.closest('.field') || fundSel.parentElement;
      if (field && !document.getElementById('mfa-fund-unauth')) {
        const hint = document.createElement('div');
        hint.id = 'mfa-fund-unauth';
        hint.className = 'hint-sm';
        hint.style.cssText = 'color:#dc2626; margin-top:4px';
        hint.innerHTML = `⚠ fund.nkmr.ioにログインしてください
          <a href="${FUND_HOME_URL}" target="_blank" rel="noopener" class="btn primary" style="margin-left:6px; padding:2px 10px; font-size:11px; text-decoration:none">🔓 開く</a>`;
        field.appendChild(hint);
      }
    } else {
      fundSel.innerHTML = `<option value="">${escapeHtml('取得失敗: ' + (e?.message || e))}</option>`;
    }
  });
  document.getElementById('mfa-submit').addEventListener('click', async () => {
    const fund   = document.getElementById('mfa-fund').value.trim();
    const type   = document.getElementById('mfa-type').value;
    const item   = document.getElementById('mfa-item').value.trim();
    const amount = Number(document.getElementById('mfa-amount').value) || 0;
    const date   = document.getElementById('mfa-date').value;
    const status = document.getElementById('mfa-status').value;
    const fy     = Number(document.getElementById('mfa-fy').value) || mfYear;
    const docs   = document.getElementById('mfa-docs').checked;
    const memo   = document.getElementById('mfa-memo').value.trim();
    if (!fund)             { toast('予算を選んでください'); return; }
    if (!item)             { toast('項目を入力してください'); return; }
    if (!(amount > 0))     { toast('金額を入力してください'); return; }
    const extra = {};
    if (docs) extra.docs_submitted = true;
    if (memo) extra.memo = memo;
    const btn = document.getElementById('mfa-submit');
    btn.disabled = true; btn.textContent = '追加中…';
    try {
      const res = await fundItemAdd({
        fiscal_year: fy, fund, type, item, amount, status,
        entry_date: date,
        extra: JSON.stringify(extra),
      });
      toast(`追加しました (id=${res.id})`);
      try { localStorage.removeItem('labpay-myfund-cache'); } catch {}
      // 一覧再取得 (現在年が fy と違えば移動)
      if (fy !== mfYear) mfYear = fy;
      await loadAndRender({ force: true });
    } catch (e) {
      toast('失敗: ' + (e?.message || e), 5000);
      btn.disabled = false; btn.textContent = '➕ 追加';
    }
  });
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
