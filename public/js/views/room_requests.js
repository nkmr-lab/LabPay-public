// v1230 fb#502 教室予約依頼 — 「発表練習などで教室を押さえてほしい」を中村さん (admin)
//   に投げる LabPay 上の連絡フォーム。教室番号は依頼者が指定しない代わりに
//   条件 (プロジェクター/大人数/階など) を並べる。中村さんは中野キャンパスフロア情報
//   (Cosense: https://scrapbox.io/nkmr-lab/中野キャンパスフロア情報) を見て最適な
//   教室を押さえ、 room_assigned + note を返す。 LabPay 台帳は動かない (buy_requests
//   と同じ設計)。
//
// UI:
//   一覧: pending / confirmed / declined タブ + カード形式
//   新規: 日付 / 開始〜終了 / 用途 / 想定人数 / 条件チェック / 補足
//   詳細アクション: admin なら 教室確定 / 却下 モーダル、依頼者なら 編集 / 取消
//
// route: #/room-requests, #/room-requests/new, #/room-requests/:id/edit

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate, resetFsInnerNav } from '../router.js';
import { toast } from '../app.js';

const FLOOR_GUIDE_URL = 'https://scrapbox.io/nkmr-lab/%E4%B8%AD%E9%87%8E%E3%82%AD%E3%83%A3%E3%83%B3%E3%83%91%E3%82%B9%E3%83%95%E3%83%AD%E3%82%A2%E6%83%85%E5%A0%B1';

const STATUS_LABEL = {
  pending:   { emoji: '📤', label: '依頼中',   color: '#059669', bg: '#f0fdf4' },
  confirmed: { emoji: '✅', label: '教室確定', color: '#0369a1', bg: '#f0f9ff' },
  declined:  { emoji: '❌', label: '却下',     color: '#dc2626', bg: '#fef2f2' },
  cancelled: { emoji: '🚫', label: '取消',     color: '#6b7280', bg: '#f9fafb' },
};

const COND_DEFS = [
  { key: 'needs_projector',  label: '📽 プロジェクター' },
  { key: 'needs_screen',     label: '🖥 スクリーン' },
  { key: 'needs_whiteboard', label: '🖊 ホワイトボード' },
  { key: 'needs_pc',         label: '💻 PC' },
  { key: 'needs_mic',        label: '🎤 マイク' },
  { key: 'needs_camera',     label: '📷 カメラ (収録用)' },
];

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('T') ? '' : '+09:00'));
    if (isNaN(d.getTime())) return String(iso);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return 'たった今';
    if (diffMin < 60) return `${diffMin}分前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}時間前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}日前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch { return String(iso); }
}

function fmtDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const days = ['日','月','火','水','木','金','土'];
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
  return `${Number(m[2])}/${Number(m[3])} (${days[dt.getDay()]})`;
}

function fmtHM(t) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

// ---- 一覧 ----
export async function renderRoomRequests({ query } = {}) {
  const app = document.getElementById('app');
  const tab = (query && query.status) || 'pending';
  app.innerHTML = renderShell();
  try {
    const params = { limit: 200 };
    if (tab !== 'all') params.status = tab;
    const d = await get('/api/room-requests', params);
    document.getElementById('rr-list').innerHTML = renderList(d.items || [], d.is_admin || false, tab);
    document.getElementById('rr-tabs').innerHTML = renderTabs(tab, d.counts || {});
    wireList(d.is_admin || false);
    wireTabs();
  } catch (e) {
    document.getElementById('rr-list').innerHTML =
      `<div class="card" style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

function renderShell() {
  return `
    <div class="card page-header">
      <h2 style="margin:0">🏫 教室予約依頼</h2>
      <div class="hint-sm" style="margin-top:4px">
        発表練習・会議などで教室を押さえてほしい時にここから依頼。教室番号は指定不要 (中村さんが条件に合わせて予約)。
        LabPay 台帳のお金は動きません。
      </div>
      <div class="row" style="gap:6px; margin-top:8px; justify-content:flex-end">
        <a class="btn primary" href="#/room-requests/new" style="text-decoration:none">＋新規依頼</a>
      </div>
    </div>
    <div id="rr-tabs"></div>
    <div id="rr-list"><div class="card"><div class="hint-sm">読み込み中…</div></div></div>
    <div id="rr-modal"></div>
  `;
}

