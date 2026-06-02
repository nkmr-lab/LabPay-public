// /#/nomikai      → step 1: メンバー選択 (全員/学年別/男女別バルク + 個別チップ)
// /#/nomikai/new  → step 2: 選択メンバーで計算 (ソフドリのみフラグ + weight + 総額 → 配分)
// /#/nomikai/{id} → 既存セッションの詳細 (支払い済 toggle 等)

import { get, post, patch } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

// 基本は全員 ×1.0 でスタート。アルコール/学年での自動補正は廃止
// (UI から [−][+] で操作する方式に変更)。GRADE_ORDER はソートのみで使う。
const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

// Step-1 picker keeps just a Set of user ids; step-2 form attaches weight/alcohol
// in its own local state when the picker handoff happens via URL query.
// When `lockedIds` is non-null (e.g. coming from a group's "このメンバーで割り勘"
// shortcut), only those users are shown and they're all pre-selected.
const stepOne = { selected: new Set(), users: [], lockedIds: null };

// ─────────────── STEP 1: picker ────────────────────────────────────────

export async function renderNomikai({ query } = {}) {
  stepOne.selected = new Set();
  stepOne.lockedIds = null;
  const raw = String(query?.members || '').trim();
  if (raw) {
    const ids = raw.split(',').map(Number).filter(Boolean);
    if (ids.length) stepOne.lockedIds = new Set(ids);
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="hint">← アプリ</a>
      <h2 style="margin:6px 0 0">飲み会割り勘</h2>
      <p class="card-subtitle">
        新歓・追いコン等の幹事用。まずはメンバーを絞り込み → 次の画面で各人の飲酒/ソフドリと重み付けを調整して計算します。
      </p>
    </div>

    <div class="card">
      <h3>1. メンバーを選ぶ</h3>
      <div id="nm-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
      <div id="nm-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="margin-top:10px; align-items:center">
        <div id="nm-count" class="muted grow">0 人選択中</div>
        <button id="nm-next" class="primary">次へ →</button>
      </div>
    </div>

    <div class="card">
      <h3>過去のセッション</h3>
      <div id="nm-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('nm-next').addEventListener('click', goToStep2);
  await loadHistory();
}

async function populatePicker() {
  const u = await get('/api/users');
  let pool = u.items;
  if (stepOne.lockedIds) {
    pool = pool.filter(x => stepOne.lockedIds.has(Number(x.id)));
    pool.forEach(x => stepOne.selected.add(Number(x.id)));
  }
  // Sort: D → M2 → M1 → B4 → B3 → (no grade), 50音順.
  stepOne.users = [...pool].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });

  // Bulk buttons. semantics: tap one → ensure all members of that group are
  // ON (additive). Tap [全員] again when everyone is already selected → clear.
  const grades = [...new Set(stepOne.users.map(u => u.grade).filter(Boolean))]
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const bulkRow = document.getElementById('nm-bulk');
  bulkRow.innerHTML = `
    <button data-bulk="all"  class="btn">全員</button>
    ${grades.map(g => `<button data-bulk="grade:${g}" class="btn">${g}</button>`).join('')}
    <button data-bulk="gender:M" class="btn">男</button>
    <button data-bulk="gender:F" class="btn">女</button>
    <button data-bulk="clear" class="btn">クリア</button>
  `;
  bulkRow.querySelectorAll('[data-bulk]').forEach(btn => {
    btn.addEventListener('click', () => applyBulk(btn.dataset.bulk));
  });

  const picker = document.getElementById('nm-picker');
  picker.innerHTML = stepOne.users.map(x => `
    <span class="rl-chip" data-uid="${x.id}">
      ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
      <span>${escapeHtml(x.display_name)}</span>
      ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
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
  if (key === 'clear') {
    stepOne.selected.clear();
    refreshChips();
    return;
  }
  const targets = stepOne.users.filter(u => memberMatches(u, key));
  // If every target is already selected → toggle them off (so you can quickly drop a group).
  // Otherwise → add all to the selection.
  const allOn = targets.every(u => stepOne.selected.has(u.id));
  if (allOn) targets.forEach(u => stepOne.selected.delete(u.id));
  else       targets.forEach(u => stepOne.selected.add(u.id));
  refreshChips();
}

function togglePick(uid) {
  if (stepOne.selected.has(uid)) stepOne.selected.delete(uid);
  else stepOne.selected.add(uid);
  refreshChips();
}

function refreshChips() {
  document.querySelectorAll('#nm-picker .rl-chip').forEach(c => {
    const on = stepOne.selected.has(Number(c.dataset.uid));
    c.style.background = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  document.getElementById('nm-count').textContent = `${stepOne.selected.size} 人選択中`;
}

function goToStep2() {
  if (stepOne.selected.size === 0) { toast('メンバーを選んでください'); return; }
  const ids = [...stepOne.selected].join(',');
  navigate('#/nomikai/new?uids=' + ids);
}

async function loadHistory() {
  try {
    const d = await get('/api/nomikai');
    const root = document.getElementById('nm-list');
    if (!d.items.length) { root.innerHTML = `<div class="empty">まだ履歴はありません</div>`; return; }
    root.innerHTML = d.items.map(s => `
      <a class="list-item" href="#/nomikai/${s.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(s.title)} ${s.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
          <div class="meta">${escapeHtml(s.creator_name)} · 総額 ¥${Number(s.total_yen).toLocaleString()} · 参加 ${s.member_count}人</div>
          <div class="meta">支払い済 ${s.paid_count}/${s.member_count} · ${escapeHtml(s.created_at)}</div>
        </div>
      </a>`).join('');
  } catch (e) {
    document.getElementById('nm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─────────────── STEP 2: per-person calc form ──────────────────────────

// uid → { alcohol, weight, fixed_yen|null, grade, display_name, avatar_url }
// fixed_yen non-null means "this person pays exactly this", and they're
// excluded from the weighted split — used for "幹事は ¥3000 だけ" 系。
const stepTwo = new Map();

// Round each (non-creator) row's computed amount to the nearest multiple of
// roundBucket if > 1. Delta absorbed by the creator. Buttons set this.
let roundBucket = 1;

export async function renderNomikaiNew({ query }) {
  const uids = String(query?.uids || '').split(',').map(Number).filter(Boolean);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/nomikai" class="hint">← メンバー選択</a>
      <h2 style="margin:6px 0 0">2. 詳細を入力</h2>
      <p class="card-subtitle">
        各人の飲酒/ソフドリ、必要なら weight を調整。総額と分配が一致するように rounding は主催者に寄せます。
      </p>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="nm-title" maxlength="200" placeholder="例: 新歓 @ 居酒屋〇〇">
      </label>
      <label class="field">
        <span class="lbl">総額 (円)</span>
        <input type="number" id="nm-total" min="0" placeholder="例: 28000">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="nm-notes" maxlength="2000" rows="2" placeholder="場所・コース内容など"></textarea>
      </label>
    </div>

    <div class="card">
      <h3>参加者</h3>
      <div class="muted" style="font-size:12px; margin-bottom:6px">
        🍺/🥤 はタップで切替。基本 ×1.0、[−][+] で 0.2 ずつ調整。
        [固定] にすると金額直接指定 (他の人で割り直し)。
      </div>
      <div id="nm-people"></div>
      <div class="row" style="gap:4px; flex-wrap:wrap; margin-top:10px; align-items:center">
        <span class="hint-sm">区切り:</span>
        <button data-round="1"    class="btn">なし</button>
        <button data-round="10"   class="btn">10円</button>
        <button data-round="100"  class="btn">100円</button>
        <button data-round="500"  class="btn">500円</button>
        <button data-round="1000" class="btn">1000円</button>
      </div>
    </div>

    <div class="card">
      <div class="row center">
        <div id="nm-preview-total" class="muted grow">参加者ごとの金額を計算します</div>
        <button id="nm-submit" class="primary">作成 + 全員に通知</button>
      </div>
    </div>
  `;

  if (!uids.length) {
    document.getElementById('nm-people').innerHTML = `<div class="muted">メンバーが指定されていません。<a href="#/nomikai">選択画面に戻る</a></div>`;
    return;
  }

  try {
    const u = await get('/api/users');
    const byId = new Map(u.items.map(x => [x.id, x]));
    stepTwo.clear();
    uids.forEach(uid => {
      const ent = byId.get(uid);
      if (!ent) return;
      stepTwo.set(uid, {
        alcohol: true,                 // default: drinker (most-common case)
        weight: 1.0,                    // 基本 ×1.0; 上ボタン/下ボタンで ±0.2
        fixed_yen: null,                // null = weighted; number = 固定額
        grade: ent.grade || '',
        display_name: ent.display_name,
        avatar_url: ent.avatar_url,
      });
    });
  } catch (e) {
    document.getElementById('nm-people').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  roundBucket = 1;
  renderPeople();

  // 親に 1 度だけ event delegation を貼って、子ノードを innerHTML で
  // 入れ替えてもリスナーが重複しないようにする。+ ボタンを連打すると
  // ×1.2 のはずが ×2.0 になる症状は、ここを行ごとに毎回貼り直していた
  // (renderPeople 内で addEventListener) ことによる二重バインドが原因。
  const peopleRoot = document.getElementById('nm-people');
  peopleRoot.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !peopleRoot.contains(t)) return;
    if (t.dataset.flag !== undefined) { toggleAlcohol(Number(t.dataset.flag)); return; }
    if (t.dataset.dec  !== undefined) { bumpWeight(Number(t.dataset.dec), -0.2); return; }
    if (t.dataset.inc  !== undefined) { bumpWeight(Number(t.dataset.inc),  0.2); return; }
    if (t.dataset.fix  !== undefined) { toggleFixed(Number(t.dataset.fix)); return; }
    if (t.dataset.rm   !== undefined) { stepTwo.delete(Number(t.dataset.rm)); renderPeople(); return; }
  });
  // 固定額入力は input ノードを壊さず amount セルだけを更新する (フォーカス・
  // キャレット保持 + iOS Safari でスクロールがズレない)
  peopleRoot.addEventListener('input', (e) => {
    if (!e.target.matches('[data-fixyen]')) return;
    const uid = Number(e.target.dataset.fixyen);
    const cur = stepTwo.get(uid);
    if (!cur || cur.fixed_yen === null) return;
    cur.fixed_yen = Math.max(0, Math.floor(Number(e.target.value) || 0));
    stepTwo.set(uid, cur);
    recomputeAmounts();
  });

  document.getElementById('nm-total').addEventListener('input', recomputeAmounts);
  document.getElementById('nm-submit').addEventListener('click', onCreate);
  document.querySelectorAll('[data-round]').forEach(b => {
    b.addEventListener('click', () => {
      roundBucket = Number(b.dataset.round) || 1;
      renderPeople();
    });
  });
}

