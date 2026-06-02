// /#/nomikai — 飲み会割り勘 list + create form.
// /#/nomikai/{id} — session detail with per-person amounts + 支払い済 buttons.

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

// Default weight presets per grade — tuned for the lab where seniors absorb
// more of the bill. Edit per-person inline before submitting.
const GRADE_WEIGHT = { D: 1.5, M2: 1.2, M1: 1.0, B4: 0.7, B3: 0.5 };
const GRADE_ORDER  = ['D','M2','M1','B4','B3',''];
const ALCOHOL_BUMP = 1.5; // 飲んだ人に上乗せ倍率 (×1.5)

// ──────────────────────────── LIST + CREATE ────────────────────────────

export async function renderNomikai() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="muted" style="font-size:13px">← アプリ</a>
      <h2 style="margin:6px 0 0">飲み会割り勘</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        総額 + メンバー + 飲酒フラグ + 学年傾斜 で各人の支払額を計算、参加者に通知します。
        支払い済みのチェックは各参加者が自分で入れます。
      </p>
    </div>

    <div class="card">
      <h3>新規セッション</h3>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="nm-title" maxlength="200" placeholder="例: 中川送別会 @ 田中屋">
      </label>
      <label class="field">
        <span class="lbl">総額 (円)</span>
        <input type="number" id="nm-total" min="0" placeholder="例: 28000">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="nm-notes" maxlength="2000" rows="2" placeholder="場所・コース内容など"></textarea>
      </label>

      <div class="field">
        <span class="lbl">参加メンバー (タップして追加 / 飲酒フラグ切替)</span>
        <div id="nm-picker" class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px"></div>
      </div>

      <div class="field">
        <span class="lbl">プレビュー (合計が総額と一致するように weight を調整)</span>
        <div id="nm-preview" class="muted">参加者を選んでください</div>
      </div>
      <button id="nm-submit" class="primary">作成 + 全員に通知</button>
    </div>

    <div class="card">
      <h3>履歴</h3>
      <div id="nm-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('nm-total').addEventListener('input', renderPreview);
  document.getElementById('nm-submit').addEventListener('click', onCreate);
  await loadList();
}

// (user_id → {alcohol bool, weight float}). Selected = key present.
const selected = new Map();

async function populatePicker() {
  const u = await get('/api/users');
  const picker = document.getElementById('nm-picker');
  // Sort: D → M2 → M1 → B4 → B3 → (no grade), alphabetical within.
  const sorted = [...u.items].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });
  picker.innerHTML = sorted.map(x => {
    const wDefault = GRADE_WEIGHT[x.grade] ?? 1.0;
    return `
      <span class="rl-chip" data-uid="${x.id}" data-w="${wDefault}" data-grade="${escapeHtml(x.grade ?? '')}">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span>${escapeHtml(x.display_name)}</span>
        ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
      </span>`;
  }).join('');
  picker.querySelectorAll('.rl-chip').forEach(chip => {
    chip.addEventListener('click', () => onTogglePick(chip));
  });
}

function onTogglePick(chip) {
  const uid = Number(chip.dataset.uid);
  if (!selected.has(uid)) {
    // First tap: pick + default alcohol=true (most-common case at the lab)
    selected.set(uid, { alcohol: true, weight: Number(chip.dataset.w), grade: chip.dataset.grade });
    chip.style.background = 'var(--primary-soft, #efeafa)';
    chip.style.borderColor = 'var(--primary)';
    chip.dataset.state = 'alcohol';
  } else if (chip.dataset.state === 'alcohol') {
    // Second tap: toggle to non-drinker. Lower the base weight a touch.
    const cur = selected.get(uid);
    cur.alcohol = false;
    cur.weight = Math.max(0.2, cur.weight / ALCOHOL_BUMP);
    selected.set(uid, cur);
    chip.style.background = '#eaf5ef';
    chip.style.borderColor = '#0e7c63';
    chip.dataset.state = 'soft';
    // Add a 'soft' badge inside
    if (!chip.querySelector('.nm-soft-badge')) {
      const b = document.createElement('span');
      b.className = 'nm-soft-badge muted';
      b.style.cssText = 'font-size:10px; color:#0e7c63';
      b.textContent = '🥤';
      chip.appendChild(b);
    }
  } else {
    // Third tap: deselect.
    selected.delete(uid);
    chip.style.background = '';
    chip.style.borderColor = '';
    chip.dataset.state = '';
    chip.querySelector('.nm-soft-badge')?.remove();
  }
  renderPreview();
}