function renderTabs(current, counts) {
  const tabs = [
    { id: 'pending',   label: '📤 依頼中' },
    { id: 'confirmed', label: '✅ 確定' },
    { id: 'declined',  label: '❌ 却下' },
  ];
  return `<div class="card" style="padding:6px">
    <div class="row" style="gap:4px; flex-wrap:wrap">
      ${tabs.map(t => {
        const n = counts[t.id];
        const bg = t.id === current ? '#7b3fa0' : '#f3f4f6';
        const fg = t.id === current ? '#fff' : '#374151';
        return `<button class="btn" data-rr-tab="${t.id}" style="background:${bg}; color:${fg}; font-size:12px; padding:4px 10px">
                  ${t.label}${n !== undefined ? ` <span style="opacity:0.7">${n}</span>` : ''}
                </button>`;
      }).join('')}
    </div>
  </div>`;
}

function renderList(items, isAdmin, tab) {
  if (!items.length) {
    return `<div class="card" style="text-align:center; padding:30px; color:#6b7280">
      ${tab === 'pending' ? '今は依頼中のものはありません' : '該当する依頼がありません'}
    </div>`;
  }
  return items.map(r => renderCard(r, isAdmin)).join('');
}

function renderCard(r, isAdmin) {
  const meta = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
  const condBits = COND_DEFS.filter(c => r[c.key]).map(c =>
    `<span style="display:inline-block; padding:1px 8px; background:#e5e7eb; color:#374151; border-radius:8px; font-size:11px; margin:2px 4px 2px 0">${c.label}</span>`
  ).join('');
  const capBits = [];
  if (r.expected_participants) capBits.push(`想定 ${r.expected_participants}人`);
  if (r.min_capacity)          capBits.push(`収容 ${r.min_capacity}人以上`);
  if (r.preferred_floor)       capBits.push(`階: ${escapeHtml(r.preferred_floor)}`);
  const capLine = capBits.length ? `<div class="hint-sm" style="margin-top:4px">👥 ${capBits.join(' / ')}</div>` : '';
  const otherLine = r.other_conditions ? `<div class="hint-sm" style="margin-top:2px">➕ ${escapeHtml(r.other_conditions)}</div>` : '';
  const notesLine = r.notes ? `<div style="margin-top:6px; font-size:13px; color:#374151">💬 ${escapeHtml(r.notes)}</div>` : '';
  const adminNoteLine = r.admin_note
    ? `<div style="font-size:12px; color:#374151; margin-top:6px; padding:6px 10px; background:#eff6ff; border-radius:4px">📝 中村さん: ${escapeHtml(r.admin_note)}</div>`
    : '';
  const roomLine = r.status === 'confirmed' && r.room_assigned
    ? `<div style="margin-top:6px; padding:6px 10px; background:#dbeafe; border-radius:4px; font-weight:600; color:#1d4ed8">🏫 教室: ${escapeHtml(r.room_assigned)}</div>`
    : '';
  const resolvedBy = (r.status === 'confirmed' || r.status === 'declined') && r.resolver_name
    ? `<div style="font-size:11px; color:#6b7280; margin-top:4px">${meta.emoji} ${escapeHtml(r.resolver_name)} が ${fmtTime(r.resolved_at || r.updated_at)}</div>`
    : '';
  const canEdit    = r.is_mine && r.status === 'pending';
  const canCancel  = r.is_mine && r.status === 'pending';
  const canConfirm = isAdmin && r.status === 'pending';
  const canDecline = isAdmin && r.status === 'pending';
  const canReopen  = isAdmin && r.status !== 'pending';
  return `
    <div class="card" style="border-left:4px solid ${meta.color}; background:${meta.bg}44">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${meta.color}; color:#fff; font-weight:600">${meta.emoji} ${meta.label}</span>
        <div class="hint-sm" style="color:#6b7280; margin-left:auto">${escapeHtml(r.requester_name)} · ${fmtTime(r.created_at)}</div>
      </div>
      <div style="font-weight:600; margin-top:6px; font-size:15px">🏫 ${escapeHtml(r.purpose)}</div>
      <div style="margin-top:4px; font-size:13px; color:#374151">📅 ${fmtDate(r.event_date)} ${fmtHM(r.time_start)}〜${fmtHM(r.time_end)}</div>
      ${capLine}
      ${condBits ? `<div style="margin-top:4px">${condBits}</div>` : ''}
      ${otherLine}
      ${notesLine}
      ${roomLine}
      ${adminNoteLine}
      ${resolvedBy}
      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap; justify-content:flex-end">
        ${canConfirm ? `<button class="btn primary" data-rr-act="confirm" data-rr-id="${r.id}" data-rr-purpose="${escapeHtml(r.purpose)}">🏫 教室確定</button>
                        <button class="btn" data-rr-act="decline" data-rr-id="${r.id}" data-rr-purpose="${escapeHtml(r.purpose)}">❌ 却下</button>` : ''}
        ${canEdit    ? `<button class="btn" data-rr-act="edit" data-rr-id="${r.id}">✏️ 編集</button>` : ''}
        ${canCancel  ? `<button class="btn" data-rr-act="cancel" data-rr-id="${r.id}" data-rr-purpose="${escapeHtml(r.purpose)}">🚫 取消</button>` : ''}
        ${canReopen  ? `<button class="btn" data-rr-act="reopen" data-rr-id="${r.id}">🔄 依頼中に戻す</button>` : ''}
      </div>
    </div>
  `;
}

