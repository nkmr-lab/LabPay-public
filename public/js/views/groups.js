// /#/groups — list + create. /#/groups/{id} — detail with feed + member-context
// shortcuts for ルーレット / 飲み会割り勘.

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

// ──────────────────────────── LIST + CREATE ────────────────────────────

export async function renderGroups() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="muted" style="font-size:13px">← アプリ</a>
      <h2 style="margin:6px 0 0">暫定グループ</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        出張中・旅行・連幹事など、短期間だけ使う臨時グループ。連絡用のフィード
        (メモ・URL・時間) を共有しつつ、ルーレットや飲み会割り勘をそのメンバーで
        即起動できます。
      </p>
    </div>

    <div class="card">
      <h3>新規グループ</h3>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="gr-title" maxlength="200" placeholder="例: 学会 in 神戸">
      </label>
      <label class="field">
        <span class="lbl">説明 (任意)</span>
        <textarea id="gr-notes" maxlength="2000" rows="2"></textarea>
      </label>
      <div class="field">
        <span class="lbl">メンバー (タップして選択)</span>
        <div id="gr-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <button id="gr-submit" class="primary">作成</button>
    </div>

    <div class="card">
      <h3>あなたのグループ</h3>
      <div id="gr-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('gr-submit').addEventListener('click', onCreate);
  await loadList();
}

const picked = new Set();

async function populatePicker() {
  const u = await get('/api/users');
  const root = document.getElementById('gr-picker');
  root.innerHTML = u.items.map(x => `
    <span class="rl-chip" data-uid="${x.id}">
      ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
      <span>${escapeHtml(x.display_name)}</span>
      ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
    </span>`).join('');
  root.querySelectorAll('.rl-chip').forEach(c => {
    c.addEventListener('click', () => {
      const uid = Number(c.dataset.uid);
      if (picked.has(uid)) {
        picked.delete(uid); c.style.background = ''; c.style.borderColor = '';
      } else {
        picked.add(uid); c.style.background = 'var(--primary-soft, #efeafa)';
        c.style.borderColor = 'var(--primary)';
      }
    });
  });
}

