// /#/research-notes — Cosense 研究ノート ビューア + エディタ。
//   v834: フルスクリーン表示 + ✕で閉じる、 GitHub風ヒートカレンダー、 localStorage キャッシュ +
//   ETag (304) によるかしこい再取得、 前月/次月をバックグラウンド プリフェッチ。
import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const CACHE_PREFIX = 'cosense:';
const SECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日でキャッシュ自動破棄

let stateLocal = {
  handle: null,
  canWrite: false,
  selectedDate: null,
  visibleYm: null,
  mode: 'view',                  // 'view' | 'edit'
  loaded: { date: null, text: '', exists: false },
  monthData: {},                 // 'YYYY.MM' → { days: {date: {line_count, char_count}} }
};

export async function renderResearchNotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="rn-fullscreen" style="box-sizing:border-box">
      <div class="row center" style="margin-bottom:8px; gap:8px">
        <h2 style="margin:0; font-size:18px; flex:1">📝 研究ノート</h2>
      </div>
      <div id="rn-status" hidden>
        <div class="muted">読み込み中…</div>
      </div>
      <div id="rn-body" hidden>
        <div id="rn-calendar" style="margin-bottom:12px"></div>

        <div class="row center" style="gap:6px; flex-wrap:wrap; margin-bottom:8px">
          <span id="rn-date-label" class="bold" style="font-size:14px"></span>
          <span style="flex:1"></span>
          <span id="rn-cache-badge" class="hint-sm" style="font-size:11px"></span>
        </div>

        <div id="rn-view" hidden>
          <div id="rn-view-body" style="min-height:60px"></div>
          <div class="row" style="margin-top:8px; gap:6px; align-items:center">
            <button id="rn-edit-btn" class="primary" hidden>✏️ 編集</button>
            <span id="rn-no-edit-hint" class="hint-sm" style="color:#dc2626" hidden></span>
          </div>
        </div>

        <div id="rn-edit" hidden>
          <p class="hint-sm" style="margin:4px 0 6px">
            このセクションの本文をまるごとロードしています。 自由に編集してください。 保存を押すと差分のみ Scrapbox にコミット。
            行頭の半角スペースは Scrapbox のインデントなので、 右側のプレビューで「保存するとこう見える」 を確認しながら書いてください。
          </p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
            <div>
              <div class="hint-sm" style="margin-bottom:2px">📝 編集</div>
              <textarea id="rn-text" rows="12" maxlength="50000" placeholder=" 本文を書く" style="width:100%; font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace; font-size:13px; line-height:1.6; box-sizing:border-box; padding:8px 10px; min-height:240px"></textarea>
            </div>
            <div>
              <div class="hint-sm" style="margin-bottom:2px">👁 プレビュー</div>
              <div id="rn-preview" style="min-height:240px; max-height:480px; overflow:auto; border:1px solid var(--line); border-radius:6px; padding:8px 10px; background:#fafafa; font-size:13px; line-height:1.6"></div>
            </div>
          </div>
          <div class="row" style="gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap">
            <button id="rn-save" class="primary">💾 保存 (差分コミット)</button>
            <button id="rn-cancel" class="btn">キャンセル</button>
            <span id="rn-stats" class="hint-sm" style="margin-left:auto"></span>
          </div>
        </div>
      </div>
    </div>
  `;
  await loadInitial();
}

async function loadInitial() {
  const statusEl = document.getElementById('rn-status');
  statusEl.hidden = false;
  statusEl.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    const r = await fetchEtagged('/api/cosense/research-note/days?count=2', 'days');
    const d = r.data;
    if (d.has_handle === false) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">名前 (Scrapbox 上の表記) が未設定</div>
        <div style="font-size:13px; margin-top:6px">${escapeHtml(d.message || '')}</div>`;
      return;
    }
    if (!d.cookie_present) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">⚠ Scrapbox との連携がまだ設定されていません</div>
        <div style="font-size:13px; margin-top:6px">
          「設定」 → 「📝 Cosense (Scrapbox) 連携」 から、 Scrapbox の鍵 (Personal Access Token) を登録してください。
        </div>`;
      return;
    }
    stateLocal.handle = d.handle;
    stateLocal.canWrite = !!d.can_write;
    stateLocal.selectedDate = d.today;
    stateLocal.visibleYm = d.today.slice(0, 7); // 'YYYY.MM'
    statusEl.hidden = true;
    document.getElementById('rn-body').hidden = false;

    await renderCalendar(stateLocal.visibleYm);
    await loadSection(stateLocal.selectedDate);
    schedulePrefetch(stateLocal.visibleYm);
  } catch (e) {
    statusEl.innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}

async function switchDate(dateKey) {
  if (stateLocal.mode === 'edit') {
    if (!confirm('編集中の内容は破棄されます。 別の日に移動しますか?')) return;
    setMode('view');
  }
  stateLocal.selectedDate = dateKey;
  const ym = dateKey.slice(0, 7);
  if (ym !== stateLocal.visibleYm) {
    stateLocal.visibleYm = ym;
    await renderCalendar(ym);
    schedulePrefetch(ym);
  } else {
    updateCalendarSelection();
  }
  await loadSection(dateKey);
}

async function loadSection(dateKey) {
  const viewBody = document.getElementById('rn-view-body');
  const editBtn = document.getElementById('rn-edit-btn');
  const noEditHint = document.getElementById('rn-no-edit-hint');
  const label = document.getElementById('rn-date-label');
  label.textContent = humanDateLabel(dateKey);
  document.getElementById('rn-view').hidden = false;
  document.getElementById('rn-edit').hidden = true;
  stateLocal.mode = 'view';
  viewBody.innerHTML = '<div class="muted">読み込み中…</div>';
  setCacheBadge('');

  try {
    const r = await fetchEtagged('/api/cosense/research-note/section?date=' + encodeURIComponent(dateKey), 'section:' + dateKey);
    const s = r.data;
    stateLocal.loaded = {
      date: dateKey,
      text: s.body_text || '',
      exists: !!s.exists_section,
    };
    renderViewBody();
    setCacheBadge(r.stale ? '⚠ オフライン (キャッシュ表示)' : (r.fromCache ? '✓ 最新 (キャッシュから即時表示)' : '✓ 取得済'));
  } catch (e) {
    viewBody.innerHTML = `<div class="muted">セクションのロード失敗: ${escapeHtml(e.message)}</div>`;
  }

  if (stateLocal.canWrite) {
    editBtn.hidden = false;
    noEditHint.hidden = true;
    if (!editBtn.dataset.bound) {
      editBtn.dataset.bound = '1';
      editBtn.addEventListener('click', () => setMode('edit'));
    }
  } else {
    editBtn.hidden = true;
    noEditHint.hidden = false;
    noEditHint.textContent = '編集するには、 設定 → Cosense 連携で Scrapbox の鍵を登録してください。';
  }
}

function renderViewBody() {
  const viewBody = document.getElementById('rn-view-body');
  if (!stateLocal.loaded.exists) {
    viewBody.innerHTML = '<div class="muted">(まだ書かれていません)</div>';
    return;
  }
  if (!stateLocal.loaded.text || stateLocal.loaded.text.trim() === '') {
    viewBody.innerHTML = '<div class="muted">(日付ヘッダはあるが内容が空)</div>';
    return;
  }
  const lines = stateLocal.loaded.text.split('\n');
  viewBody.innerHTML = lines.map(renderPreviewLine).join('');
}

function setMode(mode) {
  stateLocal.mode = mode;
  const viewEl = document.getElementById('rn-view');
  const editEl = document.getElementById('rn-edit');
  if (mode === 'edit') {
    viewEl.hidden = true;
    editEl.hidden = false;
    const ta = document.getElementById('rn-text');
    ta.value = stateLocal.loaded.text;
    renderPreview();
    if (!ta.dataset.previewBound) {
      ta.dataset.previewBound = '1';
      ta.addEventListener('input', renderPreview);
    }
    bindSaveCancel();
    setTimeout(() => ta.focus(), 0);
  } else {
    viewEl.hidden = false;
    editEl.hidden = true;
    renderViewBody();
  }
}

function bindSaveCancel() {
  const saveBtn = document.getElementById('rn-save');
  const cancelBtn = document.getElementById('rn-cancel');
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', async () => {
      const ta = document.getElementById('rn-text');
      const text = ta.value;
      const dateKey = stateLocal.selectedDate;
      saveBtn.disabled = true;
      const old = saveBtn.textContent;
      saveBtn.textContent = '保存中…';
      try {
        const r = await post('/api/cosense/research-note/replace-section', { date: dateKey, text });
        if (r.ok) {
          if (r.noop) {
            toast('変更なし');
          } else {
            const s = r.stats || {};
            const parts = [];
            if (s.header_created) parts.push('ヘッダ作成');
            if (s.inserts) parts.push(s.inserts + '行追加');
            if (s.updates) parts.push(s.updates + '行修正');
            if (s.deletes) parts.push(s.deletes + '行削除');
            toast('✅ 保存しました (' + (parts.join('+') || (r.change_count + '件')) + ')', 5000);
            document.getElementById('rn-stats').textContent = '直前の保存: ' + (parts.join('+') || (r.change_count + '件'));
          }
          // キャッシュ無効化 (該当セクション + その月)
          cacheRemove('section:' + dateKey);
          cacheRemove('month:' + dateKey.slice(0, 7));
          await loadSection(dateKey);
          await renderCalendar(stateLocal.visibleYm);
          setMode('view');
        } else {
          toast('失敗: ' + (r.body || ('HTTP ' + r.status)));
        }
      } catch (e) {
        toast('失敗: ' + e.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = old;
      }
    });
  }
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', () => {
      if (!confirm('編集を破棄して閲覧モードに戻りますか?')) return;
      setMode('view');
    });
  }
}

// ───────── カレンダー ─────────

async function renderCalendar(ym) {
  const root = document.getElementById('rn-calendar');
  // まずキャッシュから即描画 (空でも骨組みだけ)
  let data = stateLocal.monthData[ym];
  if (!data) {
    const cached = cacheGet('month:' + ym);
    if (cached) data = cached.body;
  }
  paintCalendar(ym, data);

  // 裏でフレッシュ取得 (ETag 付き)
  try {
    const r = await fetchEtagged('/api/cosense/research-note/month?ym=' + encodeURIComponent(ym), 'month:' + ym);
    stateLocal.monthData[ym] = r.data;
    paintCalendar(ym, r.data);
  } catch (e) { /* 失敗してもキャッシュ表示で続行 */ }
}

function paintCalendar(ym, data) {
  const root = document.getElementById('rn-calendar');
  const [yy, mm] = ym.split('.').map(Number);
  const firstDay = new Date(yy, mm - 1, 1);
  const lastDay = new Date(yy, mm, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${yy}.${String(mm).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
    cells.push({ day: d, date: dateKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const days = (data && data.days) || {};
  const today = todayJstKey();
  const headerRow = ['日','月','火','水','木','金','土'].map((w, i) =>
    `<div style="text-align:center; font-size:11px; padding:4px 0; color:${i === 0 ? '#dc2626' : (i === 6 ? '#0284c7' : '#6b7280')}">${w}</div>`
  ).join('');
  // v838 #422 PC向け拡張: wide screen ではセルを大きくして、 セル内に preview text を表示する。
  //   class 'rn-day' に CSS media query を当てて、 ≥900px で min-height 110px、 preview を可視に。
  const cellHtml = cells.map(c => {
    if (!c) return '<div></div>';
    const dayInfo = days[c.date] || { line_count: 0, char_count: 0, preview: '' };
    const lc = dayInfo.line_count || 0;
    const preview = dayInfo.preview || '';
    const isToday = c.date === today;
    const isSelected = c.date === stateLocal.selectedDate;
    const heat = heatColor(lc);
    const border = isSelected ? '2px solid #0284c7' : '1px solid #e5e7eb';
    const todayMark = isToday ? 'box-shadow:0 0 0 2px #fde68a; ' : '';
    const textCol = lc > 5 ? '#fff' : '#1f2937';
    const subCol = lc > 5 ? 'rgba(255,255,255,0.85)' : '#4b5563';
    return `
      <button type="button" data-rn-day="${c.date}" class="rn-day"
        style="position:relative; padding:4px 4px 6px; border:${border}; border-radius:6px; background:${heat}; cursor:pointer; ${todayMark}font-size:12px; text-align:left; overflow:hidden"
        title="${c.date} — ${lc}行 / ${dayInfo.char_count || 0}文字${preview ? '\n' + preview : ''}">
        <div class="rn-day-head" style="display:flex; align-items:baseline; gap:4px">
          <span style="font-weight:${isToday ? '700' : '500'}; color:${textCol}">${c.day}</span>
          ${lc > 0 ? `<span class="rn-day-count" style="font-size:9px; color:${subCol}; margin-left:auto">${lc}</span>` : ''}
        </div>
        ${preview ? `<div class="rn-day-preview" style="font-size:10px; color:${subCol}; line-height:1.3; margin-top:2px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; word-break:break-word">${escapeHtml(preview)}</div>` : ''}
      </button>`;
  }).join('');
  root.innerHTML = `
    <div class="row" style="margin-bottom:6px; gap:6px; align-items:center">
      <button id="rn-cal-prev" class="btn" style="padding:3px 8px">←</button>
      <div class="bold" style="flex:1; text-align:center">${ym}</div>
      <button id="rn-cal-today" class="btn" style="padding:3px 10px; font-size:12px">📅 今日</button>
      <button id="rn-cal-next" class="btn" style="padding:3px 8px">→</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px">
      ${headerRow}
      ${cellHtml}
    </div>`;
  // バインド
  root.querySelectorAll('[data-rn-day]').forEach(btn => {
    btn.addEventListener('click', () => switchDate(btn.getAttribute('data-rn-day')));
  });
  document.getElementById('rn-cal-prev').addEventListener('click', () => switchMonth(-1));
  document.getElementById('rn-cal-next').addEventListener('click', () => switchMonth(+1));
  document.getElementById('rn-cal-today').addEventListener('click', () => switchDate(todayJstKey()));
}

function updateCalendarSelection() {
  // 軽量更新: ハイライトだけ
  const root = document.getElementById('rn-calendar');
  if (!root) return;
  root.querySelectorAll('[data-rn-day]').forEach(btn => {
    const dk = btn.getAttribute('data-rn-day');
    const isSel = dk === stateLocal.selectedDate;
    btn.style.border = isSel ? '2px solid #0284c7' : '1px solid #e5e7eb';
  });
}

async function switchMonth(delta) {
  // v835 #419 月変更時は表示中の日も同月内の同日(または月末)に移動して、 セクション表示も切替
  const [yy, mm] = stateLocal.visibleYm.split('.').map(Number);
  const targetMonthStart = new Date(yy, mm - 1 + delta, 1);
  const targetY = targetMonthStart.getFullYear();
  const targetM = targetMonthStart.getMonth() + 1;
  const targetLastDay = new Date(targetY, targetM, 0).getDate();
  const selDay = Number(stateLocal.selectedDate.split('.')[2]);
  const newDay = Math.min(selDay, targetLastDay);
  const newDateKey = `${targetY}.${String(targetM).padStart(2, '0')}.${String(newDay).padStart(2, '0')}`;
  await switchDate(newDateKey);
}

function heatColor(n) {
  if (n === 0) return '#fff';
  if (n <= 2) return '#dcfce7';
  if (n <= 5) return '#86efac';
  if (n <= 15) return '#22c55e';
  return '#15803d';
}

function schedulePrefetch(ym) {
  // 前月+次月を裏で読みに行く
  const [yy, mm] = ym.split('.').map(Number);
  const prev = new Date(yy, mm - 2, 1);
  const next = new Date(yy, mm, 1);
  const pYm = `${prev.getFullYear()}.${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const nYm = `${next.getFullYear()}.${String(next.getMonth() + 1).padStart(2, '0')}`;
  [pYm, nYm].forEach(y => {
    fetchEtagged('/api/cosense/research-note/month?ym=' + encodeURIComponent(y), 'month:' + y)
      .then(r => { stateLocal.monthData[y] = r.data; })
      .catch(() => {});
  });
}

