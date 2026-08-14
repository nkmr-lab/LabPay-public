// v1080 購入依頼 (#want_to_buy の後継)。中村さん指示「今、研究室では
//   #want_to_buy というチャンネルで私への購入を依頼している。これを、もう Slack で
//   のやり取りじゃなく、 LabPay 上でやってしまいたい」。
//   決定事項 (2026-07-14 対話で確定):
//     - アプリタブ独立ページ (/#/buy-requests)
//     - 「買った」アクションは admin (中村さん) のみ
//     - LabPay 台帳のお金は動かさない (現物受け渡しだけ)
//
// UI:
//   一覧: open / bought / declined / cancelled / all のタブ切替 + カード形式
//   新規: URL / タイトル / 数量 / 想定価格 / 緊急度 / 理由
//   詳細: 情報表示 + admin なら買った/却下モーダル、依頼者なら編集/取消

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate, resetFsInnerNav } from '../router.js';
import { state, toast } from '../app.js';
// v1317 fund.nkmr.io 直叩き
import { fundBudgets, fundItemAdd, isFundUnauthError, FUND_HOME_URL } from '../fund_api.js';
import { openModal } from '../modal.js';

const STATUS_LABEL = {
  open:      { emoji: '📤', label: '依頼中',   color: '#059669', bg: '#f0fdf4' },
  bought:    { emoji: '✅', label: '購入済',   color: '#0369a1', bg: '#f0f9ff' },
  declined:  { emoji: '❌', label: '却下',     color: '#dc2626', bg: '#fef2f2' },
  cancelled: { emoji: '🚫', label: '取消',     color: '#6b7280', bg: '#f9fafb' },
};

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('T') ? '' : '+09:00'));
    if (isNaN(d.getTime())) return String(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'たった今';
    if (diffMin < 60) return `${diffMin}分前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}時間前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}日前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch { return String(iso); }
}

// ------- 一覧 -------
export async function renderBuyRequests({ query } = {}) {
  const app = document.getElementById('app');
  // v1285 通知経由の「?open=ID」= 該当依頼が bought / declined / cancelled 済でも
  //   見つかるよう tab を all に強制、 描画後 該当カードに scrollIntoView + 一瞬強調。
  const openId = query && query.open ? Number(query.open) : null;
  const tab = openId ? 'all' : ((query && query.status) || 'open');
  app.innerHTML = renderShell(tab);
  wireHeader();
  try {
    const params = { limit: 200 };
    if (tab !== 'all') params.status = tab;
    const d = await get('/api/buy-requests', params);
    document.getElementById('br-list').innerHTML = renderList(d.items || [], d.is_admin || false, tab);
    document.getElementById('br-tabs').innerHTML = renderTabs(tab, d.counts || {});
    wireList(d.is_admin || false);
    wireTabs();
    if (openId) _highlightBuyRequestCard(openId);
  } catch (e) {
    document.getElementById('br-list').innerHTML = `<div class="card" style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

// v1285 該当カードを scrollIntoView + 一瞬 紫リング で 強調 (通知経由 の 直行)。
function _highlightBuyRequestCard(id) {
  requestAnimationFrame(() => {
    const el = document.getElementById('br-card-' + id);
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { el.scrollIntoView(); }
    el.classList.add('br-card-flash');
    setTimeout(() => el.classList.remove('br-card-flash'), 2000);
  });
}

function renderShell(tab) {
  return `
    <div class="card page-header">
      <h2 style="margin:0">🛒 購入依頼</h2>
      <div class="hint-sm" style="margin-top:4px">研究室で買ってほしいものをここに投げる。従来 #want_to_buy Slack でやっていたやりとりの後継。中村さんが一元的に見て「買った / 却下」を返します (LabPay 台帳のお金は動きません、現物受け渡しだけ)。</div>
      <div class="row" style="gap:6px; margin-top:8px; justify-content:flex-end">
        <a class="btn primary" href="#/buy-requests/new" style="text-decoration:none">＋新規依頼</a>
      </div>
    </div>
    <div id="br-tabs"></div>
    <div id="br-list"><div class="card"><div class="hint-sm">読み込み中…</div></div></div>
    <div id="br-modal"></div>
  `;
}

function renderTabs(current, counts) {
  // v1082 中村さん指示「依頼中 / 購入済 / 却下で良い。取消とすべては要らない」
  //   → タブは 3 つに絞る。取消済の依頼は API 上は残るが UI ではタブなし
  //     (要調査時は URL 直打ちで ?status=cancelled でアクセス可)。
  const tabs = [
    { id: 'open',      label: '📤 依頼中' },
    { id: 'bought',    label: '✅ 購入済' },
    { id: 'declined',  label: '❌ 却下' },
  ];
  return `<div class="card" style="padding:6px">
    <div class="row" style="gap:4px; flex-wrap:wrap">
      ${tabs.map(t => {
        const n = counts[t.id];
        const bg = t.id === current ? '#7b3fa0' : '#f3f4f6';
        const fg = t.id === current ? '#fff' : '#374151';
        return `<button class="btn" data-br-tab="${t.id}" style="background:${bg}; color:${fg}; font-size:12px; padding:4px 10px">
                  ${t.label}${n !== undefined ? ` <span style="opacity:0.7">${n}</span>` : ''}
                </button>`;
      }).join('')}
    </div>
  </div>`;
}

function renderList(items, isAdmin, tab) {
  if (!items.length) {
    return `<div class="card" style="text-align:center; padding:30px; color:#6b7280">
      ${tab === 'open' ? '今は募集中の依頼はありません' : '該当する依頼がありません'}
    </div>`;
  }
  return items.map(r => renderCard(r, isAdmin)).join('');
}

function renderCard(r, isAdmin) {
  const meta = STATUS_LABEL[r.status] || STATUS_LABEL.open;
  const urgMark = (r.status === 'open' && r.urgency === 'urgent') ? '<span style="background:#fef2f2; color:#dc2626; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600; margin-left:6px">🚨 緊急</span>' : '';
  const priceLine = r.price_estimate !== null ? `想定 ${r.price_estimate.toLocaleString()}円` : '想定価格なし';
  const qtyLine = r.quantity > 1 ? ` × ${r.quantity}` : '';
  const actualLine = r.actual_price !== null ? ` / 実費 ${r.actual_price.toLocaleString()}円` : '';
  const noteLine = r.fulfiller_note ? `<div style="font-size:12px; color:#6b7280; margin-top:4px; padding:6px 10px; background:#f9fafb; border-radius:4px">📝 ${escapeHtml(r.fulfiller_note)}</div>` : '';
  const fulfilledBy = (r.status === 'bought' || r.status === 'declined') && r.fulfiller_name
    ? `<div style="font-size:11px; color:#6b7280; margin-top:4px">${meta.emoji} ${escapeHtml(r.fulfiller_name)} が ${fmtTime(r.bought_at || r.updated_at)}${actualLine}</div>` : '';
  const canEdit = r.is_mine && r.status === 'open';
  const canCancel = r.is_mine && r.status === 'open';
  const canBuy = isAdmin && r.status === 'open';
  const canReopen = isAdmin && (r.status === 'bought' || r.status === 'declined' || r.status === 'cancelled');
  // v1082 中村さん「もう一度お願いするボタン」→ 依頼者本人だけ、 closed 状態のときに表示
  const canReask = r.is_mine && (r.status === 'bought' || r.status === 'declined' || r.status === 'cancelled');
  // v1317 admin のみ、 bought かつ 未転送 の 場合 に fund 転送 button 表示
  const canPushFund = isAdmin && r.status === 'bought' && !r.fund_pushed_at;
  const fundBadge = (r.status === 'bought' && isAdmin)
    ? (r.fund_pushed_at
        ? `<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600; margin-left:4px">💰 fund 転送済 ${fmtTime(r.fund_pushed_at)}</span>`
        : `<span style="background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600; margin-left:4px">💰 fund 未転送</span>`)
    : '';
  return `
    <div class="card" id="br-card-${r.id}" data-br-row-id="${r.id}" style="border-left:4px solid ${meta.color}; background:${meta.bg}44">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${meta.color}; color:#fff; font-weight:600">${meta.emoji} ${meta.label}</span>
        ${urgMark}
        ${fundBadge}
        <div class="hint-sm" style="color:#6b7280; margin-left:auto">${escapeHtml(r.requester_name)} · ${fmtTime(r.created_at)}</div>
      </div>
      <div style="font-weight:600; margin-top:6px; font-size:15px">${escapeHtml(r.title)}${qtyLine}</div>
      <div style="margin-top:4px"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="font-size:12px; color:#0369a1; word-break:break-all">🔗 ${escapeHtml(r.url.length > 100 ? r.url.slice(0, 100) + '…' : r.url)}</a></div>
      <div class="hint-sm" style="margin-top:4px">💴 ${escapeHtml(priceLine)}</div>
      ${r.reason ? `<div style="margin-top:6px; font-size:13px; color:#374151">💬 ${escapeHtml(r.reason)}</div>` : ''}
      ${noteLine}
      ${fulfilledBy}
      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap; justify-content:flex-end">
        ${canBuy ? `<button class="btn primary" data-br-act="buy" data-br-id="${r.id}" data-br-title="${escapeHtml(r.title)}">🛒 買った</button>
                    <button class="btn" data-br-act="decline" data-br-id="${r.id}" data-br-title="${escapeHtml(r.title)}">❌ 却下</button>` : ''}
        ${canEdit ? `<button class="btn" data-br-act="edit" data-br-id="${r.id}">✏️ 編集</button>` : ''}
        ${canCancel ? `<button class="btn" data-br-act="cancel" data-br-id="${r.id}" data-br-title="${escapeHtml(r.title)}">🚫 取消</button>` : ''}
        ${canReask ? `<button class="btn primary" data-br-act="reask" data-br-id="${r.id}" data-br-title="${escapeHtml(r.title)}">🔁 もう一度お願いする</button>` : ''}
        ${canReopen ? `<button class="btn" data-br-act="reopen" data-br-id="${r.id}">🔄 open に戻す</button>` : ''}
        ${canPushFund ? `<button class="btn" style="background:#fef3c7; color:#92400e" data-br-act="fund-push" data-br-id="${r.id}">💰 fund に転送</button>` : ''}
      </div>
    </div>
  `;
}

function wireHeader() {
  // 「＋新規依頼」は href="#/buy-requests/new" なのでリスナー不要
}
function wireTabs() {
  document.querySelectorAll('[data-br-tab]').forEach(b => {
    b.addEventListener('click', () => {
      // v1267 room_requests と同じ症状対策: タブ切替は fullscreen 内部 nav で
      //   カウント積まれるので、切替時にリセットして「✕ 1発で entry に戻る」に。
      resetFsInnerNav();
      navigate('#/buy-requests?status=' + b.dataset.brTab);
    });
  });
}

function wireList(isAdmin) {
  document.querySelectorAll('[data-br-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.brId);
      const act = btn.dataset.brAct;
      const title = btn.dataset.brTitle || '';
      if (act === 'buy')     return openFulfillModal(id, 'buy', title);
      if (act === 'decline') return openFulfillModal(id, 'decline', title);
      if (act === 'cancel') {
        if (!confirm(`依頼を取り消しますか？\n\n${title}`)) return;
        try {
          await del('/api/buy-requests/' + id);
          toast('取消しました');
          renderBuyRequests({ query: parseQuery() });
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
        return;
      }
      if (act === 'reopen') {
        try {
          await patch('/api/buy-requests/' + id + '/reopen', {});
          toast('open に戻しました');
          renderBuyRequests({ query: parseQuery() });
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
        return;
      }
      if (act === 'reask') {
        if (!confirm(`もう一度お願いしますか？\n\n${title}\n\n(同じ内容で新規依頼を作ります)`)) return;
        try {
          const res = await post('/api/buy-requests/' + id + '/reask', {});
          toast(`再依頼しました (#${res.id})`);
          navigate('#/buy-requests?status=open');
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
        return;
      }
      if (act === 'edit') {
        navigate('#/buy-requests/' + id + '/edit');
        return;
      }
      if (act === 'fund-push') return openFundPushModal(id);
    });
  });
}

// v1317 fund.nkmr.io に 支払アイテム を 転送 する modal。
//   admin (中村さん) が bought 済 の 買物 を fund の 支払記録 に 反映 する。
//   1) fund.nkmr.io/api.php?action=budgets で 予算一覧 取得 → pulldown
//   2) type (default 消耗品費) / item = title / amount = actual_price を フォーム化
//   3) fundItemAdd で 直接 fund.nkmr.io に POST (nkmr-SSO 共有 cookie で 認証)
//   4) 成功 で PATCH /api/buy-requests/{id}/fund-pushed で LabPay 側 も マーク
async function openFundPushModal(id) {
  // 対象 の buy_request を 一覧 から 拾う (再 fetch で 最新 に)
  let r;
  try {
    const d = await get('/api/buy-requests/' + id);
    r = d.item || d;
  } catch (e) { toast('取得失敗: ' + (e?.message || e)); return; }
  if (r.status !== 'bought') { toast('bought の 依頼 だけ 転送 できます'); return; }
  if (r.fund_pushed_at) { toast('すでに 転送済 です'); return; }
  const amount = r.actual_price ?? r.price_estimate ?? 0;
  const fy = fiscalYearOf(new Date());
  const today = todayYmd();

  // v1318 budgets 取得 (fund.nkmr.io 直叩き、 未ログイン なら fund へ 誘導)。
  //   fundBudgets(fiscalYear) は fiscalYear 単体 を 引数 に とる (v1089)、 v1317 で
  //   object を 渡して いた ため 内部で {fiscal_year: {fiscal_year: 2026}} と 誤エンコード
  //   され 「この年度の予算がありません」に なって いた。
  //   応答 の item 構造: {fiscal_year, fund, label, plan, work1, work2, remain, ...}
  //   value は fund (fund 側 の 予算識別子)、 表示 は label があれば label、 なければ fund。
  let budgetOptions = '<option value="">読み込み中…</option>';
  try {
    const bud = await fundBudgets(fy);
    const items = bud.map(b => {
      const v = b.fund || b.name || '';
      const lbl = b.label || b.fund || b.name || '(名前なし)';
      const remain = (b.remain != null) ? ` (残 ${Number(b.remain).toLocaleString()}円)` : '';
      return `<option value="${escapeHtml(v)}">${escapeHtml(lbl)}${remain}</option>`;
    }).join('');
    budgetOptions = items || '<option value="">この年度の予算がありません</option>';
  } catch (e) {
    if (isFundUnauthError(e)) {
      toast('fund.nkmr.io に SSO ログインしていません');
      window.open(FUND_HOME_URL, '_blank');
      return;
    }
    budgetOptions = `<option value="">取得失敗: ${escapeHtml(e.message)}</option>`;
  }

  const m = openModal({
    title: '💰 fund.nkmr.io に 転送',
    bodyHtml: `
      <div class="hint-sm" style="font-size:12px; color:#666; margin-bottom:8px">
        buy_request #${id} を fund.nkmr.io の 支払アイテム として 追加します。
      </div>
      <div class="field"><span class="lbl">年度</span>
        <input type="number" id="fp-fy" value="${fy}" min="2020" max="2099"></div>
      <div class="field"><span class="lbl">予算</span>
        <select id="fp-fund">${budgetOptions}</select></div>
      <div class="field"><span class="lbl">科目 (type)</span>
        <select id="fp-type-sel">
          <!-- v1322 my_fund.js と 同じ fund 側 正式 種別 に 差し替え。 「物品」等 が これ で 出る。 -->
          <option value="物品">物品</option>
          <option value="人件費">人件費</option>
          <option value="旅費">旅費</option>
          <option value="サブスク">サブスク</option>
          <option value="ドクター">ドクター</option>
          <option value="その他">その他</option>
        </select></div>
      <div class="field"><span class="lbl">品名 (item)</span>
        <input type="text" id="fp-item" value="${escapeHtml(r.title)}" maxlength="200"></div>
      <div class="field"><span class="lbl">金額</span>
        <input type="number" id="fp-amount" value="${amount}" min="0"></div>
      <div class="field"><span class="lbl">支払日</span>
        <input type="date" id="fp-date" value="${today}"></div>
      <div class="field"><span class="lbl">状態</span>
        <select id="fp-status"><option value="paid" selected>支払済</option><option value="pending">予定</option></select></div>
    `,
    buttons: [
      { label: 'キャンセル', kind: 'btn', onClick: ({ close }) => close() },
      { label: '💰 転送する', kind: 'primary', onClick: async ({ close, setBusy }) => {
          const fundName = document.getElementById('fp-fund').value.trim();
          if (!fundName) { toast('予算を選択してください'); return; }
          // v1322 科目は select で fund 側 正式 種別 (物品/人件費/旅費/サブスク/ドクター/その他) から 選択
          const typeVal = document.getElementById('fp-type-sel').value;
          if (!typeVal) { toast('科目を選択してください'); return; }
          const params = {
            fiscal_year: document.getElementById('fp-fy').value,
            fund: fundName,
            type: typeVal,
            item: document.getElementById('fp-item').value.trim() || r.title,
            amount: Number(document.getElementById('fp-amount').value),
            status: document.getElementById('fp-status').value,
            entry_date: document.getElementById('fp-date').value,
          };
          if (!(params.amount > 0)) { toast('金額を入力してください'); return; }
          setBusy(true);
          try {
            await fundItemAdd(params);
            await patch('/api/buy-requests/' + id + '/fund-pushed', {});
            toast('fund に 転送しました');
            close();
            renderBuyRequests({ query: parseQuery() });
          } catch (e) {
            setBusy(false);
            if (isFundUnauthError(e)) {
              toast('fund.nkmr.io に SSO ログインしていません');
              window.open(FUND_HOME_URL, '_blank');
            } else {
              toast('失敗: ' + (e?.message || e));
            }
          }
        } },
    ],
  });
}

// 会計年度 (4月始まり)。 1-3月 は 前年 の 年度。
function fiscalYearOf(d) {
  const y = d.getFullYear();
  return d.getMonth() < 3 ? y - 1 : y;
}
function todayYmd() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseQuery() {
  const q = (location.hash.split('?')[1] || '');
  const params = new URLSearchParams(q);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// ------- 買った / 却下モーダル -------
function openFulfillModal(id, mode, title) {
  const root = document.getElementById('br-modal');
  const isBuy = mode === 'buy';
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" data-br-close="1">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px" data-br-inner>
        <div class="row" style="align-items:center; justify-content:space-between">
          <h3 style="margin:0; font-size:16px">${isBuy ? '🛒 買った印を付ける' : '❌ 却下する'}</h3>
          <button class="btn" data-br-close="1">×</button>
        </div>
        <div style="margin-top:8px; font-size:13px; color:#6b7280">対象: ${escapeHtml(title)}</div>
        ${isBuy ? `<label class="field" style="margin-top:12px">
          <span class="lbl">実際の価格 (円、任意)</span>
          <input type="number" id="br-actual-price" min="0" step="1" placeholder="例: 1250" style="width:150px">
        </label>` : ''}
        <label class="field" style="margin-top:10px">
          <span class="lbl">${isBuy ? '到着予定 / 置き場所メモ (任意)' : '却下理由 (任意)'}</span>
          <textarea id="br-note" rows="3" maxlength="2000" placeholder="${isBuy ? '例: 明日届く予定、 10F 棚に置きます' : '例: 予算オーバー、別品で代替'}" style="width:100%; box-sizing:border-box"></textarea>
        </label>
        <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
          <button class="btn" data-br-close="1">やめる</button>
          <button class="btn primary" id="br-submit-fulfill">${isBuy ? '🛒 買った、通知する' : '❌ 却下する'}</button>
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-br-close]').forEach(el => el.addEventListener('click', (e) => { if (e.target === el) closeModal(); }));
  document.getElementById('br-submit-fulfill').addEventListener('click', async () => {
    const body = {};
    const noteEl = document.getElementById('br-note');
    if (noteEl && noteEl.value.trim()) body.fulfiller_note = noteEl.value.trim();
    if (isBuy) {
      const apEl = document.getElementById('br-actual-price');
      if (apEl && apEl.value !== '') body.actual_price = Number(apEl.value);
    }
    try {
      await patch(`/api/buy-requests/${id}/${isBuy ? 'buy' : 'decline'}`, body);
      toast(isBuy ? '「買った」で通知しました' : '却下しました');
      closeModal();
      renderBuyRequests({ query: parseQuery() });
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
}

function closeModal() {
  const root = document.getElementById('br-modal');
  if (root) root.innerHTML = '';
}

// ------- 新規作成 -------
export async function renderBuyRequestNew() {
  const app = document.getElementById('app');
  app.innerHTML = renderForm(null);
  wireForm(null);
}

// ------- 編集 -------
export async function renderBuyRequestEdit({ params }) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `<div class="card"><div class="hint-sm">読み込み中…</div></div>`;
  try {
    const r = await get('/api/buy-requests/' + id);
    if (!r.is_mine && !r.is_admin) {
      app.innerHTML = `<div class="card" style="color:#dc2626">編集できるのは依頼者本人か admin のみ</div>`;
      return;
    }
    app.innerHTML = renderForm(r);
    wireForm(r);
  } catch (e) {
    app.innerHTML = `<div class="card" style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

function renderForm(existing) {
  const isEdit = !!existing;
  return `
    <div class="card page-header">
      <h2 style="margin:0">${isEdit ? '✏️ 購入依頼を編集' : '🛒 新規購入依頼'}</h2>
      <div class="hint-sm" style="margin-top:4px">中村さん (admin) に買ってほしいものを依頼します。 <a href="#/buy-requests">← 一覧に戻る</a></div>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">商品 URL <span style="color:#dc2626">*</span></span>
        <input type="url" id="brf-url" required maxlength="2048" placeholder="https://www.yodobashi.com/product/..." value="${existing ? escapeHtml(existing.url) : ''}" style="width:100%; box-sizing:border-box">
        <div class="hint-sm" style="margin-top:4px; color:#6b7280">ヨドバシ推奨、 Amazon 等も OK (http:// or https:// で始まる URL なら何でも)</div>
      </label>
      <label class="field">
        <span class="lbl">商品名 <span style="color:#dc2626">*</span></span>
        <input type="text" id="brf-title" required maxlength="200" placeholder="例: 温湿度計 (Bluetooth 対応)" value="${existing ? escapeHtml(existing.title) : ''}" style="width:100%; box-sizing:border-box">
      </label>
      <div class="row" style="gap:8px; flex-wrap:wrap">
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">数量</span>
          <input type="number" id="brf-qty" min="1" max="9999" value="${existing ? existing.quantity : 1}" style="width:100%; box-sizing:border-box">
        </label>
        <label class="field" style="flex:2; min-width:150px">
          <span class="lbl">想定価格 (円、任意)</span>
          <input type="number" id="brf-price" min="0" step="1" placeholder="例: 1250" value="${existing && existing.price_estimate !== null ? existing.price_estimate : ''}" style="width:100%; box-sizing:border-box">
        </label>
      </div>
      <label class="field">
        <span class="lbl">緊急度</span>
        <select id="brf-urgency" style="width:200px">
          <option value="normal" ${!existing || existing.urgency === 'normal' ? 'selected' : ''}>🟢 通常</option>
          <option value="urgent" ${existing && existing.urgency === 'urgent' ? 'selected' : ''}>🚨 緊急 (急いでほしい)</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">理由・用途 (任意)</span>
        <textarea id="brf-reason" rows="4" maxlength="2000" placeholder="例: 実験用に使いたい。現行のは電池切れで交換。" style="width:100%; box-sizing:border-box">${existing ? escapeHtml(existing.reason || '') : ''}</textarea>
      </label>
      <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
        <a class="btn" href="#/buy-requests" style="text-decoration:none">キャンセル</a>
        <button class="btn primary" id="brf-submit">${isEdit ? '💾 保存' : '📤 依頼を投げる'}</button>
      </div>
    </div>
  `;
}

function wireForm(existing) {
  const submit = document.getElementById('brf-submit');
  submit.addEventListener('click', async () => {
    const url      = document.getElementById('brf-url').value.trim();
    const title    = document.getElementById('brf-title').value.trim();
    const qty      = Math.max(1, Number(document.getElementById('brf-qty').value) || 1);
    const priceRaw = document.getElementById('brf-price').value.trim();
    const urgency  = document.getElementById('brf-urgency').value;
    const reason   = document.getElementById('brf-reason').value.trim();
    if (!url || !/^https?:\/\//i.test(url)) { toast('URL は http(s):// で始めてください'); return; }
    if (!title) { toast('商品名を入力してください'); return; }
    const body = { url, title, quantity: qty, urgency, reason };
    if (priceRaw !== '') body.price_estimate = Number(priceRaw);
    submit.disabled = true; submit.textContent = '送信中…';
    try {
      if (existing) {
        await patch('/api/buy-requests/' + existing.id, body);
        toast('保存しました');
      } else {
        const r = await post('/api/buy-requests', body);
        toast(`依頼しました (#${r.id})`);
      }
      navigate('#/buy-requests');
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
      submit.disabled = false;
      submit.textContent = existing ? '💾 保存' : '📤 依頼を投げる';
    }
  });
}
