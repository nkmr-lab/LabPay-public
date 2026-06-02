// /#/groups — list + create. /#/groups/{id} — detail with feed + ワリカ +
// member-context shortcuts for ルーレット / 飲み会割り勘.

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

// ──────────────────────────── LIST + CREATE ────────────────────────────

export async function renderGroups() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="muted" style="font-size:13px">← アプリ</a>
      <h2 style="margin:6px 0 0">グループ</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        出張・旅行・連幹事など、短期間だけ使うメンバー枠。フィード (メモ・URL・
        時間) + ワリカ (立替を積み上げ → 精算) を共有しつつ、ルーレットや
        飲み会割り勘をそのメンバーで即起動できます。
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
        <span class="lbl">メンバー</span>
        <div id="gr-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
        <div id="gr-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div id="gr-count" class="muted" style="font-size:12px; margin-top:6px">0 人選択中</div>
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
let allUsers = [];

async function populatePicker() {
  const u = await get('/api/users');
  picked.clear();
  // Sort: D → M2 → M1 → B4 → B3 → (no grade), 50音順
  allUsers = [...u.items].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });

  const grades = [...new Set(allUsers.map(u => u.grade).filter(Boolean))]
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const bulk = document.getElementById('gr-bulk');
  bulk.innerHTML = `
    <button data-bulk="all"  class="btn">全員</button>
    ${grades.map(g => `<button data-bulk="grade:${g}" class="btn">${g}</button>`).join('')}
    <button data-bulk="gender:M" class="btn">男</button>
    <button data-bulk="gender:F" class="btn">女</button>
    <button data-bulk="clear" class="btn">クリア</button>
  `;
  bulk.querySelectorAll('[data-bulk]').forEach(b => {
    b.addEventListener('click', () => applyBulk(b.dataset.bulk));
  });

  const picker = document.getElementById('gr-picker');
  picker.innerHTML = allUsers.map(x => `
    <span class="rl-chip" data-uid="${x.id}">
      ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
      <span>${escapeHtml(x.display_name)}</span>
      ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
      ${x.gender === 'F' ? `<span class="muted" style="font-size:10px">♀</span>` : ''}
    </span>`).join('');
  picker.querySelectorAll('.rl-chip').forEach(c => {
    c.addEventListener('click', () => togglePick(Number(c.dataset.uid)));
  });
  refreshChips();
}

function memberMatches(user, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:')) return (user.grade || '') === key.slice(6);
  if (key.startsWith('gender:')) return (user.gender || '') === key.slice(7);
  return false;
}

function applyBulk(key) {
  if (key === 'clear') { picked.clear(); refreshChips(); return; }
  const targets = allUsers.filter(u => memberMatches(u, key));
  // Two-state toggle: if all targets are already on → turn them off; else add all.
  const allOn = targets.every(u => picked.has(u.id));
  if (allOn) targets.forEach(u => picked.delete(u.id));
  else       targets.forEach(u => picked.add(u.id));
  refreshChips();
}

function togglePick(uid) {
  if (picked.has(uid)) picked.delete(uid);
  else picked.add(uid);
  refreshChips();
}

