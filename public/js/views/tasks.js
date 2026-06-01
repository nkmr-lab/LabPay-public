import { get, post, patch } from '../api.js';
import { escapeHtml, avatarHtml, navigate, safeHttpUrl } from '../router.js';
import { state, toast } from '../app.js';

const GRADES = ['B3', 'B4', 'M1', 'M2', 'D'];

export async function renderTasks({ query }) {
  const filter = query?.filter || 'available';
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center">
        <h2 style="flex:1; margin:0">タスク</h2>
        <button id="task-new" class="primary">+ 出す</button>
      </div>
      <div class="row" style="gap:6px; margin-top:8px">
        <a href="#/tasks?filter=available" class="${filter==='available'?'btn primary':'btn'}">受けられる</a>
        <a href="#/tasks?filter=active"    class="${filter==='active'?'btn primary':'btn'}">進行中</a>
        <a href="#/tasks?filter=mine"      class="${filter==='mine'?'btn primary':'btn'}">自分が出した</a>
      </div>
    </div>
    <div id="task-form-card" hidden></div>
    <div id="task-list"><div class="muted">読み込み中…</div></div>
  `;

  document.getElementById('task-new').addEventListener('click', () => toggleCreateForm());
  await loadList(filter);
}

function toggleCreateForm(open = null) {
  const card = document.getElementById('task-form-card');
  const shouldOpen = open !== null ? open : card.hidden;
  if (!shouldOpen) { card.hidden = true; card.innerHTML = ''; return; }

  card.hidden = false;
  card.innerHTML = `
    <div class="card">
      <h3>タスクを出す</h3>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="t-title" maxlength="200">
      </label>
      <label class="field">
        <span class="lbl">作業 URL (任意)</span>
        <input type="url" id="t-url" maxlength="2000" placeholder="https://...">
        <div class="muted" style="font-size:12px">引き受けた人が「作業を開く」を押すと新しいタブで開きます。</div>
      </label>
      <label class="field">
        <span class="lbl">詳細 (任意)</span>
        <textarea id="t-desc" maxlength="5000" rows="3"></textarea>
      </label>
      <label class="field">
        <span class="lbl">完了時のメッセージ (任意)</span>
        <textarea id="t-cmsg" maxlength="2000" rows="2" placeholder="ありがとうございます!次もよろしくね"></textarea>
        <div class="muted" style="font-size:12px">承認時にやってくれた人へ表示されます (note 風)。</div>
      </label>
      <div class="row">
        <label class="field" style="flex:1">
          <span class="lbl">報酬 (pt / 1人あたり)</span>
          <input type="number" id="t-reward" min="1" value="10">
        </label>
        <label class="field" style="flex:1">
          <span class="lbl">募集人数</span>
          <input type="number" id="t-capacity" min="1" value="1">
        </label>
      </div>
      <label class="field">
        <span class="lbl">1人あたりの参加可能回数</span>
        <select id="t-perlimit">
          <option value="1" selected>1回まで</option>
          <option value="3">3回まで</option>
          <option value="5">5回まで</option>
          <option value="0">無制限</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">締切 (任意・無指定なら無期限)</span>
        <input type="datetime-local" id="t-deadline">
      </label>
      <div class="field">
        <span class="lbl">対象学年 (チェック無し = 全員)</span>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          ${GRADES.map(g => `
            <label class="muted" style="display:inline-flex; align-items:center; gap:4px">
              <input type="checkbox" value="${g}" class="t-aud"> ${g}
            </label>`).join('')}
        </div>
      </div>
      <div class="muted" style="font-size:12px; margin:4px 0 8px">
        報酬 × 募集人数 が ESCROW に預けられます (取り消し時は未承認分が返金されます)。
      </div>
      <div class="row">
        <button id="t-submit" class="primary">出す</button>
        <button id="t-cancel">キャンセル</button>
      </div>
    </div>
  `;
  document.getElementById('t-cancel').addEventListener('click', () => toggleCreateForm(false));
  document.getElementById('t-submit').addEventListener('click', onCreate);
}

async function onCreate() {
  const title = document.getElementById('t-title').value.trim();
  const url = document.getElementById('t-url').value.trim();
  const description = document.getElementById('t-desc').value.trim();
  const completion_message = document.getElementById('t-cmsg').value.trim();
  const reward   = Number(document.getElementById('t-reward').value);
  const capacity = Number(document.getElementById('t-capacity').value);
  const per_user_limit = Number(document.getElementById('t-perlimit').value);
  const deadline = document.getElementById('t-deadline').value || null;
  const aud = Array.from(document.querySelectorAll('.t-aud:checked')).map(el => el.value);
  if (!title || !(reward > 0) || !(capacity > 0)) { toast('入力を確認してください'); return; }
  try {
    await post('/api/tasks', {
      title,
      url: url || null,
      description: description || null,
      completion_message: completion_message || null,
      reward, capacity, per_user_limit, deadline,
      audience_grades: aud,
    });
    toast('タスクを出しました');
    toggleCreateForm(false);
    await loadList('mine');
    navigate('#/tasks?filter=mine');
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadList(filter) {
  try {
    const d = await get('/api/tasks', { filter });
    const root = document.getElementById('task-list');
    if (!d.items.length) {
      root.innerHTML = `<div class="card empty">該当するタスクはありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(t => renderRow(t, filter)).join('');
  } catch (e) {
    document.getElementById('task-list').innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRow(t, filter) {
  const audTag = t.audience_grades ? `<span class="tag muted" style="margin-left:4px">${escapeHtml(t.audience_grades)}</span>` : '';
  const statusTag = ({
    open: '<span class="tag">募集中</span>',
    closed: '<span class="tag muted">完了</span>',
    cancelled: '<span class="tag danger">取消</span>',
  })[t.status] || '';
  const deadlineTag = t.deadline ? `<span class="tag warn" style="margin-left:4px">締切 ${escapeHtml(t.deadline)}</span>` : '';

  let progressLine = '';
  if (t.approved_count !== undefined) {
    progressLine = `<div class="meta">承認 ${t.approved_count} / ${t.capacity}人${t.pending_count ? ` · 報告待ち ${t.pending_count}` : ''}</div>`;
  }
  if (filter === 'active' && t.my_status) {
    const lbl = t.my_status === 'claimed' ? '引き受け中 (完了報告まち)'
              : t.my_status === 'reported' ? '報告済み (承認まち)'
              : '';
    progressLine = `<div class="meta">${lbl}</div>`;
  }

  return `
    <div class="card" style="display:flex; gap:10px; align-items:flex-start">
      ${avatarHtml(t.requester_name, t.requester_avatar_url, 'md')}
      <div style="flex:1">
        <div>
          <a class="bold" href="#/tasks/${t.id}">${escapeHtml(t.title)}</a>
          ${statusTag}${audTag}${deadlineTag}
        </div>
        <div class="meta">${escapeHtml(t.requester_name)} · ${t.reward}pt × ${t.capacity}人${t.per_user_limit === 0 ? ' (各自無制限)' : (t.per_user_limit > 1 ? ` (各自 ${t.per_user_limit}回まで)` : '')}</div>
        ${progressLine}
      </div>
    </div>`;
}

// ==================== Task detail (#/tasks/:id) ====================

export async function renderTaskDetail({ params }) {
  const id = params.id;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><a href="#/tasks">← タスク一覧</a></div><div id="task-detail"><div class="muted">読み込み中…</div></div>`;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const t = await get('/api/tasks/' + id);
    const root = document.getElementById('task-detail');
    const meId = state.me?.id;
    const isRequester = meId === Number(t.requester_user_id);
    const myActive = (t.my_claims || []).filter(c => ['claimed','reported','approved'].includes(c.status));
    const myLastClaim = (t.my_claims || []).find(c => ['claimed','reported'].includes(c.status));

    // Has THIS user already been approved on this task? If so, surface the requester's
    // thank-you message (note-style).
    const myApproved = (t.my_claims || []).find(c => c.status === 'approved');

    let actions = '';
    if (!isRequester && t.status === 'open') {
      const canClaim = t.remaining > 0
        && (t.per_user_limit === 0 || myActive.length < t.per_user_limit);
      if (myLastClaim) {
        if (myLastClaim.status === 'claimed') {
          const safeUrl = safeHttpUrl(t.url);
          const openBtn = safeUrl
            ? `<a class="btn primary" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">作業を開く ↗</a>`
            : '';
          actions = `
            ${openBtn}
            <textarea id="report-notes" maxlength="2000" placeholder="完了内容や気づき (任意) — 実験で問題があった点なども" rows="3" style="margin-top:6px; width:100%; box-sizing:border-box"></textarea>
            <button id="report-btn" class="primary" data-claim="${myLastClaim.id}">完了報告</button>`;
        } else if (myLastClaim.status === 'reported') {
          actions = `<div class="muted">承認待ち</div>`;
        }
      } else if (canClaim) {
        actions = `<button id="claim-btn" class="primary">これを引き受ける</button>`;
      } else if (t.remaining === 0) {
        actions = `<div class="muted">定員に達しています</div>`;
      } else {
        actions = `<div class="muted">引き受け上限/対象外で受けられません</div>`;
      }
    }

    if (isRequester && t.status === 'open') {
      actions += `
        <div class="row" style="margin-top:6px; gap:6px">
          <button id="edit-task">編集</button>
          <button id="cancel-task" class="danger">取り消す</button>
        </div>`;
    }

    const safeDetailUrl = safeHttpUrl(t.url);
    const urlBlock = safeDetailUrl
      ? `<div style="margin-top:6px">
           <a href="${escapeHtml(safeDetailUrl)}" target="_blank" rel="noopener noreferrer" class="bold" style="color:var(--primary)">
             🔗 ${escapeHtml(safeDetailUrl)} ↗
           </a>
         </div>`
      : '';
    const thankBlock = (myApproved && t.completion_message)
      ? `<div class="card" style="border-left:4px solid var(--primary); background:#faf6ff">
           <div class="bold" style="margin-bottom:4px">${escapeHtml(t.requester_name)} さんから</div>
           <div style="white-space:pre-wrap">${escapeHtml(t.completion_message)}</div>
         </div>`
      : '';

    root.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:center; gap:10px">
          ${avatarHtml(t.requester_name, t.requester_avatar_url, 'md')}
          <div style="flex:1">
            <div class="bold" style="font-size:18px">${escapeHtml(t.title)}</div>
            <div class="meta">${escapeHtml(t.requester_name)} · ${t.created_at}</div>
          </div>
        </div>
        ${urlBlock}
        ${t.description ? `<div style="margin-top:10px; white-space:pre-wrap">${escapeHtml(t.description)}</div>` : ''}
        <div class="sep"></div>
        <div>
          <div>報酬: <span class="bold" style="color:var(--primary)">${t.reward}pt</span> × ${t.capacity}人 (残 ${t.remaining}人)</div>
          <div class="meta">
            ${t.per_user_limit === 0 ? '各自無制限' : `各自 ${t.per_user_limit} 回まで`}
            ${t.audience_grades ? ` · 対象: ${escapeHtml(t.audience_grades)}` : ''}
            ${t.deadline ? ` · 締切: ${escapeHtml(t.deadline)}` : ''}
            · 状態: ${escapeHtml(t.status)}
          </div>
        </div>
        <div style="margin-top:12px">${actions}</div>
      </div>

      ${thankBlock}

      <div id="edit-form-wrap" hidden></div>

      ${isRequester ? renderClaimsAdmin(t) : ''}
    `;

    document.getElementById('claim-btn')?.addEventListener('click', () => onClaim(id));
    document.getElementById('report-btn')?.addEventListener('click', e => onReport(id, e.currentTarget.dataset.claim));
    document.getElementById('cancel-task')?.addEventListener('click', () => onCancelTask(id));
    document.getElementById('edit-task')?.addEventListener('click', () => renderEditForm(t));
    root.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => onApprove(id, b.dataset.approve)));
    root.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => onReject(id, b.dataset.reject)));
  } catch (e) {
    document.getElementById('task-detail').innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderClaimsAdmin(t) {
  if (!t.claims) return '';
  if (t.claims.length === 0) return `<div class="card"><h3>申請</h3><div class="empty">まだ誰も引き受けていません</div></div>`;
  const rows = t.claims.map(c => `
    <div class="list-item" style="align-items:flex-start">
      <div style="flex:1; display:flex; align-items:flex-start; gap:8px">
        ${avatarHtml(c.display_name, c.avatar_url, 'sm')}
        <div style="flex:1">
          <div class="bold">${escapeHtml(c.display_name)} <span class="tag muted">${escapeHtml(c.status)}</span></div>
          ${c.notes ? `<div style="margin-top:4px; padding:6px 8px; background:#f6f3fa; border-radius:6px; white-space:pre-wrap; font-size:13px">${escapeHtml(c.notes)}</div>` : ''}
          <div class="meta">${escapeHtml(c.created_at)}${c.reported_at ? ' · 報告 ' + escapeHtml(c.reported_at) : ''}</div>
        </div>
      </div>
      ${c.status === 'reported' ? `
        <div>
          <button class="primary" data-approve="${c.id}">承認 (+${t.reward}pt)</button>
          <button class="danger" data-reject="${c.id}">却下</button>
        </div>` : ''}
    </div>`).join('');
  return `<div class="card"><h3>申請 (${t.claims.length}件)</h3><div class="list">${rows}</div></div>`;
}

async function onClaim(taskId) {
  try { await post(`/api/tasks/${taskId}/claim`, {}); toast('引き受けました'); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function onReport(taskId, claimId) {
  const notes = document.getElementById('report-notes')?.value.trim() || null;
  try { await post(`/api/tasks/${taskId}/claims/${claimId}/report`, { notes }); toast('完了報告しました'); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function onApprove(taskId, claimId) {
  if (!confirm('承認して報酬を支払いますか?')) return;
  try {
    const r = await post(`/api/tasks/${taskId}/claims/${claimId}/approve`, {});
    toast(r.completion_message
      ? '承認しました — やってくれた人へお礼メッセージを送信'
      : '承認しました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onReject(taskId, claimId) {
  if (!confirm('却下しますか?')) return;
  try { await post(`/api/tasks/${taskId}/claims/${claimId}/reject`, {}); toast('却下しました'); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}

function renderEditForm(t) {
  const wrap = document.getElementById('edit-form-wrap');
  wrap.hidden = false;
  const auds = (t.audience_grades || '').split(',').filter(Boolean);
  // datetime-local needs "YYYY-MM-DDTHH:MM"
  const dlVal = t.deadline ? t.deadline.replace(' ', 'T').slice(0, 16) : '';
  wrap.innerHTML = `
    <div class="card">
      <h3>タスクを編集</h3>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="e-title" maxlength="200" value="${escapeHtml(t.title)}">
      </label>
      <label class="field">
        <span class="lbl">作業 URL</span>
        <input type="url" id="e-url" maxlength="2000" placeholder="https://..." value="${escapeHtml(t.url ?? '')}">
      </label>
      <label class="field">
        <span class="lbl">詳細</span>
        <textarea id="e-desc" maxlength="5000" rows="3">${escapeHtml(t.description ?? '')}</textarea>
      </label>
      <label class="field">
        <span class="lbl">完了時のメッセージ</span>
        <textarea id="e-cmsg" maxlength="2000" rows="2">${escapeHtml(t.completion_message ?? '')}</textarea>
      </label>
      <div class="row">
        <label class="field" style="flex:1">
          <span class="lbl">報酬 (pt / 1人あたり)</span>
          <input type="number" id="e-reward" min="1" value="${t.reward}">
        </label>
        <label class="field" style="flex:1">
          <span class="lbl">募集人数 (承認済み ${t.approved_count} 件以上必須)</span>
          <input type="number" id="e-capacity" min="${t.approved_count || 1}" value="${t.capacity}">
        </label>
      </div>
      <label class="field">
        <span class="lbl">1人あたりの参加可能回数</span>
        <select id="e-perlimit">
          <option value="1" ${t.per_user_limit===1?'selected':''}>1回まで</option>
          <option value="3" ${t.per_user_limit===3?'selected':''}>3回まで</option>
          <option value="5" ${t.per_user_limit===5?'selected':''}>5回まで</option>
          <option value="0" ${t.per_user_limit===0?'selected':''}>無制限</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">締切 (空欄で無期限)</span>
        <input type="datetime-local" id="e-deadline" value="${escapeHtml(dlVal)}">
      </label>
      <div class="field">
        <span class="lbl">対象学年</span>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          ${['B3','B4','M1','M2','D'].map(g => `
            <label class="muted" style="display:inline-flex; align-items:center; gap:4px">
              <input type="checkbox" value="${g}" class="e-aud" ${auds.includes(g)?'checked':''}> ${g}
            </label>`).join('')}
        </div>
      </div>
      <div class="muted" style="font-size:12px; margin-bottom:6px">
        報酬・募集人数を変えると、未承認分の差額が自動で預け or 返金されます。
      </div>
      <div class="row">
        <button id="e-save" class="primary">保存</button>
        <button id="e-cancel">キャンセル</button>
      </div>
    </div>
  `;
  document.getElementById('e-cancel').addEventListener('click', () => { wrap.hidden = true; wrap.innerHTML = ''; });
  document.getElementById('e-save').addEventListener('click', () => onSaveEdit(t.id));
}

async function onSaveEdit(taskId) {
  const title = document.getElementById('e-title').value.trim();
  const url = document.getElementById('e-url').value.trim();
  const description = document.getElementById('e-desc').value.trim();
  const completion_message = document.getElementById('e-cmsg').value.trim();
  const reward   = Number(document.getElementById('e-reward').value);
  const capacity = Number(document.getElementById('e-capacity').value);
  const per_user_limit = Number(document.getElementById('e-perlimit').value);
  const deadline = document.getElementById('e-deadline').value || null;
  const aud = Array.from(document.querySelectorAll('.e-aud:checked')).map(el => el.value);
  if (!title || !(reward > 0) || !(capacity > 0)) { toast('入力を確認してください'); return; }
  try {
    await patch('/api/tasks/' + taskId, {
      title,
      url: url || null,
      description: description || null,
      completion_message: completion_message || null,
      reward, capacity, per_user_limit, deadline,
      audience_grades: aud,
    });
    toast('保存しました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCancelTask(taskId) {
  if (!confirm('タスクを取り消しますか? (未承認分の報酬が返金されます)')) return;
  try { const r = await post(`/api/tasks/${taskId}/cancel`, {}); toast(`取り消しました (${r.refunded}pt 返金)`); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}
