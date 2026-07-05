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
      </div>
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
        <span id="rf-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
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
  await loadTagsChips();
  await loadList();
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
    </div>
    <div class="card">
      <div class="row" style="gap:6px; margin-bottom:8px">
        <button class="btn primary rf-tab" data-tab="doi"   style="font-size:13px">DOI</button>
        <button class="btn rf-tab"         data-tab="arxiv" style="font-size:13px">arXiv</button>
        <button class="btn rf-tab"         data-tab="url"   style="font-size:13px">URL</button>
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

  // 相互 リンク
  const linksBlock = (d.links || []).length
    ? `<div class="card"><div class="bold" style="font-size:13px; margin-bottom:6px">🔗 同 PDF の 関連 (自分 の 過去 作業)</div>
        <div class="row" style="gap:6px; flex-wrap:wrap">${(d.links).map(l => `<a class="btn" href="${escapeHtml(l.url)}" style="font-size:12px; padding:3px 10px">${escapeHtml(l.label)}</a>`).join('')}</div></div>`
    : '';

  document.getElementById('rf-d-body').innerHTML = abstractBlock + myBlock + othersBlock + linksBlock;

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
}
