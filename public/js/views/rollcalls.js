// /#/rollcalls — 点呼 (roll call)。 「いる？」 「起きてる？」 をワンタップで集める。
// 投票と似てるが 選択肢が無く 「応答済 / 未応答」 のみ + 任意メモ。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { tag, fmtDateTime } from '../format.js';
import { createMemberPicker } from '../member_picker.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

const PRESETS = [
  { title: '起きてる？',     minutes: 10, hint: '朝の出勤 / 学会の集合前 など' },
  { title: 'いる？',         minutes: 5,  hint: 'ミーティング前の出席確認' },
  { title: '帰宅できた？',   minutes: 60, hint: '夜の安全確認' },
];

function fmtRemaining(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = dt - new Date();
  if (diff <= 0) return '締切';
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  if (min >= 60) return `残り ${Math.floor(min/60)}時間${min%60}分`;
  return `残り ${min}:${String(sec).padStart(2,'0')}`;
}
// v482 #70 「点呼 を 押して から の 経過 時間」 (起案 = 開始 = 押し時刻)。
function fmtElapsed(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = new Date() - dt;
  if (diff < 0) return '0:00 経過';
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  if (min >= 60) return `${Math.floor(min/60)}時間${min%60}分 経過`;
  return `${min}:${String(sec%60).padStart(2,'0')} 経過`;
}
function deadlineShort(s) {
  if (!s) return '';
  return String(s).slice(11, 16);
}

