// /#/bait — アルバイト申請 (#244)。
// 依頼者: 「時間 (小数) + 対象者 + 用途」で依頼を作って進捗確認 + 催促。
// 受け取った側: 月別で自分宛ての全依頼を見て、申請処理後 done に。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';
import { fundBudgets, fundBaitoAdd, isFundUnauthError, FUND_HOME_URL } from '../fund_api.js';   // v1089 fund.nkmr.io 書込 / v1250 未認証 判定

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
        <h2 style="margin:0">💼 アルバイト申請</h2>
        <a class="btn primary" href="#/bait/new">＋新規依頼</a>
      </div>
      <p class="hint" style="font-size:13px; margin-top:6px">
        実験協力などで学生にアルバイトを依頼するときに。
        受け取った側は自分の月別リストで全部見えるので、申請処理をまとめて進められます。
      </p>
      <div class="hint-sm" style="margin-top:6px">
        📝 アルバイト代の登録先 (中村研の予算執行 DB): <a href="https://fund.nkmr.io" target="_blank" rel="noopener">https://fund.nkmr.io</a>
        (下の「💴 fund 登録」ボタンから LabPay 内で直接登録も可)
      </div>
    </div>

    <div class="card">
      <h3>📥 あなた宛ての依頼 (アルバイト申請してください)</h3>
      <div id="bait-mine" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>📤 あなたが出した依頼</h3>
      <div id="bait-out" class="list"><div class="muted">読み込み中…</div></div>
    </div>
    <div id="bait-fund-modal"></div>
  `;
  await Promise.all([loadMyAssignments(), loadMyRequests()]);
}

async function loadMyAssignments() {
  const root = document.getElementById('bait-mine');
  try {
    const d = await get('/api/bait/my-assignments');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">あなた宛ての依頼はありません</div>';
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
          ${escapeHtml(periodLabel(p))} ・ ${arr.length} 件 (${pendingN} 件未処理) ・合計 ${totalH} 時間
        </summary>
        <div style="padding:6px 8px">
          ${arr.map(a => `
            <div class="list-item" style="${a.status === 'pending' ? 'background:#fff8e6' : 'opacity:0.75'}; flex-direction:column; align-items:stretch; gap:4px">
              <div style="display:flex; gap:8px; align-items:center">
                <a href="#/bait/${a.bait_request_id}" class="grow bold" style="text-decoration:none; color:inherit; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.title)}</a>
                <span style="flex:none; color:#7c3aed; font-weight:700">${Number(a.hours)} h</span>
                ${a.status === 'done'
                  ? `<span class="tag ok" style="flex:none">✓ 処理済</span>`
                  : `<button class="btn mr-fundadd" data-aid="${a.id}" data-title="${escapeHtml(a.title)}" data-hours="${Number(a.hours)}" data-period="${escapeHtml(a.period || '')}" style="flex:none; padding:3px 10px; font-size:12px; color:#7b3fa0">💴 fund 登録</button>
                     <button class="btn primary mr-done" data-aid="${a.id}" style="flex:none; padding:3px 10px; font-size:12px">処理済にする</button>`}
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
      const note = prompt('処理時のメモ (任意。アルバイト申請の申請番号等)', '');
      try {
        await patch('/api/bait/assignments/' + aid + '/done', { note: note || null });
        toast('処理済にしました');
        loadMyAssignments();
      } catch (e) { toast('失敗: ' + e.message); }
    }));
    // v1089 中村さん指示「あなた宛の依頼を処理できる仕組み」→ fund.nkmr.io に
    //   自分のアルバイト代を登録するモーダルを開くボタン。完了時に処理済にする
    //   オプションも付ける (デフォルト ON)。
    root.querySelectorAll('.mr-fundadd').forEach(b => b.addEventListener('click', async (e) => {
      e.preventDefault();
      openBaitFundModal({
        assignmentId: b.dataset.aid,
        title:  b.dataset.title || '',
        hours:  Number(b.dataset.hours) || 0,
        period: b.dataset.period || '',
      });
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
      root.innerHTML = '<div class="empty">まだあなたが出した依頼はありません</div>';
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
          <div class="meta">合計 ${Number(r.total_hours || 0)} 時間・ ${pct}% 処理済</div>
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
      <a href="#/bait" class="hint">← アルバイト申請</a>
      <h2 style="margin:6px 0">＋新規依頼</h2>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">タイトル / 何のため</span>
        <input type="text" id="bn-title" maxlength="200" placeholder="例: 6月実験協力 (○○ 実験の観測者)">
      </label>
      <label class="field">
        <span class="lbl">対象月</span>
        <input type="month" id="bn-period" value="${currentPeriod()}">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="bn-notes" maxlength="2000" rows="2" placeholder="補足 / 申請時の注意など"></textarea>
      </label>

      <div class="field">
        <span class="lbl">対象者 (各人の時間を設定 — 小数点 OK)</span>
        <div id="bn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="bn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div id="bn-hours-area" style="margin-top:8px"></div>
        <div id="bn-count" class="muted" style="font-size:12px; margin-top:6px">0 人選択中</div>
      </div>

      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/bait" class="btn">キャンセル</a>
        <button id="bn-save" class="primary">依頼を送る</button>
      </div>
    </div>
  `;

  // v669 #247: picker は createMemberPicker の await 解決後に入るが、
  //   createMemberPicker 内の初期 refreshChips() が onChange (= refreshHoursArea) を呼ぶので、
  //   そのタイミングで picker はまだ undefined → TDZ ReferenceError。
  //   let に先宣言 + refreshHoursArea 内で未初期化なら早期 return。
  let picker = null;
  const hoursMap = new Map(); // uid → hours

  function refreshHoursArea() {
    if (!picker) return;
    const sel = [...picker.getSelected()];
    document.getElementById('bn-count').textContent = `${sel.length} 人選択中`;
    const root = document.getElementById('bn-hours-area');
    if (!sel.length) { root.innerHTML = ''; return; }
    // pool は picker が持っている
    const pool = picker.users() || [];
    const byUid = new Map(pool.map(u => [u.id, u]));
    const sorted = sel.map(uid => byUid.get(Number(uid))).filter(Boolean)
      .sort((a, b) => (GRADE_ORDER.indexOf(a.grade || '') - GRADE_ORDER.indexOf(b.grade || ''))
        || (a.display_name || '').localeCompare(b.display_name || '', 'ja'));
    root.innerHTML = `
      <div class="muted" style="font-size:12px; margin:6px 0 4px">各人の時間を入力 (小数 OK、単位 = 時間)</div>
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
    if (!period) { toast('対象月必須'); return; }
    const assignments = [];
    document.querySelectorAll('[data-hr]').forEach(inp => {
      const uid = Number(inp.dataset.hr);
      const h = Math.max(0, Number(inp.value) || 0);
      if (h > 0) assignments.push({ user_id: uid, hours: h });
    });
    if (!assignments.length) { toast('対象者 + 時間を 1 件以上'); return; }
    try {
      const r = await post('/api/bait/requests', { title, period, notes, assignments });
      toast('依頼を送りました');
      navigate('#/bait/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderBaitDetail({ params }) {
  const id = Number(params?.id);
  const app = document.getElementById('app');
  if (!Number.isFinite(id) || id <= 0) {
    app.innerHTML = `<div class="card"><a href="#/bait" class="hint">← 一覧</a><div class="muted" style="margin-top:6px">依頼 ID が不正です (${escapeHtml(String(params?.id ?? '不明'))})。一覧から開き直してください。</div></div>`;
    return;
  }
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
        <button id="bd-remind" class="btn">📣 未処理者に催促</button>
        <button id="bd-close" class="btn">🏁 依頼を完了マーク</button>
        <button id="bd-del" class="danger">削除</button>
      </div>
    </div>
  `;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const d = await get('/api/bait/requests/' + id);
    // v814 #407 防御: 旧キャッシュ JS / 一時 fetch 失敗等で d.request が欠落した場合
    //   「undefined is not an object (evaluating 'r.title')」で詰まらないように早期検知。
    if (!d || !d.request) {
      const got = d ? Object.keys(d).join(', ') : 'null';
      throw new Error(`detail レスポンスに request 欠落 (キー: ${got})。アプリを一度リロードしてみてください。`);
    }
    const r = d.request;
    const assignments = Array.isArray(d.assignments) ? d.assignments : [];
    const totalH = assignments.reduce((s, a) => s + Number(a.hours || 0), 0);
    const doneN  = assignments.filter(a => a.status === 'done').length;
    const total  = assignments.length;
    document.getElementById('bd-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(r.title || '(タイトルなし)')}</h2>
      <div class="meta">
        起案 ${escapeHtml(r.requester_name || '?')} ・ ${escapeHtml(periodLabel(r.period || ''))} ・合計 ${totalH} 時間・ ${doneN}/${total} 件処理済
        ${r.closed_at ? '・ <span style="color:#10b981">🏁 完了マーク済</span>' : ''}
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
                ? ` ・ ✓ ${escapeHtml(doneTime)} 処理済`
                : ' ・ <span style="color:#e65100">未処理</span>'}
              ${a.worker_note ? ` ・ ${escapeHtml(a.worker_note)}` : ''}
            </div>
          </div>
          ${mine ? (
            a.status === 'done'
              ? `<button class="btn bd-undone" data-aid="${a.id}" style="flex:none; font-size:12px">未処理に戻す</button>`
              : `<button class="btn primary bd-done" data-aid="${a.id}" style="flex:none; font-size:12px">処理済に</button>`
          ) : ''}
        </div>`;
    }).join('');
    root.querySelectorAll('.bd-done').forEach(b => b.addEventListener('click', async () => {
      const note = prompt('処理時のメモ (任意)', '') || null;
      try { await patch('/api/bait/assignments/' + b.dataset.aid + '/done', { note });
        toast('処理済にしました');
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
      remindBtn.textContent = `📣 未処理者に催促 (${unr})`;
      remindBtn.disabled = unr === 0;
      remindBtn.addEventListener('click', async () => {
        if (!confirm(`${unr} 人に催促通知を送りますか?`)) return;
        try {
          const r = await post('/api/bait/requests/' + id + '/remind', {});
          toast(`${r.sent} 人に送りました`);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('bd-close').addEventListener('click', async () => {
        if (!confirm('この依頼を完了マークしますか?')) return;
        try {
          await patch('/api/bait/requests/' + id + '/close', {});
          toast('完了マークしました');
          loadDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('bd-del').addEventListener('click', async () => {
        if (!confirm('この依頼を削除しますか? assignment も全部消えます。')) return;
        try {
          await del('/api/bait/requests/' + id);
          toast('削除しました');
          navigate('#/bait');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('bd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v1089 fund.nkmr.io にアルバイト代を登録するモーダル。
//   period ("2026-05") → month=5月、 fiscal_year=2026 に自動変換。
//   予算 (fund) は fundBudgets で取得したプルダウン、 hourly は 1250/1600 プリセット +
//   任意入力 (work1/work2 の説明も表示)。送信成功で「LabPay 側の assignment も
//   処理済にする」チェックを ON なら PATCH /api/bait/assignments/{id}/done も叩く。
async function openBaitFundModal({ assignmentId, title, hours, period }) {
  const root = document.getElementById('bait-fund-modal');
  if (!root) return;
  // period "2026-05" → year 2026, month 5
  const pm = /^(\d{4})-(\d{2})$/.exec(period);
  const y = pm ? Number(pm[1]) : new Date().getFullYear();
  const m = pm ? Number(pm[2]) : (new Date().getMonth() + 1);
  // 会計年度: 4-3 月 (4-12月は同年、 1-3月は前年度)
  const fy = m >= 4 ? y : (y - 1);
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" data-bf-close>
      <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; padding:20px" data-bf-inner>
        <div class="row" style="align-items:center; justify-content:space-between">
          <h3 style="margin:0; font-size:16px">💴 fund.nkmr.io にアルバイト代を登録</h3>
          <button class="btn" data-bf-close>×</button>
        </div>
        <div class="hint-sm" style="margin-top:4px; color:#6b7280">依頼: <b>${escapeHtml(title)}</b> / ${y}年 ${m}月 / ${hours} h</div>
        <label class="field" style="margin-top:10px">
          <span class="lbl">予算 <span style="color:#dc2626">*</span></span>
          <select id="bf-fund" style="width:100%"><option value="">読み込み中…</option></select>
          <div class="hint-sm" id="bf-fund-note" style="margin-top:2px; color:#6b7280"></div>
        </label>
        <label class="field">
          <span class="lbl">項目 (何をやったか) <span style="color:#dc2626">*</span></span>
          <input type="text" id="bf-item" maxlength="200" value="${escapeHtml(title || '')}">
        </label>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:110px">
            <span class="lbl">対象月</span>
            <select id="bf-month">
              ${Array.from({length: 12}, (_, i) => i + 1).map(mm =>
                `<option value="${mm}月" ${mm === m ? 'selected' : ''}>${mm}月</option>`).join('')}
            </select>
          </label>
          <label class="field" style="flex:1; min-width:110px">
            <span class="lbl">年度</span>
            <input type="number" id="bf-fy" min="2020" max="2100" value="${fy}">
          </label>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:130px">
            <span class="lbl">時給 (円) <span style="color:#dc2626">*</span></span>
            <div class="row" style="gap:4px; margin-bottom:4px">
              <button type="button" class="btn" data-bf-hourly="1250" style="font-size:11px; padding:2px 8px">1250</button>
              <button type="button" class="btn" data-bf-hourly="1600" style="font-size:11px; padding:2px 8px">1600</button>
            </div>
            <input type="number" id="bf-hourly" min="0" step="1" value="1250">
          </label>
          <label class="field" style="flex:1; min-width:130px">
            <span class="lbl">時間 (h) <span style="color:#dc2626">*</span></span>
            <input type="number" id="bf-hours" min="0" step="0.25" value="${hours || ''}">
          </label>
        </div>
        <div id="bf-amount-preview" class="hint-sm" style="text-align:right; color:#7b3fa0; font-weight:600; margin-top:-4px"></div>
        <label style="display:flex; align-items:center; gap:6px; margin-top:12px; font-size:13px">
          <input type="checkbox" id="bf-mark-done" checked>
          登録後、この依頼の LabPay 側も「処理済」にする
        </label>
        <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
          <button class="btn" data-bf-close>やめる</button>
          <button class="btn primary" id="bf-submit">💴 fund に登録</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-bf-close]').forEach(el => el.addEventListener('click', (e) => {
    if (e.target === el || e.currentTarget === el) close();
  }));
  // amount preview
  const updatePreview = () => {
    const h  = Number(document.getElementById('bf-hourly').value) || 0;
    const hs = Number(document.getElementById('bf-hours').value) || 0;
    const amt = Math.round(h * hs);
    document.getElementById('bf-amount-preview').textContent = amt > 0 ? `想定合計: ¥${amt.toLocaleString()}` : '';
  };
  ['bf-hourly', 'bf-hours'].forEach(id => document.getElementById(id).addEventListener('input', updatePreview));
  updatePreview();
  root.querySelectorAll('[data-bf-hourly]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('bf-hourly').value = btn.dataset.bfHourly;
      updatePreview();
    });
  });
  // fund プルダウン埋め
  const fundSel = document.getElementById('bf-fund');
  const noteEl  = document.getElementById('bf-fund-note');
  try {
    const buds = await fundBudgets(fy);
    if (!buds.length) {
      fundSel.innerHTML = '<option value="">(予算リスト取得失敗)</option>';
    } else {
      fundSel.innerHTML = '<option value="">— 選択 —</option>' + buds.map(b => {
        const label = b.label || b.fund || '';
        return `<option value="${escapeHtml(b.fund || '')}"
                        data-work1="${escapeHtml(b.work1 || '')}"
                        data-work2="${escapeHtml(b.work2 || '')}"
                        data-plan="${escapeHtml(b.plan || '')}">${escapeHtml(label)}</option>`;
      }).join('');
      fundSel.addEventListener('change', () => {
        const opt = fundSel.selectedOptions[0];
        if (!opt || !opt.value) { noteEl.textContent = ''; return; }
        const plan = opt.dataset.plan  || '';
        const w1   = opt.dataset.work1 || '';
        const w2   = opt.dataset.work2 || '';
        const lines = [];
        if (plan) lines.push(plan);
        if (w1)   lines.push('1250 円/h: ' + w1);
        if (w2)   lines.push('1600 円/h: ' + w2);
        noteEl.textContent = lines.join(' / ');
      });
    }
  } catch (e) {
    // v1250 未認証 (fund.nkmr.io セッション 切れ) を 分かりやすく 表示
    if (isFundUnauthError(e)) {
      fundSel.innerHTML = '<option value="">(fund.nkmr.io未ログイン)</option>';
      if (noteEl) {
        noteEl.innerHTML = `<span style="color:#dc2626">⚠ fund.nkmr.ioにログインしてください。</span>
          <a href="${FUND_HOME_URL}" target="_blank" rel="noopener" class="btn primary" style="margin-left:6px; padding:2px 10px; font-size:11px; text-decoration:none">🔓 fundを別タブで開く</a>
          <div style="font-size:11px; margin-top:2px">ログイン後、一度このモーダルを閉じて再度開いてください。</div>`;
      }
    } else {
      fundSel.innerHTML = `<option value="">${escapeHtml('予算取得失敗: ' + (e?.message || e))}</option>`;
    }
  }
  // submit
  document.getElementById('bf-submit').addEventListener('click', async () => {
    const fund   = document.getElementById('bf-fund').value.trim();
    const item   = document.getElementById('bf-item').value.trim();
    const month  = document.getElementById('bf-month').value.trim();
    const hourly = Number(document.getElementById('bf-hourly').value) || 0;
    const hoursN = Number(document.getElementById('bf-hours').value) || 0;
    const fyN    = Number(document.getElementById('bf-fy').value) || fy;
    const markDone = document.getElementById('bf-mark-done').checked;
    if (!fund)                  { toast('予算を選んでください'); return; }
    if (!item)                  { toast('項目を入力してください'); return; }
    if (!(hourly > 0 && hoursN > 0)) { toast('時給と時間を入力してください'); return; }
    const btn = document.getElementById('bf-submit');
    btn.disabled = true; btn.textContent = '登録中…';
    try {
      const res = await fundBaitoAdd({ fund, item, month, hourly, hours: hoursN, fiscal_year: fyN });
      toast(`fund に登録しました (¥${(res.amount || Math.round(hourly * hoursN)).toLocaleString()})`);
      if (markDone) {
        try { await patch('/api/bait/assignments/' + assignmentId + '/done', { note: `fund 登録済 (id=${res.id})` }); }
        catch (e) { toast('fund 登録は成功したが LabPay 側の処理済化に失敗: ' + (e?.message || e), 5000); }
      }
      close();
      loadMyAssignments();
    } catch (e) {
      toast('失敗: ' + (e?.message || e), 5000);
      btn.disabled = false; btn.textContent = '💴 fund に登録';
    }
  });
}