function setCacheBadge(msg) {
  const el = document.getElementById('rn-cache-badge');
  if (el) {
    el.textContent = msg;
    el.style.color = msg.includes('オフライン') ? '#dc2626' : '#6b7280';
  }
}

// ───────── キャッシュ + ETag ─────────

function cacheGet(key) {
  try {
    const s = localStorage.getItem(CACHE_PREFIX + key);
    if (!s) return null;
    const obj = JSON.parse(s);
    if (obj?.ts && Date.now() - obj.ts > SECTION_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return obj;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); }
  catch (e) {
    // QuotaExceeded — 古いキャッシュを破棄してリトライ
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
      }
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
    } catch {}
  }
}
function cacheRemove(key) {
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch {}
}

// ETag 対応 fetch。 304 ならキャッシュをそのまま、 200 なら最新で上書き、 ネットワーク失敗時は
//   キャッシュにフォールバック。
async function fetchEtagged(url, cacheKey) {
  const cached = cacheGet(cacheKey);
  const headers = { 'Accept': 'application/json' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  let resp;
  try {
    resp = await fetch(url, { credentials: 'same-origin', headers, cache: 'no-store' });
  } catch (e) {
    if (cached) return { data: cached.body, fromCache: true, stale: true };
    throw e;
  }
  if (resp.status === 304 && cached) {
    return { data: cached.body, fromCache: true, stale: false };
  }
  if (resp.status === 401) {
    if (cached) return { data: cached.body, fromCache: true, stale: true };
    throw new Error('未認証');
  }
  if (!resp.ok) {
    if (cached) return { data: cached.body, fromCache: true, stale: true };
    throw new Error('HTTP ' + resp.status);
  }
  const body = await resp.json();
  const etag = resp.headers.get('ETag');
  cacheSet(cacheKey, { etag, body, ts: Date.now() });
  return { data: body, fromCache: false, stale: false };
}

// ───────── プレビュー (Scrapbox 簡易レンダリング) ─────────

function renderPreview() {
  const ta = document.getElementById('rn-text');
  const root = document.getElementById('rn-preview');
  if (!ta || !root) return;
  const lines = ta.value.split('\n');
  root.innerHTML = lines.map(renderPreviewLine).join('') || '<div class="muted" style="font-size:12px">(空)</div>';
}

function renderPreviewLine(line) {
  let indent = 0;
  while (indent < line.length && line[indent] === ' ') indent++;
  const rest = line.slice(indent);
  const padPx = indent * 14;
  const inner = renderScrapboxInline(rest);
  const empty = inner.trim() === '' ? '&nbsp;' : inner;
  const bulletDot = indent > 0 ? '<span style="color:#9ca3af; margin-right:6px">•</span>' : '';
  return `<div style="padding-left:${padPx}px; min-height:1em; white-space:pre-wrap; word-break:break-word">${bulletDot}${empty}</div>`;
}

function renderScrapboxInline(s) {
  const esc = (t) => t.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += '<code style="background:#eef; padding:0 3px; border-radius:3px">' + esc(s.slice(i + 1, end)) + '</code>';
        i = end + 1; continue;
      }
    }
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      if (end > i) {
        out += renderBracket(s.slice(i + 1, end));
        i = end + 1; continue;
      }
    }
    out += esc(s[i]);
    i++;
  }
  return out;
}