function renderPreview() {
  const root = document.getElementById('nm-preview');
  const total = Number(document.getElementById('nm-total').value) || 0;
  if (!selected.size) { root.innerHTML = '参加者を選んでください'; return; }
  const arr = [];
  selected.forEach((v, uid) => arr.push({ uid, ...v }));
  // Compute weighted shares.
  const sumW = arr.reduce((s, x) => s + x.weight, 0) || 1;
  // Allocate then absorb rounding delta into the creator (= state.me.id) or 1st row.
  let allocated = 0;
  arr.forEach(x => { x.amount = Math.round(total * x.weight / sumW); allocated += x.amount; });
  const delta = total - allocated;
  if (delta) {
    const meIdx = arr.findIndex(x => x.uid === state.me?.id);
    arr[(meIdx >= 0 ? meIdx : 0)].amount += delta;
  }
  // Render rows with editable weights so the user can fine-tune until amounts feel right.
  root.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 70px 70px 30px; gap:6px; align-items:center; font-size:13px; margin-bottom:4px; color:var(--muted)">
      <div>メンバー</div><div style="text-align:right">weight</div><div style="text-align:right">支払額</div><div></div>
    </div>
    ${arr.map(x => `
      <div style="display:grid; grid-template-columns: 1fr 70px 70px 30px; gap:6px; align-items:center; padding:3px 0">
        <div>${escapeHtml(memberLabel(x.uid))} ${x.alcohol ? '🍺' : '🥤'} ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}</div>
        <input type="number" min="0.1" step="0.1" value="${x.weight.toFixed(1)}" data-w-uid="${x.uid}" style="text-align:right">
        <div class="bold" style="text-align:right">¥${x.amount.toLocaleString()}</div>
        <button data-rm-uid="${x.uid}" class="danger" style="padding:4px 8px">×</button>
      </div>`).join('')}
    <div style="margin-top:6px; text-align:right; font-size:13px" class="muted">
      合計 ¥${allocated.toLocaleString()} ${delta ? `(調整 ${delta > 0 ? '+' : ''}${delta} 円は ${escapeHtml(state.me?.display_name || '主催')} に)` : ''}
    </div>
  `;
  root.querySelectorAll('[data-w-uid]').forEach(inp => {
    inp.addEventListener('input', () => {
      const uid = Number(inp.dataset.wUid);
      const v = Math.max(0.1, Math.min(10, Number(inp.value) || 1));
      const cur = selected.get(uid);
      if (cur) { cur.weight = v; selected.set(uid, cur); renderPreview(); }
    });
  });
  root.querySelectorAll('[data-rm-uid]').forEach(b => {
    b.addEventListener('click', () => {
      const uid = Number(b.dataset.rmUid);
      selected.delete(uid);
      const chip = document.querySelector(`#nm-picker .rl-chip[data-uid="${uid}"]`);
      if (chip) { chip.style.background = ''; chip.style.borderColor = ''; chip.dataset.state = ''; chip.querySelector('.nm-soft-badge')?.remove(); }
      renderPreview();
    });
  });
}

function memberLabel(uid) {
  const chip = document.querySelector(`#nm-picker .rl-chip[data-uid="${uid}"] > span:nth-of-type(1)`);
  return chip ? chip.textContent : ('user#' + uid);
}

async function onCreate() {
  const title = document.getElementById('nm-title').value.trim();
  const total = Number(document.getElementById('nm-total').value);
  const notes = document.getElementById('nm-notes').value.trim() || null;
  if (!title) { toast('タイトルを入力してください'); return; }
  if (!(total > 0)) { toast('総額を入力してください'); return; }
  if (selected.size < 1) { toast('参加者を選んでください'); return; }
  const participants = [];
  selected.forEach((v, uid) => participants.push({
    user_id: uid, alcohol: v.alcohol, weight: v.weight,
  }));
  try {
    const r = await post('/api/nomikai', { title, total_yen: total, notes, participants });
    toast('作成しました');
    location.hash = '#/nomikai/' + r.id;
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadList() {
  try {
    const d = await get('/api/nomikai');
    const root = document.getElementById('nm-list');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">まだ履歴はありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(s => `
      <a class="list-item" href="#/nomikai/${s.id}">
        <div style="flex:1">
          <div class="bold">${escapeHtml(s.title)} ${s.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
          <div class="meta">${escapeHtml(s.creator_name)} · 総額 ¥${Number(s.total_yen).toLocaleString()} · 参加 ${s.member_count}人</div>
          <div class="meta">支払い済 ${s.paid_count}/${s.member_count} · ${escapeHtml(s.created_at)}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('nm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ──────────────────────────── DETAIL ────────────────────────────

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
    // Pick someone else from the same session as the proxy.
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