function wireTabs() {
  document.querySelectorAll('[data-rr-tab]').forEach(b => {
    b.addEventListener('click', () => {
      // v1267 中村さん報告「依頼中以外を開くと右上の ✕ で 一発で消えない」→
      //   タブ切替は fullscreen の内部 nav でカウント積まれる仕様なので、切替時に
      //   カウントリセットして「✕ を 1 発押せば entry (前ページ) に直行」させる。
      resetFsInnerNav();
      navigate('#/room-requests?status=' + b.dataset.rrTab);
    });
  });
}

function wireList(isAdmin) {
  document.querySelectorAll('[data-rr-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.rrId);
      const act = btn.dataset.rrAct;
      const purpose = btn.dataset.rrPurpose || '';
      if (act === 'confirm') return openResolveModal(id, 'confirm', purpose);
      if (act === 'decline') return openResolveModal(id, 'decline', purpose);
      if (act === 'cancel') {
        if (!confirm(`依頼を取り消しますか？\n\n${purpose}`)) return;
        try {
          await del('/api/room-requests/' + id);
          toast('取消しました');
          renderRoomRequests({ query: parseQuery() });
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
        return;
      }
      if (act === 'reopen') {
        try {
          await patch('/api/room-requests/' + id + '/reopen', {});
          toast('依頼中に戻しました');
          renderRoomRequests({ query: parseQuery() });
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
        return;
      }
      if (act === 'edit') {
        navigate('#/room-requests/' + id + '/edit');
      }
    });
  });
}

