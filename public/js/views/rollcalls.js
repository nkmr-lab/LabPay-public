// /#/rollcalls — 点呼 (roll call)。 「いる？」 「起きてる？」 をワンタップで集める。
// 投票と似てるが 選択肢が無く 「応答済 / 未応答」 のみ + 任意メモ。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

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
  if (min >= 60) return `あと ${Math.floor(min/60)}時間${min%60}分`;
  return `あと ${min}:${String(sec).padStart(2,'0')}`;
}

export async function renderRollCalls() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">点呼</h2>
        <a class="btn primary" href="#/rollcalls/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        「いる？」 「起きてる？」 をワンタップで集めるための仕組み。
      </p>
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
        : `<span class="tag" style="background:#eee">締切済</span>`);
      if (r.is_target && !r.has_responded && open) tags.push('<span class="tag" style="background:#fff3e0; color:#e65100">未応答</span>');
      if (r.is_target && r.has_responded) tags.push('<span class="tag" style="background:#e8f5e9; color:#2e7d32">応答済</span>');
      if (Number(r.creator_user_id) === Number(state.me?.id)) tags.push('<span class="tag">起案</span>');
      return `
        <a class="list-item" href="#/rollcalls/${r.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title)}</div>
            <div class="meta">${tags.join(' ')} · ${escapeHtml(fmtRemaining(r.deadline_at))} · 起案 ${escapeHtml(r.creator_name)}</div>
            <div class="meta">${r.responded_count}/${r.target_count} 人が応答</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('rc-list').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderRollCallNew() {
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
        <input type="text" id="rcn-title" maxlength="200" placeholder="例: 起きてる？" autofocus>
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <input type="text" id="rcn-body" maxlength="500" placeholder="補足 (例: 10:00 までに集合)">
      </label>
      <label class="field"><span class="lbl">締切まで (分)</span>
        <input type="number" id="rcn-min" min="1" max="1440" value="10">
      </label>
      <div class="field">
        <span class="lbl">対象者</span>
        <div id="rcn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
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

  let allUsers = [];
  const selected = new Set();
  try {
    const u = await get('/api/users');
    allUsers = [...(u.items || [])].sort((a, b) => {
      const d = gradeRank(a.grade) - gradeRank(b.grade);
      if (d !== 0) return d;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    const presentGrades = [...new Set(allUsers.map(x => x.grade || ''))];
    const sortedGrades = GRADE_ORDER.filter(g => g !== '' && presentGrades.includes(g));
    document.getElementById('rcn-bulk').innerHTML = `
      <button class="btn" data-bulk="all">全員</button>
      ${sortedGrades.map(g => `<button class="btn" data-bulk="grade" data-grade="${g}">${g}</button>`).join('')}
    `;
    document.querySelectorAll('#rcn-bulk [data-bulk]').forEach(b => {
      b.addEventListener('click', () => {
        const target = b.dataset.bulk === 'grade'
          ? allUsers.filter(x => (x.grade || '') === b.dataset.grade)
          : allUsers;
        const allOn = target.every(x => selected.has(x.id));
        if (allOn) target.forEach(x => selected.delete(x.id));
        else       target.forEach(x => selected.add(x.id));
        document.querySelectorAll('#rcn-members input[data-uid]').forEach(cb => {
          cb.checked = selected.has(Number(cb.dataset.uid));
        });
      });
    });
    document.getElementById('rcn-members').innerHTML = allUsers.map(x => `
      <label class="rl-chip">
        <input type="checkbox" data-uid="${x.id}">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span>${escapeHtml(x.display_name)}</span>
        ${x.grade ? `<span class="muted" style="font-size:11px">[${escapeHtml(x.grade)}]</span>` : ''}
      </label>`).join('');
    document.querySelectorAll('#rcn-members input[data-uid]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = Number(cb.dataset.uid);
        if (cb.checked) selected.add(uid); else selected.delete(uid);
      });
    });
  } catch (e) {
    document.getElementById('rcn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('rcn-save').addEventListener('click', async () => {
    const title = document.getElementById('rcn-title').value.trim();
    const body  = document.getElementById('rcn-body').value.trim();
    const min   = Math.max(1, Math.min(1440, parseInt(document.getElementById('rcn-min').value, 10) || 0));
    if (!title) { toast('タイトル必須'); return; }
    if (!selected.size) { toast('対象者を 1 人以上'); return; }
    // 現在時刻 + min 分 を ISO datetime-local 形式へ。
    const dl = new Date(Date.now() + min * 60_000);
    const pad = n => String(n).padStart(2, '0');
    const deadline = `${dl.getFullYear()}-${pad(dl.getMonth()+1)}-${pad(dl.getDate())}T${pad(dl.getHours())}:${pad(dl.getMinutes())}`;
    try {
      const r = await post('/api/rollcalls', {
        title, body, deadline_at: deadline, target_ids: [...selected],
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
        <button id="rcd-close" class="btn">締切る</button>
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
    head.innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(r.title)}</h2>
      <div class="meta">
        起案 ${escapeHtml(r.creator_name)} · ${isOpen ? '受付中' : '締切済'}
      </div>
      <div id="rcd-deadline" class="meta" data-deadline="${escapeHtml(r.deadline_at)}">
        締切 ${escapeHtml(fmtRemaining(r.deadline_at))}
      </div>
      ${r.body ? `<div style="margin-top:6px; white-space:pre-wrap">${escapeHtml(r.body)}</div>` : ''}
    `;
    rcLastDeadline = r.deadline_at;
    // 締切までのカウントダウン (秒刻み)
    if (isOpen) {
      const updateCountdown = () => {
        const el = document.getElementById('rcd-deadline');
        if (!el) return;
        const txt = fmtRemaining(el.dataset.deadline);
        if (txt === '締切') {
          el.textContent = '締切';
          clearInterval(rcCountdownTimer);
          loadRollCallDetail(id);
          return;
        }
        el.textContent = `締切まで ${txt.replace('あと ', '')}`;
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

    // 管理ボタン (起案者のみ)
    if (d.is_creator) {
      const adminCard = document.getElementById('rcd-admin-card');
      adminCard.hidden = false;
      document.getElementById('rcd-close').disabled = !isOpen;
      document.getElementById('rcd-close').addEventListener('click', async () => {
        if (!confirm('この点呼を締切ますか?')) return;
        try {
          await patch(`/api/rollcalls/${id}/close`, {});
          toast('締切ました');
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
