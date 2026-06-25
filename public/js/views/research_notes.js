// /#/research-notes — Cosense (nkmr-lab) の研究ノートを LabPay 内で閲覧 / 編集。
//   v832: 閲覧モードで起動 + カレンダーで日付選択 → 「✏️ 編集」 で編集モード → 「💾 保存」 で
//   差分コミット。 「最初から追記モードが気持ち悪い」 への対応。
import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

let stateLocal = {
  handle: null,
  canWrite: false,
  pageUrl: '',
  selectedDate: null,   // 'YYYY.MM.DD'
  mode: 'view',          // 'view' | 'edit'
  loaded: { date: null, text: '', exists: false },
};

export async function renderResearchNotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 研究ノート (Cosense)</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        nkmr-lab の 「YYYY.MM_研究ノート_<i>名前</i>」 ページから、 選んだ日のセクションを表示します。
        編集するには、 設定 → Cosense 連携で Scrapbox の鍵 を登録してから 「✏️ 編集」 を押してください。
      </p>
    </div>
    <div class="card" id="rn-status">
      <div class="muted">読み込み中…</div>
    </div>
    <div class="card" id="rn-main" hidden>
      <div class="row center" style="gap:6px; flex-wrap:wrap; margin-bottom:8px">
        <input type="date" id="rn-date-picker" style="font-size:14px; padding:4px 6px">
        <button id="rn-prev" class="btn" style="padding:3px 8px">←</button>
        <button id="rn-today" class="btn" style="padding:3px 10px">今日</button>
        <button id="rn-next" class="btn" style="padding:3px 8px">→</button>
        <span id="rn-date-label" class="muted" style="font-size:12px; margin-left:6px"></span>
        <span style="flex:1"></span>
        <a id="rn-open" class="btn" style="font-size:12px; padding:3px 10px" target="_blank" rel="noopener">↗ Scrapbox を開く</a>
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
        <div class="rn-edit-pane" style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
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
  `;
  await loadInitial();
}

async function loadInitial() {
  const statusEl = document.getElementById('rn-status');
  try {
    // 状態とハンドル情報を取得 + 今日の日付を確定
    const d = await get('/api/cosense/research-note/days?count=2');
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
    const source = d.cookie_source || 'none';
    const sourceLabel = source === 'self-pat' ? '✅ 自分の鍵 (本人)' :
                       source === 'self-cookie' ? '☑ 自分の cookie (本人)' :
                       source === 'shared-cookie' ? '⚙ 共有 cookie (中村名義、 読み取りのみ)' : '?';
    statusEl.innerHTML = `<div style="font-size:13px">名前: <code>${escapeHtml(d.handle)}</code> ・ 認証: ${sourceLabel}</div>`;

    document.getElementById('rn-main').hidden = false;

    // バインド
    bindNav();
    document.getElementById('rn-date-picker').value = dateKeyToInputValue(stateLocal.selectedDate);
    await loadSection(stateLocal.selectedDate);
  } catch (e) {
    statusEl.innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function bindNav() {
  document.getElementById('rn-date-picker').addEventListener('change', (ev) => {
    const v = ev.target.value; // 'YYYY-MM-DD'
    if (!v) return;
    const dateKey = v.replace(/-/g, '.'); // 'YYYY.MM.DD'
    switchDate(dateKey);
  });
  document.getElementById('rn-prev').addEventListener('click', () => moveDays(-1));
  document.getElementById('rn-next').addEventListener('click', () => moveDays(+1));
  document.getElementById('rn-today').addEventListener('click', () => {
    const t = todayJstKey();
    switchDate(t);
  });
}

function moveDays(delta) {
  const cur = parseDateKey(stateLocal.selectedDate);
  cur.setDate(cur.getDate() + delta);
  const k = formatDateKey(cur);
  switchDate(k);
}

async function switchDate(dateKey) {
  if (stateLocal.mode === 'edit') {
    if (!confirm('編集中の内容は破棄されます。 別の日に移動しますか?')) {
      // ピッカーを元の日付に戻す
      document.getElementById('rn-date-picker').value = dateKeyToInputValue(stateLocal.selectedDate);
      return;
    }
    setMode('view');
  }
  stateLocal.selectedDate = dateKey;
  document.getElementById('rn-date-picker').value = dateKeyToInputValue(dateKey);
  await loadSection(dateKey);
}

async function loadSection(dateKey) {
  const viewBody = document.getElementById('rn-view-body');
  const editBtn = document.getElementById('rn-edit-btn');
  const noEditHint = document.getElementById('rn-no-edit-hint');
  const label = document.getElementById('rn-date-label');
  const open = document.getElementById('rn-open');
  label.textContent = humanDateLabel(dateKey);

  // 画面状態リセット
  document.getElementById('rn-view').hidden = false;
  document.getElementById('rn-edit').hidden = true;
  stateLocal.mode = 'view';
  viewBody.innerHTML = '<div class="muted">読み込み中…</div>';

  // ページ URL (日付の月部分でページ名生成)
  const ym = dateKey.slice(0, 7);
  const title = `${ym}_研究ノート_${stateLocal.handle}`;
  stateLocal.pageUrl = `https://scrapbox.io/nkmr-lab/${encodeURIComponent(title)}`;
  open.href = stateLocal.pageUrl;

  try {
    const s = await get('/api/cosense/research-note/section?date=' + encodeURIComponent(dateKey));
    stateLocal.loaded = {
      date: dateKey,
      text: s.body_text || '',
      exists: !!s.exists_section,
    };
    renderViewBody();
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
  // 閲覧モードでも簡易レンダリングする (= スペースインデントを視覚化)
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
          await loadSection(dateKey);
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

// プレビュー再描画 (Scrapbox 簡易レンダリング)
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
  const heading = inside.match(/^(\*+)\s+(.+)$/);
  if (heading) {
    const stars = heading[1].length;
    const text = heading[2];
    const size = stars === 1 ? '1em' : (stars === 2 ? '1.15em' : '1.3em');
    return `<b style="font-size:${size}; color:#1f2937">${escapeHtml(text)}</b>`;
  }
  const it = inside.match(/^\/\s+(.+)$/);
  if (it) return `<i>${escapeHtml(it[1])}</i>`;
  const st = inside.match(/^-\s+(.+)$/);
  if (st) return `<s>${escapeHtml(st[1])}</s>`;
  const urlMatch = inside.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const url = urlMatch[0];
    const text = inside.replace(url, '').trim() || url;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#0284c7">${escapeHtml(text)}</a>`;
  }
  return `<span style="color:#9333ea; border-bottom:1px dotted #9333ea">${escapeHtml(inside)}</span>`;
}

// ───────── helpers ─────────
function dateKeyToInputValue(k) { return k.replace(/\./g, '-'); }
function parseDateKey(k) {
  // 'YYYY.MM.DD' → Date (LocalDate)
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
  // JST 現在日
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
