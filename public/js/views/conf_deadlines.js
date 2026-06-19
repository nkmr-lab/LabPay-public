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

// v691 #275 AOE (Anywhere on Earth = UTC-12) サポート
//   AOE 入力 ↔ JST 保存 の 変換 (JST = AOE + 21 時間)。
//   保存 は 常 に JST wall-clock で、 表示時 に is_aoe なら AOE 形式 に 戻して 見せる。
function jstStrToAoeStr(jstStr) {
  if (!jstStr) return '';
  // jstStr = "2026-06-20 20:59:00" (treat as JST wall-clock)
  const iso = String(jstStr).replace(' ', 'T') + '+09:00';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  // AOE = UTC-12. Format the instant in UTC-12 → use offset by hand.
  const aoe = new Date(ms - 12 * 3600 * 1000); // UTC time - 12h gives AOE wall-clock when read as UTC
  return aoe.toISOString().slice(0, 16).replace('T', ' ');
}
function aoeStrToJstStr(aoeStr) {
  if (!aoeStr) return '';
  // aoeStr = "2026-06-19 23:59" treat as UTC-12 wall-clock
  const iso = String(aoeStr).replace(' ', 'T') + '-12:00';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  // Format as JST wall-clock
  const jst = new Date(ms + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 16).replace('T', ' ');
}
function parseExtra(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (_) { return []; }
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
        // v691 #275 label / AOE / extras 件数 を 表示
        const mainLbl = r.deadline_label || '締切';
        const aoeBadge = Number(r.deadline_is_aoe) ? ' 🌐AOE' : '';
        const extras = parseExtra(r.extra_deadlines);
        const extraNote = extras.length ? ` (+${extras.length}件)` : '';
        return `
          <a class="list-item" href="#/conf-deadlines/${r.id}" style="gap:8px; align-items:flex-start">
            <span style="font-size:24px; flex:none">${escapeHtml(cat.icon)}</span>
            <div class="grow" style="min-width:0">
              <div class="bold" style="font-size:15px">${escapeHtml(r.name)}</div>
              <div class="meta">${escapeHtml(cat.label)} ・ ${escapeHtml(mainLbl)}${aoeBadge} ${escapeHtml(fmtDate(r.deadline_at))}${extraNote}</div>
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
      <fieldset class="field" style="border:1px solid var(--line); border-radius:6px; padding:8px">
        <legend style="font-size:12px; color:#666">📅 メイン 締切 (必須)</legend>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label style="flex:1; min-width:120px"><span class="lbl" style="font-size:11px">種別 (任意)</span>
            <input type="text" id="cd-deadline-label" maxlength="50" placeholder="原稿 / 申込 / アブスト 等">
          </label>
          <label style="flex:2; min-width:180px"><span class="lbl" style="font-size:11px">日時</span>
            <input type="datetime-local" id="cd-deadline" required>
          </label>
        </div>
        <label style="display:inline-flex; gap:6px; align-items:center; font-size:12px; margin-top:4px">
          <input type="checkbox" id="cd-deadline-aoe">
          🌐 AOE (Anywhere on Earth) で 指定 する
          <span class="hint-sm" style="font-size:10px">※ AOE = UTC-12。 入力 は AOE 時刻 で、 内部 は JST 換算 で 保存。</span>
        </label>
      </fieldset>
      <fieldset class="field" style="border:1px dashed var(--line); border-radius:6px; padding:8px">
        <legend style="font-size:12px; color:#666">➕ サブ 締切 (任意、 最大 10 件)</legend>
        <div id="cd-extras"></div>
        <button type="button" id="cd-extra-add" class="btn" style="font-size:12px; padding:2px 8px">＋ サブ 締切 を 追加</button>
        <div class="hint-sm" style="font-size:10px; margin-top:4px">申込 / アブスト など、 原稿 締切 以外 の 締切 を 並べて 登録 できます。</div>
      </fieldset>
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
  // v691 #275 サブ 締切 の 行 を 追加
  const extrasRoot = document.getElementById('cd-extras');
  function addExtraRow(initial) {
    const row = document.createElement('div');
    row.className = 'row cd-extra-row';
    row.style.cssText = 'gap:6px; align-items:flex-end; margin-bottom:4px; flex-wrap:wrap';
    row.innerHTML = `
      <input type="text" class="cd-ex-label" maxlength="50" placeholder="種別 (申込 / アブスト 等)" style="flex:1; min-width:120px; font-size:12px">
      <input type="datetime-local" class="cd-ex-dt" style="flex:2; min-width:180px; font-size:12px">
      <label style="display:inline-flex; gap:4px; align-items:center; font-size:11px">
        <input type="checkbox" class="cd-ex-aoe"> AOE
      </label>
      <button type="button" class="btn cd-ex-rm danger" style="font-size:11px; padding:2px 6px">削除</button>
    `;
    if (initial) {
      row.querySelector('.cd-ex-label').value = initial.label || '';
      const dt = String(initial.deadline_at || '').replace(' ', 'T').slice(0, 16);
      if (initial.is_aoe) {
        row.querySelector('.cd-ex-aoe').checked = true;
        row.querySelector('.cd-ex-dt').value = jstStrToAoeStr(initial.deadline_at);
      } else {
        row.querySelector('.cd-ex-dt').value = dt;
      }
    }
    row.querySelector('.cd-ex-rm').addEventListener('click', () => row.remove());
    extrasRoot.appendChild(row);
  }
  document.getElementById('cd-extra-add').addEventListener('click', () => {
    if (extrasRoot.querySelectorAll('.cd-extra-row').length >= 10) { toast('サブ 締切 は 最大 10 件'); return; }
    addExtraRow();
  });
  if (isEdit) {
    try {
      const r = await get('/api/conf-deadlines/' + id);
      document.getElementById('cd-category').value = r.category;
      document.getElementById('cd-name').value = r.name || '';
      document.getElementById('cd-full-name').value = r.full_name || '';
      document.getElementById('cd-url').value = r.url || '';
      document.getElementById('cd-deadline-label').value = r.deadline_label || '';
      document.getElementById('cd-deadline-aoe').checked = !!Number(r.deadline_is_aoe);
      if (Number(r.deadline_is_aoe)) {
        document.getElementById('cd-deadline').value = jstStrToAoeStr(r.deadline_at);
      } else {
        document.getElementById('cd-deadline').value = (r.deadline_at || '').replace(' ', 'T').slice(0, 16);
      }
      parseExtra(r.extra_deadlines).forEach(addExtraRow);
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
    const isAoe = document.getElementById('cd-deadline-aoe').checked;
    const dlInput = document.getElementById('cd-deadline').value;
    const deadlineJst = isAoe ? aoeStrToJstStr(dlInput) : dlInput;
    const extras = [];
    document.querySelectorAll('.cd-extra-row').forEach(row => {
      const lbl = row.querySelector('.cd-ex-label').value.trim();
      const dt = row.querySelector('.cd-ex-dt').value;
      const aoe = row.querySelector('.cd-ex-aoe').checked;
      if (!dt) return;
      extras.push({
        label: lbl || '締切',
        deadline_at: aoe ? aoeStrToJstStr(dt) : dt,
        is_aoe: aoe ? 1 : 0,
      });
    });
    const data = {
      category: document.getElementById('cd-category').value,
      name: document.getElementById('cd-name').value.trim(),
      full_name: document.getElementById('cd-full-name').value.trim() || null,
      url: document.getElementById('cd-url').value.trim() || null,
      deadline_at: deadlineJst,
      deadline_label: document.getElementById('cd-deadline-label').value.trim() || null,
      deadline_is_aoe: isAoe ? 1 : 0,
      extra_deadlines: extras,
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
    // v691 #275 メイン + サブ 締切 を 1 つ の リスト に まとめて 表示。 AOE 付き は AOE 形式 も 併記。
    const mainLabel = r.deadline_label || '投稿 締切';
    const mainAoe = !!Number(r.deadline_is_aoe);
    const allDeadlines = [
      { label: mainLabel, deadline_at: r.deadline_at, is_aoe: mainAoe ? 1 : 0, _main: true },
      ...parseExtra(r.extra_deadlines),
    ];
    const dlHtml = allDeadlines.map(d => {
      const dl2 = new Date(String(d.deadline_at).replace(' ', 'T'));
      const s2 = Math.floor((dl2 - new Date()) / 1000);
      const col = s2 <= 0 ? '#999' : s2 < 86400*3 ? '#dc2626' : s2 < 86400*14 ? '#ea580c' : '#10b981';
      const aoeBadge = d.is_aoe ? '<span class="tag" style="background:#dbeafe; color:#1e40af; font-size:10px; margin-left:4px">🌐 AOE</span>' : '';
      const aoeNote = d.is_aoe ? `<div class="hint-sm" style="font-size:10px">AOE: ${escapeHtml(jstStrToAoeStr(d.deadline_at))}</div>` : '';
      return `<div style="padding:8px 12px; background:${d._main ? '#fef3c7' : '#fff7ed'}; border-radius:6px; margin-top:6px; border-left:3px solid ${col}">
        <div class="hint-sm">${escapeHtml(d.label)}${aoeBadge}</div>
        <div style="font-size:16px; font-weight:700; color:${col}">${escapeHtml(fmtDate(d.deadline_at))} (${fmtAhead(s2)})</div>
        ${aoeNote}
      </div>`;
    }).join('');
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
      ${dlHtml}
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
