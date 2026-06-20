// /#/conf-deadlines — 学会 〆切 一覧 (#251)。
// 誰でも 登録、 全員 閲覧。 カテゴリ: 国際会議 / 国内研究会 / 論文誌 / その他。 〆切順 表示。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

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
          <input type="checkbox" id="cd-mine"> ⭐ 自分 関連 のみ
        </label>
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
          <input type="checkbox" id="cd-past"> 過去 も 含める
        </label>
      </div>
      <div id="cd-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  let curCat = '';
  let curPast = false;
  let curMine = false;
  async function reload() {
    const params = [];
    if (curCat) params.push('category=' + curCat);
    if (curPast) params.push('past=1');
    if (curMine) params.push('mine=1');
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
        const mainLbl = r.deadline_label || '締切';
        const aoeBadge = Number(r.deadline_is_aoe) ? ' 🌐AOE' : '';
        const extras = parseExtra(r.extra_deadlines);
        const extraNote = extras.length ? ` (+${extras.length}件)` : '';
        // v697 #282 自分 関連 は ⭐ + 黄色 ハイライト
        const isMine = !!Number(r.is_mine);
        const mineStyle = isMine ? '; background:#fffbeb; border-left:4px solid #f59e0b' : '';
        const mineMark = isMine ? ' ⭐' : '';
        return `
          <a class="list-item" href="#/conf-deadlines/${r.id}" style="gap:8px; align-items:flex-start${mineStyle}">
            <span style="font-size:24px; flex:none">${escapeHtml(cat.icon)}</span>
            <div class="grow" style="min-width:0">
              <div class="bold" style="font-size:15px">${escapeHtml(r.name)}${mineMark}</div>
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
  document.getElementById('cd-mine').addEventListener('change', e => { curMine = e.target.checked; reload(); });
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

  // v712 #306 入力 補助:
  //   (a) datetime-local の 時刻 が 未入力 (00:00) なら 自動 で 23:59 に。
  //       締切 は ほぼ 必ず 23:59 なので、 ユーザ が 日付 だけ 選んで も デフォルト で
  //       23:59 が 入る ように。
  //   (b) カテゴリ が 国際 会議 (intl_conf) に なったら AOE checkbox を 既定 ON に。
  //       (ユーザ が 既に 手動 で 触って いれば 触らない)
  //   (c) 会期 開始日 を 選んだ ら 終了日 input の min を 開始日 に セット。
  const force2359 = (el) => {
    if (!el) return;
    const v = el.value;
    if (!v) return;
    if (v.endsWith('T00:00') || v.endsWith('T00:00:00')) {
      el.value = v.slice(0, 10) + 'T23:59';
    }
  };
  document.getElementById('cd-deadline').addEventListener('change', e => force2359(e.target));
  extrasRoot.addEventListener('change', e => {
    if (e.target.classList?.contains('cd-ex-dt')) force2359(e.target);
  });
  let aoeUserTouched = false;
  document.getElementById('cd-deadline-aoe').addEventListener('change', () => { aoeUserTouched = true; });
  document.getElementById('cd-category').addEventListener('change', e => {
    if (aoeUserTouched) return;
    document.getElementById('cd-deadline-aoe').checked = (e.target.value === 'intl_conf');
  });
  const eventEnd = document.getElementById('cd-event-end');
  document.getElementById('cd-event-start').addEventListener('change', e => {
    if (e.target.value) {
      eventEnd.min = e.target.value;
      if (eventEnd.value && eventEnd.value < e.target.value) eventEnd.value = e.target.value;
    } else {
      eventEnd.removeAttribute('min');
    }
  });

  if (!isEdit) {
    // v712 #306 新規 登録 で カテゴリ 既定 が 国際 会議 なら AOE も 既定 ON。
    if (document.getElementById('cd-category').value === 'intl_conf') {
      document.getElementById('cd-deadline-aoe').checked = true;
    }
  }
  if (isEdit) {
    try {
      const r = await get('/api/conf-deadlines/' + id);
      // 既存 値 を 読み込んだ 後 は カテゴリ 変更 で AOE を 触らない (手動 扱い)。
      aoeUserTouched = true;
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
      if (r.event_start) {
        document.getElementById('cd-event-start').value = String(r.event_start).slice(0, 10);
        eventEnd.min = String(r.event_start).slice(0, 10);
      }
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
      <!-- v697 #282 メンバー セクション -->
      <div style="margin-top:14px; padding:10px; border:1px solid var(--line); border-radius:6px; background:${r.is_mine ? '#fffbeb' : '#fff'}">
        <div class="row center" style="gap:6px; margin-bottom:6px">
          <div class="bold">👥 メンバー (${(r.members || []).length})</div>
          <span style="flex:1"></span>
          ${r.is_mine
            ? `<button id="cd-leave" class="btn" style="font-size:12px">離脱</button>`
            : `<button id="cd-join" class="btn primary" style="font-size:12px">⭐ 参加 する</button>`}
          ${canEdit ? `<button id="cd-add-member" class="btn" style="font-size:12px">＋ 追加</button>` : ''}
        </div>
        <div id="cd-members-list">
          ${(r.members || []).length === 0
            ? '<div class="hint-sm">まだ メンバー は いません</div>'
            : (r.members || []).map(m => {
                const initial = (m.display_name || '?').trim().charAt(0).toUpperCase();
                const av = m.avatar_url
                  ? `<img src="${escapeHtml(m.avatar_url)}" style="width:24px; height:24px; border-radius:50%; object-fit:cover">`
                  : `<div style="width:24px; height:24px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px">${escapeHtml(initial)}</div>`;
                const canRm = canEdit || Number(m.user_id) === meId;
                return `<div style="display:inline-flex; align-items:center; gap:4px; margin:2px 6px 2px 0; padding:2px 6px; background:#fff; border-radius:14px; border:1px solid var(--line); font-size:12px">
                  ${av}<span>${escapeHtml(m.display_name)}</span>${canRm ? `<button data-rm-member="${m.user_id}" style="border:none; background:transparent; cursor:pointer; color:#999; padding:0 2px">×</button>` : ''}
                </div>`;
              }).join('')}
        </div>
      </div>
    `;
    document.getElementById('cd-join')?.addEventListener('click', async () => {
      try { await post('/api/conf-deadlines/' + id + '/join', {}); toast('参加 しました'); renderConfDeadlineDetail({ params: { id } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('cd-leave')?.addEventListener('click', async () => {
      if (!confirm('この 学会 〆切 から 離脱 しますか?')) return;
      try { await post('/api/conf-deadlines/' + id + '/leave', {}); toast('離脱 しました'); renderConfDeadlineDetail({ params: { id } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    // v698 #284 prompt 入力 を 廃止 し、 共通 の member_picker を modal で 出す。
    document.getElementById('cd-add-member')?.addEventListener('click', async () => {
      const existingIds = (r.members || []).map(m => Number(m.user_id));
      const exclude = existingIds.concat([Number(r.created_by_user_id)]);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:14px';
      wrap.innerHTML = `
        <div style="background:#fff; border-radius:8px; padding:14px; max-width:600px; width:100%; max-height:80vh; overflow-y:auto">
          <div class="bold" style="margin-bottom:6px">👥 メンバー を 選択 (<span id="cd-mp-count">0</span>)</div>
          <div id="cd-mp-bulk" class="row" style="flex-wrap:wrap; gap:4px; margin-bottom:6px"></div>
          <div id="cd-mp-chips" class="row" style="flex-wrap:wrap; gap:4px"></div>
          <div class="row" style="gap:6px; margin-top:10px; justify-content:flex-end">
            <button id="cd-mp-cancel" class="btn">キャンセル</button>
            <button id="cd-mp-ok" class="btn primary">追加 する</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const picker = await createMemberPicker({
        bulkContainer: wrap.querySelector('#cd-mp-bulk'),
        chipsContainer: wrap.querySelector('#cd-mp-chips'),
        countLabel: wrap.querySelector('#cd-mp-count'),
        excludeIds: exclude,
      });
      wrap.querySelector('#cd-mp-cancel').addEventListener('click', () => wrap.remove());
      wrap.querySelector('#cd-mp-ok').addEventListener('click', async () => {
        const ids = [...picker.getSelected()];
        if (!ids.length) { toast('1 人 以上 選んで ください'); return; }
        try {
          await post('/api/conf-deadlines/' + id + '/members', { user_ids: ids });
          toast(`${ids.length} 人 追加 しました`);
          wrap.remove();
          renderConfDeadlineDetail({ params: { id } });
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    document.querySelectorAll('[data-rm-member]').forEach(b => b.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const target = b.dataset.rmMember;
      if (!confirm('この メンバー を 外し ますか?')) return;
      try { await del('/api/conf-deadlines/' + id + '/members/' + target); toast('外し ました'); renderConfDeadlineDetail({ params: { id } }); }
      catch (e) { toast('失敗: ' + e.message); }
    }));
  } catch (e) {
    document.getElementById('cd-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
