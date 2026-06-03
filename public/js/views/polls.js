// /#/polls — 投票 (Polls) のリスト + 詳細 + 作成。
//   visibility:
//     creator        — 集計は起案者のみ
//     open           — 投票した瞬間から全員に集計が見える
//     after_deadline — 締切後に全員に集計が見える (デフォルト)
//   個人の票は どの visibility でも他人には見せない。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const VIS_LABEL = {
  creator: '主催者のみ集計可視',
  open: '投票後すぐ全員に集計が見える',
  after_deadline: '締切後に全員に集計が見える (推奨)',
};

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
}

function fmtDeadline(s) {
  if (!s) return '';
  const t = s.replace(' ', 'T');
  const dt = new Date(t);
  const now = new Date();
  const diff = dt - now;
  const pad = n => String(n).padStart(2, '0');
  const base = `${dt.getMonth()+1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  if (diff <= 0) return `${base} (締切済)`;
  const hours = diff / 3600000;
  if (hours < 1) return `${base} (あと ${Math.ceil(diff / 60000)} 分)`;
  if (hours < 24) return `${base} (あと ${Math.ceil(hours)} 時間)`;
  return base;
}

export async function renderPolls() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">投票</h2>
        <a class="btn primary" href="#/polls/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        メンバーに 「これどっちにする?」 を投げて締切までに集める用。
        個人の票は誰が何に入れたか公開されない。
      </p>
    </div>
    <div id="polls-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/polls');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('polls-list').innerHTML =
        '<div class="empty">投票はまだありません</div>';
      return;
    }
    document.getElementById('polls-list').innerHTML = items.map(p => {
      const closed = p.status === 'closed';
      const youCreated = Number(p.creator_user_id) === Number(state.me?.id);
      const tags = [];
      if (closed) tags.push('<span class="tag" style="background:#eee">締切済</span>');
      else        tags.push('<span class="tag" style="background:#e3f2fd; color:#1565c0">受付中</span>');
      if (p.is_voter && !p.has_voted && !closed) tags.push('<span class="tag" style="background:#fff3e0; color:#e65100">未投票</span>');
      if (p.is_voter && p.has_voted) tags.push('<span class="tag" style="background:#e8f5e9; color:#2e7d32">投票済</span>');
      if (youCreated) tags.push('<span class="tag">主催</span>');
      return `
        <a class="list-item" href="#/polls/${p.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)}</div>
            <div class="meta">${tags.join(' ')} · 締切 ${escapeHtml(fmtDeadline(p.deadline_at))} · 起案 ${escapeHtml(p.creator_name)}</div>
            <div class="meta">${p.voted_count}/${p.voter_count} 人が投票${p.multi_select ? ' · 複数選択可' : ''}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('polls-list').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderPollNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/polls" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">投票を作る</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="pn-title" maxlength="200" placeholder="例: 飲み会の店、 どこにする?" autofocus>
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <textarea id="pn-body" rows="2" maxlength="2000" placeholder="補足説明など"></textarea>
      </label>
      <label class="field"><span class="lbl">締切</span>
        <input type="datetime-local" id="pn-deadline">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="pn-multi"><span class="slider"></span></span>
        <span>複数選択可</span>
      </label>
      <label class="field"><span class="lbl">集計の見え方</span>
        <select id="pn-vis">
          <option value="after_deadline">${VIS_LABEL.after_deadline}</option>
          <option value="open">${VIS_LABEL.open}</option>
          <option value="creator">${VIS_LABEL.creator}</option>
        </select>
      </label>
      <label class="field"><span class="lbl">選択肢 (1 行に 1 つ、 2 個以上)</span>
        <textarea id="pn-options" rows="5" placeholder="例:&#10;A 店&#10;B 店&#10;C 店"></textarea>
      </label>
      <div class="field">
        <span class="lbl">対象者</span>
        <div id="pn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="pn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/polls" class="btn">キャンセル</a>
        <button id="pn-save" class="primary">作成</button>
      </div>
    </div>
  `;
  // 締切デフォルト: 翌日 18:00。
  const def = new Date(); def.setDate(def.getDate() + 1); def.setHours(18, 0, 0, 0);
  const p = n => String(n).padStart(2, '0');
  document.getElementById('pn-deadline').value =
    `${def.getFullYear()}-${p(def.getMonth()+1)}-${p(def.getDate())}T${p(def.getHours())}:${p(def.getMinutes())}`;

  let allUsers = [];
  const selected = new Set();
  try {
    const u = await get('/api/users');
    allUsers = [...(u.items || [])].sort((a, b) => {
      const d = gradeRank(a.grade) - gradeRank(b.grade);
      if (d !== 0) return d;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    if (state.me?.id) selected.add(Number(state.me.id));   // デフォで自分は入れておく
    const presentGrades = [...new Set(allUsers.map(x => x.grade || ''))];
    const sortedGrades = GRADE_ORDER.filter(g => g !== '' && presentGrades.includes(g));
    document.getElementById('pn-bulk').innerHTML = `
      <button class="btn" data-bulk="all">全員</button>
      ${sortedGrades.map(g => `<button class="btn" data-bulk="grade" data-grade="${g}">${g}</button>`).join('')}
    `;
    document.querySelectorAll('#pn-bulk [data-bulk]').forEach(b => {
      b.addEventListener('click', () => {
        const target = b.dataset.bulk === 'grade'
          ? allUsers.filter(x => (x.grade || '') === b.dataset.grade)
          : allUsers;
        const allOn = target.every(x => selected.has(x.id));
        if (allOn) target.forEach(x => selected.delete(x.id));
        else       target.forEach(x => selected.add(x.id));
        document.querySelectorAll('#pn-members input[data-uid]').forEach(cb => {
          cb.checked = selected.has(Number(cb.dataset.uid));
        });
      });
    });
    document.getElementById('pn-members').innerHTML = allUsers.map(x => `
      <label class="rl-chip">
        <input type="checkbox" data-uid="${x.id}" ${selected.has(x.id) ? 'checked' : ''}>
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span>${escapeHtml(x.display_name)}</span>
        ${x.grade ? `<span class="muted" style="font-size:11px">[${escapeHtml(x.grade)}]</span>` : ''}
      </label>`).join('');
    document.querySelectorAll('#pn-members input[data-uid]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = Number(cb.dataset.uid);
        if (cb.checked) selected.add(uid); else selected.delete(uid);
      });
    });
  } catch (e) {
    document.getElementById('pn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('pn-save').addEventListener('click', async () => {
    const title = document.getElementById('pn-title').value.trim();
    const body  = document.getElementById('pn-body').value.trim();
    const deadline = document.getElementById('pn-deadline').value;
    const multi = document.getElementById('pn-multi').checked;
    const vis   = document.getElementById('pn-vis').value;
    const optsRaw = document.getElementById('pn-options').value;
    const opts = optsRaw.split(/\r?\n/).map(s => s.trim()).filter(s => s.length).slice(0, 30);
    if (!title) { toast('タイトル必須'); return; }
    if (!deadline) { toast('締切必須'); return; }
    if (opts.length < 2) { toast('選択肢を 2 つ以上'); return; }
    if (!selected.size) { toast('対象者を 1 人以上'); return; }
    try {
      const r = await post('/api/polls', {
        title, body, deadline_at: deadline, multi_select: multi,
        visibility: vis, options: opts, voter_ids: [...selected],
      });
      toast('作成しました');
      navigate('#/polls/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

let countdownTimer = null;

export async function renderPollDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/polls" class="hint">← 一覧</a>
      <div id="pd-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card" id="pd-vote-card" hidden>
      <h3 style="margin:0 0 6px" id="pd-vote-title">投票</h3>
      <div id="pd-options" class="list"></div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <button id="pd-vote-save" class="primary">投票する</button>
      </div>
    </div>
    <div class="card" id="pd-tally-card" hidden>
      <h3 style="margin:0 0 6px">集計</h3>
      <div id="pd-tally"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">対象者</h3>
      <div id="pd-voters" class="row" style="gap:6px; flex-wrap:wrap"></div>
    </div>
    <div class="card" id="pd-admin-card" hidden>
      <div class="row" style="gap:6px">
        <button id="pd-close" class="btn">締切る</button>
        <button id="pd-del"   class="danger">削除</button>
      </div>
    </div>
  `;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  await loadPollDetail(id);
}