// 計算結果を全行に書き戻し、行は (fixed/weighted モード切替などで構造が
// 変わるとき) この関数で完全に redraw。リスナーは親で 1 回だけ。
function renderPeople() {
  const arr = computeAmounts();
  document.querySelectorAll('[data-round]').forEach(b => {
    b.classList.toggle('primary', Number(b.dataset.round) === roundBucket);
  });
  document.getElementById('nm-people').innerHTML = arr.map(renderRow).join('');
  updatePreviewTotal(arr);
}

// 行の構造を変えずに金額表示だけ書き換える (固定額の入力中に呼ぶ)。
function recomputeAmounts() {
  const arr = computeAmounts();
  const root = document.getElementById('nm-people');
  if (!root) return;
  arr.forEach(x => {
    const cell = root.querySelector(`[data-amt="${x.uid}"]`);
    if (cell) cell.textContent = `¥${x.amount.toLocaleString()}`;
  });
  updatePreviewTotal(arr);
}

function computeAmounts() {
  const total = Number(document.getElementById('nm-total').value) || 0;
  const arr = [...stepTwo.entries()].map(([uid, v]) => ({ uid, ...v }));
  const fixedTotal = arr.reduce((s, x) => s + (x.fixed_yen ?? 0), 0);
  const remaining  = Math.max(0, total - fixedTotal);
  const weighted   = arr.filter(x => x.fixed_yen === null);
  const sumW = weighted.reduce((s, x) => s + x.weight, 0) || 1;
  let allocated = 0;
  for (const x of arr) {
    if (x.fixed_yen !== null) {
      x.amount = x.fixed_yen;
    } else {
      const v = remaining * x.weight / sumW;
      x.amount = roundBucket > 1
        ? Math.round(v / roundBucket) * roundBucket
        : Math.round(v);
    }
    allocated += x.amount;
  }
  const delta = total - allocated;
  if (delta && arr.length) {
    const meIdx = arr.findIndex(x => x.uid === state.me?.id);
    arr[(meIdx >= 0 ? meIdx : 0)].amount += delta;
  }
  arr._allocated = allocated + delta;
  arr._delta = delta;
  arr._total = total;
  return arr;
}

