// /#/refs — Zotero-like 文献管理 (v925 MVP)。
// ラボ全員 で 共有、 各自 note + 読状態 は 個人別。
// DOI / arXiv ID / URL から metadata 自動取得 (crossref / arxiv API)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { renderAuthorAvatar, mountAuthorAvatars, initLabUsersCache } from '../author_avatar.js';

const STATUS_LABEL = { unread: '未読', reading: '読中', read: '既読' };
const STATUS_COLOR = { unread: '#9ca3af', reading: '#f59e0b', read: '#15803d' };
// v929
const ITEM_TYPES = [
  { id: 'article',      label: '📄 論文' },
  { id: 'conference',   label: '📄 会議 論文' },
  { id: 'book',         label: '📖 書籍' },
  { id: 'book_chapter', label: '📖 書籍 の 章' },
  { id: 'thesis',       label: '🎓 学位論文' },
  { id: 'patent',       label: '⚙️ 特許' },
  { id: 'dataset',      label: '📊 データセット' },
  { id: 'preprint',     label: '📝 プレプリント' },
  { id: 'web',          label: '🌐 Web ページ' },
  { id: 'misc',         label: '📎 その他' },
];
const HIGHLIGHT_COLORS = {
  yellow: '#fef3c7', red: '#fee2e2', green: '#dcfce7', blue: '#dbeafe', purple: '#ede9fe',
};
const HIGHLIGHT_TEXT_COLORS = {
  yellow: '#78350f', red: '#7f1d1d', green: '#166534', blue: '#1e3a8a', purple: '#5b21b6',
};