function renderBracket(inside) {
  // [* 見出し] の場合に中に URL が含まれていたら 画像表示も検討する
  const heading = inside.match(/^(\*+)\s+(.+)$/);
  if (heading) {
    const stars = heading[1].length;
    const text = heading[2];
    const size = stars === 1 ? '1em' : (stars === 2 ? '1.15em' : '1.3em');
    const urlInHead = text.match(/https?:\/\/\S+/);
    if (urlInHead) {
      const imgSrc = imageUrlOf(urlInHead[0]);
      if (imgSrc) return `<a href="${escapeHtml(urlInHead[0])}" target="_blank" rel="noopener"><img src="${escapeHtml(imgSrc)}" loading="lazy" style="max-width:100%; max-height:280px; border-radius:4px; display:block; margin:4px 0"></a>`;
    }
    return `<b style="font-size:${size}; color:#1f2937">${escapeHtml(text)}</b>`;
  }
  const it = inside.match(/^\/\s+(.+)$/);
  if (it) return `<i>${escapeHtml(it[1])}</i>`;
  const st = inside.match(/^-\s+(.+)$/);
  if (st) return `<s>${escapeHtml(st[1])}</s>`;
  const urlMatch = inside.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const url = urlMatch[0];
    // v835 #420 画像 URL なら img タグで表示 (Scrapbox 記法準拠)
    const imgSrc = imageUrlOf(url);
    if (imgSrc) {
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(imgSrc)}" loading="lazy" style="max-width:100%; max-height:280px; border-radius:4px; display:block; margin:4px 0"></a>`;
    }
    const text = inside.replace(url, '').trim() || url;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#0284c7">${escapeHtml(text)}</a>`;
  }
  return `<span style="color:#9333ea; border-bottom:1px dotted #9333ea">${escapeHtml(inside)}</span>`;
}