function updatePreviewTotal(arr) {
  const el = document.getElementById('nm-preview-total');
  if (!el) return;
  const total = arr._total;
  el.innerHTML = total
    ? `合計 ¥${arr._allocated.toLocaleString()}${arr._delta ? ` (端数 ${arr._delta > 0 ? '+' : ''}${arr._delta} 円は ${escapeHtml(state.me?.display_name || '主催')} に)` : ''}`
    : '総額を入力してください';
}

function renderRow(x) {
  const grade = x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : '';
  const isFixed = x.fixed_yen !== null;
  // Compact 2-line layout: line1 = icon + name + amount + remove; line2 = weight/fixed controls.
  const controls = isFixed
    ? `<input type="number" min="0" step="100" value="${x.fixed_yen}" data-fixyen="${x.uid}" style="width:90px; text-align:right">
       <span class="muted" style="font-size:11px">円 固定</span>
       <button data-fix="${x.uid}" class="btn" style="padding:2px 6px; font-size:11px">解除</button>`
    : `<button data-dec="${x.uid}" class="btn" style="padding:2px 8px">−</button>
       <span class="bold" style="min-width:42px; text-align:center">×${x.weight.toFixed(1)}</span>
       <button data-inc="${x.uid}" class="btn" style="padding:2px 8px">+</button>
       <button data-fix="${x.uid}" class="btn" style="padding:2px 6px; font-size:11px; margin-left:6px">固定</button>`;
  return `
    <div class="nm-row" style="display:grid; grid-template-columns: auto 1fr auto auto; gap:6px 8px; align-items:center; padding:6px 0; border-bottom:1px solid #eee">
      <button data-flag="${x.uid}" class="btn" style="grid-row:1/3; min-width:46px; font-size:18px">${x.alcohol ? '🍺' : '🥤'}</button>
      <div style="display:flex; align-items:center; gap:6px; min-width:0">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(x.display_name)}</span>
        ${grade}
      </div>
      <div class="bold" data-amt="${x.uid}" style="text-align:right; font-size:15px">¥${x.amount.toLocaleString()}</div>
      <button data-rm="${x.uid}" class="danger" style="padding:4px 8px">×</button>
      <div style="grid-column:2/5; display:flex; align-items:center; gap:4px; flex-wrap:wrap">
        ${controls}
      </div>
    </div>`;
}