function refreshChips() {
  document.querySelectorAll('#gr-picker .rl-chip').forEach(c => {
    const on = picked.has(Number(c.dataset.uid));
    c.style.background = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  const countEl = document.getElementById('gr-count');
  if (countEl) countEl.textContent = `${picked.size} 人選択中`;
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
      <a href="#/groups" class="muted" style="font-size:13px">← グループ一覧</a>
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
        <a class="btn primary" href="#/roulette?members=${memberIds}">🎰 ルーレット</a>
        <a class="btn" href="#/nomikai?members=${memberIds}">🍻 割り勘</a>
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

// 通貨候補。表示順だけ持てばよい — レートは /api/fx で取得 (登録時点を snapshot)。
const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'KRW', 'TWD', 'AUD'];

let wariMembers = []; // populated by loadDetail() via setWariMembers()
// セッション内 fetch キャッシュ: currency → {rate, fetched_at}
const fxCache = new Map();

async function fetchFxRate(ccy) {
  if (ccy === 'JPY') return { rate: 1, source: 'identity' };
  if (fxCache.has(ccy)) return fxCache.get(ccy);
  const d = await get('/api/fx', { currency: ccy });
  const entry = { rate: Number(d.rate_to_jpy), source: d.source };
  fxCache.set(ccy, entry);
  return entry;
}
// Set of user_ids the next expense applies to. Initialized to all current
// members when setWariMembers() runs; user deselects chips to exclude people.
let wariFor = new Set();

function renderWariForm() {
  const root = document.getElementById('gd-wari-form');
  if (!root) return;
  // OTHER は最後の sentinel。選ぶと自由入力欄が現れる。
  const ccyOpts = [...CURRENCIES, 'OTHER'].map(c =>
    `<option value="${c}">${c === 'OTHER' ? 'その他…' : c}</option>`).join('');
  root.innerHTML = `
    <div style="display:grid; grid-template-columns: minmax(0,1fr) 110px; gap:6px; margin-bottom:6px">
      <input type="number" id="ex-amt" min="0" step="0.01" placeholder="金額" inputmode="decimal">
      <select id="ex-ccy">${ccyOpts}</select>
    </div>
    <div id="ex-custom-row" hidden style="display:grid; grid-template-columns: 110px minmax(0,1fr); gap:6px; margin-bottom:6px">
      <input type="text" id="ex-ccy-custom" maxlength="3" placeholder="通貨 (例: THB)" style="text-transform:uppercase">
      <input type="number" id="ex-rate-manual" min="0" step="0.000001" placeholder="1 通貨 = ? JPY">
    </div>
    <div id="ex-rate-row" hidden style="margin-bottom:6px; font-size:12px"></div>
    <label class="muted" style="font-size:12px; display:block; margin-bottom:2px">立て替えた人</label>
    <select id="ex-payer" style="margin-bottom:6px">
      ${wariMembers.map(m => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('')}
    </select>
    <div id="ex-for" style="margin-bottom:6px"></div>
    <input type="text" id="ex-memo" maxlength="500" placeholder="メモ (例: ランチ, タクシー)" style="margin-bottom:6px">
    <button id="ex-submit" class="primary">支出を記録</button>
  `;
  const ccyEl = document.getElementById('ex-ccy');
  ccyEl.addEventListener('change', () => syncFxPreview());
  // For OTHER: try auto-fetch when user finishes typing a 3-letter code.
  document.getElementById('ex-ccy-custom').addEventListener('blur', () => tryFetchCustomRate());
  document.getElementById('ex-ccy-custom').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  });
  syncFxPreview();
  // Default payer to me if present in the group, else first member.
  const sel = document.getElementById('ex-payer');
  if (state.me?.id && wariMembers.some(m => m.id === state.me.id)) {
    sel.value = String(state.me.id);
  }
  wariFor = new Set(wariMembers.map(m => m.id));
  renderForPicker();
  document.getElementById('ex-submit').addEventListener('click', () => onAddExpense());
}

// Last-fetched rate for the preset dropdown path. Cleared on currency change.
let pendingFxRate = null;

async function syncFxPreview() {
  const ccy = document.getElementById('ex-ccy').value;
  const row = document.getElementById('ex-rate-row');
  const customRow = document.getElementById('ex-custom-row');
  pendingFxRate = null;
  if (ccy === 'OTHER') {
    customRow.hidden = false;
    row.hidden = false;
    row.innerHTML = `<span class="muted">通貨コード (3文字) と 1通貨=?円 を入れてください。コードが対応していれば自動取得します。</span>`;
    return;
  }
  customRow.hidden = true;
  if (ccy === 'JPY') { row.hidden = true; row.innerHTML = ''; return; }
  row.hidden = false;
  row.innerHTML = `<span class="muted">レート取得中…</span>`;
  try {
    const entry = await fetchFxRate(ccy);
    pendingFxRate = entry.rate;
    row.innerHTML = `<span class="muted">登録時点のレート: 1 ${escapeHtml(ccy)} = ${entry.rate.toFixed(4)} JPY <span style="font-size:11px">(${escapeHtml(entry.source)})</span></span>`;
  } catch (e) {
    pendingFxRate = null;
    row.innerHTML = `<span style="color:var(--warn)">レート取得失敗 (${escapeHtml(e.message)}) — 送信時にサーバー側で再取得します</span>`;
  }
}

async function tryFetchCustomRate() {
  const code = document.getElementById('ex-ccy-custom').value.trim();
  const rateEl = document.getElementById('ex-rate-manual');
  const row = document.getElementById('ex-rate-row');
  if (code.length !== 3) return;
  if (rateEl.value && Number(rateEl.value) > 0) return; // user already typed → don't overwrite
  row.innerHTML = `<span class="muted">${escapeHtml(code)} のレートを取得中…</span>`;
  try {
    const entry = await fetchFxRate(code);
    rateEl.value = entry.rate.toFixed(6);
    row.innerHTML = `<span class="muted">登録時点のレート: 1 ${escapeHtml(code)} = ${entry.rate.toFixed(4)} JPY <span style="font-size:11px">(${escapeHtml(entry.source)})</span></span>`;
  } catch (e) {
    row.innerHTML = `<span class="muted">${escapeHtml(code)} は自動取得できませんでした。手動でレートを入れてください。</span>`;
  }
}

