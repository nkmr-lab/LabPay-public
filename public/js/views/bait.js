// /#/bait — アルバイト 申請 (#244)。
// 依頼者: 「時間 (小数) + 対象者 + 用途」 で 依頼 を 作って 進捗 確認 + 催促。
// 受け取った 側: 月別 で 自分宛て の 全 依頼 を 見て、 申請 処理 後 done に。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];

function currentPeriod() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function periodLabel(p) {
  if (!p) return '';
  const [y, m] = p.split('-');
  return `${y}年${Number(m)}月`;
}

export async function renderBait() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">💼 アルバイト 申請</h2>
        <a class="btn primary" href="#/bait/new">＋ 新規 依頼</a>
      </div>
      <p class="hint" style="font-size:13px; margin-top:6px">
        実験 協力 などで 学生 に アルバイト を 依頼 する とき に。
        受け取った 側 は 自分 の 月別 リスト で 全部 見える ので、 申請 処理 を まとめて 進められます。
      </p>
    </div>

    <div class="card">
      <h3>📥 あなた宛て の 依頼 (アルバイト 申請 して ください)</h3>
      <div id="bait-mine" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>📤 あなた が 出した 依頼</h3>
      <div id="bait-out" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await Promise.all([loadMyAssignments(), loadMyRequests()]);
}

