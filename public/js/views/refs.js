// /#/refs — Zotero-like 文献管理 (v925 MVP)。
// ラボ全員 で 共有、 各自 note + 読状態 は 個人別。
// DOI / arXiv ID / URL から metadata 自動取得 (crossref / arxiv API)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const STATUS_LABEL = { unread: '未読', reading: '読中', read: '既読' };
const STATUS_COLOR = { unread: '#9ca3af', reading: '#f59e0b', read: '#15803d' };

let listState = {
  q: '', tag: '', year: 0, status: '', sort: 'new',
  collection_id: 0, uncategorized: false, trash: false,
};

function authorsShort(authors) {
  if (!Array.isArray(authors) || !authors.length) return '';
  const names = authors.map(a => (a && a.name) || '').filter(Boolean);
  if (names.length <= 3) return names.join(', ');
  return names.slice(0, 3).join(', ') + `, et al. (${names.length}人)`;
}

// ─── 一覧 ─────────────────────────────────────────────

export async function renderRefs() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:8px; flex-wrap:wrap">
        <h2 style="margin:0; flex:1">📚 文献管理 <span style="font-size:11px; color:#9ca3af; font-weight:normal">Zotero 的、 ラボ共有</span></h2>
        <a class="btn primary" href="#/refs/new" style="font-size:13px; padding:4px 12px">＋ 文献を 追加</a>
        <button id="rf-export" class="btn" style="font-size:12px; padding:4px 8px" title="BibTeX 一括 ダウンロード">⬇ BibTeX</button>
        <button id="rf-toggle-trash" class="btn" style="font-size:12px; padding:4px 8px" title="ゴミ箱 切替">🗑</button>
      </div>
    </div>
    <!-- v928 track B: コレクション サイドバー (縦 スクロール chip) -->
    <div class="card" id="rf-cols-card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:12px">📁 コレクション</div>
        <button id="rf-col-new" class="btn" style="font-size:11px; padding:2px 8px; margin-left:auto">＋ 新規</button>
      </div>
      <div id="rf-cols-list" class="row" style="gap:4px; flex-wrap:wrap"></div>
    </div>
    <!-- v928 track B: 保存した 検索 -->
    <div class="card" id="rf-ss-card" hidden>
      <div class="row center" style="gap:6px; margin-bottom:6px">
        <div class="bold" style="font-size:12px">🔎 保存した 検索</div>
      </div>
      <div id="rf-ss-list" class="row" style="gap:4px; flex-wrap:wrap"></div>
    </div>
    <div class="card">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <input type="search" id="rf-q" placeholder="🔍 タイトル / 著者 / 抄録 / 会議名" style="flex:1; min-width:180px; padding:4px 8px; font-size:13px; border:1px solid #d1d5db; border-radius:4px" value="${escapeHtml(listState.q)}">
        <select id="rf-status" style="font-size:12px; padding:2px 6px">
          <option value="">🎯 状態 全部</option>
          <option value="unread" ${listState.status==='unread'?'selected':''}>未読</option>
          <option value="reading" ${listState.status==='reading'?'selected':''}>読中</option>
          <option value="read" ${listState.status==='read'?'selected':''}>既読</option>
        </select>
        <input type="number" id="rf-year" placeholder="年" min="1900" max="2100" style="width:80px; padding:2px 6px; font-size:12px" value="${listState.year || ''}">
        <select id="rf-sort" style="font-size:12px; padding:2px 6px">
          <option value="new"   ${listState.sort==='new'   ?'selected':''}>新着順</option>
          <option value="year"  ${listState.sort==='year'  ?'selected':''}>年 降順</option>
          <option value="title" ${listState.sort==='title' ?'selected':''}>タイトル順</option>
        </select>
        <button id="rf-save-search" class="btn" style="font-size:11px; padding:2px 8px" title="今 の 条件 を 保存">💾</button>
        <span id="rf-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
      <div id="rf-cur-filter" class="hint-sm" style="font-size:11px; margin-top:4px; color:#7b3fa0"></div>
      <div id="rf-tags" class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap"></div>
    </div>
    <div id="rf-list" class="card"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('rf-export').addEventListener('click', () => {
    const t = listState.tag ? `?tag=${encodeURIComponent(listState.tag)}` : '';
    window.location.href = '/api/refs/export/bibtex' + t;
  });
  let searchTimer = null;
  document.getElementById('rf-q').addEventListener('input', e => {
    listState.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadList, 250);
  });
  document.getElementById('rf-status').addEventListener('change', e => { listState.status = e.target.value; loadList(); });
  document.getElementById('rf-year').addEventListener('change', e => { listState.year = Number(e.target.value) || 0; loadList(); });
  document.getElementById('rf-sort').addEventListener('change', e => { listState.sort = e.target.value; loadList(); });
  // v928 track B
  document.getElementById('rf-toggle-trash').addEventListener('click', () => {
    listState.trash = !listState.trash;
    document.getElementById('rf-toggle-trash').classList.toggle('primary', listState.trash);
    updateCurFilterHint();
    loadList();
  });
  document.getElementById('rf-col-new').addEventListener('click', async () => {
    const name = prompt('コレクション 名 (例: HCI 論文、 CHI2026 送り 用 等)');
    if (!name) return;
    const icon = prompt('絵文字 (省略で 📁)', '📁') || '📁';
    try { await post('/api/refs/collections', { name, icon }); await loadCollectionsChips(); toast('作成'); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('rf-save-search').addEventListener('click', async () => {
    const name = prompt('この 検索条件 に 名前 を');
    if (!name) return;
    try {
      await post('/api/refs/saved_searches', { name, filter: {
        q: listState.q, tag: listState.tag, year: listState.year, status: listState.status,
        sort: listState.sort, collection_id: listState.collection_id,
        uncategorized: listState.uncategorized, trash: listState.trash,
      } });
      await loadSavedSearchesChips();
      toast('保存 完了');
    } catch (e) { toast('失敗: ' + e.message); }
  });
  await Promise.all([loadTagsChips(), loadCollectionsChips(), loadSavedSearchesChips()]);
  updateCurFilterHint();
  await loadList();
}

function updateCurFilterHint() {
  const el = document.getElementById('rf-cur-filter');
  if (!el) return;
  const parts = [];
  if (listState.trash) parts.push('🗑 ゴミ箱');
  if (listState.collection_id) {
    const btn = document.querySelector('.rf-col-chip[data-cid="'+listState.collection_id+'"]');
    parts.push('📁 ' + (btn?.dataset.name || 'コレクション #' + listState.collection_id));
  }
  if (listState.uncategorized) parts.push('📁 未分類');
  el.textContent = parts.join(' · ');
}

async function loadCollectionsChips() {
  const root = document.getElementById('rf-cols-list');
  if (!root) return;
  try {
    const d = await get('/api/refs/collections');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<span class="muted" style="font-size:11px">まだ ありません</span>'; return; }
    const meId = Number(state.me?.id || 0);
    const isAdmin = state.me?.role === 'admin';
    // 「未分類」 chip + 各 collection chip
    let html = `<button class="btn rf-col-chip" data-cid="0" style="font-size:11px; padding:2px 8px; ${listState.uncategorized&&!listState.collection_id?'background:#a855f7; color:#fff':''}">📁 未分類</button>`;
    html += items.map(c => {
      const active = c.id === listState.collection_id;
      return `<button class="btn rf-col-chip" data-cid="${c.id}" data-name="${escapeHtml(c.name)}" style="font-size:11px; padding:2px 8px; ${active?'background:#a855f7; color:#fff; border-color:#a855f7':''}">
        ${c.icon || '📁'} ${escapeHtml(c.name)} <span class="hint-sm">(${c.ref_count})</span>
        ${(c.owner_user_id === meId || isAdmin) ? `<span class="rf-col-del" data-cid="${c.id}" style="margin-left:4px; opacity:0.5; cursor:pointer">✕</span>` : ''}
      </button>`;
    }).join('');
    root.innerHTML = html;
    root.querySelectorAll('.rf-col-chip').forEach(b => {
      b.addEventListener('click', (ev) => {
        if (ev.target.classList.contains('rf-col-del')) return;
        const cid = Number(b.dataset.cid);
        if (cid === 0) {
          listState.uncategorized = !listState.uncategorized;
          listState.collection_id = 0;
        } else {
          if (listState.collection_id === cid) { listState.collection_id = 0; }
          else { listState.collection_id = cid; listState.uncategorized = false; }
        }
        loadCollectionsChips(); updateCurFilterHint(); loadList();
      });
    });
    root.querySelectorAll('.rf-col-del').forEach(x => {
      x.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('この コレクション を 削除? (中の 文献 は 残ります)')) return;
        try { await del('/api/refs/collections/' + x.dataset.cid); await loadCollectionsChips(); toast('削除'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (_) {}
}

async function loadSavedSearchesChips() {
  const card = document.getElementById('rf-ss-card');
  const root = document.getElementById('rf-ss-list');
  if (!card || !root) return;
  try {
    const d = await get('/api/refs/saved_searches');
    const items = d.items || [];
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    root.innerHTML = items.map(s => `
      <button class="btn rf-ss-chip" data-id="${s.id}" data-filter='${escapeHtml(JSON.stringify(s.filter||{}))}' style="font-size:11px; padding:2px 8px; background:#e0e7ff; color:#3730a3; border-color:#3730a3">
        🔎 ${escapeHtml(s.name)}
        <span class="rf-ss-del" data-id="${s.id}" style="margin-left:4px; opacity:0.5; cursor:pointer">✕</span>
      </button>`).join('');
    root.querySelectorAll('.rf-ss-chip').forEach(b => {
      b.addEventListener('click', (ev) => {
        if (ev.target.classList.contains('rf-ss-del')) return;
        const f = JSON.parse(b.dataset.filter || '{}');
        Object.assign(listState, {
          q: f.q||'', tag: f.tag||'', year: f.year||0, status: f.status||'',
          sort: f.sort||'new', collection_id: f.collection_id||0,
          uncategorized: !!f.uncategorized, trash: !!f.trash,
        });
        // input 値 も 更新
        document.getElementById('rf-q').value = listState.q;
        document.getElementById('rf-status').value = listState.status;
        document.getElementById('rf-year').value = listState.year || '';
        document.getElementById('rf-sort').value = listState.sort;
        loadCollectionsChips(); loadTagsChips(); updateCurFilterHint(); loadList();
      });
    });
    root.querySelectorAll('.rf-ss-del').forEach(x => {
      x.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try { await del('/api/refs/saved_searches/' + x.dataset.id); await loadSavedSearchesChips(); toast('削除'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (_) {}
}

async function loadTagsChips() {
  const root = document.getElementById('rf-tags');
  try {
    const d = await get('/api/refs/tags');
    const tags = d.tags || [];
    if (!tags.length) { root.hidden = true; return; }
    root.hidden = false;
    root.innerHTML = tags.slice(0, 30).map(t => {
      const isActive = t.tag === listState.tag;
      return `<button class="btn rf-tag" data-tag="${escapeHtml(t.tag)}" style="font-size:11px; padding:2px 8px; ${isActive?'background:#a855f7; color:#fff; border-color:#a855f7':''}">
        ${escapeHtml(t.tag)} <span class="hint-sm">(${t.count})</span>
      </button>`;
    }).join('') + (listState.tag ? `<button id="rf-tag-clear" class="btn" style="font-size:11px; padding:2px 8px">✕ タグ 解除</button>` : '');
    root.querySelectorAll('.rf-tag').forEach(b => {
      b.addEventListener('click', () => {
        listState.tag = b.dataset.tag === listState.tag ? '' : b.dataset.tag;
        loadTagsChips(); loadList();
      });
    });
    root.querySelector('#rf-tag-clear')?.addEventListener('click', () => {
      listState.tag = ''; loadTagsChips(); loadList();
    });
  } catch (_) { root.hidden = true; }
}

async function loadList() {
  const root = document.getElementById('rf-list');
  const params = new URLSearchParams();
  if (listState.q)      params.set('q', listState.q);
  if (listState.tag)    params.set('tag', listState.tag);
  if (listState.year)   params.set('year', listState.year);
  if (listState.status) params.set('status', listState.status);
  if (listState.sort)   params.set('sort', listState.sort);
  if (listState.collection_id) params.set('collection_id', listState.collection_id);
  if (listState.uncategorized) params.set('uncategorized', '1');
  if (listState.trash)  params.set('trash', '1');
  try {
    const d = await get('/api/refs?' + params.toString());
    document.getElementById('rf-count').textContent = `${d.total || 0} 件`;
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="muted" style="padding:20px; text-align:center">
        ${listState.q || listState.tag || listState.year || listState.status ? '該当なし。 条件 を 変えて 試して' : 'まだ 何も 登録 されて いません。 「＋ 文献を 追加」 から どうぞ'}
      </div>`;
      return;
    }
    root.innerHTML = items.map(it => renderTile(it)).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderTile(it) {
  const tagsHtml = (it.tags || []).map(t =>
    `<span class="tag" style="background:#f3e8ff; color:#7b3fa0; font-size:11px; padding:1px 6px; border-radius:8px">${escapeHtml(t)}</span>`
  ).join(' ');
  const st = it.my_status || 'unread';
  const stChip = `<span style="background:${STATUS_COLOR[st]}; color:#fff; font-size:10px; padding:1px 6px; border-radius:8px">${STATUS_LABEL[st]}</span>`;
  const idBadges = [];
  if (it.doi)      idBadges.push('DOI');
  if (it.arxiv_id) idBadges.push('arXiv');
  if (it.pdf_path) idBadges.push('📄 PDF');
  const idHtml = idBadges.length ? `<span class="hint-sm" style="font-size:10px; margin-left:6px">${idBadges.join(' · ')}</span>` : '';
  return `
    <a class="list-item" href="#/refs/${it.id}" style="display:block; padding:10px 12px; border-bottom:1px solid #f3f4f6; text-decoration:none; color:inherit">
      <div class="bold" style="font-size:14px; line-height:1.4">
        ${escapeHtml(it.title)} ${idHtml}
      </div>
      <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-top:2px">
        ${escapeHtml(authorsShort(it.authors))}${it.year ? ' · ' + it.year : ''}${it.venue ? ' · ' + escapeHtml(it.venue) : ''}
      </div>
      <div class="row" style="gap:4px; margin-top:4px; align-items:center">
        ${stChip}
        ${tagsHtml}
        <span class="hint-sm" style="margin-left:auto; font-size:11px">
          ${avatarHtml(it.added_by_name, it.added_by_avatar, 'xs')} ${escapeHtml(it.added_by_name || '?')}
        </span>
      </div>
    </a>`;
}

// ─── 新規 追加 ────────────────────────────────────────

export async function renderRefsNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/refs" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">📚 文献 を 追加</h2>
      <div class="hint-sm" style="font-size:11px; margin-top:4px">
        📖 <a href="#/refs/bookmarklet" style="color:var(--primary)">ブラウザ 用 bookmarklet を 作る</a> — 論文 ページ で 1 click 追加
      </div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; margin-bottom:8px; flex-wrap:wrap">
        <button class="btn primary rf-tab" data-tab="doi"    style="font-size:13px">DOI</button>
        <button class="btn rf-tab"         data-tab="arxiv"  style="font-size:13px">arXiv</button>
        <button class="btn rf-tab"         data-tab="url"    style="font-size:13px">URL</button>
        <button class="btn rf-tab"         data-tab="pdf"    style="font-size:13px">📄 PDF から</button>
        <button class="btn rf-tab"         data-tab="import" style="font-size:13px">📥 BibTeX/RIS</button>
        <button class="btn rf-tab"         data-tab="manual" style="font-size:13px">手動 入力</button>
      </div>

      <!-- DOI -->
      <div id="rf-tab-doi" class="rf-tab-panel">
        <label class="field"><span class="lbl">🔗 DOI</span>
          <input type="text" id="rf-doi" placeholder="例: 10.1145/3313831.3376234 または https://doi.org/10.1145/..." autofocus>
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="rf-fetch-doi" class="btn primary">🔍 metadata 取得</button>
        </div>
      </div>

      <!-- arXiv -->
      <div id="rf-tab-arxiv" class="rf-tab-panel" hidden>
        <label class="field"><span class="lbl">🔗 arXiv ID</span>
          <input type="text" id="rf-arxiv" placeholder="例: 2401.12345 または https://arxiv.org/abs/2401.12345">
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="rf-fetch-arxiv" class="btn primary">🔍 metadata 取得</button>
        </div>
      </div>

      <!-- URL -->
      <div id="rf-tab-url" class="rf-tab-panel" hidden>
        <label class="field"><span class="lbl">🔗 URL (DOI か arXiv ID を 含む)</span>
          <input type="url" id="rf-url" placeholder="例: https://dl.acm.org/doi/10.1145/...">
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="rf-fetch-url" class="btn primary">🔍 metadata 取得</button>
        </div>
      </div>

      <!-- PDF から 抽出 -->
      <div id="rf-tab-pdf" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">PDF を アップロード → pdftotext で 抽出 → DOI/arXiv 検出 or OpenAI で metadata 抽出。 gpt-5-mini を 使う (~5pt 相当)。</div>
        <label class="field"><span class="lbl">📄 PDF ファイル</span>
          <input type="file" id="rf-pdf-input" accept="application/pdf,.pdf">
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="rf-fetch-pdf" class="btn primary">🔍 metadata 抽出</button>
        </div>
      </div>

      <!-- BibTeX / RIS 一括 import -->
      <div id="rf-tab-import" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">Zotero / Mendeley 等 から export した .bib または .ris を 一括 追加。 同 DOI は skip。</div>
        <label class="field"><span class="lbl">📥 .bib or .ris ファイル</span>
          <input type="file" id="rf-bulk-file" accept=".bib,.bibtex,.ris,text/plain">
        </label>
        <div class="row" style="gap:6px">
          <button id="rf-do-bibtex" class="btn primary">🔽 BibTeX として import</button>
          <button id="rf-do-ris"    class="btn primary">🔽 RIS として import</button>
        </div>
        <div id="rf-bulk-result" style="margin-top:8px; font-size:13px"></div>
      </div>

      <!-- 手動 -->
      <div id="rf-tab-manual" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">DOI や arXiv ID が 無い 場合。 下の フォーム に 直接 入力 して 「登録」。</div>
      </div>

      <!-- 取得 結果 warning -->
      <div id="rf-dup-warn" hidden></div>

      <!-- 共通 詳細 フォーム -->
      <div id="rf-form" style="margin-top:10px; padding:10px; background:#f9fafb; border-radius:6px">
        <label class="field"><span class="lbl">タイトル *</span>
          <input type="text" id="rf-f-title" maxlength="1000">
        </label>
        <label class="field"><span class="lbl">著者 (カンマ 区切り)</span>
          <input type="text" id="rf-f-authors" placeholder="例: 田中 太郎, John Smith, 山田 花子">
        </label>
        <div class="row" style="gap:6px">
          <label class="field" style="flex:1"><span class="lbl">年</span>
            <input type="number" id="rf-f-year" min="1900" max="2100">
          </label>
          <label class="field" style="flex:3"><span class="lbl">出典 (会議 / 論文誌)</span>
            <input type="text" id="rf-f-venue" maxlength="500">
          </label>
        </div>
        <label class="field"><span class="lbl">URL</span>
          <input type="url" id="rf-f-url" placeholder="https://...">
        </label>
        <label class="field"><span class="lbl">抄録</span>
          <textarea id="rf-f-abstract" rows="4" style="width:100%; box-sizing:border-box; font-size:13px"></textarea>
        </label>
        <label class="field"><span class="lbl">タグ (カンマ 区切り)</span>
          <input type="text" id="rf-f-tags" placeholder="例: HCI, 視線, MR">
        </label>
        <input type="hidden" id="rf-f-doi">
        <input type="hidden" id="rf-f-arxiv">
        <input type="hidden" id="rf-f-force" value="0">
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <a href="#/refs" class="btn">キャンセル</a>
          <button id="rf-save" class="primary">＋ 登録</button>
        </div>
      </div>
    </div>
  `;

  // タブ 切替
  document.querySelectorAll('.rf-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.rf-tab').forEach(x => x.classList.remove('primary'));
      b.classList.add('primary');
      document.querySelectorAll('.rf-tab-panel').forEach(p => p.hidden = true);
      document.getElementById('rf-tab-' + b.dataset.tab).hidden = false;
    });
  });

  const fillFormFromMeta = (meta) => {
    document.getElementById('rf-f-title').value    = meta.title || '';
    document.getElementById('rf-f-authors').value  = (meta.authors || []).map(a => a.name || '').filter(Boolean).join(', ');
    document.getElementById('rf-f-year').value     = meta.year || '';
    document.getElementById('rf-f-venue').value    = meta.venue || '';
    document.getElementById('rf-f-abstract').value = meta.abstract || '';
    document.getElementById('rf-f-url').value      = meta.url || '';
    document.getElementById('rf-f-doi').value      = meta.doi || '';
    document.getElementById('rf-f-arxiv').value    = meta.arxiv_id || '';
  };

  const showDup = (existing) => {
    const warn = document.getElementById('rf-dup-warn');
    if (!existing) { warn.hidden = true; warn.innerHTML = ''; document.getElementById('rf-f-force').value = '0'; return; }
    warn.hidden = false;
    warn.innerHTML = `
      <div style="background:linear-gradient(135deg, #fef3c7, #fde68a); border:2px solid #f59e0b; border-radius:10px; padding:12px 14px; margin:8px 0">
        <div style="font-size:15px; font-weight:700; color:#78350f">⚠️ この 文献 は 既に 登録済</div>
        <div style="font-size:13px; color:#78350f; margin-top:4px">
          「<b>${escapeHtml(existing.title)}</b>」 (id=${existing.id})
        </div>
        <div class="row" style="gap:6px; margin-top:8px">
          <a href="#/refs/${existing.id}" class="btn primary" style="font-size:12px">📖 既存 詳細 を 見る</a>
          <button id="rf-dup-force-btn" class="btn" style="font-size:12px">上書き 覚悟 で 続行</button>
        </div>
      </div>`;
    document.getElementById('rf-dup-force-btn').addEventListener('click', () => {
      warn.hidden = true; warn.innerHTML = '';
      document.getElementById('rf-f-force').value = '1';
      toast('force フラグ ON、 登録 進めて OK');
    });
  };

  const doFetch = async (endpoint, payload) => {
    try {
      const r = await post('/api/refs/' + endpoint, payload);
      showDup(r.existing || null);
      fillFormFromMeta(r.meta || {});
      toast('取得 完了、 内容 を 確認 して 「登録」');
    } catch (e) { toast('取得 失敗: ' + e.message); }
  };
  document.getElementById('rf-fetch-doi').addEventListener('click', () => {
    const doi = document.getElementById('rf-doi').value.trim();
    if (!doi) { toast('DOI を 入れて'); return; }
    doFetch('import_doi', { doi });
  });
  document.getElementById('rf-fetch-arxiv').addEventListener('click', () => {
    const arxiv_id = document.getElementById('rf-arxiv').value.trim();
    if (!arxiv_id) { toast('arXiv ID を 入れて'); return; }
    doFetch('import_arxiv', { arxiv_id });
  });
  document.getElementById('rf-fetch-url').addEventListener('click', () => {
    const url = document.getElementById('rf-url').value.trim();
    if (!url) { toast('URL を 入れて'); return; }
    doFetch('import_url', { url });
  });

  document.getElementById('rf-save').addEventListener('click', async () => {
    const title = document.getElementById('rf-f-title').value.trim();
    if (!title) { toast('タイトル は 必須'); return; }
    const payload = {
      title,
      doi:      document.getElementById('rf-f-doi').value.trim(),
      arxiv_id: document.getElementById('rf-f-arxiv').value.trim(),
      authors: document.getElementById('rf-f-authors').value.split(',').map(s => s.trim()).filter(Boolean),
      year:    document.getElementById('rf-f-year').value,
      venue:   document.getElementById('rf-f-venue').value.trim(),
      abstract: document.getElementById('rf-f-abstract').value.trim(),
      url:     document.getElementById('rf-f-url').value.trim(),
      tags:    document.getElementById('rf-f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (document.getElementById('rf-f-force').value === '1') payload.force = 1;
    try {
      const r = await post('/api/refs', payload);
      toast('登録 完了');
      navigate('#/refs/' + r.id);
    } catch (e) { toast('登録 失敗: ' + e.message); }
  });

  // v927 track A: PDF から metadata 抽出
  document.getElementById('rf-fetch-pdf')?.addEventListener('click', async () => {
    const f = document.getElementById('rf-pdf-input').files?.[0];
    if (!f) { toast('PDF を 選んで'); return; }
    if (f.size > 30 * 1024 * 1024) { toast('30MB まで'); return; }
    const btn = document.getElementById('rf-fetch-pdf');
    btn.disabled = true; btn.textContent = '⏳ 抽出中…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      const resp = await fetch('/api/refs/extract_pdf', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error?.message || j?.error || ('HTTP ' + resp.status));
      showDup(j.existing || null);
      fillFormFromMeta(j.meta || {});
      const methodLabel = j.method === 'pdf_doi_crossref' ? 'PDF から DOI 発見 + crossref'
                       : j.method === 'pdf_arxiv_api'    ? 'PDF から arXiv ID 発見 + arxiv API'
                       :                                   'OpenAI が 先頭 テキスト から 抽出';
      toast(`抽出 完了 (${methodLabel})、 内容 確認 して 「登録」`);
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '🔍 metadata 抽出'; }
  });

  // v927 track A: BibTeX / RIS 一括 import
  const doBulk = async (endpoint) => {
    const f = document.getElementById('rf-bulk-file').files?.[0];
    if (!f) { toast('ファイル を 選んで'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('5MB まで'); return; }
    const btn = document.getElementById(endpoint === 'import_bibtex' ? 'rf-do-bibtex' : 'rf-do-ris');
    btn.disabled = true; btn.textContent = '⏳ 処理中…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      const resp = await fetch('/api/refs/' + endpoint, {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error?.message || j?.error || ('HTTP ' + resp.status));
      const res = document.getElementById('rf-bulk-result');
      res.innerHTML = `
        <div style="background:#dcfce7; border:1px solid #86efac; border-radius:6px; padding:10px; color:#166534">
          <div class="bold">✅ ${j.added} 件 追加、 ${j.skipped} 件 skip (計 ${j.total} 件)</div>
          <div style="margin-top:6px; max-height:200px; overflow:auto; font-size:12px">
            ${(j.results || []).map(r =>
              r.status === 'added'
                ? `<a href="#/refs/${r.id}" style="display:block; color:#166534; text-decoration:underline">✅ ${escapeHtml(r.title || 'no title')}</a>`
                : r.status === 'dup'
                  ? `<a href="#/refs/${r.existing_id}" style="display:block; color:#78350f">⏭ 既存: ${escapeHtml(r.title || 'no title')}</a>`
                  : `<div style="color:#7f1d1d">⚠ skip: ${escapeHtml(r.reason || '')}</div>`
            ).join('')}
          </div>
          <a href="#/refs" class="btn primary" style="font-size:12px; margin-top:6px">📖 一覧 で 確認</a>
        </div>`;
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = endpoint === 'import_bibtex' ? '🔽 BibTeX として import' : '🔽 RIS として import'; }
  };
  document.getElementById('rf-do-bibtex').addEventListener('click', () => doBulk('import_bibtex'));
  document.getElementById('rf-do-ris')   .addEventListener('click', () => doBulk('import_ris'));

  // v927 bookmarklet から の 遷移: `#/refs/new?url=https://...&title=...`
  //   hash router は ?url を そのまま 残す ので、 手動 で parse。
  const hash = location.hash || '';
  const qStart = hash.indexOf('?');
  if (qStart >= 0) {
    const qs = new URLSearchParams(hash.slice(qStart + 1));
    const urlParam = qs.get('url');
    const titleParam = qs.get('title');
    if (urlParam) {
      // URL タブ に 自動 切替 + 値 セット + 自動 fetch
      const urlTab = document.querySelector('.rf-tab[data-tab="url"]');
      urlTab?.click();
      const urlInput = document.getElementById('rf-url');
      if (urlInput) urlInput.value = urlParam;
      if (titleParam) document.getElementById('rf-f-title').value = titleParam;
      setTimeout(() => document.getElementById('rf-fetch-url')?.click(), 100);
    }
  }
}

// v927 添付ファイル 一覧 の 読み込み + 描画。
async function loadAttachments(refId) {
  const el = document.getElementById('rf-att-list');
  if (!el) return;
  try {
    const d = await get('/api/refs/' + refId + '/attachments');
    const items = d.items || [];
    const meId = Number(state.me?.id || 0);
    if (!items.length) { el.innerHTML = '<span class="muted">まだ 追加なし</span>'; return; }
    const kindEmoji = { pdf: '📄', supplement: '📎', slides: '🖼', video: '🎞', image: '🖼', other: '📁' };
    el.innerHTML = items.map(a => `
      <div class="list-item" style="padding:6px 0; border-bottom:1px solid #f3f4f6; display:flex; gap:8px; align-items:center">
        <span style="font-size:16px">${kindEmoji[a.kind] || '📁'}</span>
        <a href="${escapeHtml(a.path)}" target="_blank" rel="noopener" style="flex:1; color:var(--primary); text-decoration:none; font-size:13px; word-break:break-all">${escapeHtml(a.filename)}</a>
        <span class="hint-sm" style="font-size:11px">${((a.size_bytes||0)/1024).toFixed(0)} KB · ${escapeHtml(a.uploaded_by_name || '?')}</span>
        ${(a.uploaded_by_user_id === meId || state.me?.role === 'admin')
          ? `<button class="btn danger rf-att-del" data-id="${a.id}" style="font-size:11px; padding:2px 6px">🗑</button>` : ''}
      </div>`).join('');
    el.querySelectorAll('.rf-att-del').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('削除?')) return;
        try {
          await del('/api/refs/' + refId + '/attachments/' + b.dataset.id);
          toast('削除 完了');
          loadAttachments(refId);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    el.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

// v928 track B: 関連 論文 の 表示 + 削除。
async function loadRelated(refId) {
  const el = document.getElementById('rf-rel-list');
  if (!el) return;
  try {
    const d = await get('/api/refs/' + refId + '/relations');
    const items = d.items || [];
    if (!items.length) { el.innerHTML = '<span class="muted">まだ ありません</span>'; return; }
    el.innerHTML = items.map(r => `
      <div class="list-item" style="padding:6px 0; border-bottom:1px solid #f3f4f6; display:flex; gap:6px; align-items:center">
        <a href="#/refs/${r.other_id}" style="flex:1; color:var(--primary); text-decoration:none; font-size:13px">
          🔗 ${escapeHtml(r.title)}${r.year ? ' (' + r.year + ')' : ''}
        </a>
        ${r.note ? `<span class="hint-sm" style="font-size:11px; color:#6b7280">${escapeHtml(r.note)}</span>` : ''}
        <button class="btn danger rf-rel-del" data-oid="${r.other_id}" style="font-size:11px; padding:2px 6px">✕</button>
      </div>`).join('');
    el.querySelectorAll('.rf-rel-del').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('関連 を 外す?')) return;
        try { await del('/api/refs/' + refId + '/relations/' + b.dataset.oid); toast('外しました'); loadRelated(refId); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    el.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

// v927 bookmarklet 生成 ページ
export async function renderRefsBookmarklet() {
  const app = document.getElementById('app');
  const origin = location.origin;
  const bmCode = `javascript:(function(){var u=encodeURIComponent(location.href);var t=encodeURIComponent(document.title||'');window.open('${origin}/#/refs/new?url='+u+'&title='+t,'_blank');})();`;
  app.innerHTML = `
    <div class="card">
      <a href="#/refs/new" class="hint">← 追加 に 戻る</a>
      <h2 style="margin:6px 0 0">📖 refs Bookmarklet</h2>
      <div class="hint-sm" style="font-size:12px; margin-top:4px">論文 ページ を 開いた まま 1 クリック で LabPay に 追加。</div>
    </div>
    <div class="card">
      <div class="bold" style="font-size:14px; margin-bottom:6px">1. 下の リンク を ブラウザ の ブックマーク バー に ドラッグ</div>
      <a href="${bmCode}" style="display:inline-block; padding:8px 16px; background:#a855f7; color:#fff; text-decoration:none; border-radius:6px; font-weight:700">📖 refs に 追加</a>
      <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:6px">ドラッグ が うまく いか ない 時 は 下の コード を コピー して ブックマーク の URL 欄 に 貼り 付け:</div>
      <textarea readonly style="width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; margin-top:4px; height:80px">${escapeHtml(bmCode)}</textarea>
    </div>
    <div class="card">
      <div class="bold" style="font-size:14px; margin-bottom:6px">2. 使い方</div>
      <ol style="font-size:13px; line-height:1.8">
        <li>tabelog みたい に <b>論文 の 出版社 ページ</b> (ACM DL / IEEE / arXiv / Nature 等) を 開く</li>
        <li>ブックマーク バー の 「📖 refs に 追加」 を クリック</li>
        <li>LabPay が 新規 タブ で 開き、 URL 自動 fetch → DOI/arXiv 抽出 → metadata が 埋まる</li>
        <li>タグ を 付けて 「登録」</li>
      </ol>
      <div class="hint-sm" style="font-size:11px; color:#6b7280">対応 サイト: DOI or arXiv ID を URL に 含む 論文 ページ。 認識 できない 場合 は 「URL」 タブ に URL だけ 埋まった 状態 で 手動 補完 する 形 に。</div>
    </div>
  `;
}

// ─── 詳細 ─────────────────────────────────────────────

export async function renderRefsDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/refs" class="hint">← 一覧</a>
      <div id="rf-d-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div id="rf-d-body"></div>
  `;
  try {
    const d = await get('/api/refs/' + id);
    paintDetail(id, d);
  } catch (e) {
    document.getElementById('rf-d-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function paintDetail(id, d) {
  const meId = Number(state.me?.id || 0);
  const isOwner = d.added_by_user_id === meId;
  const isAdmin = state.me?.role === 'admin';
  const canEdit = isOwner || isAdmin;

  const idLinks = [];
  if (d.doi)      idLinks.push(`<a href="https://doi.org/${escapeHtml(d.doi)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 DOI: ${escapeHtml(d.doi)}</a>`);
  if (d.arxiv_id) idLinks.push(`<a href="https://arxiv.org/abs/${escapeHtml(d.arxiv_id)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 arXiv: ${escapeHtml(d.arxiv_id)}</a>`);
  if (d.url && d.url !== `https://doi.org/${d.doi}`) idLinks.push(`<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 出版社 リンク</a>`);
  const tagsHtml = (d.tags || []).map(t =>
    `<span class="tag" style="background:#f3e8ff; color:#7b3fa0; font-size:12px; padding:2px 8px; border-radius:10px">${escapeHtml(t)}</span>`
  ).join(' ');
  const pdfBlock = d.pdf_path
    ? `<a href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" class="btn" style="font-size:12px; padding:3px 10px">📄 PDF を 開く</a>`
    : `<button id="rf-pdf-upload" class="btn" style="font-size:12px; padding:3px 10px">📎 PDF を 添付</button>
       <input type="file" id="rf-pdf-file" accept="application/pdf,.pdf" hidden>`;
  const bibBtn = `<button id="rf-bibtex-btn" class="btn" style="font-size:12px; padding:3px 10px">📋 BibTeX コピー</button>`;

  document.getElementById('rf-d-head').innerHTML = `
    <h2 style="margin:6px 0 0; font-size:18px; line-height:1.4">${escapeHtml(d.title)}</h2>
    <div class="meta" style="margin-top:4px">
      ${escapeHtml(authorsShort(d.authors))}${d.year ? ' · <b>' + d.year + '</b>' : ''}${d.venue ? ' · ' + escapeHtml(d.venue) : ''}
    </div>
    ${idLinks.length ? '<div class="meta" style="margin-top:6px; display:flex; gap:12px; flex-wrap:wrap">' + idLinks.join(' ') + '</div>' : ''}
    <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
      ${pdfBlock}
      ${bibBtn}
      ${canEdit ? '<button id="rf-del" class="btn danger" style="font-size:12px; padding:3px 10px">🗑 削除</button>' : ''}
    </div>
    <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">${tagsHtml}</div>
    <div class="meta" style="margin-top:6px; font-size:11px">
      登録: ${avatarHtml(d.added_by_name, d.added_by_avatar, 'xs')} ${escapeHtml(d.added_by_name || '?')} · ${escapeHtml(d.created_at || '')}
    </div>
  `;

  const abstractBlock = d.abstract
    ? `<div class="card"><div class="bold" style="font-size:13px; margin-bottom:4px">抄録</div><div style="font-size:13px; line-height:1.7; white-space:pre-wrap">${escapeHtml(d.abstract)}</div></div>`
    : '';

  // 自分 の note + 読状態
  const myStatus = d.my?.status || 'unread';
  const myNote = d.my?.note || '';
  const statusBtns = ['unread','reading','read'].map(s =>
    `<button class="btn rf-st" data-s="${s}" style="font-size:12px; padding:3px 10px; ${s===myStatus?`background:${STATUS_COLOR[s]}; color:#fff; border-color:${STATUS_COLOR[s]}`:''}">${STATUS_LABEL[s]}</button>`
  ).join('');
  const sc = d.status_counts || { unread:0, reading:0, read:0 };
  const myBlock = `
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px">🎯 自分 の 状態</div>
        <span class="hint-sm" style="margin-left:auto; font-size:11px">ラボ全体: 未読 ${sc.unread} / 読中 ${sc.reading} / 既読 ${sc.read}</span>
      </div>
      <div class="row" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">${statusBtns}</div>
      <label class="field"><span class="lbl" style="font-size:12px">📝 自分 の note (共有 されます)</span>
        <textarea id="rf-my-note" rows="4" placeholder="読んだ 感想 / 気づき / 実験結果 の 突っ込み ポイント 等" style="width:100%; box-sizing:border-box; font-size:13px">${escapeHtml(myNote)}</textarea>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="rf-save-note" class="btn primary" style="font-size:12px">📝 note を 保存</button>
      </div>
    </div>`;

  // 他の 人 の note (共有)
  const othersHtml = (d.others_notes || []).map(n => `
    <div style="padding:8px 10px; border-bottom:1px solid #f3f4f6">
      <div class="row center" style="gap:6px">
        ${avatarHtml(n.display_name, n.avatar_url, 'xs')}
        <span class="bold" style="font-size:12px">${escapeHtml(n.display_name)}</span>
        <span style="background:${STATUS_COLOR[n.status]||'#9ca3af'}; color:#fff; font-size:10px; padding:1px 6px; border-radius:8px">${STATUS_LABEL[n.status]||n.status}</span>
        <span class="hint-sm" style="margin-left:auto; font-size:10px">${escapeHtml(n.updated_at || '')}</span>
      </div>
      <div style="font-size:13px; line-height:1.6; margin-top:4px; white-space:pre-wrap">${escapeHtml(n.note)}</div>
    </div>`).join('');
  const othersBlock = othersHtml
    ? `<div class="card"><div class="bold" style="font-size:13px; margin-bottom:6px">💬 ラボメン の note</div>${othersHtml}</div>`
    : '';

  // v926 相互 リンク: kind 別 に 「済」 「進行中」 を 分けて 表示。 ラボメン の 分も 拾う。
  const linkKinds = { paper_translate: [], paper_full_translate: [], paper_review: [] };
  for (const l of (d.links || [])) {
    if (linkKinds[l.kind]) linkKinds[l.kind].push(l);
  }
  const linkChip = l => {
    const status = l.status || 'done';
    const bg = status === 'done' ? '#dcfce7' : status === 'processing' ? '#fef3c7' : '#e0e7ff';
    const col = status === 'done' ? '#166534' : status === 'processing' ? '#78350f' : '#3730a3';
    const stLbl = status === 'done' ? '済' : status === 'processing' ? '進行中' : '待機';
    const runner = l.is_mine ? '' : ` <span style="opacity:0.7">by ${escapeHtml(l.runner_name || '?')}</span>`;
    return `<a class="btn" href="${escapeHtml(l.url)}" style="font-size:12px; padding:3px 10px; background:${bg}; color:${col}; border-color:${col}">
      ${escapeHtml(l.label)} (${stLbl})${runner}
    </a>`;
  };

  // v926 LabPay AI 連携 カード: refs に PDF が あれば 4 種類 の 処理 を キック 可能。
  const hasPdf = !!d.pdf_path;
  const aiCard = hasPdf ? `
    <div class="card" style="background:linear-gradient(135deg, #ede9fe, #ddd6fe); border:2px solid #a78bfa; border-radius:10px">
      <div class="row center" style="gap:6px; margin-bottom:8px; flex-wrap:wrap">
        <div class="bold" style="font-size:14px; color:#5b21b6">🤖 この 論文 を LabPay AI に かける</div>
      </div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="rf-ai-summary"  class="btn primary" style="font-size:12px; padding:4px 10px">📑 要約する</button>
        <button id="rf-ai-fulltrans" class="btn primary" style="font-size:12px; padding:4px 10px">📑 全訳する</button>
        <button id="rf-ai-review"   class="btn primary" style="font-size:12px; padding:4px 10px">📄 査読する</button>
        <button id="rf-ai-dr"       class="btn primary" style="font-size:12px; padding:4px 10px">🔎 関連 論文 を 探す</button>
      </div>
      ${linkKinds.paper_translate.length ? `<div style="margin-top:8px"><div class="hint-sm" style="font-size:11px; color:#5b21b6; margin-bottom:2px">要約</div><div class="row" style="gap:4px; flex-wrap:wrap">${linkKinds.paper_translate.map(linkChip).join('')}</div></div>` : ''}
      ${linkKinds.paper_full_translate.length ? `<div style="margin-top:6px"><div class="hint-sm" style="font-size:11px; color:#5b21b6; margin-bottom:2px">全訳</div><div class="row" style="gap:4px; flex-wrap:wrap">${linkKinds.paper_full_translate.map(linkChip).join('')}</div></div>` : ''}
      ${linkKinds.paper_review.length ? `<div style="margin-top:6px"><div class="hint-sm" style="font-size:11px; color:#5b21b6; margin-bottom:2px">査読</div><div class="row" style="gap:4px; flex-wrap:wrap">${linkKinds.paper_review.map(linkChip).join('')}</div></div>` : ''}
    </div>` : (
      // PDF が 無い とき: Deep Research だけ できる (query base で 動く の で)
      `<div class="card" style="background:#f3f4f6; border:1px dashed #9ca3af">
        <div class="hint-sm" style="font-size:12px">📎 PDF を 添付 する と 要約 / 全訳 / 査読 が 実行 できます。 関連 論文 検索 は PDF なし でも 可 ↓</div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button id="rf-ai-dr" class="btn primary" style="font-size:12px; padding:4px 10px">🔎 関連 論文 を 探す (Deep Research)</button>
        </div>
      </div>`
    );

  // v928 track B: この refs が 所属 する collections + 追加/削除
  const colsHtml = (d.collections || []).map(c =>
    `<span class="tag rf-col-tag" data-cid="${c.id}" style="background:#ede9fe; color:#5b21b6; font-size:11px; padding:2px 6px; border-radius:8px; cursor:pointer">${c.icon || '📁'} ${escapeHtml(c.name)} <span class="rf-col-rem" data-cid="${c.id}" style="opacity:0.5">✕</span></span>`
  ).join(' ');
  const colsCard = `
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px">📁 コレクション</div>
        <button id="rf-col-add-btn" class="btn" style="font-size:11px; padding:2px 8px; margin-left:auto">＋ 追加</button>
      </div>
      <div id="rf-cols-of-ref" class="row" style="gap:4px; flex-wrap:wrap">${colsHtml || '<span class="muted" style="font-size:12px">未分類</span>'}</div>
    </div>`;

  // v928 track B: 関連 論文 (related items)
  const relatedCard = `
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px">🔗 関連 論文</div>
        <button id="rf-rel-add" class="btn" style="font-size:11px; padding:2px 8px; margin-left:auto">＋ 追加</button>
      </div>
      <div id="rf-rel-list" class="hint-sm" style="font-size:12px">読み込み中…</div>
    </div>`;

  // v928 track B: trash に 入って いる 場合 の 復元 バナー
  const trashBanner = d.deleted_at ? `
    <div class="card" style="background:#fef2f2; border:2px solid #dc2626">
      <div class="row center" style="gap:6px">
        <div class="bold" style="color:#7f1d1d">🗑 この 文献 は ゴミ箱 に あります</div>
        <button id="rf-restore" class="btn primary" style="font-size:12px; margin-left:auto">↩ 復元</button>
      </div>
      <div class="hint-sm" style="font-size:11px; color:#7f1d1d; margin-top:4px">削除 したのは ${escapeHtml(d.deleted_at)}。 完全削除 は admin のみ 可 (再度 「🗑 削除」 で 実行)。</div>
    </div>` : '';

  // v927 添付ファイル (attachments、 主 PDF 以外の 補足資料 / スライド 等)
  const attCard = `
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px">📎 添付ファイル</div>
        <label class="btn primary" style="font-size:12px; padding:3px 10px; margin-left:auto; cursor:pointer">
          ＋ 追加
          <input type="file" id="rf-att-file" hidden>
        </label>
      </div>
      <div id="rf-att-list" class="hint-sm" style="font-size:12px">読み込み中…</div>
    </div>`;

  document.getElementById('rf-d-body').innerHTML = trashBanner + abstractBlock + aiCard + colsCard + relatedCard + attCard + myBlock + othersBlock;
  loadAttachments(id);
  loadRelated(id);
  // v928 track B: コレクション add/remove
  document.getElementById('rf-col-add-btn')?.addEventListener('click', async () => {
    try {
      const dc = await get('/api/refs/collections');
      const items = dc.items || [];
      if (!items.length) { toast('コレクション なし。 一覧 で 「＋ 新規」 で 作って'); return; }
      const opts = items.map((c, i) => `${i+1}. ${c.icon || '📁'} ${c.name}`).join('\n');
      const pick = prompt('番号 で 選択:\n' + opts);
      if (!pick) return;
      const idx = Number(pick) - 1;
      if (idx < 0 || idx >= items.length) { toast('番号 不正'); return; }
      await post('/api/refs/collections/' + items[idx].id + '/refs/' + id, {});
      toast('追加');
      renderRefsDetail({ params: { id } });
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.querySelectorAll('.rf-col-rem').forEach(x => {
    x.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { await del('/api/refs/collections/' + x.dataset.cid + '/refs/' + id); toast('外しました'); renderRefsDetail({ params: { id } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  });
  // v928 track B: related add
  document.getElementById('rf-rel-add')?.addEventListener('click', async () => {
    const refIdStr = prompt('関連 する 文献 の ID を 入力 (数字)');
    if (!refIdStr) return;
    const otherId = Number(refIdStr);
    if (!otherId || otherId === id) { toast('ID 不正'); return; }
    const note = prompt('メモ (任意)') || '';
    try {
      await post('/api/refs/' + id + '/relations', { ref_id: otherId, kind: 'related', note });
      toast('関連 追加');
      loadRelated(id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  // v928 track B: trash restore
  document.getElementById('rf-restore')?.addEventListener('click', async () => {
    try { await post('/api/refs/' + id + '/restore', {}); toast('復元'); renderRefsDetail({ params: { id } }); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('rf-att-file')?.addEventListener('change', async () => {
    const f = document.getElementById('rf-att-file').files?.[0];
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { toast('30MB まで'); return; }
    const kind = f.type.startsWith('image/') ? 'image'
              : f.type === 'application/pdf' ? 'supplement'
              : (/\.(pptx?|key)$/i.test(f.name) ? 'slides'
              : (f.type.startsWith('video/') ? 'video' : 'other'));
    const fd = new FormData();
    fd.append('file', f);
    fd.append('kind', kind);
    try {
      const resp = await fetch('/api/refs/' + id + '/attachments', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error?.message || j?.error || ('HTTP ' + resp.status));
      toast('添付 完了');
      loadAttachments(id);
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // ── ハンドラ ──
  document.getElementById('rf-bibtex-btn')?.addEventListener('click', async () => {
    if (!d.bibtex) { toast('BibTeX なし'); return; }
    try { await navigator.clipboard.writeText(d.bibtex); toast('BibTeX を コピー'); }
    catch { toast('コピー 失敗'); }
  });
  document.getElementById('rf-del')?.addEventListener('click', async () => {
    if (!confirm('この 文献 を 削除 しますか? (元 に 戻せません)')) return;
    try { await del('/api/refs/' + id); toast('削除 完了'); navigate('#/refs'); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('rf-pdf-upload')?.addEventListener('click', () => {
    document.getElementById('rf-pdf-file').click();
  });
  document.getElementById('rf-pdf-file')?.addEventListener('change', async () => {
    const f = document.getElementById('rf-pdf-file').files?.[0];
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { toast('30MB まで'); return; }
    const fd = new FormData();
    fd.append('file', f);
    try {
      const resp = await fetch('/api/refs/' + id + '/attach_pdf', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error?.message || j?.error || ('HTTP ' + resp.status));
      toast('PDF 添付 完了');
      renderRefsDetail({ params: { id } });
    } catch (e) { toast('添付 失敗: ' + e.message); }
  });
  document.querySelectorAll('.rf-st').forEach(b => {
    b.addEventListener('click', async () => {
      try {
        await patch('/api/refs/' + id + '/note', { status: b.dataset.s });
        toast('状態: ' + STATUS_LABEL[b.dataset.s]);
        renderRefsDetail({ params: { id } });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  document.getElementById('rf-save-note')?.addEventListener('click', async () => {
    const note = document.getElementById('rf-my-note').value;
    try {
      await patch('/api/refs/' + id + '/note', { note });
      toast('note 保存');
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // v926 LabPay AI 連携 ハンドラ。 refs.pdf_path から blob を fetch して 既存 の
  //   /api/ai/paper_translate / paper_full_translate / paper_review に POST する。
  //   結果 の share_token は 次回 refs 詳細 で pdf_sha256 一致 で 自動 表示 される。
  const fetchPdfBlob = async () => {
    if (!d.pdf_path) throw new Error('PDF が 添付 されて いません');
    const resp = await fetch(d.pdf_path, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('PDF 取得 失敗 HTTP ' + resp.status);
    return await resp.blob();
  };
  const pdfName = () => {
    const t = (d.title || 'paper').replace(/[^\w\-一-龯ぁ-んァ-ン]/g, '_').slice(0, 80);
    return t + '.pdf';
  };
  const runAiPost = async (endpoint, extraFields = {}) => {
    const btn = document.getElementById(endpoint === '/api/ai/paper_translate' ? 'rf-ai-summary'
              : endpoint === '/api/ai/paper_full_translate' ? 'rf-ai-fulltrans' : 'rf-ai-review');
    const oldTxt = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ 送信中…';
    try {
      const blob = await fetchPdfBlob();
      const fd = new FormData();
      fd.append('file', new File([blob], pdfName(), { type: 'application/pdf' }));
      for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
      const resp = await fetch(endpoint, {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error?.message || j?.error || ('HTTP ' + resp.status));
      const url = endpoint.includes('paper_full') ? '#/paper-translate-full/r/' + j.share_token
                : endpoint.includes('paper_review') ? '#/paper-review/r/' + j.share_token
                : '#/paper-summary/r/' + j.share_token;
      toast('開始! 完了 通知 が 届きます');
      window.open(url, '_blank');
      // refs 詳細 を リフレッシュ (「進行中」 が 出る)
      renderRefsDetail({ params: { id } });
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = oldTxt;
    }
  };

  document.getElementById('rf-ai-summary')?.addEventListener('click', async () => {
    if (!confirm('要約 を 開始 します。 モデル は gpt-5 (共有 で 25pt / 非共有 で 50pt)。 続行?')) return;
    await runAiPost('/api/ai/paper_translate', { model: 'gpt-5', auto_share: '1' });
  });
  document.getElementById('rf-ai-fulltrans')?.addEventListener('click', async () => {
    const dir = confirm('英→日 で 全訳 しますか? [OK=英→日 / キャンセル=別の モデル で]') ? 'en2ja' : null;
    if (!dir) { toast('全訳 は /#/paper-translate-full から 直接 起動 して ください'); return; }
    if (!confirm('全訳 を 開始 (' + dir + ' / gpt-5 / 共有 30pt 予定)。 続行?')) return;
    await runAiPost('/api/ai/paper_full_translate', { direction: dir, model: 'gpt-5', auto_share: '1' });
  });
  document.getElementById('rf-ai-review')?.addEventListener('click', async () => {
    const venue = prompt('査読 の target 会議 名', d.venue || 'CHI');
    if (!venue) return;
    const strictness = prompt('厳しさ: soft / normal / strict', 'normal') || 'normal';
    if (!confirm(`査読 開始 (${venue} / ${strictness} / gpt-5 30pt)。 続行?`)) return;
    await runAiPost('/api/ai/paper_review', {
      target_venue: venue, strictness, model: 'gpt-5',
    });
  });
  // Deep Research: PDF 不要、 タイトル + 抄録 を prefill query に して /#/deep-research へ 遷移
  document.getElementById('rf-ai-dr')?.addEventListener('click', () => {
    const q = `以下 の 論文 に 関連 する 最近 (2024-2026) の 論文 を 3-5 本 探して 短く 紹介 して ください。\n\n` +
              `タイトル: ${d.title}\n` +
              (d.year ? `年: ${d.year}\n` : '') +
              (d.venue ? `会議 / 誌: ${d.venue}\n` : '') +
              (d.abstract ? `\n抄録:\n${(d.abstract || '').slice(0, 500)}` : '');
    try { sessionStorage.setItem('labpay.dr.prefill', q); } catch (_) {}
    navigate('#/deep-research');
    setTimeout(() => {
      const el = document.getElementById('dr-query');
      if (el) { el.value = q; el.focus(); }
    }, 500);
  });
}