// 「誰の分?」 picker. Chip row with everyone pre-selected; tap a chip to
// exclude that person from this expense.
function renderForPicker() {
  const root = document.getElementById('ex-for');
  if (!root) return;
  const n = wariFor.size;
  const summary = n === 0
    ? `<span style="color:var(--warn)">対象者を 1 人以上選んでください</span>`
    : (n === wariMembers.length
        ? `全員 (${n}人)`
        : `${n}人で割る`);
  root.innerHTML = `
    <label class="muted" style="font-size:12px">誰の分? <span style="margin-left:6px">${summary}</span></label>
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px">
      ${wariMembers.map(m => {
        const on = wariFor.has(m.id);
        return `
        <span class="rl-chip" data-for-uid="${m.id}" style="${on ? 'background:var(--primary-soft,#efeafa); border-color:var(--primary)' : 'opacity:.5'}">
          ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
          <span>${escapeHtml(m.display_name)}</span>
        </span>`;
      }).join('')}
    </div>
  `;
  root.querySelectorAll('[data-for-uid]').forEach(c => {
    c.addEventListener('click', () => {
      const uid = Number(c.dataset.forUid);
      if (wariFor.has(uid)) wariFor.delete(uid);
      else wariFor.add(uid);
      renderForPicker();
    });
  });
}

async function onAddExpense() {
  const gid = currentGroupId;
  const amount = Number(document.getElementById('ex-amt').value);
  let currency = document.getElementById('ex-ccy').value;
  const payer_user_id = Number(document.getElementById('ex-payer').value);
  const memo = document.getElementById('ex-memo').value.trim() || null;
  if (!(amount > 0)) { toast('金額を入れてください'); return; }
  const body = { amount, payer_user_id, memo };
  if (currency === 'OTHER') {
    const code = document.getElementById('ex-ccy-custom').value.trim();
    const manualRate = Number(document.getElementById('ex-rate-manual').value);
    if (!/^[A-Z]{3}$/.test(code))   { toast('通貨コード (3文字) を入れてください'); return; }
    if (!(manualRate > 0))           { toast('レートを入れてください'); return; }
    currency = code;
    body.rate_to_jpy = manualRate;
  } else if (currency !== 'JPY' && pendingFxRate) {
    // Use the previewed rate if we have one; otherwise let the server fetch.
    body.rate_to_jpy = pendingFxRate;
  }
  body.currency = currency;
  if (wariFor.size === 0) { toast('対象者を 1 人以上選んでください'); return; }
  // Omit participant_ids if it's everyone — backend default is the full
  // current member list, which keeps a member added later handled identically.
  // Send a subset only when it's actually a subset.
  if (wariFor.size !== wariMembers.length) {
    body.participant_ids = [...wariFor];
  }
  try {
    await post(`/api/groups/${gid}/expenses`, body);
    document.getElementById('ex-amt').value = '';
    document.getElementById('ex-memo').value = '';
    wariFor = new Set(wariMembers.map(m => m.id));
    renderForPicker();
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
  // Resolve participant ids to short names for "対象: X, Y, Z" if it's a
  // proper subset of current members; show "全員 (N人)" otherwise.
  const names = e.participants.map(uid => {
    const m = wariMembers.find(x => x.id === uid);
    return m ? m.display_name : `#${uid}`;
  });
  const isAll = e.participants.length === wariMembers.length
    && e.participants.every(uid => wariMembers.some(m => m.id === uid));
  const forText = isAll
    ? `全員 (${e.participants.length}人)`
    : `対象: ${names.join(', ')}`;
  return `
    <div class="list-item">
      <div style="flex:1">
        <div class="bold">${escapeHtml(e.payer_name)} 立替: ¥${e.amount_jpy.toLocaleString()}${orig}</div>
        ${e.memo ? `<div class="meta">${escapeHtml(e.memo)}</div>` : ''}
        <div class="meta">${escapeHtml(e.created_at)} · ${escapeHtml(forText)}</div>
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
        ${d.settlements.length ? `
          <div style="margin-top:12px; text-align:right">
            <button id="gd-settle-notify" class="primary">全員に通知する</button>
          </div>` : ''}
        <p class="muted" style="font-size:11px; margin-top:8px">
          ※ 実際の送金は外 (現金 / PayPay / 銀行) でやり取りしてください。
        </p>
      </div>
    </div>`;
  root.querySelector('#gd-settle-close').addEventListener('click', () => { root.hidden = true; root.innerHTML = ''; });
  root.querySelector('#gd-settle-notify')?.addEventListener('click', async (ev) => {
    if (!confirm('参加者全員に「誰が誰に送る」通知を送信します。よろしいですか?')) return;
    ev.currentTarget.disabled = true;
    try {
      const r = await post(`/api/groups/${gid}/settle`, {});
      toast(`${r.sent} 人に通知しました`);
      root.hidden = true; root.innerHTML = '';
    } catch (e) { toast('失敗: ' + e.message); ev.currentTarget.disabled = false; }
  });
}

// Called from loadDetail() after members are known.
function setWariMembers(members) {
  wariMembers = members;
  wariFor = new Set(members.map(m => m.id));
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
