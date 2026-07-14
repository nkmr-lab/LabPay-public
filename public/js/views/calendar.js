// v1079 月表示 Google Calendar + 既存イベントへの Zoom 追加 UI。
//   中村さん指示「Google カレンダー表示機能、今は今日の予定しか見えないけど、
//     月モードで表示したり、次の月とかに移動して表示したりしたい。で、そこから
//     Zoom を追加したい」
//   ホームカードの「今日の予定」はそのまま残置。このビューは /#/calendar の
//   全画面月表示 + 前後月ナビ + イベント詳細モーダル + Zoom 追加ボタン。
//   URL に ?ym=YYYY-MM を持たせて前後ボタンで back button も効くように。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const CACHE_PREFIX = 'labpay-cal-month-';   // per-month cache key
const CACHE_TTL_MS = 3 * 60 * 1000;         // 3 分

function pad(n) { return String(n).padStart(2, '0'); }
function ymToParts(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return null;
  const y = Number(m[1]), mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { y, m: mm };
}
function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function shiftYm(ym, delta) {
  const p = ymToParts(ym) || ymToParts(currentYm());
  const d = new Date(p.y, p.m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function localTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; }
  catch { return 'Asia/Tokyo'; }
}
function readCache(ym) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + ym);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.timestamp) return null;
    return obj;
  } catch { return null; }
}
function writeCache(ym, items) {
  try { localStorage.setItem(CACHE_PREFIX + ym, JSON.stringify({ items, timestamp: Date.now() })); } catch {}
}
function invalidateCache(ym) { try { localStorage.removeItem(CACHE_PREFIX + ym); } catch {} }
function invalidateAllCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}

function monthRange(ym) {
  const p = ymToParts(ym);
  const first = new Date(p.y, p.m - 1, 1);
  const last  = new Date(p.y, p.m, 0);   // last day of the month
  return {
    from: `${p.y}-${pad(p.m)}-01`,
    to:   `${p.y}-${pad(p.m)}-${pad(last.getDate())}`,
    firstWeekday: first.getDay(),   // 0=Sun
    daysInMonth: last.getDate(),
  };
}