function bumpWeight(uid, delta) {
  const cur = stepTwo.get(uid);
  if (!cur || cur.fixed_yen !== null) return;
  cur.weight = Math.max(0.2, Math.min(10, Math.round((cur.weight + delta) * 10) / 10));
  stepTwo.set(uid, cur);
  renderPeople();
}

function toggleFixed(uid) {
  const cur = stepTwo.get(uid);
  if (!cur) return;
  if (cur.fixed_yen === null) {
    // Pre-fill with the current computed amount so the switch feels natural.
    cur.fixed_yen = guessCurrentAmount(uid) ?? 0;
  } else {
    cur.fixed_yen = null;
  }
  stepTwo.set(uid, cur);
  renderPeople();
}

// Re-derive the amount the user is currently seeing for `uid` from the latest
// weighted/fixed mix — used as a sensible initial value when switching to 固定.
function guessCurrentAmount(uid) {
  const total = Number(document.getElementById('nm-total').value) || 0;
  const arr = [...stepTwo.entries()].map(([k, v]) => ({ uid: k, ...v }));
  const fixedTotal = arr.reduce((s, x) => s + (x.fixed_yen ?? 0), 0);
  const remaining = Math.max(0, total - fixedTotal);
  const weighted = arr.filter(x => x.fixed_yen === null);
  const sumW = weighted.reduce((s, x) => s + x.weight, 0) || 1;
  const me = arr.find(x => x.uid === uid);
  if (!me || me.fixed_yen !== null) return null;
  let v = remaining * me.weight / sumW;
  return roundBucket > 1 ? Math.round(v / roundBucket) * roundBucket : Math.round(v);
}