// v929 簡易 Markdown → HTML (見出し / 太字 / italic / 箇条書き / リンク / コード / 改行)。
//   XSS 対策 に まず escapeHtml、 その後 に 決まった pattern だけ 復元。
function mdToHtml(src) {
  if (!src) return '';
  let s = escapeHtml(String(src));
  // コードブロック ```lang\ncode\n```
  s = s.replace(/```(\w*)\n([\s\S]+?)\n```/g, (m, lang, code) => `<pre style="background:#f3f4f6; padding:8px; border-radius:4px; overflow-x:auto; font-family:monospace; font-size:12px">${code}</pre>`);
  // inline code
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6; padding:1px 4px; border-radius:3px; font-family:monospace; font-size:12px">$1</code>');
  // 見出し
  s = s.replace(/^###### (.+)$/gm, '<h6 style="margin:8px 0 4px; font-size:13px">$1</h6>');
  s = s.replace(/^##### (.+)$/gm,  '<h5 style="margin:8px 0 4px; font-size:14px">$1</h5>');
  s = s.replace(/^#### (.+)$/gm,   '<h4 style="margin:8px 0 4px; font-size:14px">$1</h4>');
  s = s.replace(/^### (.+)$/gm,    '<h3 style="margin:8px 0 4px; font-size:15px">$1</h3>');
  s = s.replace(/^## (.+)$/gm,     '<h2 style="margin:10px 0 4px; font-size:16px">$1</h2>');
  s = s.replace(/^# (.+)$/gm,      '<h1 style="margin:12px 0 6px; font-size:18px">$1</h1>');
  // 引用
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid #a855f7; padding:2px 8px; margin:4px 0; color:#5b21b6">$1</blockquote>');
  // 箇条書き
  s = s.replace(/^([-*]) (.+)$/gm, '<li style="margin-left:20px">$2</li>');
  s = s.replace(/(<li[^>]*>.+<\/li>\n?)+/g, m => '<ul style="margin:4px 0">' + m + '</ul>');
  // 太字
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  s = s.replace(/(?<![*])\*([^*\n]+)\*(?![*])/g, '<em>$1</em>');
  // リンク [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--primary)">$1</a>');
  // 裸の URL
  s = s.replace(/(?<!href=&quot;|href=")https?:\/\/[^\s<]+/g, m => `<a href="${m}" target="_blank" rel="noopener" style="color:var(--primary)">${m}</a>`);
  // 改行 (段落 は 単純 に <br>)
  s = s.replace(/\n/g, '<br>');
  return s;
}

let listState = {
  q: '', tag: '', year: 0, status: '', sort: 'new',
  collection_id: 0, uncategorized: false, trash: false,
  fulltext_q: '',
};

function authorsShort(authors) {
  if (!Array.isArray(authors) || !authors.length) return '';
  const names = authors.map(a => (a && a.name) || '').filter(Boolean);
  if (names.length <= 3) return names.join(', ');
  return names.slice(0, 3).join(', ') + `, et al. (${names.length}人)`;
}

// v1006 中村さん要望「(refs 詳細に) 要約 と 同型 の 著者リスト を 付けて 欲しい」。
//   paper_translate.js の ptRenderAuthorCards と 揃えた 見た目、 タップで
//   #/authors/{name} (著者ページ) に 遷移。
function rfRenderAuthorCards(authors) {
  if (!Array.isArray(authors) || !authors.length) return '';
  return `
    <div class="card" style="margin-top:10px">
      <div class="bold" style="color:var(--primary); font-size:13px; margin-bottom:8px">👥 著者 <span class="hint-sm" style="font-weight:normal">タップで著者ページ</span></div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:8px">
        ${authors.map(a => {
          const name  = String(a?.name  || '').trim();
          if (!name) return '';
          const aff   = String(a?.affiliation || '').trim();
          const email = String(a?.email || '').trim();
          return `
            <div style="display:flex; gap:10px; padding:8px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; min-width:0">
              ${renderAuthorAvatar({ name, email }, { size: 38 })}
              <div style="flex:1; min-width:0; font-size:12px">
                <button data-rf-author="${escapeHtml(name)}" class="bold" style="font-size:13px; background:none; border:none; padding:0; color:#7b3fa0; cursor:pointer; text-align:left; font-family:inherit; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(name)}</button>
                ${aff   ? `<div style="color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHtml(aff)}">${escapeHtml(aff)}</div>` : ''}
                ${email ? `<a href="mailto:${escapeHtml(email)}" style="font-size:11px; color:#7b3fa0; text-decoration:none">${escapeHtml(email)}</a>` : ''}
              </div>
            </div>`;
        }).filter(Boolean).join('')}
      </div>
    </div>`;
}

// v1006 タグ / 著者 の クリック ハンドラ。 paintDetail の 差し込み 直後 に 呼ぶ。
function rfBindClickables() {
  document.querySelectorAll('[data-rf-tag]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const t = String(b.dataset.rfTag || '').trim();
      if (!t) return;
      location.hash = '#/refs?tag=' + encodeURIComponent(t);
    });
  });
  document.querySelectorAll('[data-rf-author]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.rfAuthor || '').trim();
      if (!q) return;
      location.hash = '#/authors/' + encodeURIComponent(q);
    });
  });
  mountAuthorAvatars(document.getElementById('app'));
}

// ─── 一覧 ─────────────────────────────────────────────

export async function renderRefs() {
  // v1006 URL の ?tag=<t> ?q=<q> を listState に取り込む (詳細ページから
  //   キーワード chip をタップしてジャンプ してきた場合)。
  const qStart = (location.hash || '').indexOf('?');
  if (qStart !== -1) {
    const qs = new URLSearchParams((location.hash || '').slice(qStart + 1));
    const t = qs.get('tag'); if (t) listState.tag = t;
    const q = qs.get('q');   if (q) listState.q = q;
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:8px; flex-wrap:wrap">
        <h2 style="margin:0; flex:1">📚 文献管理</h2>
        <a class="btn primary" href="#/refs/new" style="font-size:13px; padding:4px 12px">＋ 文献を 追加</a>
        <button id="rf-export" class="btn" style="font-size:12px; padding:4px 8px" title="現在 の 絞り込み 対象 全件 の BibTeX を クリップボード に コピー">📋 BibTeX コピー</button>
        <a class="btn" href="#/refs/bibliography" style="font-size:12px; padding:4px 8px" title="参考文献 リスト を CSL style で 一括生成">📚 参考文献</a>
        <button id="rf-toggle-trash" class="btn" style="font-size:12px; padding:4px 8px" title="ゴミ箱 切替">🗑</button>
      </div>
    </div>
    <!-- v928 track B: コレクション サイドバー (縦 スクロール chip) -->
    <div class="card" id="rf-cols-card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:12px">📁 コレクション</div>
        <button id="rf-col-new" class="btn" style="font-size:11px; padding:2px 8px; margin-left:auto">＋ 新規</button>
      </div>
      <!-- v937 fb#472: 二連 prompt() で 詰まる ケース (モバイル Safari 等) を 潰す ため
           インライン フォーム に 差し替え。 hidden 開始、 「＋ 新規」 で toggle。 -->
      <div id="rf-col-form" hidden style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; align-items:center">
        <input type="text" id="rf-col-name" placeholder="コレクション名 (例: HCI論文、 CHI2026送り用)"
               style="flex:1; min-width:180px; padding:4px 8px; font-size:13px; border:1px solid #d1d5db; border-radius:4px">
        <input type="text" id="rf-col-icon" placeholder="📁" value="📁" maxlength="4"
               style="width:60px; padding:4px 8px; font-size:16px; text-align:center; border:1px solid #d1d5db; border-radius:4px">
        <button id="rf-col-create" class="btn primary" style="font-size:12px; padding:4px 10px">作成</button>
        <button id="rf-col-cancel" class="btn" style="font-size:12px; padding:4px 10px">キャンセル</button>
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
        <input type="search" id="rf-ftq" placeholder="🔍 PDF 全文" style="width:140px; padding:4px 8px; font-size:13px; border:1px solid #a78bfa; border-radius:4px" title="PDF 添付 済 refs の 本文 検索" value="${escapeHtml(listState.fulltext_q)}">
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
  document.getElementById('rf-export').addEventListener('click', async () => {
    // v935 ダウンロード 保存 じゃ なく クリップボード へ (BibTeX は Overleaf 貼り 付け が 主用途)
    const t = listState.tag ? `?tag=${encodeURIComponent(listState.tag)}` : '';
    try {
      const resp = await fetch('/api/refs/export/bibtex' + t, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const entries = (text.match(/@\w+\s*\{/g) || []).length;
      await navigator.clipboard.writeText(text);
      toast(`📋 ${entries} 件 の BibTeX を コピー`);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  let searchTimer = null;
  document.getElementById('rf-q').addEventListener('input', e => {
    listState.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadList, 250);
  });
  document.getElementById('rf-ftq').addEventListener('input', e => {
    listState.fulltext_q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadList, 350);
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
  // v937 fb#472 二連 prompt() が モバイル で 詰まる 件 の 修正。 インライン フォーム トグル に。
  const colForm = document.getElementById('rf-col-form');
  const colNameInput = document.getElementById('rf-col-name');
  document.getElementById('rf-col-new').addEventListener('click', () => {
    colForm.hidden = !colForm.hidden;
    if (!colForm.hidden) { colNameInput.value = ''; colNameInput.focus(); }
  });
  document.getElementById('rf-col-cancel').addEventListener('click', () => {
    colForm.hidden = true;
  });
  const submitCol = async () => {
    const name = colNameInput.value.trim();
    if (!name) { toast('名前を入力してください'); colNameInput.focus(); return; }
    const icon = document.getElementById('rf-col-icon').value.trim() || '📁';
    try {
      await post('/api/refs/collections', { name, icon });
      colForm.hidden = true;
      colNameInput.value = '';
      await loadCollectionsChips();
      toast('コレクション作成');
    } catch (e) { toast('失敗: ' + e.message); }
  };
  document.getElementById('rf-col-create').addEventListener('click', submitCol);
  colNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCol(); });
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
  if (listState.fulltext_q) params.set('fulltext_q', listState.fulltext_q);
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
    // v935 タイル 内 の タグ chip クリック で フィルタ 発火 (親 <a> の navigate を 止める)
    root.querySelectorAll('.rf-tile-tag').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const t = b.dataset.tag;
        listState.tag = (listState.tag === t) ? '' : t;
        loadTagsChips();
        loadList();
        // scroll to top
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderTile(it) {
  // v935 タグ chip を button 化 + data-tag で 拾える ように。 親 <a> の navigate を stopPropagation で 止める。
  //   flex:0 0 auto で 引き伸ばされ ない よう に (.row > * が flex:1 1 auto を 効かせる ので inline style で 上書き)。
  const tagsHtml = (it.tags || []).map(t =>
    `<button class="tag rf-tile-tag" data-tag="${escapeHtml(t)}" style="flex:0 0 auto; background:#f3e8ff; color:#7b3fa0; font-size:11px; padding:1px 6px; border-radius:8px; border:none; cursor:pointer; font-family:inherit; line-height:1.4">${escapeHtml(t)}</button>`
  ).join(' ');
  const st = it.my_status || 'unread';
  const stChip = `<span style="flex:0 0 auto; background:${STATUS_COLOR[st]}; color:#fff; font-size:10px; padding:1px 6px; border-radius:8px; line-height:1.4">${STATUS_LABEL[st]}</span>`;
  const idBadges = [];
  if (it.doi)      idBadges.push('DOI');
  if (it.arxiv_id) idBadges.push('arXiv');
  if (it.pdf_path) idBadges.push('📄 PDF');
  if (it.citation_count != null) idBadges.push(`🔗 ${it.citation_count}`);
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
        <button class="btn primary rf-tab" data-tab="doi"     style="font-size:13px">DOI</button>
        <button class="btn rf-tab"         data-tab="arxiv"   style="font-size:13px">arXiv</button>
        <button class="btn rf-tab"         data-tab="url"     style="font-size:13px">URL</button>
        <button class="btn rf-tab"         data-tab="pdf"     style="font-size:13px">📄 PDF から</button>
        <button class="btn rf-tab"         data-tab="import"  style="font-size:13px">📥 BibTeX/RIS</button>
        <button class="btn rf-tab"         data-tab="zotero"  style="font-size:13px">🔷 Zotero</button>
        <button class="btn rf-tab"         data-tab="csljson" style="font-size:13px">📄 CSL-JSON</button>
        <button class="btn rf-tab"         data-tab="endnote" style="font-size:13px">📚 EndNote XML</button>
        <button class="btn rf-tab"         data-tab="ss"      style="font-size:13px">🔬 Semantic Scholar</button>
        <button class="btn rf-tab"         data-tab="manual"  style="font-size:13px">手動 入力</button>
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

      <!-- Zotero API 直接連携 -->
      <div id="rf-tab-zotero" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">
          Zotero に 貯めた 文献 を API 経由 で 直接 取り込み。 <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener" style="color:var(--primary)">🔗 API key を 発行</a> (「Personal Library」 に read 権限 でOK) → 下 に 貼る。 個人 library なら user_id、 group library なら group_id を 入れる (どちらも <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener" style="color:var(--primary)">同ページ</a> に 数字 で 表示)。
        </div>
        <label class="field"><span class="lbl">🔑 Zotero API Key</span>
          <input type="password" id="rf-zt-key" placeholder="P9AbCd... (Zotero で 発行)">
        </label>
        <div class="row" style="gap:6px">
          <label class="field" style="flex:1"><span class="lbl">👤 user_id (個人)</span>
            <input type="text" id="rf-zt-user" placeholder="例: 12345">
          </label>
          <label class="field" style="flex:1"><span class="lbl">👥 group_id (group library の 場合、 どちらか 一方)</span>
            <input type="text" id="rf-zt-group" placeholder="例: 67890">
          </label>
        </div>
        <label class="field"><span class="lbl">🔢 1 ページ 分 の 件数 (最大 100)</span>
          <input type="number" id="rf-zt-limit" min="10" max="100" value="100" style="width:120px">
        </label>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label style="display:inline-flex; gap:6px; align-items:center; font-size:12px">
            <input type="checkbox" id="rf-zt-fetch-all" checked> 🔁 全件 取得 (ページング 自動 追随)
          </label>
          <label style="display:inline-flex; gap:6px; align-items:center; font-size:12px">
            <input type="checkbox" id="rf-zt-sync-pdfs"> 📄 PDF 添付 も 同期 (時間 かかる)
          </label>
        </div>
        <div class="row" style="gap:6px">
          <button id="rf-do-zotero" class="btn primary">🔽 Zotero から import</button>
        </div>
        <div id="rf-zt-result" style="margin-top:8px; font-size:13px"></div>
      </div>

      <!-- CSL-JSON ファイル -->
      <div id="rf-tab-csljson" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">Zotero / Papers 等 で export した CSL-JSON (.json) を upload。 一番 情報 が 残る 形式。</div>
        <label class="field"><span class="lbl">📥 .json (CSL-JSON) ファイル</span>
          <input type="file" id="rf-csl-file" accept=".json,application/json">
        </label>
        <div class="row" style="gap:6px">
          <button id="rf-do-csljson" class="btn primary">🔽 CSL-JSON として import</button>
        </div>
        <div id="rf-csl-result" style="margin-top:8px; font-size:13px"></div>
      </div>

      <!-- Semantic Scholar 検索 -->
      <div id="rf-tab-ss" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">
          <a href="https://www.semanticscholar.org" target="_blank" rel="noopener" style="color:var(--primary)">Semantic Scholar</a> の 200M+ 論文 データベース を キーワード 検索。 結果 から 「＋ 追加」 で refs に。 認証 不要。
        </div>
        <label class="field"><span class="lbl">🔍 キーワード</span>
          <input type="text" id="rf-ss-q" placeholder="例: eye tracking mixed reality">
        </label>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label style="flex:1; min-width:100px"><span class="lbl" style="font-size:11px">年 (任意)</span><input type="number" id="rf-ss-year" min="1900" max="2100"></label>
          <label style="flex:2; min-width:120px"><span class="lbl" style="font-size:11px">venue (任意)</span><input type="text" id="rf-ss-venue" placeholder="例: CHI"></label>
          <label style="flex:1; min-width:80px"><span class="lbl" style="font-size:11px">件数</span><input type="number" id="rf-ss-limit" min="5" max="50" value="20"></label>
        </div>
        <div class="row" style="gap:6px">
          <button id="rf-do-ss-search" class="btn primary">🔬 検索</button>
        </div>
        <div id="rf-ss-results" style="margin-top:8px; font-size:13px"></div>
      </div>

      <!-- EndNote XML -->
      <div id="rf-tab-endnote" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">EndNote / Mendeley から export した .xml を upload。 record 要素 を 拾って 一括 追加。</div>
        <label class="field"><span class="lbl">📥 .xml ファイル</span>
          <input type="file" id="rf-en-file" accept=".xml,text/xml,application/xml">
        </label>
        <div class="row" style="gap:6px">
          <button id="rf-do-endnote" class="btn primary">🔽 EndNote XML として import</button>
        </div>
        <div id="rf-en-result" style="margin-top:8px; font-size:13px"></div>
      </div>

      <!-- 手動 -->
      <div id="rf-tab-manual" class="rf-tab-panel" hidden>
        <div class="hint-sm" style="font-size:12px; color:#6b7280; margin-bottom:6px">DOI や arXiv ID が 無い 場合。 下の フォーム に 直接 入力 して 「登録」。</div>
      </div>

      <!-- 取得 結果 warning -->
      <div id="rf-dup-warn" hidden></div>

      <!-- 共通 詳細 フォーム -->
      <div id="rf-form" style="margin-top:10px; padding:10px; background:#f9fafb; border-radius:6px">
        <label class="field"><span class="lbl">🏷 種類</span>
          <select id="rf-f-item-type" style="font-size:13px">
            ${ITEM_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
          </select>
        </label>
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
        <details style="margin-top:6px">
          <summary style="cursor:pointer; font-size:12px; color:#6b7280">⚙ 追加 field (isbn / pages / volume / issue / publisher / editor 等)</summary>
          <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap">
            <label style="flex:1; min-width:100px"><span class="lbl" style="font-size:11px">ISBN</span><input type="text" id="rf-ex-isbn"></label>
            <label style="flex:1; min-width:80px"><span class="lbl" style="font-size:11px">pages</span><input type="text" id="rf-ex-pages" placeholder="123-134"></label>
            <label style="flex:1; min-width:60px"><span class="lbl" style="font-size:11px">vol</span><input type="text" id="rf-ex-volume"></label>
            <label style="flex:1; min-width:60px"><span class="lbl" style="font-size:11px">issue</span><input type="text" id="rf-ex-issue"></label>
          </div>
          <div class="row" style="gap:6px; margin-top:4px; flex-wrap:wrap">
            <label style="flex:1; min-width:120px"><span class="lbl" style="font-size:11px">publisher</span><input type="text" id="rf-ex-publisher"></label>
            <label style="flex:1; min-width:100px"><span class="lbl" style="font-size:11px">editor</span><input type="text" id="rf-ex-editor"></label>
            <label style="flex:1; min-width:100px"><span class="lbl" style="font-size:11px">edition</span><input type="text" id="rf-ex-edition"></label>
          </div>
        </details>
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
    // v929 item_type auto (crossref type から マップ)
    const t = (meta.type || '').toLowerCase();
    let mapped = 'article';
    if (/proceedings/.test(t)) mapped = 'conference';
    else if (/book-chapter|inbook/.test(t)) mapped = 'book_chapter';
    else if (/book/.test(t)) mapped = 'book';
    else if (/thesis|dissertation/.test(t)) mapped = 'thesis';
    else if (/dataset/.test(t)) mapped = 'dataset';
    else if (meta.arxiv_id) mapped = 'preprint';
    document.getElementById('rf-f-item-type').value = mapped;
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
    const extra = {};
    ['isbn','pages','volume','issue','publisher','editor','edition'].forEach(k => {
      const v = document.getElementById('rf-ex-' + k)?.value.trim() || '';
      if (v) extra[k] = v;
    });
    const payload = {
      title,
      item_type: document.getElementById('rf-f-item-type').value,
      doi:      document.getElementById('rf-f-doi').value.trim(),
      arxiv_id: document.getElementById('rf-f-arxiv').value.trim(),
      authors: document.getElementById('rf-f-authors').value.split(',').map(s => s.trim()).filter(Boolean),
      year:    document.getElementById('rf-f-year').value,
      venue:   document.getElementById('rf-f-venue').value.trim(),
      abstract: document.getElementById('rf-f-abstract').value.trim(),
      url:     document.getElementById('rf-f-url').value.trim(),
      tags:    document.getElementById('rf-f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      extra,
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

  // v929 Zotero API 直接連携
  const renderBulkResult = (elId, j) => {
    document.getElementById(elId).innerHTML = `
      <div style="background:#dcfce7; border:1px solid #86efac; border-radius:6px; padding:10px; color:#166534">
        <div class="bold">✅ ${j.added} 件 追加、 ${j.skipped} 件 skip (計 ${j.total} 件)</div>
        <div style="margin-top:6px; max-height:220px; overflow:auto; font-size:12px">
          ${(j.results || []).slice(0, 100).map(r =>
            r.status === 'added'
              ? `<a href="#/refs/${r.id}" style="display:block; color:#166534; text-decoration:underline">✅ ${escapeHtml((r.title || 'no title').slice(0, 100))}</a>`
              : r.status === 'dup'
                ? `<a href="#/refs/${r.existing_id}" style="display:block; color:#78350f">⏭ 既存: ${escapeHtml((r.title || 'no title').slice(0, 100))}</a>`
                : `<div style="color:#7f1d1d">⚠ skip: ${escapeHtml(r.reason || '')}</div>`
          ).join('')}
          ${(j.results || []).length > 100 ? `<div class="muted" style="margin-top:4px">…他 ${(j.results||[]).length - 100} 件</div>` : ''}
        </div>
        <a href="#/refs" class="btn primary" style="font-size:12px; margin-top:6px">📖 一覧 で 確認</a>
      </div>`;
  };
  document.getElementById('rf-do-zotero').addEventListener('click', async () => {
    const api_key = document.getElementById('rf-zt-key').value.trim();
    const user_id = document.getElementById('rf-zt-user').value.trim();
    const group_id = document.getElementById('rf-zt-group').value.trim();
    const limit = Number(document.getElementById('rf-zt-limit').value) || 100;
    const fetch_all = document.getElementById('rf-zt-fetch-all').checked;
    const sync_pdfs = document.getElementById('rf-zt-sync-pdfs').checked;
    if (!api_key) { toast('API Key を'); return; }
    if (!user_id && !group_id) { toast('user_id か group_id を'); return; }
    const btn = document.getElementById('rf-do-zotero');
    btn.disabled = true;
    btn.textContent = fetch_all ? '⏳ Zotero 全件 取得中… (数分 かかります)' : '⏳ Zotero と 通信中…';
    try {
      const j = await post('/api/refs/import_zotero', {
        api_key, user_id, group_id, limit, fetch_all, sync_pdfs,
      });
      renderBulkResult('rf-zt-result', j);
      let extra = '';
      if (j.zotero_total != null) extra += ` (Zotero 側 全 ${j.zotero_total} 件、 ${j.fetched_pages} ページ 取得)`;
      if (sync_pdfs) extra += ` / 📄 PDF 同期: ${j.pdf_synced} 件 追加、 ${j.pdf_skipped} skip、 ${j.pdf_errors} error`;
      toast(`✅ ${j.added} 件 追加${extra}`);
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '🔽 Zotero から import'; }
  });
  const doBulkFile = async (endpoint, inputId, resultElId, btnId, btnTxt) => {
    const f = document.getElementById(inputId).files?.[0];
    if (!f) { toast('ファイル を'); return; }
    const btn = document.getElementById(btnId);
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
      renderBulkResult(resultElId, j);
      toast(`✅ ${j.added} 件 追加`);
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = btnTxt; }
  };
  document.getElementById('rf-do-csljson').addEventListener('click', () =>
    doBulkFile('import_csljson', 'rf-csl-file', 'rf-csl-result', 'rf-do-csljson', '🔽 CSL-JSON として import'));
  document.getElementById('rf-do-endnote').addEventListener('click', () =>
    doBulkFile('import_endnote', 'rf-en-file', 'rf-en-result', 'rf-do-endnote', '🔽 EndNote XML として import'));

  // v931 Semantic Scholar 検索
  document.getElementById('rf-do-ss-search').addEventListener('click', async () => {
    const query = document.getElementById('rf-ss-q').value.trim();
    if (!query) { toast('キーワード を'); return; }
    const year = Number(document.getElementById('rf-ss-year').value) || 0;
    const venue = document.getElementById('rf-ss-venue').value.trim();
    const limit = Number(document.getElementById('rf-ss-limit').value) || 20;
    const btn = document.getElementById('rf-do-ss-search');
    btn.disabled = true; btn.textContent = '⏳ 検索中…';
    try {
      const r = await post('/api/refs/ss_search', { query, year, venue, limit });
      renderSsResults('rf-ss-results', r.items || [], r.total || 0);
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '🔬 検索'; }
  });

  // v927/v931 bookmarklet or Semantic Scholar から の hash param 処理
  applyRefsNewHashParams();
}

// v931 Semantic Scholar 検索結果 の 描画 (共通、 各 item に 「＋追加」 ボタン)。
function renderSsResults(elId, items, total) {
  const el = document.getElementById(elId);
  if (!items.length) { el.innerHTML = '<span class="muted">該当なし</span>'; return; }
  el.innerHTML = `
    <div class="bold" style="font-size:13px; margin-bottom:6px">✅ ${items.length} 件 (SS 全体 ${total} 件)</div>
    ${items.map((m, i) => renderSsCard(m, i)).join('')}
  `;
  el.querySelectorAll('.rf-ss-add').forEach(b => {
    b.addEventListener('click', async () => {
      const idx = Number(b.dataset.i);
      const m = items[idx];
      if (!m) return;
      b.disabled = true; b.textContent = '⏳';
      try {
        const r = await post('/api/refs', {
          title: m.title,
          doi: m.doi || '',
          arxiv_id: m.arxiv_id || '',
          authors: (m.authors || []).map(a => a.name).filter(Boolean),
          year: m.year || '',
          venue: m.venue || '',
          abstract: m.abstract || '',
          url: m.url || '',
          extra: {},
        });
        // ss_id と citation_count を enrich で 埋める
        try { await post('/api/refs/' + r.id + '/ss_enrich', {}); } catch (_) {}
        b.textContent = '✅';
        m.existing_ref_id = r.id;
        toast('追加');
      } catch (e) {
        toast('失敗: ' + e.message);
        b.disabled = false; b.textContent = '＋ 追加';
      }
    });
  });
}

function renderSsCard(m, idx) {
  const authors = (m.authors || []).map(a => a.name).filter(Boolean);
  const authShort = authors.length > 3 ? authors.slice(0, 3).join(', ') + ` et al. (${authors.length})` : authors.join(', ');
  const cc = m.citation_count != null ? `<span title="被引用数" style="color:#7b3fa0">🔗 ${m.citation_count}</span>` : '';
  const rc = m.reference_count != null ? `<span class="hint-sm" title="参考文献数">📚 ${m.reference_count}</span>` : '';
  const oa = m.is_open_access ? '<span style="color:#15803d" title="Open Access">🆓</span>' : '';
  const ext = [
    m.doi ? `<a href="https://doi.org/${escapeHtml(m.doi)}" target="_blank" rel="noopener" style="color:var(--primary); font-size:11px">DOI</a>` : '',
    m.arxiv_id ? `<a href="https://arxiv.org/abs/${escapeHtml(m.arxiv_id)}" target="_blank" rel="noopener" style="color:var(--primary); font-size:11px">arXiv</a>` : '',
    m.url ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" style="color:var(--primary); font-size:11px">🔗</a>` : '',
  ].filter(Boolean).join(' · ');
  const btnHtml = m.existing_ref_id
    ? `<a href="#/refs/${m.existing_ref_id}" class="btn" style="font-size:11px; padding:2px 8px; background:#dcfce7; color:#166534; border-color:#166534">✅ 既に あり → 開く</a>`
    : `<button class="btn primary rf-ss-add" data-i="${idx}" style="font-size:11px; padding:2px 8px">＋ 追加</button>`;
  return `
    <div style="padding:8px 10px; border-bottom:1px solid #f3f4f6">
      <div class="bold" style="font-size:13px; line-height:1.4">${escapeHtml(m.title || '(no title)')}</div>
      <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:2px">
        ${escapeHtml(authShort)}${m.year ? ' · ' + m.year : ''}${m.venue ? ' · ' + escapeHtml(m.venue) : ''}
      </div>
      ${m.abstract ? `<div style="font-size:12px; color:#4b5563; margin-top:4px; max-height:60px; overflow:hidden">${escapeHtml((m.abstract || '').slice(0, 300))}${m.abstract.length > 300 ? '…' : ''}</div>` : ''}
      <div class="row" style="gap:6px; margin-top:4px; align-items:center; flex-wrap:wrap">
        ${cc} ${rc} ${oa} ${ext}
        <span style="margin-left:auto">${btnHtml}</span>
      </div>
    </div>`;
}

// v927/v931 bookmarklet + SS から の 遷移 用 の hash param 処理 (単独 関数、 renderRefsNew から 呼ぶ)。
function applyRefsNewHashParams() {
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

// v929 highlights 表示 + 削除。
async function loadHighlights(refId) {
  const el = document.getElementById('rf-hl-list');
  if (!el) return;
  try {
    const d = await get('/api/refs/' + refId + '/highlights');
    const items = d.items || [];
    const meId = Number(state.me?.id || 0);
    if (!items.length) { el.innerHTML = '<span class="muted">まだ ありません。 「＋ 追加」 で PDF から の 引用 + comment を メモ 可能</span>'; return; }
    el.innerHTML = items.map(h => {
      const bg = HIGHLIGHT_COLORS[h.color] || HIGHLIGHT_COLORS.yellow;
      const col = HIGHLIGHT_TEXT_COLORS[h.color] || HIGHLIGHT_TEXT_COLORS.yellow;
      return `
        <div style="background:${bg}; border-left:4px solid ${col}; padding:8px 10px; margin-bottom:6px; border-radius:0 4px 4px 0">
          <div class="row center" style="gap:6px; margin-bottom:4px">
            ${avatarHtml(h.display_name, h.avatar_url, 'xs')}
            <span class="bold" style="font-size:11px; color:${col}">${escapeHtml(h.display_name)}</span>
            ${h.page ? `<span class="hint-sm" style="color:${col}">p. ${h.page}</span>` : ''}
            <span class="hint-sm" style="margin-left:auto; font-size:10px">${escapeHtml(h.created_at || '')}</span>
            ${h.user_id === meId ? `<button class="btn danger rf-hl-del" data-id="${h.id}" style="font-size:10px; padding:1px 4px">✕</button>` : ''}
          </div>
          ${h.quote_text ? `<div style="font-style:italic; font-size:12px; margin-bottom:4px; padding:4px; background:rgba(255,255,255,0.4); border-radius:3px">"${escapeHtml(h.quote_text)}"</div>` : ''}
          ${h.comment ? `<div style="font-size:13px; color:${col}; line-height:1.5">${mdToHtml(h.comment)}</div>` : ''}
        </div>`;
    }).join('');
    el.querySelectorAll('.rf-hl-del').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('削除?')) return;
        try { await del('/api/refs/' + refId + '/highlights/' + b.dataset.id); toast('削除'); loadHighlights(refId); }
        catch (e) { toast('失敗: ' + e.message); }
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

// v930 参考文献 リスト 生成 ページ
export async function renderRefsBibliography() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/refs" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">📚 参考文献 リスト を 生成</h2>
      <div class="hint-sm" style="font-size:11px; margin-top:4px">複数 の 文献 を 選んで、 まとめ て CSL style で 引用 生成。 論文 の 参考文献 セクション 作成 に。</div>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">📄 style</span>
        <select id="rfb-style" style="font-size:13px">
          <option value="apa">APA 7</option>
          <option value="mla">MLA 9</option>
          <option value="chicago">Chicago</option>
          <option value="ieee">IEEE</option>
          <option value="nature">Nature</option>
          <option value="science">Science</option>
          <option value="acm">ACM SIG</option>
        </select>
      </label>
      <div class="row" style="gap:6px; margin-bottom:8px; flex-wrap:wrap">
        <button class="btn primary rfb-tab" data-tab="collection" style="font-size:13px">📁 コレクション から</button>
        <button class="btn rfb-tab" data-tab="tag" style="font-size:13px">🏷 タグ から</button>
        <button class="btn rfb-tab" data-tab="ids" style="font-size:13px">✍ ID 直接指定</button>
      </div>
      <div id="rfb-panel-collection" class="rfb-panel">
        <label class="field"><span class="lbl">📁 コレクション を 選択</span>
          <select id="rfb-col-select" style="font-size:13px">
            <option value="">読み込み中…</option>
          </select>
        </label>
      </div>
      <div id="rfb-panel-tag" class="rfb-panel" hidden>
        <label class="field"><span class="lbl">🏷 タグ を 入力</span>
          <input type="text" id="rfb-tag-input" placeholder="例: HCI">
        </label>
      </div>
      <div id="rfb-panel-ids" class="rfb-panel" hidden>
        <label class="field"><span class="lbl">🔢 ref ID を カンマ 区切り で 入力</span>
          <textarea id="rfb-ids-input" rows="3" placeholder="例: 12, 45, 67, 89"></textarea>
        </label>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="rfb-recommend" class="btn" style="background:#fef3c7; color:#78350f; border-color:#78350f">🎯 SS で 関連論文 おすすめ</button>
        <button id="rfb-gen" class="btn primary">📚 生成</button>
      </div>
    </div>
    <!-- v931 SS 推薦 結果 -->
    <div id="rfb-rec-result" class="card" hidden>
      <div class="bold" style="font-size:13px; margin-bottom:6px; color:#78350f">🔬 Semantic Scholar が おすすめ する 論文</div>
      <div id="rfb-rec-list"></div>
    </div>
    <div id="rfb-result" class="card" hidden>
      <div class="row center" style="gap:6px; margin-bottom:6px">
        <div class="bold" style="font-size:13px">結果 (<span id="rfb-count">0</span> 件)</div>
        <button id="rfb-copy" class="btn primary" style="font-size:11px; padding:2px 8px; margin-left:auto">📋 全部 コピー</button>
      </div>
      <textarea id="rfb-out" readonly style="width:100%; box-sizing:border-box; min-height:300px; font-family:monospace; font-size:12px"></textarea>
    </div>
  `;
  document.querySelectorAll('.rfb-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.rfb-tab').forEach(x => x.classList.remove('primary'));
      b.classList.add('primary');
      document.querySelectorAll('.rfb-panel').forEach(p => p.hidden = true);
      document.getElementById('rfb-panel-' + b.dataset.tab).hidden = false;
    });
  });
  // コレクション ロード
  try {
    const d = await get('/api/refs/collections');
    const sel = document.getElementById('rfb-col-select');
    sel.innerHTML = (d.items || []).map(c =>
      `<option value="${c.id}">${c.icon || '📁'} ${escapeHtml(c.name)} (${c.ref_count})</option>`
    ).join('') || '<option value="">なし</option>';
  } catch (_) {}
  document.getElementById('rfb-gen').addEventListener('click', async () => {
    const style = document.getElementById('rfb-style').value;
    let payload = { style };
    const activeTab = document.querySelector('.rfb-tab.primary')?.dataset.tab || 'collection';
    if (activeTab === 'collection') {
      payload.collection_id = Number(document.getElementById('rfb-col-select').value);
      if (!payload.collection_id) { toast('コレクション を'); return; }
    } else if (activeTab === 'tag') {
      payload.tag = document.getElementById('rfb-tag-input').value.trim();
      if (!payload.tag) { toast('タグ を'); return; }
    } else {
      const raw = document.getElementById('rfb-ids-input').value;
      payload.ref_ids = raw.split(/[,\s]+/).map(s => Number(s.trim())).filter(Boolean);
      if (!payload.ref_ids.length) { toast('ID を'); return; }
    }
    const btn = document.getElementById('rfb-gen');
    btn.disabled = true; btn.textContent = '⏳ 生成中…';
    try {
      const r = await post('/api/refs/bibliography', payload);
      document.getElementById('rfb-result').hidden = false;
      document.getElementById('rfb-count').textContent = r.count || 0;
      document.getElementById('rfb-out').value = r.bibliography || '';
      toast('✅ 生成 完了 (' + (r.count || 0) + ' 件)');
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '📚 生成'; }
  });
  document.getElementById('rfb-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.getElementById('rfb-out').value); toast('コピー'); }
    catch { toast('失敗'); }
  });
  // v931 SS 推薦
  document.getElementById('rfb-recommend').addEventListener('click', async () => {
    // まず ref_ids を 集める
    const activeTab = document.querySelector('.rfb-tab.primary')?.dataset.tab || 'collection';
    let refIds = [];
    if (activeTab === 'ids') {
      refIds = document.getElementById('rfb-ids-input').value.split(/[,\s]+/).map(s => Number(s.trim())).filter(Boolean);
    } else if (activeTab === 'collection') {
      const cid = Number(document.getElementById('rfb-col-select').value);
      if (!cid) { toast('コレクション を'); return; }
      const cd = await get('/api/refs?collection_id=' + cid + '&limit=100');
      refIds = (cd.items || []).map(x => x.id);
    } else {
      const tag = document.getElementById('rfb-tag-input').value.trim();
      if (!tag) { toast('タグ を'); return; }
      const td = await get('/api/refs?tag=' + encodeURIComponent(tag) + '&limit=100');
      refIds = (td.items || []).map(x => x.id);
    }
    if (!refIds.length) { toast('種 に する refs が ない'); return; }
    const btn = document.getElementById('rfb-recommend');
    btn.disabled = true; btn.textContent = '⏳ SS に 問い 合わせ中…';
    try {
      const r = await post('/api/refs/ss_recommend', { ref_ids: refIds, limit: 30 });
      const items = r.items || [];
      const box = document.getElementById('rfb-rec-result');
      const list = document.getElementById('rfb-rec-list');
      box.hidden = false;
      if (!items.length) { list.innerHTML = '<span class="muted">おすすめ 0 件</span>'; }
      else {
        list.innerHTML = items.map((m, i) => renderSsCard(m, i)).join('');
        list.querySelectorAll('.rf-ss-add').forEach(b => {
          b.addEventListener('click', async () => {
            const idx = Number(b.dataset.i);
            const m = items[idx];
            if (!m) return;
            b.disabled = true; b.textContent = '⏳';
            try {
              const rr = await post('/api/refs', {
                title: m.title, doi: m.doi || '', arxiv_id: m.arxiv_id || '',
                authors: (m.authors || []).map(a => a.name).filter(Boolean),
                year: m.year || '', venue: m.venue || '', abstract: m.abstract || '',
                url: m.url || '', extra: {},
              });
              try { await post('/api/refs/' + rr.id + '/ss_enrich', {}); } catch (_) {}
              b.textContent = '✅ 追加';
              m.existing_ref_id = rr.id;
            } catch (e) {
              toast('失敗: ' + e.message);
              b.disabled = false; b.textContent = '＋ 追加';
            }
          });
        });
      }
      toast(`🎯 ${items.length} 件 おすすめ`);
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '🎯 SS で 関連論文 おすすめ'; }
  });
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
    await initLabUsersCache();     // v1006 著者アバター 用
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
  // v1006 タグ を クリック 可能に (中村さん要望「論文ページ に ある キーワード も クリック 可能に」)。
  //   #/refs?tag=<t> に 遷移 → renderRefs 側 の URL パラメータ 読み取りで tag フィルタが 効く。
  const tagsHtml = (d.tags || []).map(t =>
    `<button data-rf-tag="${escapeHtml(t)}" class="tag" style="background:#f3e8ff; color:#7b3fa0; font-size:12px; padding:2px 8px; border-radius:10px; border:1px solid #d8b4fe; cursor:pointer; font-family:inherit">${escapeHtml(t)}</button>`
  ).join(' ');
  const pdfBlock = d.pdf_path
    ? `<a href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" class="btn" style="font-size:12px; padding:3px 10px">📄 PDF を 開く</a>`
    : `<button id="rf-pdf-upload" class="btn" style="font-size:12px; padding:3px 10px">📎 PDF を 添付</button>
       <input type="file" id="rf-pdf-file" accept="application/pdf,.pdf" hidden>`;
  const bibBtn = `<button id="rf-bibtex-btn" class="btn" style="font-size:12px; padding:3px 10px">📋 BibTeX コピー</button>`;
  // v929: 引用 生成 dropdown
  const citeBtn = `
    <div style="display:inline-flex; gap:2px; align-items:stretch">
      <button id="rf-cite-btn" class="btn" style="font-size:12px; padding:3px 8px; border-top-right-radius:0; border-bottom-right-radius:0">📄 引用 コピー</button>
      <select id="rf-cite-style" style="font-size:11px; padding:2px 4px; border-left:0; border-top-left-radius:0; border-bottom-left-radius:0">
        <option value="apa">APA 7</option>
        <option value="mla">MLA 9</option>
        <option value="chicago">Chicago</option>
        <option value="ieee">IEEE</option>
        <option value="nature">Nature</option>
        <option value="science">Science</option>
        <option value="acm">ACM SIG</option>
      </select>
    </div>`;

  document.getElementById('rf-d-head').innerHTML = `
    <h2 style="margin:6px 0 0; font-size:18px; line-height:1.4">${escapeHtml(d.title)}</h2>
    <div class="meta" style="margin-top:4px">
      ${d.year ? '<b>' + d.year + '</b>' : ''}${d.year && d.venue ? ' · ' : ''}${d.venue ? escapeHtml(d.venue) : ''}
    </div>
    ${idLinks.length ? '<div class="meta" style="margin-top:6px; display:flex; gap:12px; flex-wrap:wrap">' + idLinks.join(' ') + '</div>' : ''}
    <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
      ${pdfBlock}
      ${bibBtn}
      ${citeBtn}
      ${canEdit ? '<button id="rf-del" class="btn danger" style="font-size:12px; padding:3px 10px">🗑 削除</button>' : ''}
    </div>
    <!-- v929 item_type + extra 表示 -->
    <div class="hint-sm" style="font-size:11px; margin-top:4px">
      ${escapeHtml((ITEM_TYPES.find(t => t.id === d.item_type) || {label: '📄 論文'}).label)}
      ${(d.extra && Object.keys(d.extra).length) ? ' · ' + Object.entries(d.extra).map(([k,v]) => `${k}: ${escapeHtml(String(v))}`).join(' · ') : ''}
    </div>
    <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">${tagsHtml}</div>
    <div class="meta" style="margin-top:6px; font-size:11px">
      登録: ${avatarHtml(d.added_by_name, d.added_by_avatar, 'xs')} ${escapeHtml(d.added_by_name || '?')} · ${escapeHtml(d.created_at || '')}
    </div>
    ${rfRenderAuthorCards(d.authors)}
  `;
  rfBindClickables();

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
      <label class="field">
        <div class="row center" style="gap:6px">
          <span class="lbl" style="font-size:12px; flex:1">📝 自分 の note (Markdown 対応、 共有 されます)</span>
          <button id="rf-note-preview-btn" class="btn" style="font-size:10px; padding:1px 6px" title="プレビュー 切替">👁</button>
        </div>
        <textarea id="rf-my-note" rows="5" placeholder="Markdown OK: # 見出し、 **太字**、 *italic*、 - 箇条書き、 &gt; 引用、 [link](url)、 \`code\`" style="width:100%; box-sizing:border-box; font-size:13px; font-family:monospace">${escapeHtml(myNote)}</textarea>
        <div id="rf-my-note-preview" style="display:none; border:1px solid #e5e7eb; border-radius:6px; padding:8px; font-size:13px; line-height:1.6; background:#fff"></div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="rf-save-note" class="btn primary" style="font-size:12px">📝 note を 保存</button>
      </div>
    </div>`;

  // 他の 人 の note (共有、 v929 Markdown レンダリング)
  const othersHtml = (d.others_notes || []).map(n => `
    <div style="padding:8px 10px; border-bottom:1px solid #f3f4f6">
      <div class="row center" style="gap:6px">
        ${avatarHtml(n.display_name, n.avatar_url, 'xs')}
        <span class="bold" style="font-size:12px">${escapeHtml(n.display_name)}</span>
        <span style="background:${STATUS_COLOR[n.status]||'#9ca3af'}; color:#fff; font-size:10px; padding:1px 6px; border-radius:8px">${STATUS_LABEL[n.status]||n.status}</span>
        <span class="hint-sm" style="margin-left:auto; font-size:10px">${escapeHtml(n.updated_at || '')}</span>
      </div>
      <div style="font-size:13px; line-height:1.6; margin-top:4px">${mdToHtml(n.note)}</div>
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

  // v931 Semantic Scholar 連携 カード (この 論文 の 参考文献 / 被引用 / enrichment)
  const canSs = !!(d.doi || d.arxiv_id || d.semantic_scholar_id);
  const ccBadge = d.citation_count != null ? `<span style="color:#7b3fa0; font-size:12px">🔗 被引用 ${d.citation_count}</span>` : '';
  const rcBadge = d.reference_count != null ? `<span class="hint-sm" style="font-size:11px">📚 参考文献 ${d.reference_count}</span>` : '';
  const ssCard = canSs ? `
    <div class="card" style="background:linear-gradient(135deg, #fef3c7, #fde68a); border:1px solid #f59e0b">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px; color:#78350f">🔬 Semantic Scholar</div>
        ${ccBadge} ${rcBadge}
      </div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="rf-ss-refs"     class="btn" style="font-size:12px; padding:3px 10px">📚 参考文献 を 見る</button>
        <button id="rf-ss-cites"    class="btn" style="font-size:12px; padding:3px 10px">🔗 被引用 論文 を 見る</button>
        <button id="rf-ss-enrich"   class="btn" style="font-size:12px; padding:3px 10px">🔄 被引用数 を 更新</button>
      </div>
      <div id="rf-ss-panel" style="margin-top:8px"></div>
    </div>` : `
    <div class="card" style="background:#f9fafb; border:1px dashed #d1d5db">
      <div class="hint-sm" style="font-size:12px">🔬 Semantic Scholar 連携 は DOI か arXiv ID が 登録 されて いる 論文 のみ 有効。</div>
    </div>`;

  // v929 highlights (PDF から の 引用 + comment、 簡易 実装)
  const hlCard = `
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px; flex-wrap:wrap">
        <div class="bold" style="font-size:13px">✨ ハイライト</div>
        <button id="rf-hl-add" class="btn primary" style="font-size:11px; padding:2px 8px; margin-left:auto">＋ 追加</button>
      </div>
      <div id="rf-hl-list" class="hint-sm" style="font-size:12px">読み込み中…</div>
    </div>`;

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

  document.getElementById('rf-d-body').innerHTML = trashBanner + abstractBlock + aiCard + ssCard + colsCard + relatedCard + attCard + hlCard + myBlock + othersBlock;
  loadAttachments(id);
  loadRelated(id);
  loadHighlights(id);
  // v929 note の Markdown プレビュー 切替
  document.getElementById('rf-note-preview-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('rf-my-note');
    const pv = document.getElementById('rf-my-note-preview');
    if (pv.style.display === 'none') {
      pv.innerHTML = mdToHtml(ta.value);
      pv.style.display = ''; ta.style.display = 'none';
    } else {
      pv.style.display = 'none'; ta.style.display = '';
    }
  });
  // v929 CSL 引用 コピー
  document.getElementById('rf-cite-btn')?.addEventListener('click', async () => {
    const style = document.getElementById('rf-cite-style').value;
    try {
      const r = await get('/api/refs/' + id + '/citation?style=' + style);
      await navigator.clipboard.writeText(r.citation || '');
      toast(`${style.toUpperCase()} 引用 を コピー`);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  // v929 highlights add
  document.getElementById('rf-hl-add')?.addEventListener('click', async () => {
    const page = prompt('PDF の ページ 番号 (任意)') || '';
    const quote = prompt('引用 テキスト (PDF から コピー して 貼付、 任意)') || '';
    const comment = prompt('コメント / なぜ 印象的 か (任意)') || '';
    if (!quote && !comment) { toast('quote か comment を'); return; }
    try {
      await post('/api/refs/' + id + '/highlights', {
        page: page || undefined, quote_text: quote, comment,
      });
      toast('追加');
      loadHighlights(id);
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // v931 Semantic Scholar
  const showSsPanel = async (endpoint, label) => {
    const panel = document.getElementById('rf-ss-panel');
    panel.innerHTML = `<span class="muted">${label} を 取得中…</span>`;
    try {
      const r = await get('/api/refs/' + id + '/' + endpoint);
      const items = r.items || [];
      if (!items.length) { panel.innerHTML = `<span class="muted">${label}: 0 件</span>`; return; }
      panel.innerHTML = `<div class="bold" style="font-size:12px; margin-bottom:6px; color:#78350f">${label} (${items.length} 件)</div>`;
      panel.innerHTML += items.slice(0, 30).map((m, i) => renderSsCard(m, i)).join('');
      if (items.length > 30) panel.innerHTML += `<div class="muted" style="font-size:11px; margin-top:4px">…他 ${items.length - 30} 件 は 省略</div>`;
      // 「＋追加」 ボタン 束ね
      panel.querySelectorAll('.rf-ss-add').forEach(b => {
        b.addEventListener('click', async () => {
          const idx = Number(b.dataset.i);
          const m = items[idx];
          if (!m) return;
          b.disabled = true; b.textContent = '⏳';
          try {
            const rr = await post('/api/refs', {
              title: m.title, doi: m.doi || '', arxiv_id: m.arxiv_id || '',
              authors: (m.authors || []).map(a => a.name).filter(Boolean),
              year: m.year || '', venue: m.venue || '', abstract: m.abstract || '',
              url: m.url || '', extra: {},
            });
            try { await post('/api/refs/' + rr.id + '/ss_enrich', {}); } catch (_) {}
            // また、 現 ref と の 関連 を 自動 で 追加 (bidirectional)
            try { await post('/api/refs/' + id + '/relations', { ref_id: rr.id, kind: 'related' }); } catch (_) {}
            b.textContent = '✅ 追加 + 関連';
            m.existing_ref_id = rr.id;
            loadRelated(id);
          } catch (e) {
            toast('失敗: ' + e.message);
            b.disabled = false; b.textContent = '＋ 追加';
          }
        });
      });
    } catch (e) {
      panel.innerHTML = `<span class="muted" style="color:#c62828">失敗: ${escapeHtml(e.message)}</span>`;
    }
  };
  document.getElementById('rf-ss-refs')?.addEventListener('click', () => showSsPanel('ss_references', '📚 参考文献'));
  document.getElementById('rf-ss-cites')?.addEventListener('click', () => showSsPanel('ss_citations', '🔗 被引用 論文'));
  document.getElementById('rf-ss-enrich')?.addEventListener('click', async () => {
    try {
      const r = await post('/api/refs/' + id + '/ss_enrich', {});
      toast(`✅ 被引用 ${r.citation_count || 0} / 参考文献 ${r.reference_count || 0}`);
      renderRefsDetail({ params: { id } });
    } catch (e) { toast('失敗: ' + e.message); }
  });
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