function parseQuery() {
  const q = (location.hash.split('?')[1] || '');
  const params = new URLSearchParams(q);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// ---- 教室確定 / 却下モーダル (admin) ----
function openResolveModal(id, mode, purpose) {
  const root = document.getElementById('rr-modal');
  const isConfirm = mode === 'confirm';
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" data-rr-close="1">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px" data-rr-inner>
        <div class="row" style="align-items:center; justify-content:space-between">
          <h3 style="margin:0; font-size:16px">${isConfirm ? '🏫 教室確定を通知' : '❌ 却下する'}</h3>
          <button class="btn" data-rr-close="1">×</button>
        </div>
        <div style="margin-top:8px; font-size:13px; color:#6b7280">対象: ${escapeHtml(purpose)}</div>
        ${isConfirm ? `<label class="field" style="margin-top:12px">
          <span class="lbl">教室名 <span style="color:#dc2626">*</span></span>
          <input type="text" id="rr-room" maxlength="120" placeholder="例: 中野キャンパス 6号館 604" style="width:100%; box-sizing:border-box">
          <div class="hint-sm" style="margin-top:4px">
            <a href="${FLOOR_GUIDE_URL}" target="_blank" rel="noopener noreferrer">🗺 中野キャンパスフロア情報 (Cosense) を開く</a>
          </div>
        </label>` : ''}
        <label class="field" style="margin-top:10px">
          <span class="lbl">${isConfirm ? 'メモ (入口 / 鍵 / 備考、任意)' : '却下理由 (任意)'}</span>
          <textarea id="rr-note" rows="3" maxlength="2000" placeholder="${isConfirm ? '例: 5階の廊下側、事務室で鍵借りて' : '例: 同時間帯に別イベントがある'}" style="width:100%; box-sizing:border-box"></textarea>
        </label>
        <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
          <button class="btn" data-rr-close="1">やめる</button>
          <button class="btn primary" id="rr-submit-resolve">${isConfirm ? '🏫 確定を通知' : '❌ 却下する'}</button>
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-rr-close]').forEach(el => {
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  });
  document.getElementById('rr-submit-resolve').addEventListener('click', async () => {
    const body = {};
    const noteEl = document.getElementById('rr-note');
    if (noteEl && noteEl.value.trim()) body.admin_note = noteEl.value.trim();
    if (isConfirm) {
      const roomEl = document.getElementById('rr-room');
      const roomVal = (roomEl && roomEl.value.trim()) || '';
      if (!roomVal) { toast('教室名を入力してください'); return; }
      body.room_assigned = roomVal;
    }
    try {
      await patch(`/api/room-requests/${id}/${isConfirm ? 'confirm' : 'decline'}`, body);
      toast(isConfirm ? '教室確定を通知しました' : '却下しました');
      closeModal();
      renderRoomRequests({ query: parseQuery() });
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
}

function closeModal() {
  const root = document.getElementById('rr-modal');
  if (root) root.innerHTML = '';
}

// ---- 新規作成 / 編集 ----
export async function renderRoomRequestNew() {
  const app = document.getElementById('app');
  app.innerHTML = renderForm(null);
  wireForm(null);
}

export async function renderRoomRequestEdit({ params }) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `<div class="card"><div class="hint-sm">読み込み中…</div></div>`;
  try {
    const r = await get('/api/room-requests/' + id);
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

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderForm(existing) {
  const isEdit = !!existing;
  const dateVal = existing ? existing.event_date : todayISO();
  const tsVal = existing ? fmtHM(existing.time_start) : '10:00';
  const teVal = existing ? fmtHM(existing.time_end)   : '11:00';
  return `
    <div class="card page-header">
      <h2 style="margin:0">${isEdit ? '✏️ 教室予約依頼を編集' : '🏫 新規 教室予約依頼'}</h2>
      <div class="hint-sm" style="margin-top:4px">
        中村さん (admin) に教室予約を依頼します。教室番号は指定不要 (条件を書いてもらえれば中村さんが押さえます)。
        <a href="#/room-requests">← 一覧に戻る</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">
        <a href="${FLOOR_GUIDE_URL}" target="_blank" rel="noopener noreferrer">🗺 中野キャンパスフロア情報 (Cosense) を確認する</a>
      </div>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">用途 <span style="color:#dc2626">*</span></span>
        <input type="text" id="rrf-purpose" required maxlength="200"
               placeholder="例: 発表練習 (国際会議 CHI 2027 用)"
               value="${existing ? escapeHtml(existing.purpose) : ''}"
               style="width:100%; box-sizing:border-box">
      </label>
      <label class="field">
        <span class="lbl">使用したい日 <span style="color:#dc2626">*</span></span>
        <input type="date" id="rrf-date" required value="${dateVal}" style="width:200px">
      </label>
      <div class="row" style="gap:8px; flex-wrap:wrap">
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">開始時刻 <span style="color:#dc2626">*</span></span>
          <input type="time" id="rrf-time-start" required value="${tsVal}" style="width:100%; box-sizing:border-box">
        </label>
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">終了時刻 <span style="color:#dc2626">*</span></span>
          <input type="time" id="rrf-time-end" required value="${teVal}" style="width:100%; box-sizing:border-box">
        </label>
      </div>
      <label class="field">
        <span class="lbl">想定人数 (任意)</span>
        <input type="number" id="rrf-participants" min="1" max="9999"
               placeholder="例: 12"
               value="${existing && existing.expected_participants !== null ? existing.expected_participants : ''}"
               style="width:150px">
      </label>

      <div class="field">
        <span class="lbl">必要な設備 (該当するものを ON)</span>
        <div style="display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:6px">
          ${COND_DEFS.map(c => `
            <label style="display:inline-flex; align-items:center; gap:4px; font-size:13px; cursor:pointer">
              <input type="checkbox" data-rrf-cond="${c.key}" ${existing && existing[c.key] ? 'checked' : ''}>
              ${c.label}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="row" style="gap:8px; flex-wrap:wrap">
        <label class="field" style="flex:1; min-width:150px">
          <span class="lbl">最低収容人数 (任意)</span>
          <input type="number" id="rrf-min-capacity" min="1" max="9999"
                 placeholder="例: 30"
                 value="${existing && existing.min_capacity !== null ? existing.min_capacity : ''}"
                 style="width:100%; box-sizing:border-box">
        </label>
        <label class="field" style="flex:2; min-width:180px">
          <span class="lbl">希望階 (任意)</span>
          <input type="text" id="rrf-floor" maxlength="40"
                 placeholder="例: 3階以上 / 低層階 / どこでも"
                 value="${existing ? escapeHtml(existing.preferred_floor || '') : ''}"
                 style="width:100%; box-sizing:border-box">
        </label>
      </div>

      <label class="field">
        <span class="lbl">追加条件 (任意)</span>
        <textarea id="rrf-other" rows="2" maxlength="1000"
                  placeholder="例: 発表練習なので暗室に近い部屋、鍵の受渡し配慮など"
                  style="width:100%; box-sizing:border-box">${existing ? escapeHtml(existing.other_conditions || '') : ''}</textarea>
      </label>
      <label class="field">
        <span class="lbl">補足 (任意)</span>
        <textarea id="rrf-notes" rows="3" maxlength="2000"
                  placeholder="連絡事項、時間変更の柔軟性など"
                  style="width:100%; box-sizing:border-box">${existing ? escapeHtml(existing.notes || '') : ''}</textarea>
      </label>

      <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
        <a class="btn" href="#/room-requests" style="text-decoration:none">キャンセル</a>
        <button class="btn primary" id="rrf-submit">${isEdit ? '💾 保存' : '📤 依頼を投げる'}</button>
      </div>
    </div>
  `;
}

function wireForm(existing) {
  const submit = document.getElementById('rrf-submit');
  submit.addEventListener('click', async () => {
    const purpose   = document.getElementById('rrf-purpose').value.trim();
    const eventDate = document.getElementById('rrf-date').value.trim();
    const timeStart = document.getElementById('rrf-time-start').value.trim();
    const timeEnd   = document.getElementById('rrf-time-end').value.trim();
    if (!purpose)   { toast('用途を入力してください'); return; }
    if (!eventDate) { toast('日付を入力してください'); return; }
    if (!timeStart || !timeEnd) { toast('開始と終了時刻を入力してください'); return; }
    if (timeStart >= timeEnd) { toast('終了時刻は開始時刻より後にしてください'); return; }

    const body = { purpose, event_date: eventDate, time_start: timeStart, time_end: timeEnd };
    const pplRaw = document.getElementById('rrf-participants').value.trim();
    if (pplRaw !== '') body.expected_participants = Number(pplRaw);
    const capRaw = document.getElementById('rrf-min-capacity').value.trim();
    if (capRaw !== '') body.min_capacity = Number(capRaw);
    const floorVal = document.getElementById('rrf-floor').value.trim();
    if (floorVal !== '') body.preferred_floor = floorVal;
    const otherVal = document.getElementById('rrf-other').value.trim();
    if (otherVal !== '') body.other_conditions = otherVal;
    const notesVal = document.getElementById('rrf-notes').value.trim();
    if (notesVal !== '') body.notes = notesVal;
    COND_DEFS.forEach(c => {
      const el = document.querySelector(`[data-rrf-cond="${c.key}"]`);
      if (el && el.checked) body[c.key] = 1;
    });

    submit.disabled = true;
    submit.textContent = '送信中…';
    try {
      if (existing) {
        await patch('/api/room-requests/' + existing.id, body);
        toast('保存しました');
      } else {
        const r = await post('/api/room-requests', body);
        toast(`教室予約依頼を送信しました (#${r.id})`);
      }
      navigate('#/room-requests');
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
      submit.disabled = false;
      submit.textContent = existing ? '💾 保存' : '📤 依頼を投げる';
    }
  });
}