// 曜日ラベル (日曜始まり、 Google Calendar の慣習)。
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// カレンダーごとの色 (7 色ローテ、 hash で決定的)。 Google Calendar API は
// 個別イベントの colorId も返せるが、とりあえず calendarId ベースで塗り分け。
const PALETTE = ['#7b3fa0', '#0369a1', '#059669', '#a16207', '#dc2626', '#c026d3', '#0891b2'];
function calColor(calId) {
  let h = 0;
  const s = String(calId || 'primary');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function eventStartLocalYmd(ev) {
  // イベントの start (RFC3339 or YYYY-MM-DD) をローカル日付の "YYYY-MM-DD" に。
  const s = String(ev.start || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;      // all-day
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return null; }
}
function eventTimeLabel(ev) {
  if (ev.all_day) return '終日';
  try {
    const d = new Date(ev.start);
    if (isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

async function fetchMonth(ym, { force = false } = {}) {
  if (!force) {
    const cache = readCache(ym);
    if (cache && (Date.now() - cache.timestamp < CAL_TTL())) return cache.items;
  }
  const { from, to } = monthRange(ym);
  const data = await get('/api/me/calendar/events', { tz: localTz(), from, to });
  const items = (data && data.items) || [];
  writeCache(ym, items);
  return items;
}
function CAL_TTL() { return CACHE_TTL_MS; }

// ------- メインエントリ -------
// router.js は render に { params, query } を渡す。 query.ym があればそれ、
//   無ければ現在月にリダイレクト (?ym= を URL に載せて戻るボタンを効かせる)。
export async function renderCalendar({ query } = {}) {
  const app = document.getElementById('app');
  const ym = (query && query.ym) || currentYm();
  if (!ymToParts(ym)) return navigate('#/calendar?ym=' + currentYm());

  app.innerHTML = renderShell(ym);
  wireNav(ym);
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = renderGridSkeleton(ym);
  try {
    const items = await fetchMonth(ym);
    grid.innerHTML = renderGrid(ym, items);
    wireGridInteractions(ym, items);
  } catch (e) {
    grid.innerHTML = `<div class="card" style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</div>
      ${/(unauthorized|calendar_reauth|not connected)/i.test(e?.message || '')
        ? `<div class="card"><a href="/api/auth/calendar/connect" class="btn primary">🔗 Google Calendar を連携</a></div>` : ''}`;
  }
}

function renderShell(ym) {
  const p = ymToParts(ym);
  const prev = shiftYm(ym, -1);
  const next = shiftYm(ym, +1);
  const isCurrent = ym === currentYm();
  return `
    <div class="card page-header">
      <h2 style="margin:0">📅 カレンダー</h2>
      <div class="hint-sm" style="margin-top:4px">Google Calendar の月表示。予定タップで詳細 + Zoom 追加。「◀ / ▶」で前後月へ。</div>
    </div>
    <div class="card">
      <div class="row" style="align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px">
        <div class="row" style="align-items:center; gap:6px">
          <button class="btn" data-cal-nav="prev" aria-label="前月">◀</button>
          <div style="font-weight:700; font-size:16px; min-width:110px; text-align:center">${p.y}年 ${p.m}月</div>
          <button class="btn" data-cal-nav="next" aria-label="次月">▶</button>
          ${!isCurrent ? `<button class="btn" data-cal-nav="today" style="margin-left:6px">今月へ戻る</button>` : ''}
        </div>
        <div class="row" style="gap:6px; align-items:center">
          <input type="month" id="cal-ym" value="${ym}" style="padding:4px 6px; font-size:13px">
          <button class="btn" id="cal-refresh" title="キャッシュを捨てて再取得">🔄</button>
          <a class="btn primary" href="#/" style="text-decoration:none">🏠 ホーム</a>
        </div>
      </div>
    </div>
    <div id="cal-grid"></div>
    <div id="cal-modal"></div>
  `;
}

function renderGridSkeleton() {
  return `<div class="card" style="padding:20px; text-align:center; color:#6b7280">読み込み中…</div>`;
}

function renderGrid(ym, items) {
  const { firstWeekday, daysInMonth } = monthRange(ym);
  const p = ymToParts(ym);
  // 日付 → イベント配列のマッピング
  const byDate = new Map();
  for (const ev of items) {
    const ymd = eventStartLocalYmd(ev);
    if (!ymd) continue;
    if (!byDate.has(ymd)) byDate.set(ymd, []);
    byDate.get(ymd).push(ev);
  }
  // 各日のイベントを時刻順にソート (all_day は先頭)
  for (const arr of byDate.values()) {
    arr.sort((a, b) => {
      if (a.all_day && !b.all_day) return -1;
      if (!a.all_day && b.all_day) return  1;
      return String(a.start).localeCompare(String(b.start));
    });
  }
  const todayYmd = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
  const cells = [];
  // 空セル (月頭の前埋め)
  for (let i = 0; i < firstWeekday; i++) cells.push('<div class="cal-cell cal-empty"></div>');
  // 各日
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${p.y}-${pad(p.m)}-${pad(d)}`;
    const dow = new Date(p.y, p.m - 1, d).getDay();
    const dayEvents = byDate.get(ymd) || [];
    const isToday = ymd === todayYmd;
    const isSat = dow === 6, isSun = dow === 0;
    const dowClass = isToday ? 'today' : (isSat ? 'sat' : (isSun ? 'sun' : ''));
    const shown = dayEvents.slice(0, 3);
    const rest = Math.max(0, dayEvents.length - shown.length);
    cells.push(`
      <div class="cal-cell ${dowClass}" data-cal-day="${ymd}">
        <div class="cal-daynum">${d}</div>
        <div class="cal-evs">
          ${shown.map((ev, idx) => {
            const color = calColor(ev.calendar);
            const hasZoom = !!ev.url;
            const time = ev.all_day ? '' : eventTimeLabel(ev) + ' ';
            return `<div class="cal-ev" data-cal-ev-idx="${idx}" data-cal-ev-key="${escapeHtml(ymd + '|' + idx)}"
                       style="background:${color}20; border-left:3px solid ${color}"
                       title="${escapeHtml(ev.title || '')}">
                       ${hasZoom ? '🎦 ' : ''}<span style="color:${color}; font-weight:600">${escapeHtml(time)}</span>${escapeHtml(ev.title || '(無題)')}
                     </div>`;
          }).join('')}
          ${rest > 0 ? `<div class="cal-more">+${rest} 件</div>` : ''}
        </div>
      </div>`);
  }
  // 末尾の空セル (行を 7 の倍数に揃える) — 実際は最低限のパディングでOK
  while (cells.length % 7 !== 0) cells.push('<div class="cal-cell cal-empty"></div>');
  return `
    <style>
      .cal-head { display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; margin-bottom:2px }
      .cal-head > div { text-align:center; padding:6px 0; font-size:12px; font-weight:600; background:#f3f4f6; border-radius:4px }
      .cal-head > .sat { color:#0369a1 } .cal-head > .sun { color:#dc2626 }
      .cal-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; background:#e5e7eb; border-radius:6px; padding:2px }
      .cal-cell { background:#fff; min-height:88px; padding:4px; cursor:pointer; position:relative; border-radius:4px }
      .cal-cell.cal-empty { background:#fafafa; cursor:default }
      .cal-cell.today { background:#fef3c7 }
      .cal-daynum { font-size:12px; font-weight:600; color:#374151; margin-bottom:2px }
      .cal-cell.sat .cal-daynum { color:#0369a1 } .cal-cell.sun .cal-daynum { color:#dc2626 }
      .cal-cell.today .cal-daynum { color:#7b3fa0 }
      .cal-evs { display:flex; flex-direction:column; gap:1px }
      .cal-ev { font-size:10.5px; padding:1px 4px; border-radius:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.4 }
      .cal-more { font-size:10px; color:#6b7280; padding:0 4px }
      @media (max-width:640px) {
        .cal-cell { min-height:64px; padding:2px }
        .cal-ev { font-size:9px; padding:1px 2px }
      }
    </style>
    <div class="card" style="padding:6px">
      <div class="cal-head">${DOW.map((d, i) => `<div class="${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>
    <div class="hint-sm" style="margin-top:6px; text-align:right; color:#6b7280">合計 ${items.length} 件 / ${p.y}年 ${p.m}月</div>
  `;
}

function wireNav(ym) {
  document.querySelector('[data-cal-nav="prev"]')?.addEventListener('click', () => navigate('#/calendar?ym=' + shiftYm(ym, -1)));
  document.querySelector('[data-cal-nav="next"]')?.addEventListener('click', () => navigate('#/calendar?ym=' + shiftYm(ym, +1)));
  document.querySelector('[data-cal-nav="today"]')?.addEventListener('click', () => navigate('#/calendar?ym=' + currentYm()));
  document.getElementById('cal-ym')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (ymToParts(v)) navigate('#/calendar?ym=' + v);
  });
  document.getElementById('cal-refresh')?.addEventListener('click', async () => {
    invalidateCache(ym);
    renderCalendar();
  });
}

function wireGridInteractions(ym, items) {
  const grid = document.getElementById('cal-grid');
  grid.querySelectorAll('.cal-cell:not(.cal-empty)').forEach(cell => {
    cell.addEventListener('click', (ev) => {
      const evEl = ev.target.closest('.cal-ev');
      const ymd = cell.dataset.calDay;
      if (evEl) {
        const idx = Number(evEl.dataset.calEvIdx);
        openEventModal(findEventAt(items, ymd, idx), ym);
      } else {
        // Only handle the day when the .cal-more is clicked (or if the empty area).
        openDayModal(items, ymd, ym);
      }
    });
  });
}

function findEventAt(items, ymd, idx) {
  const day = items
    .filter(e => eventStartLocalYmd(e) === ymd)
    .sort((a, b) => {
      if (a.all_day && !b.all_day) return -1;
      if (!a.all_day && b.all_day) return  1;
      return String(a.start).localeCompare(String(b.start));
    });
  return day[idx] || null;
}

function fmtRange(ev) {
  if (ev.all_day) return '終日';
  try {
    const s = new Date(ev.start), e = new Date(ev.end || ev.start);
    const sd = `${s.getMonth()+1}/${s.getDate()} ${pad(s.getHours())}:${pad(s.getMinutes())}`;
    const sameDay = s.toDateString() === e.toDateString();
    const ed = sameDay ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : `${e.getMonth()+1}/${e.getDate()} ${pad(e.getHours())}:${pad(e.getMinutes())}`;
    return `${sd} – ${ed}`;
  } catch { return ev.start || ''; }
}

function openEventModal(ev, ym) {
  if (!ev) return;
  const root = document.getElementById('cal-modal');
  const hasZoom = !!ev.url;
  const canAddZoom = !ev.all_day && !hasZoom;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" data-cal-close="1">
      <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; padding:20px" data-cal-inner>
        <div class="row" style="align-items:center; justify-content:space-between">
          <h3 style="margin:0; font-size:16px">${escapeHtml(ev.title || '(無題)')}</h3>
          <button class="btn" data-cal-close="1">×</button>
        </div>
        <div style="margin-top:8px; font-size:13px; color:#374151">⏰ ${escapeHtml(fmtRange(ev))}</div>
        ${ev.location ? `<div style="margin-top:4px; font-size:13px">📍 ${escapeHtml(ev.location)}</div>` : ''}
        ${hasZoom ? `<div style="margin-top:8px; padding:8px 10px; background:#f0f9ff; border-radius:6px">
          🎦 <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">${escapeHtml(ev.url)}</a>
        </div>` : ''}
        <div style="margin-top:6px; font-size:12px; color:#6b7280">カレンダー: ${escapeHtml(ev.calendar || 'primary')}</div>
        <div class="row" style="gap:6px; margin-top:12px; flex-wrap:wrap; justify-content:flex-end">
          ${ev.html_url ? `<a class="btn" href="${escapeHtml(ev.html_url)}" target="_blank" rel="noopener">🔗 Google で開く</a>` : ''}
          ${canAddZoom ? `<button class="btn primary" data-cal-add-zoom data-cal-ev-id="${escapeHtml(ev.id)}" data-cal-cal="${escapeHtml(ev.calendar || 'primary')}">🎦 Zoom を追加</button>` : ''}
          <button class="btn" data-cal-close="1">閉じる</button>
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-cal-close]').forEach(el => el.addEventListener('click', (e) => { if (e.target === el) closeModal(); }));
  const btn = root.querySelector('[data-cal-add-zoom]');
  if (btn) {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.calEvId;
      const calId   = btn.dataset.calCal || 'primary';
      if (!eventId) return;
      btn.disabled = true; btn.textContent = '作成中…';
      try {
        const r = await post(`/api/me/calendar/events/${encodeURIComponent(eventId)}/zoom`, { calendar_id: calId });
        if (r?.invalidate_calendar_cache) { invalidateAllCache(); try { localStorage.removeItem('labpay-cal-events-cache'); } catch {} }
        toast('Zoom MTG を追加しました');
        closeModal();
        invalidateCache(ym);
        renderCalendar();
      } catch (e) {
        toast('失敗: ' + (e?.message || e));
        btn.disabled = false; btn.textContent = '🎦 Zoom を追加';
      }
    });
  }
}

function openDayModal(items, ymd, ym) {
  const day = items
    .filter(e => eventStartLocalYmd(e) === ymd)
    .sort((a, b) => {
      if (a.all_day && !b.all_day) return -1;
      if (!a.all_day && b.all_day) return  1;
      return String(a.start).localeCompare(String(b.start));
    });
  const root = document.getElementById('cal-modal');
  const [y, m, d] = ymd.split('-').map(Number);
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" data-cal-close="1">
      <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; padding:20px" data-cal-inner>
        <div class="row" style="align-items:center; justify-content:space-between">
          <h3 style="margin:0; font-size:16px">${y}年 ${m}月 ${d}日の予定</h3>
          <button class="btn" data-cal-close="1">×</button>
        </div>
        ${day.length === 0
          ? '<div class="hint-sm" style="margin-top:12px; color:#6b7280">予定はありません</div>'
          : `<div style="margin-top:10px; display:flex; flex-direction:column; gap:6px">
              ${day.map((ev, idx) => {
                const color = calColor(ev.calendar);
                const hasZoom = !!ev.url;
                return `<button class="cal-day-item" data-cal-open-idx="${idx}"
                          style="text-align:left; background:${color}15; border:1px solid ${color}55; border-left:4px solid ${color}; border-radius:6px; padding:8px 10px; cursor:pointer">
                          <div style="font-weight:600; color:${color}">${escapeHtml(hasZoom ? '🎦 ' : '')}${escapeHtml(ev.all_day ? '終日' : eventTimeLabel(ev))} ${escapeHtml(ev.title || '(無題)')}</div>
                          ${ev.location ? `<div style="font-size:11px; color:#6b7280; margin-top:2px">📍 ${escapeHtml(ev.location)}</div>` : ''}
                        </button>`;
              }).join('')}
            </div>`}
        <div class="hint-sm" style="margin-top:12px; padding:8px; background:#faf5ff; border-radius:6px; color:#7b3fa0">
          💡 予定の新規作成 (Zoom 込み) はホームの「＋ MTG」ボタンから (今後このモーダルからも作れるように予定)
        </div>
        <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
          <button class="btn" data-cal-close="1">閉じる</button>
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-cal-close]').forEach(el => el.addEventListener('click', (e) => { if (e.target === el) closeModal(); }));
  root.querySelectorAll('[data-cal-open-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.calOpenIdx);
      openEventModal(day[idx], ym);
    });
  });
}

function closeModal() {
  const root = document.getElementById('cal-modal');
  if (root) root.innerHTML = '';
}
