// /#/polls — 投票 (Polls) のリスト + 詳細 + 作成。
//   visibility:
//     creator        — 集計は起案者のみ
//     open           — 投票した瞬間から全員に集計が見える
//     after_deadline — 締切後に全員に集計が見える (デフォルト)
//   個人の票は どの visibility でも他人には見せない。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { tag, fmtDateTime } from '../format.js';

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
        <h2 style="margin:0">投票・アンケート</h2>
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
        '<div class="empty">投票・アンケートはまだありません</div>';
      return;
    }
    document.getElementById('polls-list').innerHTML = items.map(p => {
      const closed = p.status === 'closed';
      const youCreated = Number(p.creator_user_id) === Number(state.me?.id);
      const tags = [];
      if (closed) tags.push(tag('muted', '締切済'));
      else        tags.push('<span class="tag" style="background:#e3f2fd; color:#1565c0">受付中</span>');
      if (p.is_voter && !p.has_voted && !closed) tags.push('<span class="tag" style="background:#fff3e0; color:#e65100">未投票</span>');
      if (p.is_voter && p.has_voted) tags.push(tag('ok', '投票済'));
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

// 作成 / 編集 共通のフォーム本体 HTML。 初期値は createMode の時 default、
// editMode の時 既存値。
function pollFormCardHtml(initial, isEdit) {
  return `
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="pn-title" maxlength="200" placeholder="例: 飲み会の店、 どこにする?" value="${escapeHtml(initial.title || '')}" autofocus>
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <textarea id="pn-body" rows="2" maxlength="2000" placeholder="補足説明など">${escapeHtml(initial.body || '')}</textarea>
      </label>
      <label class="field"><span class="lbl">締切</span>
        <input type="datetime-local" id="pn-deadline" value="${escapeHtml(initial.deadline || '')}">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="pn-multi" ${initial.multi ? 'checked' : ''}><span class="slider"></span></span>
        <span>複数選択可</span>
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="pn-revote" ${initial.allowRevote ? 'checked' : ''}><span class="slider"></span></span>
        <span>再投票を許可する <span class="hint-sm">— OFF にすると 1 回投票したら変更不可</span></span>
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0" id="pn-ft-row" hidden>
        <span class="switch"><input type="checkbox" id="pn-ft" ${initial.allowFreeText ? 'checked' : ''}><span class="slider"></span></span>
        <span>自由記述も受ける <span class="hint-sm">— 候補に該当が無い時に文章で答えられる (複数選択 ON 時のみ)</span></span>
      </label>
      <label class="field"><span class="lbl">集計の見え方</span>
        <select id="pn-vis">
          <option value="after_deadline" ${initial.visibility === 'after_deadline' ? 'selected' : ''}>${VIS_LABEL.after_deadline}</option>
          <option value="open"           ${initial.visibility === 'open' ? 'selected' : ''}>${VIS_LABEL.open}</option>
          <option value="creator"        ${initial.visibility === 'creator' ? 'selected' : ''}>${VIS_LABEL.creator}</option>
        </select>
      </label>
      <label class="field"><span class="lbl">選択肢 (1 行に 1 つ、 2 個以上)</span>
        <textarea id="pn-options" rows="5" placeholder="例:&#10;A 店&#10;B 店&#10;C 店">${escapeHtml((initial.options || []).join('\n'))}</textarea>
        ${isEdit ? `<div class="hint-sm">既存ラベルと一致する行はそのまま残ります (票も維持)。 削除した行の票は消えます。</div>` : ''}
      </label>
      <div class="field">
        <span class="lbl">対象者</span>
        <div id="pn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="pn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
        ${isEdit ? `<div class="hint-sm">対象から外したメンバーの票は削除されます。</div>` : ''}
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="${isEdit ? '#/polls/' + initial.id : '#/polls'}" class="btn">キャンセル</a>
        <button id="pn-save" class="primary">${isEdit ? '保存' : '作成'}</button>
      </div>
    </div>
  `;
}

// フォームに 自由記述行 連動 + 締切デフォルト + メンバー チップ + save ハンドラを wire-up。
async function wirePollForm(initial, isEdit, onSave, opts = {}) {
  const multiEl = document.getElementById('pn-multi');
  const ftRow = document.getElementById('pn-ft-row');
  const syncFtRow = () => {
    ftRow.hidden = !multiEl.checked;
    if (!multiEl.checked) document.getElementById('pn-ft').checked = false;
  };
  multiEl.addEventListener('change', syncFtRow);
  syncFtRow();

  if (!isEdit && !initial.deadline) {
    // 締切デフォルト: 翌日 18:00 (作成時のみ)。
    const def = new Date(); def.setDate(def.getDate() + 1); def.setHours(18, 0, 0, 0);
    const p = n => String(n).padStart(2, '0');
    document.getElementById('pn-deadline').value =
      `${def.getFullYear()}-${p(def.getMonth()+1)}-${p(def.getDate())}T${p(def.getHours())}:${p(def.getMinutes())}`;
  }

  let allUsers = [];
  const selected = new Set((initial.voterIds || []).map(Number));
  // lockedIds: グループから飛んできた時は そのグループメンバーだけを
  // 選択候補に出す (= 普段やりとりしない人を出さない)。
  const lockedIds = opts.lockedToIds && opts.lockedToIds.length ? new Set(opts.lockedToIds.map(Number)) : null;
  try {
    const u = await get('/api/users');
    let pool = u.items || [];
    if (lockedIds) pool = pool.filter(x => lockedIds.has(Number(x.id)));
    allUsers = [...pool].sort((a, b) => {
      const d = gradeRank(a.grade) - gradeRank(b.grade);
      if (d !== 0) return d;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    if (!isEdit && state.me?.id) selected.add(Number(state.me.id));   // 作成時は自分をデフォ ON
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
    const allowRevote = document.getElementById('pn-revote').checked;
    const allowFreeText = document.getElementById('pn-ft').checked;
    const vis   = document.getElementById('pn-vis').value;
    const optsRaw = document.getElementById('pn-options').value;
    const opts = optsRaw.split(/\r?\n/).map(s => s.trim()).filter(s => s.length).slice(0, 30);
    if (!title) { toast('タイトル必須'); return; }
    if (!deadline) { toast('締切必須'); return; }
    if (opts.length < 2) { toast('選択肢を 2 つ以上'); return; }
    if (!selected.size) { toast('対象者を 1 人以上'); return; }
    try {
      await onSave({
        title, body, deadline_at: deadline, multi_select: multi,
        allow_revote: allowRevote, allow_free_text: allowFreeText,
        visibility: vis, options: opts, voter_ids: [...selected],
      });
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderPollNew({ query } = {}) {
  // グループ詳細から ?members=1,2,3&title=... で飛んで来た時の初期値。
  const rawMembers = String(query?.members || '').trim();
  const presetVoters = rawMembers
    ? rawMembers.split(',').map(Number).filter(Boolean)
    : [];
  const presetTitle  = String(query?.title || '').trim();
  const initial = {
    title: presetTitle, body: '', deadline: '', multi: false,
    allowRevote: true, allowFreeText: false,
    visibility: 'after_deadline', options: [],
    voterIds: presetVoters,
  };
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/polls" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">投票・アンケートを作る</h2>
    </div>
    ${pollFormCardHtml(initial, false)}
  `;
  // wirePollForm の isEdit=false で 「自分をデフォ ON」 がかかるが、 グループから来た
  // 場合は そちらの voterIds を優先したい → isEdit=true 相当として渡す。
  await wirePollForm(initial, presetVoters.length > 0, async (payload) => {
    const r = await post('/api/polls', payload);
    toast('作成しました');
    navigate('#/polls/' + r.id);
  }, { lockedToIds: presetVoters });
}

// /#/polls/:id/edit — 投票編集 (起案者のみ)。
export async function renderPollEdit({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/polls/${id}" class="hint">← 詳細</a>
      <h2 style="margin:6px 0 0">投票・アンケートを編集</h2>
      <div id="pe-status" class="muted" style="font-size:13px">読み込み中…</div>
    </div>
    <div id="pe-form"></div>
  `;
  try {
    const d = await get('/api/polls/' + id);
    if (!d.is_creator) {
      document.getElementById('pe-status').innerHTML =
        '<span style="color:var(--danger)">起案者のみ編集できます。</span>';
      return;
    }
    document.getElementById('pe-status').textContent = '';
    // datetime-local 用に「YYYY-MM-DDTHH:MM」 へ。
    const dl = String(d.poll.deadline_at || '').slice(0, 16).replace(' ', 'T');
    const initial = {
      id,
      title: d.poll.title,
      body: d.poll.body || '',
      deadline: dl,
      multi: !!d.poll.multi_select,
      allowRevote: !!d.poll.allow_revote,
      allowFreeText: !!d.poll.allow_free_text,
      visibility: d.poll.visibility,
      options: d.options.map(o => o.label),
      voterIds: d.voters.map(v => v.user_id),
    };
    document.getElementById('pe-form').innerHTML = pollFormCardHtml(initial, true);
    await wirePollForm(initial, true, async (payload) => {
      await patch('/api/polls/' + id, payload);
      toast('保存しました');
      navigate('#/polls/' + id);
    });
  } catch (e) {
    document.getElementById('pe-status').innerHTML = `<span style="color:var(--danger)">${escapeHtml(e.message)}</span>`;
  }
}

let countdownTimer = null;
let tallyRefreshTimer = null;
let lastDeadline = null;     // 直近 detail の締切。 refresh 間隔判定に使う。
let lastVotersSnapshot = null; // 自動更新中の click ハンドラから 直近の voters を読むため。

export async function renderPollDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/polls" class="hint">← 一覧</a>
      <div id="pd-head"><div class="muted">読み込み中…</div></div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button id="pd-copy-url" class="btn">🔗 URL をコピー</button>
      </div>
    </div>
    <div class="card" id="pd-vote-card" hidden>
      <h3 style="margin:0 0 6px" id="pd-vote-title">投票</h3>
      <div id="pd-options" class="list"></div>
      <div id="pd-ft-wrap" hidden style="margin-top:8px">
        <label class="field"><span class="lbl">自由記述 <span class="hint-sm">— 候補を選ばずにここだけ書いて投票も可</span></span>
          <textarea id="pd-ft" rows="2" maxlength="2000" placeholder="候補に該当が無いときの自由回答 (任意)"></textarea>
        </label>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <button id="pd-vote-save" class="primary">投票する</button>
      </div>
    </div>
    <div class="card" id="pd-voted-card" hidden>
      <div class="muted" style="font-size:13px">投票済 (再投票は許可されていません)</div>
    </div>
    <div class="card" id="pd-tally-card" hidden>
      <h3 style="margin:0 0 6px; display:flex; align-items:baseline; gap:8px">
        <span>集計</span>
        <span class="hint-sm" id="pd-tally-updated"></span>
      </h3>
      <div id="pd-tally"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">対象者</h3>
      <div id="pd-voters" class="row" style="gap:6px; flex-wrap:wrap"></div>
    </div>
    <div class="card" id="pd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <a id="pd-edit" class="btn" href="#/polls/${id}/edit">✏️ 編集</a>
        <button id="pd-remind" class="btn">📣 未投票者に催促</button>
        <button id="pd-close" class="btn">締切る</button>
        <button id="pd-del"   class="danger">削除</button>
      </div>
    </div>
  `;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (tallyRefreshTimer) { clearTimeout(tallyRefreshTimer); tallyRefreshTimer = null; }
  // URL コピー (ページが描かれた時点で 1 回だけ wire-up。 ボタン自体は常設)。
  document.getElementById('pd-copy-url')?.addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#/polls/' + id;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL をコピーしました');
    } catch (_) {
      // clipboard API が無い環境 (古い iOS / 非 https) は textarea で fallback。
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); toast('URL をコピーしました'); }
      catch (e) { toast('コピー失敗: ' + e.message); }
      finally { document.body.removeChild(ta); }
    }
  });
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

    // 投票カード。 再投票禁止 + 既に投票済の場合は投票 UI 非表示にし 「投票済」 カード表示。
    const voteCard = document.getElementById('pd-vote-card');
    const votedCard = document.getElementById('pd-voted-card');
    const alreadyVoted = d.my_votes.length > 0 || (d.my_free_text && d.my_free_text.length > 0);
    const canVote = d.is_voter && isOpen && (p.allow_revote || !alreadyVoted);
    if (canVote) {
      voteCard.hidden = false;
      votedCard.hidden = true;
      const inputType = p.multi_select ? 'checkbox' : 'radio';
      document.getElementById('pd-options').innerHTML = d.options.map(o => `
        <label class="list-item" style="cursor:pointer">
          <input type="${inputType}" name="pd-opt" value="${o.id}" ${d.my_votes.includes(o.id) ? 'checked' : ''}>
          <span class="grow">${escapeHtml(o.label)}</span>
        </label>`).join('');
      document.getElementById('pd-vote-title').textContent =
        alreadyVoted ? '投票し直す' : (p.multi_select ? '投票 (複数可)' : '投票');
      // 保存ボタンの文言も同期。 投票済 + 再投票可 = 「投票し直す」。
      document.getElementById('pd-vote-save').textContent =
        alreadyVoted ? '投票し直す' : '投票する';
      // 自由記述 (複数選択 + allow_free_text)
      const ftWrap = document.getElementById('pd-ft-wrap');
      const ftInput = document.getElementById('pd-ft');
      if (p.multi_select && p.allow_free_text) {
        ftWrap.hidden = false;
        ftInput.value = d.my_free_text || '';
      } else {
        ftWrap.hidden = true;
      }
      document.getElementById('pd-vote-save').addEventListener('click', async () => {
        const ids = Array.from(document.querySelectorAll('#pd-options input:checked'))
          .map(i => Number(i.value));
        const freeText = (p.multi_select && p.allow_free_text && ftInput) ? ftInput.value.trim() : '';
        if (!ids.length && !(p.multi_select && p.allow_free_text && freeText)) {
          toast(p.allow_free_text ? '選択肢を選ぶか、 自由記述を書いてください' : '1 つ以上選んでください');
          return;
        }
        try {
          await post(`/api/polls/${id}/vote`, { option_ids: ids, free_text: freeText });
          toast('投票しました');
          if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
          await loadPollDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    } else {
      voteCard.hidden = true;
      votedCard.hidden = !(d.is_voter && alreadyVoted && !p.allow_revote);
    }

    // 集計カード (本体描画は専用関数に切り出し、 自動更新でも再利用)。
    renderTallySection(d);
    // 対象者 (学年順)。 投票済の色付け + 「催促 (N)」 のカウントを 自動更新でも反映。
    renderVotersSection(d);
    // 締切と (集計 + 対象者) の自動更新スケジュール。
    lastDeadline = p.deadline_at;
    schedulePollRefresh(id, isOpen);

    // 管理ボタン
    if (isCreator) {
      const adminCard = document.getElementById('pd-admin-card');
      adminCard.hidden = false;
      const remindBtn = document.getElementById('pd-remind');
      remindBtn.addEventListener('click', async () => {
        const unvotedNow = (lastVotersSnapshot || d.voters).filter(v => !v.has_voted).length;
        if (!confirm(`未投票の ${unvotedNow} 人に通知を送りますか?`)) return;
        try {
          const r = await post(`/api/polls/${id}/remind`, {});
          toast(`${r.sent} 人に送りました`);
        } catch (e) { toast('失敗: ' + e.message); }
      });
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

// 集計セクションだけを描画 (URL コピーや投票 UI を触らないので 入力フォーカスを壊さない)。
// 表示ルール:
//   ・「N 票 (P%)」 の P = N / 回答済み人数 × 100
//     (複数選択時は 1 人で複数票入るので 「総票数 ÷ 」 だと違和感がある)
//   ・棒グラフの長さ = N / 対象者総数 × 100
//     (= 「対象の何割がコレを支持してるか」 一目で見える)
//   ・ヘッダ右に 「X/Y 人回答 · (HH:MM:SS 更新)」
function renderTallySection(d) {
  const tallyCard = document.getElementById('pd-tally-card');
  if (!tallyCard) return;
  if (!d.tally_visible || !d.tallies) {
    tallyCard.hidden = true;
    return;
  }
  tallyCard.hidden = false;
  const totalPeople  = d.voters.length;
  const votedPeople  = d.voters.filter(v => v.has_voted).length;
  const denomText    = votedPeople || 1;      // 0 除算回避 (回答者ゼロの間は P=0%)
  let html = d.options.map(o => {
    const n = d.tallies[o.id] || 0;
    const pctText = votedPeople ? Math.round((n / denomText) * 100) : 0;
    const pctBar  = totalPeople ? Math.round((n / totalPeople) * 100) : 0;
    return `
      <div style="margin-bottom:6px">
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:2px">
          <span>${escapeHtml(o.label)}</span>
          <span class="muted">${n} 票 (回答者の ${pctText}%)</span>
        </div>
        <div style="background:#eee; height:8px; border-radius:4px; overflow:hidden">
          <div style="background:var(--primary); height:100%; width:${pctBar}%"></div>
        </div>
      </div>`;
  }).join('');
  if (Array.isArray(d.free_texts) && d.free_texts.length) {
    html += `<div style="margin-top:12px">
      <div class="bold" style="font-size:13px; margin-bottom:4px">自由記述 (${d.free_texts.length} 件)</div>
      ${d.free_texts.map(t => `
        <div class="list-item" style="flex-direction:column; align-items:stretch; gap:4px; padding:6px 8px; font-size:13px">
          <div style="display:flex; align-items:center; gap:6px">
            ${avatarHtml(t.display_name, t.avatar_url, 'sm')}
            <span class="bold" style="font-size:12px">${escapeHtml(t.display_name)}</span>
          </div>
          <div style="white-space:pre-wrap; padding-left:28px">${escapeHtml(t.body)}</div>
        </div>`).join('')}
    </div>`;
  }
  html += `<div class="hint-sm" style="margin-top:8px">棒グラフは対象者 ${totalPeople} 人に対する割合。</div>`;
  document.getElementById('pd-tally').innerHTML = html;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const updated = document.getElementById('pd-tally-updated');
  if (updated) updated.textContent =
    `${votedPeople}/${totalPeople} 人回答 · (${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} 更新)`;
}

// 対象者リスト + 「催促 (N)」 のカウントを描画。 自動更新でも投票済の色付けと
// remind ボタンの数字を最新化したい。
function renderVotersSection(d) {
  lastVotersSnapshot = d.voters;
  const root = document.getElementById('pd-voters');
  if (root) {
    root.innerHTML = d.voters.map(v => `
      <span class="presence-pill" style="${v.has_voted ? 'background:#e8f5e9; border:1px solid #66bb6a' : ''}">
        ${avatarHtml(v.display_name, v.avatar_url, 'sm')}
        <span class="presence-pill-name">${escapeHtml(v.display_name)}</span>
        ${v.grade ? `<span class="muted" style="font-size:11px">[${escapeHtml(v.grade)}]</span>` : ''}
        ${v.has_voted ? '<span style="color:#2e7d32; font-size:11px">✓</span>' : ''}
      </span>`).join('');
  }
  const remindBtn = document.getElementById('pd-remind');
  if (remindBtn) {
    const unvoted = d.voters.filter(v => !v.has_voted).length;
    const isOpen = d.poll?.status === 'open';
    remindBtn.disabled = !isOpen || unvoted === 0;
    remindBtn.textContent = `📣 未投票者に催促 (${unvoted})`;
  }
}

// 締切までの残り時間で更新間隔を決める。 締切過ぎ / 集計不可視 (詳細レスポンス
// で tally_visible=false) のときは止める。
function pickRefreshIntervalMs() {
  if (!lastDeadline) return 60_000;
  const dt = new Date(String(lastDeadline).replace(' ', 'T'));
  const remaining = dt - new Date();
  if (remaining <= 0) return 0;       // 締切過ぎ
  if (remaining < 10 * 60 * 1000) return 10_000;  // 残 10 分未満
  return 60_000;
}

function schedulePollRefresh(id, isOpen) {
  if (tallyRefreshTimer) { clearTimeout(tallyRefreshTimer); tallyRefreshTimer = null; }
  const ms = isOpen ? pickRefreshIntervalMs() : 0;
  if (!ms) return;
  tallyRefreshTimer = setTimeout(async () => {
    try {
      const d = await get('/api/polls/' + id);
      // 集計 (起案者 or 締切後 or open visibility で my_votes ありで可視) + 対象者
      // (常に表示) の両方を最新化。
      renderTallySection(d);
      renderVotersSection(d);
      const stillOpen = d.poll?.status === 'open';
      if (!stillOpen) {
        // 締切直後で 1 度反映した時点で安定。 これ以上 polling しない。
        return;
      }
      lastDeadline = d.poll.deadline_at;
      schedulePollRefresh(id, true);
    } catch {
      // 失敗しても次回試みる。
      schedulePollRefresh(id, isOpen);
    }
  }, ms);
}
