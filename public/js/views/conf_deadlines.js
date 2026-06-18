// /#/conf-deadlines — 学会 〆切 一覧 (#251)。
// 誰でも 登録、 全員 閲覧。 カテゴリ: 国際会議 / 国内研究会 / 論文誌 / その他。 〆切順 表示。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const CATEGORIES = {
  intl_conf:    { icon: '🌐', label: '国際 会議' },
  domestic_conf:{ icon: '🇯🇵', label: '国内 研究会' },
  journal:      { icon: '📰', label: '論文誌' },
  other:        { icon: '📋', label: 'その他' },
};

function fmtAhead(secAhead) {
  if (secAhead <= 0) return '締切 過ぎ';
  const d = Math.floor(secAhead / 86400);
  if (d >= 1) return `あと ${d} 日`;
  const h = Math.floor(secAhead / 3600);
  if (h >= 1) return `あと ${h} 時間`;
  const m = Math.max(1, Math.floor(secAhead / 60));
  return `あと ${m} 分`;
}

function fmtDate(s) {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', ' ');
}

export async function renderConfDeadlines() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">📅 学会 〆切</h2>
        <a class="btn primary" href="#/conf-deadlines/new">＋ 新規 登録</a>
      </div>
      <p class="hint" style="font-size:13px; margin-top:6px">
        学会 / 研究会 / 論文誌 の 投稿 〆切。 誰でも 登録 可、 全員 閲覧 可。
      </p>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px">
        <button class="btn cd-cat" data-cat="">すべて</button>
        ${Object.entries(CATEGORIES).map(([k, v]) =>
          `<button class="btn cd-cat" data-cat="${k}">${v.icon} ${v.label}</button>`).join('')}
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; margin-left:auto">
          <input type="checkbox" id="cd-past"> 過去 も 含める
        </label>
      </div>
      <div id="cd-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  let curCat = '';
  let curPast = false;
  async function reload() {
    const params = [];
    if (curCat) params.push('category=' + curCat);
    if (curPast) params.push('past=1');
    const url = '/api/conf-deadlines' + (params.length ? '?' + params.join('&') : '');
    try {
      const d = await get(url);
      const items = d.items || [];
      const meId = Number(state.me?.id);
      const list = document.getElementById('cd-list');
      if (!items.length) {
        list.innerHTML = '<div class="empty">該当 する 学会 〆切 が ありません</div>';
        return;
      }
      list.innerHTML = items.map(r => {
        const cat = CATEGORIES[r.category] || CATEGORIES.other;
        const dl = new Date(String(r.deadline_at).replace(' ', 'T'));
        const sec = Math.floor((dl - new Date()) / 1000);
        const ahead = fmtAhead(sec);
        const aheadColor = sec <= 0 ? '#999' : sec < 86400*3 ? '#dc2626' : sec < 86400*14 ? '#ea580c' : '#10b981';
        const canEdit = Number(r.created_by_user_id) === meId;
        return `
          <a class="list-item" href="#/conf-deadlines/${r.id}" style="gap:8px; align-items:flex-start">
            <span style="font-size:24px; flex:none">${escapeHtml(cat.icon)}</span>
            <div class="grow" style="min-width:0">
              <div class="bold" style="font-size:15px">${escapeHtml(r.name)}</div>
              <div class="meta">${escapeHtml(cat.label)} ・ 締切 ${escapeHtml(fmtDate(r.deadline_at))}</div>
              ${r.location ? `<div class="meta">📍 ${escapeHtml(r.location)}</div>` : ''}
              <div class="meta">登録: ${escapeHtml(r.creator_name)}${canEdit ? ' ・ あなた' : ''}</div>
            </div>
            <div style="flex:none; text-align:right">
              <div class="bold" style="color:${aheadColor}; font-size:14px">${ahead}</div>
              ${r.url ? '<div class="hint-sm">🔗 URL あり</div>' : ''}
            </div>
          </a>`;
      }).join('');
    } catch (e) {
      document.getElementById('cd-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    }
  }
  document.querySelectorAll('.cd-cat').forEach(b => b.addEventListener('click', () => {
    curCat = b.dataset.cat;
    document.querySelectorAll('.cd-cat').forEach(x => x.classList.toggle('primary', x === b));
    reload();
  }));
  document.getElementById('cd-past').addEventListener('change', e => { curPast = e.target.checked; reload(); });
  document.querySelector('.cd-cat[data-cat=""]').classList.add('primary');
  await reload();
}

export async function renderConfDeadlineForm({ params } = {}) {
  const id = params?.id ? Number(params.id) : null;
  const isEdit = id != null && !Number.isNaN(id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/conf-deadlines" class="hint">← 学会 〆切</a>
      <h2 style="margin:6px 0">${isEdit ? '✏️ 編集' : '＋ 新規 登録'}</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">カテゴリ</span>
        <select id="cd-category">
          ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span class="lbl">名前 (略称)</span>
        <input type="text" id="cd-name" maxlength="200" placeholder="例: CHI 2027" required>
      </label>
      <label class="field"><span class="lbl">正式 名 (任意)</span>
        <input type="text" id="cd-full-name" maxlength="400" placeholder="例: ACM CHI Conference on Human Factors in Computing Systems 2027">
      </label>
      <label class="field"><span class="lbl">URL (任意)</span>
        <input type="url" id="cd-url" maxlength="500" placeholder="https://...">
      </label>
      <label class="field"><span class="lbl">投稿 締切 (必須)</span>
        <input type="datetime-local" id="cd-deadline" required>
      </label>
      <label class="field"><span class="lbl">採択 通知日 (任意)</span>
        <input type="datetime-local" id="cd-notification">
      </label>
      <div class="row" style="gap:6px">
        <label class="field" style="flex:1"><span class="lbl">開催 開始日 (任意)</span>
          <input type="date" id="cd-event-start">
        </label>
        <label class="field" style="flex:1"><span class="lbl">終了日 (任意)</span>
          <input type="date" id="cd-event-end">
        </label>
      </div>
      <label class="field"><span class="lbl">開催 場所 (任意)</span>
        <input type="text" id="cd-location" maxlength="200" placeholder="Yokohama, Japan / Online 等">
      </label>
      <label class="field"><span class="lbl">メモ (任意)</span>
        <textarea id="cd-notes" maxlength="2000" rows="3" placeholder="トラック、 推し論文、 投稿 注意 等"></textarea>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/conf-deadlines" class="btn">キャンセル</a>
        ${isEdit ? '<button id="cd-del" class="danger">削除</button>' : ''}
        <button id="cd-save" class="primary">${isEdit ? '保存' : '登録'}</button>
      </div>
    </div>
  `;
  if (isEdit) {
    try {
      const r = await get('/api/conf-deadlines/' + id);
      document.getElementById('cd-category').value = r.category;
      document.getElementById('cd-name').value = r.name || '';
      document.getElementById('cd-full-name').value = r.full_name || '';
      document.getElementById('cd-url').value = r.url || '';
      const dl = (r.deadline_at || '').replace(' ', 'T').slice(0, 16);
      document.getElementById('cd-deadline').value = dl;
      if (r.notification_at) document.getElementById('cd-notification').value = (r.notification_at || '').replace(' ', 'T').slice(0, 16);
      if (r.event_start) document.getElementById('cd-event-start').value = String(r.event_start).slice(0, 10);
      if (r.event_end)   document.getElementById('cd-event-end').value = String(r.event_end).slice(0, 10);
      document.getElementById('cd-location').value = r.location || '';
      document.getElementById('cd-notes').value = r.notes || '';
      document.getElementById('cd-del').addEventListener('click', async () => {
        if (!confirm('この 学会 〆切 を 削除 しますか?')) return;
        try { await del('/api/conf-deadlines/' + id); toast('削除 しました'); navigate('#/conf-deadlines'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    } catch (e) { toast('取得 失敗: ' + e.message); return; }
  }
  document.getElementById('cd-save').addEventListener('click', async () => {
    const data = {
      category: document.getElementById('cd-category').value,
      name: document.getElementById('cd-name').value.trim(),
      full_name: document.getElementById('cd-full-name').value.trim() || null,
      url: document.getElementById('cd-url').value.trim() || null,
      deadline_at: document.getElementById('cd-deadline').value,
      notification_at: document.getElementById('cd-notification').value || null,
      event_start: document.getElementById('cd-event-start').value || null,
      event_end: document.getElementById('cd-event-end').value || null,
      location: document.getElementById('cd-location').value.trim() || null,
      notes: document.getElementById('cd-notes').value.trim() || null,
    };
    if (!data.name)        { toast('名前 必須'); return; }
    if (!data.deadline_at) { toast('〆切 必須'); return; }
    try {
      if (isEdit) {
        await patch('/api/conf-deadlines/' + id, data);
        toast('保存 しました');
        navigate('#/conf-deadlines/' + id);
      } else {
        const r = await post('/api/conf-deadlines', data);
        toast('登録 しました');
        navigate('#/conf-deadlines');
      }
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderConfDeadlineDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/conf-deadlines" class="hint">← 学会 〆切</a>
      <div id="cd-detail" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
  `;
  try {
    const r = await get('/api/conf-deadlines/' + id);
    const cat = CATEGORIES[r.category] || CATEGORIES.other;
    const meId = Number(state.me?.id);
    const canEdit = Number(r.created_by_user_id) === meId;
    const dl = new Date(String(r.deadline_at).replace(' ', 'T'));
    const sec = Math.floor((dl - new Date()) / 1000);
    const aheadColor = sec <= 0 ? '#999' : sec < 86400*3 ? '#dc2626' : sec < 86400*14 ? '#ea580c' : '#10b981';
    document.getElementById('cd-detail').innerHTML = `
      <div class="row center" style="gap:8px">
        <span style="font-size:32px">${escapeHtml(cat.icon)}</span>
        <div class="grow" style="min-width:0">
          <h2 style="margin:0">${escapeHtml(r.name)}</h2>
          ${r.full_name ? `<div class="meta">${escapeHtml(r.full_name)}</div>` : ''}
          <div class="meta">${escapeHtml(cat.label)}</div>
        </div>
        ${canEdit ? `<a class="btn" href="#/conf-deadlines/${id}/edit">編集</a>` : ''}
      </div>
      <div style="margin-top:12px; padding:10px 14px; background:#fef3c7; border-radius:6px">
        <div class="hint-sm">投稿 締切</div>
        <div style="font-size:20px; font-weight:700; color:${aheadColor}">${escapeHtml(fmtDate(r.deadline_at))} (${fmtAhead(sec)})</div>
      </div>
      ${r.notification_at ? `<div class="meta" style="margin-top:6px">📬 採択 通知: ${escapeHtml(fmtDate(r.notification_at))}</div>` : ''}
      ${(r.event_start || r.event_end) ? `<div class="meta">📆 開催: ${escapeHtml(String(r.event_start || '').slice(0, 10))}${r.event_end ? ' 〜 ' + escapeHtml(String(r.event_end).slice(0, 10)) : ''}</div>` : ''}
      ${r.location ? `<div class="meta">📍 ${escapeHtml(r.location)}</div>` : ''}
      ${r.url ? `<div class="meta">🔗 <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></div>` : ''}
      ${r.notes ? `<div style="margin-top:8px; padding:8px; background:#f9fafb; border-radius:6px; white-space:pre-wrap">${escapeHtml(r.notes)}</div>` : ''}
      <div class="meta" style="margin-top:8px">登録: ${escapeHtml(r.creator_name)} ・ ${escapeHtml(fmtDate(r.created_at))}</div>
    `;
  } catch (e) {
    document.getElementById('cd-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