// URL が画像っぽいかを判定し、 表示用 img src を返す (= 直接画像URLでなければ変換)。
//   - .jpg/.jpeg/.png/.gif/.webp/.svg/.bmp/.ico で終わる → そのまま
//   - gyazo.com/<id> → https://i.gyazo.com/<id>.png
//   - scrapbox.io/api/pages/.../icon → そのまま (アイコン)
function imageUrlOf(url) {
  if (/\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)(\?|#|$)/i.test(url)) return url;
  const gz = url.match(/^https?:\/\/(?:scrapbox-userscript-)?(?:i\.)?gyazo\.com\/([a-f0-9]+)(?:\/raw)?(?:\?[^#]*)?$/i);
  if (gz) return `https://i.gyazo.com/${gz[1]}.png`;
  if (/scrapbox\.io\/api\/pages\/.+\/icon$/.test(url)) return url;
  return null;
}

// ───────── date helpers ─────────
function dateKeyToInputValue(k) { return k.replace(/\./g, '-'); }
function parseDateKey(k) {
  const m = k.split('.').map(Number);
  return new Date(m[0], m[1] - 1, m[2]);
}
function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${dd}`;
}
function todayJstKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  return formatDateKey(jst);
}
function humanDateLabel(k) {
  const d = parseDateKey(k);
  const wd = ['日','月','火','水','木','金','土'][d.getDay()];
  const t = todayJstKey();
  const ts = parseDateKey(t).getTime();
  const ds = d.getTime();
  const diff = Math.round((ds - ts) / 86400000);
  let rel = '';
  if (diff === 0) rel = ' (今日)';
  else if (diff === -1) rel = ' (昨日)';
  else if (diff === 1) rel = ' (明日)';
  else if (diff < 0) rel = ` (${-diff} 日前)`;
  else rel = ` (${diff} 日後)`;
  return `(${wd})${rel}`;
}