export async function renderRollCalls() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">点呼</h2>
        <a class="btn primary" href="#/rollcalls/new">＋ 新規</a>
      </div>
    </div>
    <div id="rc-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/rollcalls');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('rc-list').innerHTML =
        '<div class="empty">点呼はまだありません</div>';
      return;
    }
    document.getElementById('rc-list').innerHTML = items.map(r => {
      const open = r.status === 'open';
      const tags = [];
      tags.push(open
        ? `<span class="tag" style="background:#e3f2fd; color:#1565c0">受付中</span>`
        : tag('muted', '締切済'));
      if (r.is_target && !r.has_responded && open) tags.push('<span class="tag" style="background:#fff3e0; color:#e65100">未応答</span>');
      if (r.is_target && r.has_responded) tags.push(tag('ok', '応答済'));
      if (Number(r.creator_user_id) === Number(state.me?.id)) tags.push('<span class="tag">起案</span>');
      return `
        <a class="list-item" href="#/rollcalls/${r.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title)}</div>
            <div class="meta">${tags.join(' ')} · ${escapeHtml(open ? fmtElapsed(r.created_at) : '締切')} · 起案 ${escapeHtml(r.creator_name)}${r.deadline_at ? ' · 締切 ' + escapeHtml(deadlineShort(r.deadline_at)) : ''}</div>
            <div class="meta">${r.responded_count}/${r.target_count} 人が応答</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('rc-list').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderRollCallNew({ query } = {}) {
  const rawMembers = String(query?.members || '').trim();
  const presetMembers = rawMembers ? rawMembers.split(',').map(Number).filter(Boolean) : [];
  const presetTitle = String(query?.title || '').trim();
  const lockMembers = presetMembers.length > 0;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/rollcalls" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">点呼を始める</h2>
    </div>
    <div class="card">
      <span class="lbl">テンプレ</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 10px">
        ${PRESETS.map((p, i) => `
          <button class="btn" data-preset="${i}">${escapeHtml(p.title)} <span class="hint-sm">(${p.minutes} 分)</span></button>
        `).join('')}
      </div>
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="rcn-title" maxlength="200" placeholder="例: 起きてる？" value="${escapeHtml(presetTitle)}" autofocus>
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <input type="text" id="rcn-body" maxlength="500" placeholder="補足 (例: 10:00 までに集合)">
      </label>
      <label class="field"><span class="lbl">締切まで (分)</span>
        <input type="number" id="rcn-min" min="1" max="1440" value="10">
      </label>
      <div class="field">
        <span class="lbl">対象者${lockMembers ? ' (グループ内)' : ''}</span>
        ${lockMembers ? '' : `<div id="rcn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>`}
        <div id="rcn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/rollcalls" class="btn">キャンセル</a>
        <button id="rcn-save" class="primary">開始</button>
      </div>
    </div>
  `;
  document.querySelectorAll('[data-preset]').forEach(b => {
    b.addEventListener('click', () => {
      const p = PRESETS[Number(b.dataset.preset)];
      document.getElementById('rcn-title').value = p.title;
      document.getElementById('rcn-min').value = p.minutes;
    });
  });

  // v383 共有 member_picker。 lockMembers の時は pool を制限し bulk を出さない。
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer: lockMembers ? null : document.getElementById('rcn-bulk'),
      chipsContainer: document.getElementById('rcn-members'),
      initial: presetMembers,
      poolIds: lockMembers ? presetMembers : null,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('rcn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('rcn-save').addEventListener('click', async () => {
    const title = document.getElementById('rcn-title').value.trim();
    const body  = document.getElementById('rcn-body').value.trim();
    const min   = Math.max(1, Math.min(1440, parseInt(document.getElementById('rcn-min').value, 10) || 0));
    if (!title) { toast('タイトル必須'); return; }
    const targetIds = picker ? [...picker.getSelected()] : [];
    if (!targetIds.length) { toast('対象者を 1 人以上'); return; }
    // 現在時刻 + min 分 を ISO datetime-local 形式へ。
    const dl = new Date(Date.now() + min * 60_000);
    const pad = n => String(n).padStart(2, '0');
    const deadline = `${dl.getFullYear()}-${pad(dl.getMonth()+1)}-${pad(dl.getDate())}T${pad(dl.getHours())}:${pad(dl.getMinutes())}`;
    try {
      const r = await post('/api/rollcalls', {
        title, body, deadline_at: deadline, target_ids: targetIds,
      });
      toast('点呼を開始しました');
      navigate('#/rollcalls/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

let rcCountdownTimer = null;
let rcRefreshTimer = null;
let rcLastDeadline = null;
let rcLastTargets = null;

export async function renderRollCallDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/rollcalls" class="hint">← 一覧</a>
      <div id="rcd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card" id="rcd-respond-card" hidden>
      <h3 style="margin:0 0 6px" id="rcd-respond-title">応答</h3>
      <label class="field"><span class="lbl">メモ (任意 — 例: 起きました / あと 5 分)</span>
        <input type="text" id="rcd-note" maxlength="300" placeholder="">
      </label>
      <button id="rcd-respond" class="primary" style="width:100%; padding:10px; font-size:16px">📣 応答する</button>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px; display:flex; align-items:baseline; gap:8px">
        <span>対象者</span>
        <span class="hint-sm" id="rcd-status"></span>
      </h3>
      <div id="rcd-targets" class="list"></div>
    </div>
    <div class="card" id="rcd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="rcd-remind" class="btn">📣 未応答者に催促</button>
        <button id="rcd-close" class="btn primary">🏁 点呼を終了</button>
        <button id="rcd-del"   class="danger">削除</button>
      </div>
    </div>
  `;
  if (rcCountdownTimer) { clearInterval(rcCountdownTimer); rcCountdownTimer = null; }
  if (rcRefreshTimer)   { clearTimeout(rcRefreshTimer); rcRefreshTimer = null; }
  await loadRollCallDetail(id);
}

async function loadRollCallDetail(id) {
  try {
    const d = await get('/api/rollcalls/' + id);
    const r = d.rollcall;
    const isOpen = r.status === 'open';
    const head = document.getElementById('rcd-head');
    // v482 #70 「点呼 を 押して から の 経過 時間」 を 主表示 に。 締切 は
    //   横 に 「(締切 HH:MM)」 として 副表示。
    head.innerHTML = `
      <div class="row center" style="gap:8px">
        <h2 style="margin:6px 0 0; flex:1">${escapeHtml(r.title)}</h2>
        ${d.is_creator && isOpen ? '<button id="rcd-edit-btn" class="btn">✏️ 編集</button>' : ''}
      </div>
      <div class="meta">
        起案 ${escapeHtml(r.creator_name)} · ${isOpen ? '受付中' : '締切済'}
      </div>
      <div id="rcd-deadline" class="meta" data-started="${escapeHtml(r.created_at || '')}" data-deadline="${escapeHtml(r.deadline_at)}">
        ${isOpen ? escapeHtml(fmtElapsed(r.created_at)) + (r.deadline_at ? ' (' + escapeHtml(fmtRemaining(r.deadline_at)) + ' / 締切 ' + escapeHtml(deadlineShort(r.deadline_at)) + ')' : '')
                 : '締切済'}
      </div>
      ${r.body ? `<div style="margin-top:6px; white-space:pre-wrap">${escapeHtml(r.body)}</div>` : ''}
      <div id="rcd-edit-card" hidden style="margin-top:8px; padding:8px; background:#f7f7fc; border-radius:6px">
        <label class="field"><span class="lbl">タイトル</span>
          <input type="text" id="rcd-edit-title" maxlength="200">
        </label>
        <label class="field"><span class="lbl">本文 (任意)</span>
          <input type="text" id="rcd-edit-body" maxlength="500">
        </label>
        <label class="field"><span class="lbl">締切 (日時)</span>
          <input type="datetime-local" id="rcd-edit-deadline">
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
          <button id="rcd-edit-cancel" class="btn">キャンセル</button>
          <button id="rcd-edit-save" class="primary">保存</button>
        </div>
      </div>
    `;
    rcLastDeadline = r.deadline_at;
    if (isOpen) {
      const updateCountdown = () => {
        const el = document.getElementById('rcd-deadline');
        if (!el) return;
        // 締切 まで 来た ら 自動 で 再 読込 (server 側 で autoclose)。
        const dlMs = new Date(String(el.dataset.deadline).replace(' ', 'T')) - new Date();
        if (dlMs <= 0) {
          el.textContent = '締切';
          clearInterval(rcCountdownTimer);
          loadRollCallDetail(id);
          return;
        }
        el.textContent = `${fmtElapsed(el.dataset.started)} (${fmtRemaining(el.dataset.deadline)} / 締切 ${deadlineShort(el.dataset.deadline)})`;
      };
      updateCountdown();
      rcCountdownTimer = setInterval(updateCountdown, 1000);
    }

    // 応答カード
    const respCard = document.getElementById('rcd-respond-card');
    const myDone = d.my_response && d.my_response.responded_at;
    if (d.is_target && isOpen) {
      respCard.hidden = false;
      document.getElementById('rcd-respond-title').textContent =
        myDone ? '応答を更新' : '応答する';
      document.getElementById('rcd-respond').textContent =
        myDone ? '📣 応答を更新' : '📣 応答する';
      document.getElementById('rcd-note').value = (d.my_response && d.my_response.note) || '';
      document.getElementById('rcd-respond').addEventListener('click', async () => {
        const note = document.getElementById('rcd-note').value.trim();
        try {
          await post(`/api/rollcalls/${id}/respond`, { note });
          toast('応答しました');
          await loadRollCallDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    } else {
      respCard.hidden = true;
    }

    renderRollCallTargets(d);
    rcLastTargets = d.targets;
    schedRollCallRefresh(id, isOpen);

    // v651 編集 (起案者 + open のみ)。 タイトル / 本文 / 締切 を 変更。
    const editBtn = document.getElementById('rcd-edit-btn');
    if (editBtn) {
      const editCard = document.getElementById('rcd-edit-card');
      const titleI = document.getElementById('rcd-edit-title');
      const bodyI = document.getElementById('rcd-edit-body');
      const dlI = document.getElementById('rcd-edit-deadline');
      editBtn.addEventListener('click', () => {
        titleI.value = r.title || '';
        bodyI.value = r.body || '';
        // 現在 締切 を datetime-local 値 に。 "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM"
        const raw = String(r.deadline_at || '').replace(' ', 'T');
        dlI.value = raw ? raw.slice(0, 16) : '';
        editCard.hidden = false;
        editBtn.disabled = true;
      });
      document.getElementById('rcd-edit-cancel').addEventListener('click', () => {
        editCard.hidden = true;
        editBtn.disabled = false;
      });
      document.getElementById('rcd-edit-save').addEventListener('click', async () => {
        const title = titleI.value.trim();
        const body  = bodyI.value.trim();
        const dl    = dlI.value;
        if (!title) { toast('タイトル必須'); return; }
        if (!dl)    { toast('締切必須');   return; }
        try {
          await patch('/api/rollcalls/' + id, { title, body, deadline_at: dl });
          toast('更新しました');
          editCard.hidden = true;
          editBtn.disabled = false;
          await loadRollCallDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }

    // 管理ボタン (起案者のみ)
    if (d.is_creator) {
      const adminCard = document.getElementById('rcd-admin-card');
      adminCard.hidden = false;
      document.getElementById('rcd-close').disabled = !isOpen;
      document.getElementById('rcd-close').addEventListener('click', async () => {
        if (!confirm('この点呼を終了しますか?')) return;
        try {
          await patch(`/api/rollcalls/${id}/close`, {});
          toast('終了しました');
          await loadRollCallDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('rcd-remind').addEventListener('click', async () => {
        const unr = (rcLastTargets || d.targets).filter(t => !t.has_responded).length;
        if (!confirm(`未応答の ${unr} 人に通知を送りますか?`)) return;
        try {
          const r = await post(`/api/rollcalls/${id}/remind`, {});
          toast(`${r.sent} 人に送りました`);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('rcd-del').addEventListener('click', async () => {
        if (!confirm('この点呼を削除しますか?')) return;
        try {
          await del('/api/rollcalls/' + id);
          toast('削除しました');
          navigate('#/rollcalls');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('rcd-head').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRollCallTargets(d) {
  rcLastTargets = d.targets;
  const responded = d.targets.filter(t => t.has_responded).length;
  const total = d.targets.length;
  const status = document.getElementById('rcd-status');
  if (status) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    status.textContent = `${responded}/${total} 応答 · (${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} 更新)`;
  }
  const root = document.getElementById('rcd-targets');
  if (!root) return;
  // 応答済を上に、 未応答を下に。 グループ内では 学年順 (server がもう並べてる)。
  const sorted = [...d.targets].sort((a, b) => (a.has_responded ? 0 : 1) - (b.has_responded ? 0 : 1));
  root.innerHTML = sorted.map(t => {
    const time = t.responded_at ? String(t.responded_at).slice(11, 16) : '';
    const noteHtml = t.note
      ? `<div class="meta" style="white-space:pre-wrap">${escapeHtml(t.note)}</div>`
      : '';
    return `
      <div class="list-item" style="gap:8px; align-items:center; ${t.has_responded ? 'background:#f4faf5' : 'opacity:0.7'}">
        ${avatarHtml(t.display_name, t.avatar_url, 'sm')}
        <div class="grow" style="min-width:0">
          <div class="bold" style="font-size:13px">
            ${escapeHtml(t.display_name)}
            ${t.grade ? `<span class="muted" style="font-size:11px; font-weight:400">[${escapeHtml(t.grade)}]</span>` : ''}
          </div>
          ${noteHtml}
        </div>
        <div style="font-size:12px; color:${t.has_responded ? '#2e7d32' : '#888'}; flex-shrink:0">
          ${t.has_responded ? `✓ ${time}` : '未応答'}
        </div>
      </div>`;
  }).join('');
  const remindBtn = document.getElementById('rcd-remind');
  if (remindBtn) {
    const unr = total - responded;
    remindBtn.disabled = d.rollcall.status !== 'open' || unr === 0;
    remindBtn.textContent = `📣 未応答者に催促 (${unr})`;
  }
}

function pickRefreshIntervalRC() {
  if (!rcLastDeadline) return 60_000;
  const diff = new Date(String(rcLastDeadline).replace(' ', 'T')) - new Date();
  if (diff <= 0) return 0;
  if (diff < 2 * 60 * 1000) return 3_000;    // 2 分以内: 3 秒
  if (diff < 10 * 60 * 1000) return 10_000;  // 10 分以内: 10 秒
  return 30_000;                             // それ以上: 30 秒
}

function schedRollCallRefresh(id, isOpen) {
  if (rcRefreshTimer) { clearTimeout(rcRefreshTimer); rcRefreshTimer = null; }
  const ms = isOpen ? pickRefreshIntervalRC() : 0;
  if (!ms) return;
  rcRefreshTimer = setTimeout(async () => {
    try {
      const d = await get('/api/rollcalls/' + id);
      renderRollCallTargets(d);
      const stillOpen = d.rollcall?.status === 'open';
      if (!stillOpen) return;
      rcLastDeadline = d.rollcall.deadline_at;
      schedRollCallRefresh(id, true);
    } catch {
      schedRollCallRefresh(id, isOpen);
    }
  }, ms);
}