async function loadMyAssignments() {
  const root = document.getElementById('bait-mine');
  try {
    const d = await get('/api/bait/my-assignments');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">あなた宛て の 依頼 は ありません</div>';
      return;
    }
    // 月別 group
    const groups = {};
    for (const it of items) {
      (groups[it.period] = groups[it.period] || []).push(it);
    }
    const periods = Object.keys(groups).sort().reverse();
    let html = '';
    for (const p of periods) {
      const arr = groups[p];
      const pendingN = arr.filter(a => a.status === 'pending').length;
      const totalH   = arr.reduce((s, a) => s + Number(a.hours || 0), 0);
      html += `<details ${pendingN > 0 ? 'open' : ''} style="margin:6px 0; border:1px solid var(--line); border-radius:6px">
        <summary style="padding:8px; cursor:pointer; font-weight:600">
          ${escapeHtml(periodLabel(p))} ・ ${arr.length} 件 (${pendingN} 件 未処理) ・ 合計 ${totalH} 時間
        </summary>
        <div style="padding:6px 8px">
          ${arr.map(a => `
            <div class="list-item" style="${a.status === 'pending' ? 'background:#fff8e6' : 'opacity:0.75'}; flex-direction:column; align-items:stretch; gap:4px">
              <div style="display:flex; gap:8px; align-items:center">
                <a href="#/bait/${a.bait_request_id}" class="grow bold" style="text-decoration:none; color:inherit; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.title)}</a>
                <span style="flex:none; color:#7c3aed; font-weight:700">${Number(a.hours)} h</span>
                ${a.status === 'done'
                  ? `<span class="tag ok" style="flex:none">✓ 処理 済</span>`
                  : `<button class="btn primary mr-done" data-aid="${a.id}" style="flex:none; padding:3px 10px; font-size:12px">処理 済 に する</button>`}
              </div>
              <div class="meta">${escapeHtml(a.requester_name)} から ${a.notes ? '・ ' + escapeHtml(String(a.notes).slice(0, 60)) : ''}</div>
            </div>
          `).join('')}
        </div>
      </details>`;
    }
    root.innerHTML = html;
    root.querySelectorAll('.mr-done').forEach(b => b.addEventListener('click', async (e) => {
      e.preventDefault();
      const aid = b.dataset.aid;
      const note = prompt('処理 時 の メモ (任意。 アルバイト 申請 の 申請番号 等)', '');
      try {
        await patch('/api/bait/assignments/' + aid + '/done', { note: note || null });
        toast('処理 済 に しました');
        loadMyAssignments();
      } catch (e) { toast('失敗: ' + e.message); }
    }));
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadMyRequests() {
  const root = document.getElementById('bait-out');
  try {
    const d = await get('/api/bait/requests');
    const meId = Number(state.me?.id);
    const items = (d.items || []).filter(r => Number(r.requester_user_id) === meId);
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ あなた が 出した 依頼 は ありません</div>';
      return;
    }
    root.innerHTML = items.map(r => {
      const total = Number(r.total_n || 0);
      const done  = Number(r.done_n  || 0);
      const pct   = total ? Math.round(done * 100 / total) : 0;
      return `
        <a class="list-item" href="#/bait/${r.id}" style="flex-direction:column; align-items:stretch; gap:4px">
          <div style="display:flex; gap:8px; align-items:center">
            <div class="grow bold" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title)}</div>
            <span class="hint-sm" style="flex:none">${escapeHtml(periodLabel(r.period))}</span>
            <span class="bold" style="flex:none; color:${done === total ? '#10b981' : '#e65100'}">${done}/${total}</span>
          </div>
          <div class="meta">合計 ${Number(r.total_hours || 0)} 時間 ・ ${pct}% 処理 済</div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderBaitNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/bait" class="hint">← アルバイト 申請</a>
      <h2 style="margin:6px 0">＋ 新規 依頼</h2>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">タイトル / 何のため</span>
        <input type="text" id="bn-title" maxlength="200" placeholder="例: 6月 実験 協力 (○○ 実験 の 観測者)">
      </label>
      <label class="field">
        <span class="lbl">対象 月</span>
        <input type="month" id="bn-period" value="${currentPeriod()}">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="bn-notes" maxlength="2000" rows="2" placeholder="補足 / 申請 時 の 注意 など"></textarea>
      </label>

      <div class="field">
        <span class="lbl">対象者 (各 人 の 時間 を 設定 — 小数点 OK)</span>
        <div id="bn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="bn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div id="bn-hours-area" style="margin-top:8px"></div>
        <div id="bn-count" class="muted" style="font-size:12px; margin-top:6px">0 人 選択 中</div>
      </div>

      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/bait" class="btn">キャンセル</a>
        <button id="bn-save" class="primary">依頼 を 送る</button>
      </div>
    </div>
  `;

  // v669 #247: picker は createMemberPicker の await 解決 後 に 入る が、
  //   createMemberPicker 内 の 初期 refreshChips() が onChange (= refreshHoursArea) を 呼ぶ ので、
  //   その タイミング で picker は まだ undefined → TDZ ReferenceError。
  //   let に 先 宣言 + refreshHoursArea 内 で 未 初期化 なら 早期 return。
  let picker = null;
  const hoursMap = new Map(); // uid → hours

  function refreshHoursArea() {
    if (!picker) return;
    const sel = [...picker.getSelected()];
    document.getElementById('bn-count').textContent = `${sel.length} 人 選択 中`;
    const root = document.getElementById('bn-hours-area');
    if (!sel.length) { root.innerHTML = ''; return; }
    // pool は picker が 持って いる
    const pool = picker.users() || [];
    const byUid = new Map(pool.map(u => [u.id, u]));
    const sorted = sel.map(uid => byUid.get(Number(uid))).filter(Boolean)
      .sort((a, b) => (GRADE_ORDER.indexOf(a.grade || '') - GRADE_ORDER.indexOf(b.grade || ''))
        || (a.display_name || '').localeCompare(b.display_name || '', 'ja'));
    root.innerHTML = `
      <div class="muted" style="font-size:12px; margin:6px 0 4px">各 人 の 時間 を 入力 (小数 OK、 単位 = 時間)</div>
      ${sorted.map(u => `
        <div class="row" style="gap:6px; align-items:center; padding:3px 0">
          ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
          <span class="grow">${escapeHtml(u.display_name)} ${u.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(u.grade)}]</span>` : ''}</span>
          <input type="number" min="0" step="0.25" data-hr="${u.id}" value="${hoursMap.get(u.id) ?? ''}" placeholder="h" style="width:90px; text-align:right">
        </div>
      `).join('')}`;
    root.querySelectorAll('[data-hr]').forEach(inp => {
      inp.addEventListener('input', () => {
        const uid = Number(inp.dataset.hr);
        const v = Math.max(0, Number(inp.value) || 0);
        if (v > 0) hoursMap.set(uid, v);
        else hoursMap.delete(uid);
      });
    });
  }

  picker = await createMemberPicker({
    bulkContainer: document.getElementById('bn-bulk'),
    chipsContainer: document.getElementById('bn-members'),
    onChange: refreshHoursArea,
    showGenderBulk: false,
  });
  refreshHoursArea();

  document.getElementById('bn-save').addEventListener('click', async () => {
    const title  = document.getElementById('bn-title').value.trim();
    const period = document.getElementById('bn-period').value;
    const notes  = document.getElementById('bn-notes').value.trim() || null;
    if (!title)  { toast('タイトル必須'); return; }
    if (!period) { toast('対象月 必須'); return; }
    const assignments = [];
    document.querySelectorAll('[data-hr]').forEach(inp => {
      const uid = Number(inp.dataset.hr);
      const h = Math.max(0, Number(inp.value) || 0);
      if (h > 0) assignments.push({ user_id: uid, hours: h });
    });
    if (!assignments.length) { toast('対象者 + 時間 を 1 件 以上'); return; }
    try {
      const r = await post('/api/bait/requests', { title, period, notes, assignments });
      toast('依頼 を 送りました');
      navigate('#/bait/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderBaitDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/bait" class="hint">← 一覧</a>
      <div id="bd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">対象者 + 進捗</h3>
      <div id="bd-list" class="list"></div>
    </div>
    <div class="card" id="bd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="bd-remind" class="btn">📣 未処理者 に 催促</button>
        <button id="bd-close" class="btn">🏁 依頼 を 完了 マーク</button>
        <button id="bd-del" class="danger">削除</button>
      </div>
    </div>
  `;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const d = await get('/api/bait/requests/' + id);
    const r = d.request;
    const totalH = (d.assignments || []).reduce((s, a) => s + Number(a.hours || 0), 0);
    const doneN  = (d.assignments || []).filter(a => a.status === 'done').length;
    const total  = (d.assignments || []).length;
    document.getElementById('bd-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(r.title)}</h2>
      <div class="meta">
        起案 ${escapeHtml(r.requester_name)} ・ ${escapeHtml(periodLabel(r.period))} ・ 合計 ${totalH} 時間 ・ ${doneN}/${total} 件 処理 済
      </div>
      ${r.notes ? `<div style="margin-top:6px; padding:6px 8px; background:#f9fafb; border-radius:6px; white-space:pre-wrap">${escapeHtml(r.notes)}</div>` : ''}
    `;
    const root = document.getElementById('bd-list');
    const meId = Number(state.me?.id);
    root.innerHTML = d.assignments.map(a => {
      const mine = a.worker_user_id === meId;
      const doneTime = a.processed_at ? String(a.processed_at).slice(0, 16) : '';
      return `
        <div class="list-item" style="gap:8px; align-items:center; ${mine ? 'background:#fffaeb; border-left:3px solid var(--primary)' : ''} ${a.status === 'done' ? 'opacity:0.85' : ''}">
          ${avatarHtml(a.worker_name, a.avatar_url, 'sm')}
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:13px">
              ${escapeHtml(a.worker_name)}
              ${a.grade ? `<span class="muted" style="font-size:11px">[${escapeHtml(a.grade)}]</span>` : ''}
              ${mine ? '<span class="hint-sm" style="font-size:11px; color:var(--primary); margin-left:4px">(あなた)</span>' : ''}
            </div>
            <div class="meta">
              ${Number(a.hours)} h
              ${a.status === 'done'
                ? ` ・ ✓ ${escapeHtml(doneTime)} 処理 済`
                : ' ・ <span style="color:#e65100">未処理</span>'}
              ${a.worker_note ? ` ・ ${escapeHtml(a.worker_note)}` : ''}
            </div>
          </div>
          ${mine ? (
            a.status === 'done'
              ? `<button class="btn bd-undone" data-aid="${a.id}" style="flex:none; font-size:12px">未処理 に 戻す</button>`
              : `<button class="btn primary bd-done" data-aid="${a.id}" style="flex:none; font-size:12px">処理 済 に</button>`
          ) : ''}
        </div>`;
    }).join('');
    root.querySelectorAll('.bd-done').forEach(b => b.addEventListener('click', async () => {
      const note = prompt('処理 時 の メモ (任意)', '') || null;
      try { await patch('/api/bait/assignments/' + b.dataset.aid + '/done', { note });
        toast('処理 済 に しました');
        loadDetail(id);
      } catch (e) { toast('失敗: ' + e.message); }
    }));
    root.querySelectorAll('.bd-undone').forEach(b => b.addEventListener('click', async () => {
      try { await patch('/api/bait/assignments/' + b.dataset.aid + '/undone', {});
        toast('戻しました');
        loadDetail(id);
      } catch (e) { toast('失敗: ' + e.message); }
    }));

    if (d.i_am_requester) {
      const admin = document.getElementById('bd-admin-card');
      admin.hidden = false;
      const unr = total - doneN;
      const remindBtn = document.getElementById('bd-remind');
      remindBtn.textContent = `📣 未処理者 に 催促 (${unr})`;
      remindBtn.disabled = unr === 0;
      remindBtn.addEventListener('click', async () => {
        if (!confirm(`${unr} 人 に 催促 通知 を 送りますか?`)) return;
        try {
          const r = await post('/api/bait/requests/' + id + '/remind', {});
          toast(`${r.sent} 人 に 送りました`);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('bd-close').addEventListener('click', async () => {
        if (!confirm('この 依頼 を 完了 マーク しますか?')) return;
        try {
          await patch('/api/bait/requests/' + id + '/close', {});
          toast('完了 マーク しました');
          loadDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('bd-del').addEventListener('click', async () => {
        if (!confirm('この 依頼 を 削除 しますか? assignment も 全部 消えます。')) return;
        try {
          await del('/api/bait/requests/' + id);
          toast('削除 しました');
          navigate('#/bait');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('bd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