async function loadPollDetail(id) {
  try {
    const d = await get('/api/polls/' + id);
    const p = d.poll;
    const isOpen = p.status === 'open';
    const isCreator = d.is_creator;
    const head = document.getElementById('pd-head');
    head.innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(p.title)}</h2>
      <div class="meta">
        起案 ${escapeHtml(p.creator_name)} · ${isOpen ? '受付中' : '締切済'} ·
        ${p.multi_select ? '複数選択可' : '単一選択'} · ${escapeHtml(VIS_LABEL[p.visibility] || p.visibility)}
      </div>
      <div id="pd-deadline" class="meta" data-deadline="${escapeHtml(p.deadline_at)}">
        締切 ${escapeHtml(fmtDeadline(p.deadline_at))}
      </div>
      ${p.body ? `<div style="margin-top:8px; white-space:pre-wrap">${escapeHtml(p.body)}</div>` : ''}
    `;
    // カウントダウン (締切まで 24h 未満なら 1 秒刻みで再描画)。
    if (isOpen) {
      const updateCountdown = () => {
        const el = document.getElementById('pd-deadline');
        if (!el) return;
        const dl = el.dataset.deadline;
        const dt = new Date(dl.replace(' ', 'T'));
        const diff = dt - new Date();
        if (diff <= 0) {
          el.textContent = '締切';
          clearInterval(countdownTimer);
          loadPollDetail(id);
          return;
        }
        if (diff < 24 * 3600 * 1000) {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          el.textContent = `締切まで ${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        } else {
          el.textContent = `締切 ${fmtDeadline(dl)}`;
        }
      };
      updateCountdown();
      countdownTimer = setInterval(updateCountdown, 1000);
    }

    // 投票カード
    const voteCard = document.getElementById('pd-vote-card');
    if (d.is_voter && isOpen) {
      voteCard.hidden = false;
      const inputType = p.multi_select ? 'checkbox' : 'radio';
      document.getElementById('pd-options').innerHTML = d.options.map(o => `
        <label class="list-item" style="cursor:pointer">
          <input type="${inputType}" name="pd-opt" value="${o.id}" ${d.my_votes.includes(o.id) ? 'checked' : ''}>
          <span class="grow">${escapeHtml(o.label)}</span>
        </label>`).join('');
      document.getElementById('pd-vote-title').textContent =
        d.my_votes.length ? '投票し直す' : (p.multi_select ? '投票 (複数可)' : '投票');
      document.getElementById('pd-vote-save').addEventListener('click', async () => {
        const ids = Array.from(document.querySelectorAll('#pd-options input:checked'))
          .map(i => Number(i.value));
        if (!ids.length) { toast('1 つ以上選んでください'); return; }
        try {
          await post(`/api/polls/${id}/vote`, { option_ids: ids });
          toast('投票しました');
          if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
          await loadPollDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    } else {
      voteCard.hidden = true;
    }

    // 集計カード
    const tallyCard = document.getElementById('pd-tally-card');
    if (d.tally_visible && d.tallies) {
      tallyCard.hidden = false;
      const total = Object.values(d.tallies).reduce((a, b) => a + b, 0) || 1;
      document.getElementById('pd-tally').innerHTML = d.options.map(o => {
        const n = d.tallies[o.id] || 0;
        const pct = Math.round((n / total) * 100);
        return `
          <div style="margin-bottom:6px">
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:2px">
              <span>${escapeHtml(o.label)}</span>
              <span class="muted">${n} 票 (${pct}%)</span>
            </div>
            <div style="background:#eee; height:8px; border-radius:4px; overflow:hidden">
              <div style="background:var(--primary); height:100%; width:${pct}%"></div>
            </div>
          </div>`;
      }).join('');
    } else {
      tallyCard.hidden = true;
    }

    // 対象者
    document.getElementById('pd-voters').innerHTML = d.voters.map(v => `
      <span class="presence-pill" style="${v.has_voted ? 'background:#e8f5e9; border:1px solid #66bb6a' : ''}">
        ${avatarHtml(v.display_name, v.avatar_url, 'sm')}
        <span class="presence-pill-name">${escapeHtml(v.display_name)}</span>
        ${v.has_voted ? '<span style="color:#2e7d32; font-size:11px">✓</span>' : ''}
      </span>`).join('');

    // 管理ボタン
    if (isCreator) {
      const adminCard = document.getElementById('pd-admin-card');
      adminCard.hidden = false;
      document.getElementById('pd-close').disabled = !isOpen;
      document.getElementById('pd-close').addEventListener('click', async () => {
        if (!confirm('この投票を締切ますか?')) return;
        try {
          await patch(`/api/polls/${id}/close`, {});
          toast('締切ました');
          await loadPollDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('pd-del').addEventListener('click', async () => {
        if (!confirm('この投票を削除しますか? (元に戻せません)')) return;
        try {
          await del('/api/polls/' + id);
          toast('削除しました');
          navigate('#/polls');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('pd-head').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
