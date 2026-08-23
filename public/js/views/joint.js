// /#/joint-events — 合同研究会用投票 (v941)。
// 起案者 (中村さん想定) が event を作成 → session → presenter を登録し、
// 公開 URL (と 4 桁コード) を外部に共有、終了後に集計 + 優秀発表者を確定。
// 外部参加者の投票 UI は /public/joint.html (別 HTML)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const AFF_LABEL = { host: 'ホスト', guest: 'ゲスト' };

// ---------- 一覧 ----------

export async function renderJointList() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center">
        <h2 style="margin:0">🎪 合同研究会投票</h2>
        <a href="#/joint-events/new" class="btn primary">＋新規</a>
      </div>
      <p class="hint-sm" style="margin:8px 0 0">
        合同研究会でセッションごとに相手ラボの発表に投票してもらい、
        セッション別優秀発表者を決めるための機能。
        外部参加者も 4 桁コード or 公開 URL で匿名投票可。
      </p>
    </div>
    <div id="jl-list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/joint-events');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('jl-list').innerHTML =
        '<div class="card muted">まだ event がありません。「＋新規」から作ってください。</div>';
      return;
    }
    document.getElementById('jl-list').innerHTML = items.map(e => `
      <a class="list-item" href="#/joint-events/${e.id}" style="text-decoration:none; color:inherit">
        <div class="grow" style="min-width:0">
          <div class="bold" style="font-size:15px">${escapeHtml(e.title)}</div>
          <div class="meta">${escapeHtml(e.host_lab)} × ${escapeHtml(e.guest_lab)}
            ${e.starts_at ? ' · ' + escapeHtml(String(e.starts_at).slice(0, 16)) : ''}
            ${e.finalized_at ? ' · <span style="color:#059669">🏆 確定済</span>' : ''}
          </div>
          <div class="meta">
            ${e.session_count} session · ${e.presenter_count} 発表 · ${e.vote_count} 票
          </div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('jl-list').innerHTML =
      `<div class="muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 新規作成 ----------

export async function renderJointNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 10px">🎪 合同研究会 event を作成</h2>
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="jn-title" maxlength="300" placeholder="例: 中村研 × 山田研合同研究会 2026 秋">
      </label>
      <label class="field"><span class="lbl">説明 (任意)</span>
        <textarea id="jn-desc" rows="3" maxlength="5000" placeholder="日時 / 場所 / 注意事項など"></textarea>
      </label>
      <div class="row" style="gap:8px">
        <label class="field" style="flex:1"><span class="lbl">ホストラボ名</span>
          <input type="text" id="jn-host" maxlength="100" value="中村研">
        </label>
        <label class="field" style="flex:1"><span class="lbl">ゲストラボ名</span>
          <input type="text" id="jn-guest" maxlength="100" placeholder="例: 山田研">
        </label>
      </div>
      <div class="row" style="gap:8px">
        <label class="field" style="flex:1"><span class="lbl">開始日時 (任意)</span>
          <input type="datetime-local" id="jn-starts">
        </label>
        <label class="field" style="flex:1"><span class="lbl">終了日時 (任意)</span>
          <input type="datetime-local" id="jn-ends">
        </label>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/joint-events" class="btn">キャンセル</a>
        <button id="jn-save" class="primary">作成</button>
      </div>
    </div>
  `;
  document.getElementById('jn-save').addEventListener('click', async () => {
    const title = document.getElementById('jn-title').value.trim();
    const host  = document.getElementById('jn-host').value.trim();
    const guest = document.getElementById('jn-guest').value.trim();
    const desc  = document.getElementById('jn-desc').value.trim();
    const starts = document.getElementById('jn-starts').value || null;
    const ends   = document.getElementById('jn-ends').value || null;
    if (!title) return toast('タイトル必須');
    if (!host || !guest) return toast('両ラボ名を入力してください');
    try {
      const d = await post('/api/joint-events', {
        title, description: desc, host_lab: host, guest_lab: guest,
        starts_at: starts, ends_at: ends,
      });
      toast('作成しました');
      navigate('#/joint-events/' + d.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

// ---------- 詳細 ----------

export async function renderJointDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card muted">読み込み中…</div>`;
  try {
    const d = await get('/api/joint-events/' + id);
    renderJointDetailInto(app, d);
  } catch (e) {
    app.innerHTML = `<div class="card muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderJointDetailInto(app, d) {
  const finalized = !!d.finalized_at;
  const publicUrl = `${location.origin}/joint.html?t=${d.public_token}`;
  const shortUrl  = d.public_code ? `${location.origin}/#/public` : null;
  app.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px">
        <div class="grow">
          <h2 style="margin:0">🎪 ${escapeHtml(d.title)}</h2>
          <div class="meta">${escapeHtml(d.host_lab)} × ${escapeHtml(d.guest_lab)}${
            d.starts_at ? ' · ' + escapeHtml(String(d.starts_at).slice(0, 16)) : ''
          }${finalized ? ' · <span style="color:#059669">🏆 確定済</span>' : ''}</div>
        </div>
        <div class="row" style="gap:4px; flex-wrap:wrap">
          <button id="jd-edit"   class="btn" style="font-size:12px; padding:4px 8px">✏️ 編集</button>
          <button id="jd-delete" class="btn" style="font-size:12px; padding:4px 8px; color:#dc2626">🗑</button>
        </div>
      </div>
      ${d.description ? `<div style="margin-top:8px; white-space:pre-wrap">${escapeHtml(d.description)}</div>` : ''}
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">📢 外部への共有</div>
      ${d.public_code ? `
        <div style="background:#fef3c7; padding:10px 14px; border-radius:6px; margin-bottom:8px">
          <div style="font-size:12px; color:#92400e; margin-bottom:2px">4 桁コード (pay.nkmr.io/#/public で入力)</div>
          <div style="font-family:ui-monospace,monospace; font-size:32px; letter-spacing:8px; font-weight:700; color:#92400e">${escapeHtml(d.public_code)}</div>
        </div>
      ` : ''}
      <div style="font-size:12px; color:#6b7280; margin-bottom:2px">直接 URL (SNS 貼り付け用)</div>
      <div class="row" style="gap:6px">
        <input type="text" id="jd-url" readonly value="${escapeHtml(publicUrl)}"
               style="flex:1; padding:6px 10px; font-size:12px; font-family:ui-monospace,monospace;
                      background:#f9fafb; border:1px solid #d1d5db; border-radius:4px">
        <button id="jd-copy" class="btn" style="font-size:12px; padding:4px 10px">📋 コピー</button>
      </div>
      <div class="hint-sm" style="margin-top:6px">
        QR コード出力は v942 で追加予定。いまは URL コピー + 4 桁コード配布でお願いします。
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
        <div class="bold">📅 セッション</div>
        <button id="jd-add-session" class="btn primary" style="font-size:12px; padding:4px 10px">＋セッション追加</button>
      </div>
      <div id="jd-sessions">
        ${(d.sessions || []).map(s => renderSessionCard(s)).join('') || '<div class="muted">まだセッションがありません</div>'}
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
        <div class="bold">📊 集計 / 優秀発表者確定</div>
        <div class="row" style="gap:4px">
          <button id="jd-results" class="btn" style="font-size:12px; padding:4px 10px">集計を見る</button>
          <button id="jd-finalize" class="btn ${finalized ? '' : 'primary'}" style="font-size:12px; padding:4px 10px">
            ${finalized ? '再確定' : '🏆 確定'}
          </button>
        </div>
      </div>
      <div id="jd-results-view" class="hint-sm">「集計を見る」で現在の投票数と最多得票者を確認 → 「確定」で各セッションの優秀発表者を決定します。</div>
    </div>
  `;

  document.getElementById('jd-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast('コピーしました');
    } catch { toast('コピー失敗'); }
  });
  document.getElementById('jd-edit').addEventListener('click', () => openEditEvent(d));
  document.getElementById('jd-delete').addEventListener('click', () => onDeleteEvent(d.id));
  document.getElementById('jd-add-session').addEventListener('click', () => openAddSession(d.id));
  // v943 「＋発表者まとめて」 → 該当 session の bulk フォームを toggle
  document.querySelectorAll('[data-add-presenter]').forEach(b =>
    b.addEventListener('click', () => {
      const sid = Number(b.dataset.addPresenter);
      const form = document.getElementById('bulk-' + sid);
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) document.getElementById('bulk-ta-' + sid)?.focus();
      }
    }));
  document.querySelectorAll('[data-bulk-cancel]').forEach(b =>
    b.addEventListener('click', () => {
      const sid = Number(b.dataset.bulkCancel);
      const form = document.getElementById('bulk-' + sid);
      if (form) form.hidden = true;
    }));
  document.querySelectorAll('[data-bulk-save]').forEach(b =>
    b.addEventListener('click', () => onBulkSavePresenters(d.id, Number(b.dataset.bulkSave))));
  document.querySelectorAll('[data-edit-session]').forEach(b =>
    b.addEventListener('click', () => openEditSession(d.id, Number(b.dataset.editSession))));
  document.querySelectorAll('[data-del-session]').forEach(b =>
    b.addEventListener('click', () => onDeleteSession(d.id, Number(b.dataset.delSession))));
  document.querySelectorAll('[data-edit-presenter]').forEach(b =>
    b.addEventListener('click', () => openEditPresenter(d.id, Number(b.dataset.editPresenter))));
  document.querySelectorAll('[data-del-presenter]').forEach(b =>
    b.addEventListener('click', () => onDeletePresenter(d.id, Number(b.dataset.delPresenter))));
  // v1351 fb#524 セッション単位の締切/再開
  document.querySelectorAll('[data-close-session]').forEach(b =>
    b.addEventListener('click', () => onCloseSession(d.id, Number(b.dataset.closeSession))));
  document.querySelectorAll('[data-reopen-session]').forEach(b =>
    b.addEventListener('click', () => onReopenSession(d.id, Number(b.dataset.reopenSession))));
  document.getElementById('jd-results').addEventListener('click', () => loadResults(d.id));
  document.getElementById('jd-finalize').addEventListener('click', () => onFinalize(d.id));
}

async function onCloseSession(eventId, sid) {
  if (!confirm('このセッションの投票を締め切りますか? (投票者は送信できなくなります、再開も可)')) return;
  try { await patch('/api/joint-events/sessions/' + sid, { closed: true }); toast('締切ました'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}
async function onReopenSession(eventId, sid) {
  if (!confirm('このセッションの投票受付を再開しますか?')) return;
  try { await patch('/api/joint-events/sessions/' + sid, { closed: false }); toast('再開しました'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}

function renderSessionCard(s) {
  // v1351 fb#524 中村さん要望「セッションごとに投票を締め切れるように」
  const closed = !!s.closed_at;
  const closeBtn = closed
    ? `<button class="btn" style="font-size:11px; padding:2px 6px; background:#dcfce7; color:#166534" data-reopen-session="${s.id}">🔓 再開</button>`
    : `<button class="btn" style="font-size:11px; padding:2px 6px; background:#fef3c7; color:#92400e" data-close-session="${s.id}">🔒 締切</button>`;
  return `
    <div style="border:1px solid ${closed ? '#fbbf24' : '#e5e7eb'}; border-radius:6px; padding:10px 12px; margin-bottom:8px; ${closed ? 'background:#fffbeb' : ''}">
      <div class="row" style="justify-content:space-between; align-items:flex-start">
        <div class="grow">
          <div class="bold">${escapeHtml(s.name)}${closed ? ' <span class="tag" style="background:#fbbf24; color:#78350f; font-size:10px; margin-left:4px">🔒 締切済</span>' : ''}</div>
          ${s.starts_at ? `<div class="meta">${escapeHtml(String(s.starts_at).slice(0, 16))}${s.ends_at ? ' - ' + escapeHtml(String(s.ends_at).slice(11, 16)) : ''}</div>` : ''}
        </div>
        <div class="row" style="gap:4px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" style="font-size:11px; padding:2px 6px" data-add-presenter="${s.id}">＋発表者まとめて</button>
          ${closeBtn}
          <button class="btn" style="font-size:11px; padding:2px 6px" data-edit-session="${s.id}">✏️</button>
          <button class="btn" style="font-size:11px; padding:2px 6px; color:#dc2626" data-del-session="${s.id}">🗑</button>
        </div>
      </div>
      <!-- v943 発表者まとめて追加フォーム (デフォルト hidden、「＋発表者まとめて」で toggle) -->
      <div id="bulk-${s.id}" hidden style="margin-top:8px; padding:8px 10px; background:#faf5ff; border-radius:6px; border:1px dashed #a78bfa">
        <div class="meta" style="margin-bottom:4px">
          発表者を 1 行 1 人で貼り付け (「名前」または「名前: 発表タイトル」形式)
        </div>
        <div class="row" style="gap:8px; margin-bottom:6px; align-items:center">
          <label style="font-size:12px"><input type="radio" name="aff-${s.id}" value="host" checked> ホスト</label>
          <label style="font-size:12px"><input type="radio" name="aff-${s.id}" value="guest"> ゲスト</label>
        </div>
        <textarea id="bulk-ta-${s.id}" rows="5" style="width:100%; font-size:13px; padding:6px 8px; border:1px solid #d1d5db; border-radius:4px; font-family:inherit"
                  placeholder="中村太郎&#10;中村次郎: PDF の効率的な校閲手法&#10;中村三郎"></textarea>
        <div class="row" style="gap:4px; justify-content:flex-end; margin-top:6px">
          <button class="btn" style="font-size:12px; padding:4px 10px" data-bulk-cancel="${s.id}">キャンセル</button>
          <button class="btn primary" style="font-size:12px; padding:4px 10px" data-bulk-save="${s.id}">追加</button>
        </div>
      </div>
      ${(s.presenters || []).length ? `
        <div style="margin-top:8px">
          ${s.presenters.map(p => `
            <div class="row" style="gap:6px; padding:4px 0; align-items:flex-start">
              <span class="tag" style="background:${p.affiliation === 'host' ? '#dbeafe' : '#fce7f3'}; color:${p.affiliation === 'host' ? '#1e40af' : '#9d174d'}; font-size:10px">
                ${escapeHtml(p.affiliation === 'host' ? 'host' : 'guest')}
              </span>
              <div class="grow">
                <b>${escapeHtml(p.name)}</b>
                ${p.is_best ? ' <span style="color:#b45309">🏆 優秀</span>' : ''}
                ${p.title ? `<div class="meta">${escapeHtml(p.title)}</div>` : ''}
              </div>
              <button class="btn" style="font-size:11px; padding:2px 6px" data-edit-presenter="${p.id}">✏️</button>
              <button class="btn" style="font-size:11px; padding:2px 6px; color:#dc2626" data-del-presenter="${p.id}">🗑</button>
            </div>
          `).join('')}
        </div>
      ` : '<div class="muted" style="font-size:12px; margin-top:6px">発表者未登録</div>'}
    </div>
  `;
}

// ---------- モーダル的な inline form (シンプル prompt で MVP) ----------

async function openEditEvent(d) {
  const title = prompt('タイトル', d.title);
  if (title === null) return;
  try { await patch('/api/joint-events/' + d.id, { title }); toast('更新'); refresh(d.id); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function onDeleteEvent(id) {
  if (!confirm('この event を削除しますか? (紐付く session / presenter / 投票も全て消えます)')) return;
  try { await del('/api/joint-events/' + id); toast('削除'); navigate('#/joint-events'); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function openAddSession(eventId) {
  const name = prompt('セッション名 (例: Session A、招待講演 1)');
  if (!name) return;
  try {
    await post('/api/joint-events/' + eventId + '/sessions', { name });
    toast('追加'); refresh(eventId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function openEditSession(eventId, sid) {
  const name = prompt('セッション名');
  if (!name) return;
  try { await patch('/api/joint-events/sessions/' + sid, { name }); toast('更新'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function onDeleteSession(eventId, sid) {
  if (!confirm('このセッションを削除しますか? (発表者・投票も消えます)')) return;
  try { await del('/api/joint-events/sessions/' + sid); toast('削除'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}

// v943 テキストエリアに 1 行 1 発表者を貼り付けてまとめて追加。既存は触らない。
async function onBulkSavePresenters(eventId, sid) {
  const ta = document.getElementById('bulk-ta-' + sid);
  const text = (ta?.value || '').trim();
  if (!text) { toast('発表者を入力してください'); ta?.focus(); return; }
  const affEl = document.querySelector(`input[name="aff-${sid}"]:checked`);
  const affiliation = affEl?.value || 'host';
  const entries = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length);
  if (!entries.length) { toast('発表者を入力してください'); return; }
  if (entries.length > 100) { toast('最大 100 人まで'); return; }
  try {
    const r = await post(`/api/joint-events/${eventId}/sessions/${sid}/presenters/bulk`,
      { affiliation, entries });
    toast(`${(r.created || []).length} 人追加`);
    refresh(eventId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function openEditPresenter(eventId, pid) {
  const name = prompt('発表者名');
  if (!name) return;
  try { await patch('/api/joint-events/presenters/' + pid, { name }); toast('更新'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function onDeletePresenter(eventId, pid) {
  if (!confirm('この発表者を削除しますか?')) return;
  try { await del('/api/joint-events/presenters/' + pid); toast('削除'); refresh(eventId); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function refresh(eventId) {
  const d = await get('/api/joint-events/' + eventId);
  renderJointDetailInto(document.getElementById('app'), d);
}

// ---------- 集計 / 確定 ----------

// v947 研究室単位でまとめて表示 (ユーザ要望)。各 session を host / guest の 2 列に分けて
//   それぞれで順位付け → 「どちらの研究室で誰が 1 位か」が一目でわかる。
async function loadResults(id) {
  const box = document.getElementById('jd-results-view');
  box.innerHTML = '<span class="muted">集計中…</span>';
  try {
    const r = await get('/api/joint-events/' + id + '/results');
    const hostLab  = r.host_lab  || 'ホスト';
    const guestLab = r.guest_lab || 'ゲスト';

    // v948 テーブル気持ち悪い + 🏆 で横幅ズレ問題修正:
    //   - CSS Grid で列幅固定 (rank / name / votes / breakdown / trophy)
    //   - trophy 列は常時 20px 予約、無い行は空白で埋める
    const renderLabGroup = (presenters, labName, bgColor, textColor) => {
      const sorted = [...presenters].sort((a, b) => (b.votes?.total || 0) - (a.votes?.total || 0));
      if (!sorted.length) return `<div class="muted" style="font-size:12px">${escapeHtml(labName)} 発表なし</div>`;
      const topVotes = sorted[0]?.votes?.total || 0;
      return `
        <div style="margin-top:6px">
          <div style="display:inline-block; background:${bgColor}; color:${textColor}; font-size:11px; padding:2px 8px; border-radius:8px; font-weight:600; margin-bottom:4px">
            ${escapeHtml(labName)}
          </div>
          ${sorted.map((p, i) => {
            const total = p.votes?.total || 0;
            const isTop = total > 0 && total === topVotes;
            return `
              <div style="display:grid; grid-template-columns: 24px minmax(0,1fr) 48px 60px 20px; column-gap:8px; align-items:baseline; padding:2px 0; font-size:13px">
                <span style="text-align:right; color:#9ca3af">${i + 1}.</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.name)}</span>
                <span style="font-family:ui-monospace,monospace; text-align:right">${total} 票</span>
                <span class="meta" style="text-align:right; font-family:ui-monospace,monospace; font-size:11px">(${p.votes?.host || 0}/${p.votes?.guest || 0}/${p.votes?.other || 0})</span>
                <span style="text-align:center; color:#059669">${isTop ? '🏆' : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    };

    box.innerHTML = (r.sessions || []).map(s => {
      const hostPresenters  = (s.presenters || []).filter(p => p.affiliation === 'host');
      const guestPresenters = (s.presenters || []).filter(p => p.affiliation === 'guest');
      return `
        <div style="border-top:1px solid #e5e7eb; padding-top:8px; margin-top:8px">
          <div class="bold" style="font-size:13px">${escapeHtml(s.name)}</div>
          ${renderLabGroup(hostPresenters,  hostLab,  '#dbeafe', '#1e40af')}
          ${renderLabGroup(guestPresenters, guestLab, '#fce7f3', '#9d174d')}
        </div>
      `;
    }).join('') + `<div class="hint-sm" style="margin-top:8px">内訳: (${escapeHtml(hostLab)} からの票 / ${escapeHtml(guestLab)} からの票 / 外部)</div>`;
  } catch (e) {
    box.innerHTML = `<span style="color:#dc2626">失敗: ${escapeHtml(e.message)}</span>`;
  }
}

async function onFinalize(id) {
  if (!confirm('各セッションで研究室ごとに 1 位 (計 2 名 / セッション) を優秀発表者として確定します。 (同票時は sort_order 順の先着)\n再確定は可能です。よろしいですか?')) return;
  try {
    await post('/api/joint-events/' + id + '/finalize', {});
    toast('確定しました 🏆');
    refresh(id);
  } catch (e) { toast('失敗: ' + e.message); }
}
