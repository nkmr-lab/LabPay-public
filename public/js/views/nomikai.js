// /#/nomikai      → step 1: メンバー選択 (全員/学年別/男女別バルク + 個別チップ)
// /#/nomikai/new  → step 2: 選択メンバーで計算 (ソフドリのみフラグ + weight + 総額 → 配分)
// /#/nomikai/{id} → 既存セッションの詳細 (支払い済 toggle 等)

import { get, post, patch } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

// Per-grade default weights (seniors absorb more) and bumps.
const GRADE_WEIGHT = { D: 1.5, M2: 1.2, M1: 1.0, B4: 0.7, B3: 0.5 };
const GRADE_ORDER  = ['D','M2','M1','B4','B3',''];
const ALCOHOL_BUMP = 1.5;

// Step-1 picker keeps just a Set of user ids; step-2 form attaches weight/alcohol
// in its own local state when the picker handoff happens via URL query.
const stepOne = { selected: new Set(), users: [] };

// ─────────────── STEP 1: picker ────────────────────────────────────────

export async function renderNomikai() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="muted" style="font-size:13px">← アプリ</a>
      <h2 style="margin:6px 0 0">飲み会割り勘</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        新歓・追いコン等の幹事用。まずはメンバーを絞り込み → 次の画面で各人の飲酒/ソフドリと重み付けを調整して計算します。
      </p>
    </div>

    <div class="card">
      <h3>1. メンバーを選ぶ</h3>
      <div id="nm-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
      <div id="nm-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="margin-top:10px; align-items:center">
        <div id="nm-count" class="muted" style="flex:1">0 人選択中</div>
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
  // Sort: D → M2 → M1 → B4 → B3 → (no grade), 50音順.
  stepOne.users = [...u.items].sort((a, b) => {
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
        <div style="flex:1">
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

// uid → { alcohol, weight, grade, display_name, avatar_url }
const stepTwo = new Map();

export async function renderNomikaiNew({ query }) {
  const uids = String(query?.uids || '').split(',').map(Number).filter(Boolean);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/nomikai" class="muted" style="font-size:13px">← メンバー選択</a>
      <h2 style="margin:6px 0 0">2. 詳細を入力</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
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
        🍺 = 飲酒 (×${ALCOHOL_BUMP}) / 🥤 = ソフドリのみ。タップで切替。
      </div>
      <div id="nm-people"></div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center">
        <div id="nm-preview-total" class="muted" style="flex:1">参加者ごとの金額を計算します</div>
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
      const w = GRADE_WEIGHT[ent.grade] ?? 1.0;
      stepTwo.set(uid, {
        alcohol: true,                 // default: drinker (most-common case)
        weight: w,
        grade: ent.grade || '',
        display_name: ent.display_name,
        avatar_url: ent.avatar_url,
      });
    });
  } catch (e) {
    document.getElementById('nm-people').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  renderPeople();
  document.getElementById('nm-total').addEventListener('input', renderPeople);
  document.getElementById('nm-submit').addEventListener('click', onCreate);
}

function renderPeople() {
  const total = Number(document.getElementById('nm-total').value) || 0;
  const arr = [...stepTwo.entries()].map(([uid, v]) => ({ uid, ...v }));
  const sumW = arr.reduce((s, x) => s + x.weight, 0) || 1;
  let allocated = 0;
  arr.forEach(x => { x.amount = Math.round(total * x.weight / sumW); allocated += x.amount; });
  const delta = total - allocated;
  if (delta) {
    const meIdx = arr.findIndex(x => x.uid === state.me?.id);
    arr[(meIdx >= 0 ? meIdx : 0)].amount += delta;
  }
  document.getElementById('nm-people').innerHTML = arr.map(x => `
    <div class="nm-row" data-uid="${x.uid}">
      <div style="flex:1; display:flex; align-items:center; gap:8px">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <div>
          <div class="bold">${escapeHtml(x.display_name)} ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}</div>
          <div class="meta">¥${x.amount.toLocaleString()}</div>
        </div>
      </div>
      <button data-flag="${x.uid}" class="btn" style="min-width:54px">${x.alcohol ? '🍺' : '🥤'}</button>
      <input type="number" min="0.1" step="0.1" value="${x.weight.toFixed(1)}" data-w="${x.uid}" style="width:60px; text-align:right">
      <button data-rm="${x.uid}" class="danger" style="padding:4px 8px">×</button>
    </div>`).join('');
  document.getElementById('nm-preview-total').innerHTML = total
    ? `合計 ¥${allocated.toLocaleString()}${delta ? ` (端数 ${delta > 0 ? '+' : ''}${delta} 円は ${escapeHtml(state.me?.display_name || '主催')} に)` : ''}`
    : '総額を入力してください';
  document.querySelectorAll('[data-flag]').forEach(b => {
    b.addEventListener('click', () => toggleAlcohol(Number(b.dataset.flag)));
  });
  document.querySelectorAll('[data-w]').forEach(inp => {
    inp.addEventListener('input', () => {
      const uid = Number(inp.dataset.w);
      const v = Math.max(0.1, Math.min(10, Number(inp.value) || 1));
      const cur = stepTwo.get(uid);
      if (cur) { cur.weight = v; stepTwo.set(uid, cur); renderPeople(); }
    });
  });
  document.querySelectorAll('[data-rm]').forEach(b => {
    b.addEventListener('click', () => {
      stepTwo.delete(Number(b.dataset.rm));
      renderPeople();
    });
  });
}

function toggleAlcohol(uid) {
  const cur = stepTwo.get(uid);
  if (!cur) return;
  if (cur.alcohol) {
    cur.alcohol = false;
    cur.weight = Math.max(0.2, cur.weight / ALCOHOL_BUMP);
  } else {
    cur.alcohol = true;
    cur.weight = cur.weight * ALCOHOL_BUMP;
  }
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
      <a href="#/nomikai" class="muted" style="font-size:13px">← 飲み会割り勘 一覧</a>
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
    const myRow = (s.participants || []).find(p => Number(p.user_id) === Number(meId));
    const settle = settlementInfo(s);
    document.getElementById('nm-detail').innerHTML = `
      <div class="bold" style="font-size:18px">${escapeHtml(s.title)} ${s.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
      <div class="meta">${escapeHtml(s.creator_name)} · ${escapeHtml(s.created_at)}</div>
      <div style="margin-top:6px">総額 <span class="bold">¥${s.total_yen.toLocaleString()}</span> · 参加 ${s.participants.length}人</div>
      ${s.notes ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(s.notes)}</div>` : ''}
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
            ? `<span class="tag" style="background:#eaf5ef; color:#0e7c63">✓ ${escapeHtml(p.paid_method)}${p.proxy_name ? ' (←' + escapeHtml(p.proxy_name) + ')' : ''}</span>`
            : `<span class="tag" style="background:#fff3df; color:#b54708">未払い</span>`}
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-pay]').forEach(b => {
      b.addEventListener('click', () => onPay(id, b.dataset.pay, s));
    });
    document.getElementById('nm-unpay')?.addEventListener('click', () => onUnpay(id));
  } catch (e) {
    document.getElementById('nm-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
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