async function onCreate() {
  const title = document.getElementById('gr-title').value.trim();
  const description = document.getElementById('gr-notes').value.trim() || null;
  if (!title) { toast('タイトルを入れてください'); return; }
  try {
    const r = await post('/api/groups', {
      title, description, member_ids: [...picked],
    });
    toast('作成しました');
    location.hash = '#/groups/' + r.id;
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadList() {
  try {
    const d = await get('/api/groups');
    const root = document.getElementById('gr-list');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">まだ参加グループはありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(g => `
      <a class="list-item" href="#/groups/${g.id}">
        <div style="flex:1">
          <div class="bold">${escapeHtml(g.title)} ${g.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
          <div class="meta">${escapeHtml(g.creator_name)} · ${g.member_count}人 · ${escapeHtml(g.created_at)}</div>
        </div>
      </a>`).join('');
  } catch (e) {
    document.getElementById('gr-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ──────────────────────────── DETAIL ───────────────────────────────────

export async function renderGroupDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/groups" class="muted" style="font-size:13px">← 一覧</a>
      <div id="gd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>新規投稿</h3>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px">
        <button data-kind="memo" class="btn primary">📝 メモ</button>
        <button data-kind="url"  class="btn">🔗 URL</button>
        <button data-kind="time" class="btn">🕒 時間</button>
      </div>
      <div id="gd-post-fields"></div>
      <button id="gd-post" class="primary" style="margin-top:6px">投稿</button>
    </div>
    <div class="card">
      <h3>フィード</h3>
      <div id="gd-feed" class="list"></div>
    </div>

    <div class="card" id="gd-wari-card">
      <div class="row" style="align-items:center">
        <h3 style="flex:1; margin:0">ワリカ</h3>
        <button id="gd-settle" class="btn">精算する</button>
      </div>
      <p class="muted" style="font-size:13px; margin:6px 0">
        誰がいくら立て替えたかを積み上げて、最後にまとめて精算します。
      </p>
      <div id="gd-wari-form"></div>
      <div id="gd-wari-summary" class="muted" style="margin-top:8px; font-size:13px">読み込み中…</div>
      <div id="gd-wari-list" class="list" style="margin-top:8px"></div>
    </div>

    <div id="gd-settle-modal" hidden></div>
  `;
  document.querySelectorAll('[data-kind]').forEach(b => {
    b.addEventListener('click', () => switchKind(b));
  });
  // Default kind: memo.
  switchKind(document.querySelector('[data-kind="memo"]'));
  document.getElementById('gd-post').addEventListener('click', () => onPost(id));
  document.getElementById('gd-settle').addEventListener('click', () => openSettleModal(id));
  await loadDetail(id);
  await loadWari(id);
}

let currentKind = 'memo';
function switchKind(btn) {
  currentKind = btn.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(b => {
    b.classList.toggle('primary', b === btn);
  });
  const root = document.getElementById('gd-post-fields');
  if (currentKind === 'memo') {
    root.innerHTML = `<textarea id="gd-body" maxlength="5000" rows="3" placeholder="メモ"></textarea>`;
  } else if (currentKind === 'url') {
    root.innerHTML = `
      <input type="url" id="gd-url" placeholder="https://…" style="margin-bottom:6px">
      <textarea id="gd-body" maxlength="2000" rows="2" placeholder="メモ (任意)"></textarea>`;
  } else {
    root.innerHTML = `
      <input type="datetime-local" id="gd-time" style="margin-bottom:6px">
      <textarea id="gd-body" maxlength="2000" rows="2" placeholder="例: 駅前ホテルに集合"></textarea>`;
  }
}

async function loadDetail(id) {
  try {
    const g = await get('/api/groups/' + id);
    const isCreator = state.me?.id === Number(g.creator_user_id);
    const memberIds = g.members.map(m => m.id).join(',');
    setWariMembers(g.members);
    document.getElementById('gd-head').innerHTML = `
      <div class="bold" style="font-size:18px">${escapeHtml(g.title)} ${g.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
      <div class="meta">${escapeHtml(g.creator_name)} · ${escapeHtml(g.created_at)}</div>
      ${g.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(g.description)}</div>` : ''}
      <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center">
        ${g.members.map(m => `
          <span class="presence-pill">
            ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
            <span class="presence-pill-name">${escapeHtml(m.display_name)}</span>
          </span>`).join('')}
      </div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <a class="btn primary" href="#/roulette?members=${memberIds}">🎰 このメンバーでルーレット</a>
        <a class="btn" href="#/nomikai?members=${memberIds}">🍻 このメンバーで割り勘</a>
        ${isCreator && !g.closed_at ? `<button id="gd-close" class="danger">閉じる</button>` : ''}
      </div>`;
    document.getElementById('gd-close')?.addEventListener('click', async () => {
      if (!confirm('このグループを閉じますか?')) return;
      try {
        await del('/api/groups/' + id);
        toast('閉じました');
        location.hash = '#/groups';
      } catch (e) { toast('失敗: ' + e.message); }
    });

    const root = document.getElementById('gd-feed');
    if (!g.items.length) {
      root.innerHTML = `<div class="empty">まだ投稿はありません</div>`;
    } else {
      root.innerHTML = g.items.map(it => renderItem(it, id)).join('');
      root.querySelectorAll('[data-rm]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('削除しますか?')) return;
          try {
            await del(`/api/groups/${id}/items/${b.dataset.rm}`);
            toast('削除しました');
            await loadDetail(id);
          } catch (e) { toast('失敗: ' + e.message); }
        });
      });
    }
  } catch (e) {
    document.getElementById('gd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderItem(it, gid) {
  const meId = state.me?.id;
  const canDelete = Number(it.created_by_user_id) === Number(meId);
  const kindBadge = ({ memo: '📝', url: '🔗', time: '🕒' })[it.kind] || '';
  const body = it.body ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(it.body)}</div>` : '';
  const link = it.url ? `<div style="margin-top:4px"><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">${escapeHtml(it.url)} ↗</a></div>` : '';
  const when = it.scheduled_at ? `<div class="meta">🕒 ${escapeHtml(it.scheduled_at)}</div>` : '';
  return `
    <div class="list-item">
      <div style="flex:1">
        <div class="bold">${kindBadge} ${escapeHtml(it.author_name)}</div>
        ${when}${link}${body}
        <div class="meta" style="margin-top:4px">${escapeHtml(it.created_at)}</div>
      </div>
      ${canDelete ? `<div><button data-rm="${it.id}" class="danger" style="padding:4px 8px">×</button></div>` : ''}
    </div>`;
}

// ──────────────────────────── WARI (ワリカ) ────────────────────────────

const DEFAULT_RATES = { JPY: 1, USD: 158, EUR: 168, GBP: 198, CNY: 22, KRW: 0.11, TWD: 4.9, AUD: 103 };

function loadRates() {
  try {
    const v = JSON.parse(localStorage.getItem('labpay-wari-rates') || 'null');
    if (v && typeof v === 'object') return { ...DEFAULT_RATES, ...v };
  } catch (_) {}
  return { ...DEFAULT_RATES };
}
function saveRates(r) {
  try { localStorage.setItem('labpay-wari-rates', JSON.stringify(r)); } catch (_) {}
}

let wariMembers = []; // populated by loadDetail() via setWariMembers()
let wariRates = loadRates();

function renderWariForm() {
  const root = document.getElementById('gd-wari-form');
  if (!root) return;
  const ccyOpts = Object.keys(wariRates).map(c => `<option value="${c}">${c}</option>`).join('');
  root.innerHTML = `
    <div style="display:grid; grid-template-columns: minmax(0,1fr) 90px; gap:6px; margin-bottom:6px">
      <input type="number" id="ex-amt" min="0" step="0.01" placeholder="金額" inputmode="decimal">
      <select id="ex-ccy">${ccyOpts}</select>
    </div>
    <div id="ex-rate-row" hidden style="margin-bottom:6px">
      <label class="muted" style="font-size:12px">レート (1 通貨 = ? JPY)</label>
      <input type="number" id="ex-rate" min="0" step="0.0001">
    </div>
    <select id="ex-payer" style="margin-bottom:6px">
      ${wariMembers.map(m => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('')}
    </select>
    <input type="text" id="ex-memo" maxlength="500" placeholder="メモ (例: ランチ, タクシー)" style="margin-bottom:6px">
    <button id="ex-submit" class="primary">支出を記録</button>
  `;
  const ccyEl = document.getElementById('ex-ccy');
  const rateRow = document.getElementById('ex-rate-row');
  const rateEl = document.getElementById('ex-rate');
  const syncRate = () => {
    const c = ccyEl.value;
    if (c === 'JPY') { rateRow.hidden = true; return; }
    rateRow.hidden = false;
    rateEl.value = wariRates[c] ?? 1;
  };
  ccyEl.addEventListener('change', syncRate);
  rateEl.addEventListener('change', () => {
    wariRates[ccyEl.value] = Number(rateEl.value) || 1;
    saveRates(wariRates);
  });
  syncRate();
  // Default payer to me if present in the group, else first member.
  const sel = document.getElementById('ex-payer');
  if (state.me?.id && wariMembers.some(m => m.id === state.me.id)) {
    sel.value = String(state.me.id);
  }
  document.getElementById('ex-submit').addEventListener('click', () => onAddExpense());
}

async function onAddExpense() {
  const gid = currentGroupId;
  const amount = Number(document.getElementById('ex-amt').value);
  const currency = document.getElementById('ex-ccy').value;
  const payer_user_id = Number(document.getElementById('ex-payer').value);
  const memo = document.getElementById('ex-memo').value.trim() || null;
  if (!(amount > 0)) { toast('金額を入れてください'); return; }
  const body = { amount, currency, payer_user_id, memo };
  if (currency !== 'JPY') {
    const rate = Number(document.getElementById('ex-rate').value);
    if (!(rate > 0)) { toast('レートを入れてください'); return; }
    body.rate_to_jpy = rate;
  }
  try {
    await post(`/api/groups/${gid}/expenses`, body);
    document.getElementById('ex-amt').value = '';
    document.getElementById('ex-memo').value = '';
    toast('記録しました');
    await loadWari(gid);
  } catch (e) { toast('失敗: ' + e.message); }
}

let currentGroupId = 0;

async function loadWari(id) {
  currentGroupId = id;
  if (!wariMembers.length) renderWariForm();
  const root = document.getElementById('gd-wari-list');
  const summary = document.getElementById('gd-wari-summary');
  if (!root || !summary) return;
  try {
    const d = await get(`/api/groups/${id}/expenses`);
    summary.innerHTML = d.count
      ? `${d.count} 件 / 合計 ¥${d.total_jpy.toLocaleString()}`
      : '<span class="muted">まだ支出はありません</span>';
    if (!d.expenses.length) { root.innerHTML = ''; return; }
    root.innerHTML = d.expenses.map(e => renderExpense(e, id)).join('');
    root.querySelectorAll('[data-rm-ex]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この支出を削除しますか?')) return;
        try {
          await del(`/api/groups/${id}/expenses/${b.dataset.rmEx}`);
          toast('削除しました');
          await loadWari(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    // Stash latest data for the settle modal.
    lastWariData = d;
  } catch (e) {
    summary.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

let lastWariData = null;

function renderExpense(e, gid) {
  const meId = state.me?.id;
  const canDelete = Number(e.created_by_user_id) === Number(meId);
  const orig = (e.currency !== 'JPY' && e.amount_original)
    ? ` <span class="muted" style="font-size:11px">(${Number(e.amount_original).toLocaleString()} ${escapeHtml(e.currency)} × ${Number(e.rate_to_jpy).toFixed(2)})</span>` : '';
  return `
    <div class="list-item">
      <div style="flex:1">
        <div class="bold">${escapeHtml(e.payer_name)} 立替: ¥${e.amount_jpy.toLocaleString()}${orig}</div>
        ${e.memo ? `<div class="meta">${escapeHtml(e.memo)}</div>` : ''}
        <div class="meta">${escapeHtml(e.created_at)} · ${e.participants.length}人で割る</div>
      </div>
      ${canDelete ? `<div><button data-rm-ex="${e.id}" class="danger" style="padding:4px 8px">×</button></div>` : ''}
    </div>`;
}

function openSettleModal(gid) {
  const d = lastWariData;
  if (!d || !d.expenses.length) { toast('支出がまだありません'); return; }
  const root = document.getElementById('gd-settle-modal');
  root.hidden = false;
  const balRows = d.balances.map(b => `
    <div class="list-item">
      <div style="flex:1; display:flex; align-items:center; gap:8px">
        ${avatarHtml(b.display_name, b.avatar_url, 'sm')}
        <div class="bold">${escapeHtml(b.display_name)}</div>
      </div>
      <div style="font-size:16px; text-align:right">
        ${b.net_jpy > 0
          ? `<span style="color:#0e7c63" class="bold">+¥${b.net_jpy.toLocaleString()}</span><div class="meta">受取</div>`
          : b.net_jpy < 0
            ? `<span style="color:#b54708" class="bold">-¥${Math.abs(b.net_jpy).toLocaleString()}</span><div class="meta">支払</div>`
            : `<span class="muted">±0</span>`}
      </div>
    </div>`).join('');
  const planRows = d.settlements.length
    ? d.settlements.map(s => `
        <div class="list-item">
          <div style="flex:1">
            <span class="bold">${escapeHtml(s.from_name)}</span> →
            <span class="bold">${escapeHtml(s.to_name)}</span>
          </div>
          <div class="bold" style="color:var(--primary); font-size:16px">¥${s.amount_jpy.toLocaleString()}</div>
        </div>`).join('')
    : `<div class="muted">送金不要 (全員ぴったり)</div>`;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; max-height:85vh; overflow:auto; padding:20px">
        <div class="row" style="align-items:center">
          <h3 style="flex:1; margin:0">精算サマリ</h3>
          <button id="gd-settle-close">×</button>
        </div>
        <p class="muted" style="font-size:13px">合計 ¥${d.total_jpy.toLocaleString()} / ${d.expenses.length} 件</p>
        <h4 style="margin:12px 0 6px">ネット残高</h4>
        <div class="list">${balRows}</div>
        <h4 style="margin:12px 0 6px">推奨送金プラン</h4>
        <div class="list">${planRows}</div>
        <p class="muted" style="font-size:11px; margin-top:8px">
          ※ 実際の送金は外でやり取りしてください。送金が済んだら、別途立替を 1 件マイナスで…ではなく、
          グループを閉じて新しいセッションを作るのがおすすめです。
        </p>
      </div>
    </div>`;
  root.querySelector('#gd-settle-close').addEventListener('click', () => { root.hidden = true; root.innerHTML = ''; });
}

// Called from loadDetail() after members are known.
function setWariMembers(members) {
  wariMembers = members;
  renderWariForm();
}

async function onPost(gid) {
  const body = document.getElementById('gd-body')?.value.trim() || null;
  const url  = document.getElementById('gd-url')?.value.trim() || null;
  const time = document.getElementById('gd-time')?.value || null;
  const payload = { kind: currentKind, body };
  if (currentKind === 'url')  payload.url = url;
  if (currentKind === 'time') payload.scheduled_at = time;
  if (currentKind === 'memo' && !body)               { toast('メモを入力してください'); return; }
  if (currentKind === 'url'  && !url)                { toast('URL を入力してください'); return; }
  if (currentKind === 'time' && !time)               { toast('時間を入力してください'); return; }
  try {
    await post(`/api/groups/${gid}/items`, payload);
    if (document.getElementById('gd-body'))  document.getElementById('gd-body').value = '';
    if (document.getElementById('gd-url'))   document.getElementById('gd-url').value  = '';
    if (document.getElementById('gd-time'))  document.getElementById('gd-time').value = '';
    toast('投稿しました');
    await loadDetail(gid);
  } catch (e) { toast('失敗: ' + e.message); }
}