function toggleAlcohol(uid) {
  const cur = stepTwo.get(uid);
  if (!cur) return;
  cur.alcohol = !cur.alcohol;
  stepTwo.set(uid, cur);
  renderPeople();
}

async function onCreate() {
  const title = document.getElementById('nm-title').value.trim();
  const total = Number(document.getElementById('nm-total').value);
  const notes = document.getElementById('nm-notes').value.trim() || null;
  if (!title) { toast('タイトルを入力してください'); return; }
  if (!(total > 0)) { toast('総額を入力してください'); return; }
  if (stepTwo.size < 1) { toast('参加者がいません'); return; }
  const participants = [];
  stepTwo.forEach((v, uid) => participants.push({
    user_id: uid, alcohol: v.alcohol, weight: v.weight,
  }));
  try {
    const r = await post('/api/nomikai', { title, total_yen: total, notes, participants });
    toast('作成しました');
    navigate('#/nomikai/' + r.id);
  } catch (e) { toast('失敗: ' + e.message); }
}

// ─────────────── DETAIL (unchanged behavior) ───────────────────────────

export async function renderNomikaiDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/nomikai" class="hint">← 飲み会割り勘 一覧</a>
      <div id="nm-detail" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>参加者</h3>
      <div id="nm-detail-list" class="list"></div>
    </div>
  `;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const s = await get('/api/nomikai/' + id);
    const meId = state.me?.id;
    const isCreator = Number(s.creator_user_id) === Number(meId);
    const myRow = (s.participants || []).find(p => Number(p.user_id) === Number(meId));
    const settle = settlementInfo(s);
    const asReqBtn = isCreator
      ? `<div style="margin-top:8px"><button id="nm-asreq" class="primary">この内容で「請求」を作る</button></div>`
      : '';
    document.getElementById('nm-detail').innerHTML = `
      <div class="bold" style="font-size:18px">${escapeHtml(s.title)} ${s.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
      <div class="meta">${escapeHtml(s.creator_name)} · ${escapeHtml(s.created_at)}</div>
      <div style="margin-top:6px">総額 <span class="bold">¥${s.total_yen.toLocaleString()}</span> · 参加 ${s.participants.length}人</div>
      ${s.notes ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(s.notes)}</div>` : ''}
      ${asReqBtn}
      ${settle ? `
        <div style="margin-top:8px; padding:8px 10px; background:#faf6ff; border-left:3px solid var(--primary); border-radius:6px; font-size:13px">
          振込先 (${escapeHtml(s.creator_name)} さん): ${settle}
        </div>` : ''}
      ${myRow ? `
        <div style="margin-top:8px; padding:8px 10px; background:#fff8e6; border-radius:6px">
          <div class="bold">あなたの支払額: ¥${myRow.amount_yen.toLocaleString()}
            ${myRow.alcohol ? '🍺' : '🥤'} ${myRow.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(myRow.grade)}]</span>` : ''}
          </div>
          ${myRow.paid_at
            ? `<div class="meta">✅ 支払い済 (${escapeHtml(myRow.paid_method)}) · ${escapeHtml(myRow.paid_at)} <button id="nm-unpay" style="margin-left:8px; padding:4px 8px">取消</button></div>`
            : `<div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
                 <button data-pay="cash"   class="primary">現金で払った</button>
                 <button data-pay="paypay">PayPay で払った</button>
                 <button data-pay="bank">銀行振込で払った</button>
                 <button data-pay="proxy">他の人に立て替えてもらった</button>
               </div>`}
        </div>` : ''}
    `;
    document.getElementById('nm-detail-list').innerHTML = s.participants.map(p => `
      <div class="list-item">
        <div style="flex:1; display:flex; align-items:center; gap:8px">
          ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
          <div>
            <div class="bold">${escapeHtml(p.display_name)} ${p.alcohol ? '🍺' : '🥤'} ${p.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(p.grade)}]</span>` : ''}</div>
            <div class="meta">¥${p.amount_yen.toLocaleString()} (weight ${Number(p.weight).toFixed(1)})</div>
          </div>
        </div>
        <div>
          ${p.paid_at
            ? `<span class="tag ok">✓ ${escapeHtml(p.paid_method)}${p.proxy_name ? ' (←' + escapeHtml(p.proxy_name) + ')' : ''}</span>`
            : `<span class="tag warn">未払い</span>`}
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-pay]').forEach(b => {
      b.addEventListener('click', () => onPay(id, b.dataset.pay, s));
    });
    document.getElementById('nm-unpay')?.addEventListener('click', () => onUnpay(id));
    document.getElementById('nm-asreq')?.addEventListener('click', () => onConvertToRequest(s));
  } catch (e) {
    document.getElementById('nm-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// 飲み会割り勘の各参加者 (主催者自身は除く) を「請求」フォーマットで送る。
// メモには元の飲み会タイトル + メモが入る。
async function onConvertToRequest(s) {
  const meId = state.me?.id;
  const recipients = (s.participants || [])
    .filter(p => Number(p.user_id) !== Number(meId) && Number(p.amount_yen) > 0)
    .map(p => ({ user_id: Number(p.user_id), amount_yen: Number(p.amount_yen) }));
  if (!recipients.length) { toast('請求対象がありません'); return; }
  const title = `${s.title}`;
  const memo  = s.notes || null;
  if (!confirm(`「${title}」を ${recipients.length} 人に請求として送ります。よろしいですか?`)) return;
  try {
    const r = await post('/api/money-requests', { title, memo, recipients });
    toast('請求を作成しました');
    location.hash = '#/requests/' + r.id;
  } catch (e) { toast('失敗: ' + e.message); }
}

function settlementInfo(s) {
  const bits = [];
  if (s.creator_paypay_id) bits.push(`PayPay: ${escapeHtml(s.creator_paypay_id)}`);
  if (s.creator_bank_info) bits.push(`口座: ${escapeHtml(s.creator_bank_info)}`);
  return bits.join(' · ');
}

async function onPay(id, method, s) {
  let proxyId = null;
  if (method === 'proxy') {
    const others = s.participants
      .filter(p => Number(p.user_id) !== Number(state.me?.id))
      .map(p => `${p.user_id}: ${p.display_name}`).join('\n');
    const ans = prompt('立て替えた人の user_id を入力してください\n参加者:\n' + others);
    proxyId = Number(ans);
    if (!proxyId) { toast('user_id を入力してください'); return; }
  }
  try {
    await patch(`/api/nomikai/${id}/pay`, { method, proxy_user_id: proxyId });
    toast('支払い済にしました');
    await loadDetail(id);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onUnpay(id) {
  if (!confirm('支払い済を取り消しますか?')) return;
  try {
    await patch(`/api/nomikai/${id}/unpay`, {});
    toast('取消しました');
    await loadDetail(id);
  } catch (e) { toast('失敗: ' + e.message); }
}
