// /#/paper-translate-full — 論文全訳 (v788 #386 #387 #388)。
//   章ごとに完全翻訳 + サンプル文の back-translation 整合確認 + 用語統一ポリッシュ。
//   direction:
//     en2ja: 英語論文 → 日本語 (標準料金)
//     ja2en: 日本語論文 → 英語 (5x、 em-dash 等 GPT-isms 除去まで含む)

import { get, post, del, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons, viewControlsHtml, bindViewControls, setFormOpen } from '../ui_ai_stars.js';
import { shareDialog } from '../share_to_sns.js';

let settings = null;
let viewState = { mineSort: 'new', mineOnly_mine: false, pubSort: 'new', mineOnly_pub: false, lastQuery: '' };

export async function renderPaperTranslateFull() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文全訳</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        要約でなく全文翻訳。章ごとに訳 → back-translation で整合確認 → 用語統一と全体ポリッシュ。
        英→日と日→英が選べます (日→英は em-dash 等 GPT-isms 除去も込み)。
      </p>
    </div>
    <details class="card" id="pft-form">
      <summary style="cursor:pointer; font-weight:600; padding:4px 0; user-select:none">➕ 新しい全訳を依頼</summary>
      <label class="field" style="margin-top:8px">
        <span class="lbl">🌐 翻訳方向</span>
        <select id="pft-direction">
          <option value="en2ja" selected>英語 → 日本語 (E→J)</option>
          <option value="ja2en">日本語 → 英語 (J→E、 5x 料金)</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">🤖 モデル</span>
        <select id="pft-model"></select>
        <div class="hint-sm" id="pft-cost-info" style="font-size:12px; margin-top:4px; color:#6b21a8"></div>
      </label>
      <label class="field">
        <span class="lbl">論文 PDF (最大 30 MB)</span>
        <input type="file" id="pft-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pft-file-status" style="margin-top:4px"></div>
      </label>
      <!-- v916 共有=半額割引 を もっと目立たせる。 チェックボックスに 「ON で 半額!」 を 直書き。 -->
      <div style="background:linear-gradient(135deg, #dcfce7, #bbf7d0); border:2px solid #22c55e; border-radius:10px; padding:14px 16px; margin:8px 0; box-shadow:0 2px 6px rgba(34,197,94,0.15)">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer">
          <input type="checkbox" id="pft-auto-share" style="width:20px; height:20px; accent-color:#16a34a; cursor:pointer">
          <span style="font-size:16px; font-weight:700; color:#14532d">🎁 チェック ON で 半額 になります!</span>
        </label>
        <div style="font-size:12px; color:#166534; margin-top:8px; line-height:1.6">
          完了と同時に 公開 ON にする (= みんなの検索に 載せる)。 研究室 全体で 共有すると 誰かの 参考になる 資産 なので、 共有 なら 半額割引。<br>
          あとから 公開 ON にすると 半額分 返金 / 公開 OFF に戻すと 半額割引 分 追加課金 されます。
        </div>
      </div>
      <!-- v798 同時に要約も走らせるオプション -->
      <fieldset class="field" style="border:1px dashed var(--line); border-radius:6px; padding:8px; margin-top:4px">
        <legend style="font-size:12px; color:#6b7280">📑📑 同時に要約も走らせる (任意)</legend>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px">
          <input type="checkbox" id="pft-also-summary">
          要約 (落合メソッド + 図表抽出) も一緒に開始
        </label>
        <div id="pft-also-summary-opts" style="margin-top:6px; display:none">
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">要約モデル</span>
            <select id="pft-sum-model" style="font-size:12px"></select>
            <div class="hint-sm" id="pft-sum-cost-info" style="font-size:11px; margin-top:2px"></div>
          </label>
        </div>
      </fieldset>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pft-go" class="primary" disabled>📑 全訳開始</button>
      </div>
    </details>
    <div id="pft-result"></div>
    <!-- v807 自分の履歴とみんなの公開全訳をタブで切替 (要約ページと同形式) -->
    <div class="card" style="margin-top:8px">
      <div class="row" style="gap:6px; margin-bottom:8px; align-items:center">
        <button id="pft-tab-mine"   class="btn primary" data-tab="mine"   style="font-size:13px">📜 自分の履歴</button>
        <button id="pft-tab-shared" class="btn"         data-tab="shared" style="font-size:13px">🌐 みんなの公開全訳</button>
        <span style="flex:1"></span>
        <input type="search" id="pft-search" placeholder="🔍 検索 (公開のみ、タイトル / 著者 / 本文)" maxlength="100" style="font-size:13px; padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; min-width:180px" hidden>
      </div>
      <div id="pft-controls"></div>
      <div id="pft-list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadSettings();
  bindEvents();
  // v807 タブ切替
  let curTab = 'mine';
  let searchTimer = null;
  const tabMine   = document.getElementById('pft-tab-mine');
  const tabShared = document.getElementById('pft-tab-shared');
  const searchEl  = document.getElementById('pft-search');
  const switchTab = (t) => {
    curTab = t;
    tabMine.classList.toggle('primary',   t === 'mine');
    tabShared.classList.toggle('primary', t === 'shared');
    searchEl.hidden = (t !== 'shared');
    if (t === 'mine') loadHistory();
    else              loadSharedList(searchEl.value || '');
  };
  tabMine.addEventListener('click',   () => switchTab('mine'));
  tabShared.addEventListener('click', () => switchTab('shared'));
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSharedList(searchEl.value || ''), 300);
  });
  // v955 hash に ?q=<keyword> が 付いていたら shared タブ に 切り替えて 検索実行
  const hashQ = (location.hash.match(/\?q=([^&]+)/) || [])[1];
  if (hashQ) {
    const kw = decodeURIComponent(hashQ);
    searchEl.value = kw;
    switchTab('shared');
    return;
  }
  await loadHistory();   // 初期は自分の履歴
}

function bindEvents() {
  const fileInput = document.getElementById('pft-file');
  const status = document.getElementById('pft-file-status');
  const btn = document.getElementById('pft-go');
  const dir = document.getElementById('pft-direction');
  const sel = document.getElementById('pft-model');
  const info = document.getElementById('pft-cost-info');
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) { status.textContent = ''; btn.disabled = true; return; }
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      status.innerHTML = '<span style="color:#dc2626">PDF のみ</span>'; btn.disabled = true; return;
    }
    if (f.size > 30 * 1024 * 1024) {
      status.innerHTML = '<span style="color:#dc2626">30 MB を超え</span>'; btn.disabled = true; return;
    }
    status.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size/1048576).toFixed(1)} MB)</span>`;
    btn.disabled = false;
  });
  function rebuildModelOptions() {
    if (!settings) return;
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const def = settings.default_model || Object.keys(models)[0];
    // v916 選択肢 に 「共有なら Xpt」 を 明記
    sel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const m = sel.value;
    const base = models[m] || 0;
    // v914 共有 で 半額割引
    const shared = !!document.getElementById('pft-auto-share')?.checked;
    const pt = shared ? Math.floor(base / 2) : base;
    if (info) {
      info.innerHTML = `選択中: ${escapeHtml(m)} ・ ${pt}pt (${dir.value === 'ja2en' ? '日→英' : '英→日'})` +
        (shared ? ` <span style="color:#15803d">(公開 ON、 半額割引 = 基本 ${base}pt の 半額)</span>`
                : ` <span style="color:#6b7280">(非公開、 基本額)</span>`);
    }
    btn.textContent = `📑 全訳開始 (${pt}pt)`;
  }
  dir?.addEventListener('change', rebuildModelOptions);
  sel?.addEventListener('change', refreshCost);
  document.getElementById('pft-auto-share')?.addEventListener('change', refreshCost);
  btn?.addEventListener('click', go);
  if (settings) rebuildModelOptions();
  // v798 同時に要約も走らせるオプション
  setupAlsoSummary();
}

// v798 同時要約オプションのセットアップ
let summarySettingsCache = null;
async function setupAlsoSummary() {
  const toggle = document.getElementById('pft-also-summary');
  const opts   = document.getElementById('pft-also-summary-opts');
  const modSel = document.getElementById('pft-sum-model');
  const info   = document.getElementById('pft-sum-cost-info');
  if (!toggle) return;
  toggle.addEventListener('change', async () => {
    opts.style.display = toggle.checked ? '' : 'none';
    if (toggle.checked && !summarySettingsCache) {
      try { summarySettingsCache = await get('/api/ai/paper_translate'); }
      catch (e) { toast('要約設定読込失敗: ' + e.message); return; }
      rebuildSummaryModels();
    }
  });
  function rebuildSummaryModels() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const def = summarySettingsCache.default_model || Object.keys(models)[0];
    // v916 選択肢 に 「共有なら Xpt」 を 明記
    modSel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const m = modSel.value;
    const base = models[m] || 0;
    // v914 同じ auto_share チェックボックスを 全訳 と 要約 の 両方に適用、 共有=半額
    const shared = !!document.getElementById('pft-auto-share')?.checked;
    const pt = shared ? Math.floor(base / 2) : base;
    info.innerHTML = `要約 ${pt}pt` +
      (shared ? ` <span style="color:#15803d">(公開 ON、 半額割引 = 基本 ${base}pt の 半額)</span>`
              : ` <span style="color:#6b7280">(非公開、 基本額)</span>`);
  }
  modSel.addEventListener('change', refreshCost);
  document.getElementById('pft-auto-share')?.addEventListener('change', refreshCost);
}

async function loadSettings() {
  try { settings = await get('/api/ai/paper_full_translate'); }
  catch (e) { toast('設定読込失敗: ' + e.message); return; }
}

// v807 自分の履歴 (タイトル / 公開中バッジ / 削除ボタン)
async function loadHistory() {
  const root = document.getElementById('pft-list');
  try {
    const url = '/api/ai/paper_full_translate' + (viewState.mineSort === 'stars' ? '?sort=stars' : '');
    const d = await get(url);
    let items = d.items || [];
    if (viewState.mineOnly_mine) items = items.filter(r => r.my_starred);

    setFormOpen('pft-form', (d.items || []).length === 0);

    const ctlRoot = document.getElementById('pft-controls');
    if (ctlRoot) {
      ctlRoot.innerHTML = viewControlsHtml({ id: 'pft-mine-vc', sort: viewState.mineSort, mineOnly: viewState.mineOnly_mine, total: items.length });
      bindViewControls(ctlRoot, ({ mineOnly, sort }) => { viewState.mineOnly_mine = mineOnly; viewState.mineSort = sort; loadHistory(); });
    }

    if (!items.length) {
      root.innerHTML = `<div class="empty">${viewState.mineOnly_mine ? 'スター付きの全訳はまだありません' : 'まだ全訳履歴がありません'}</div>`;
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">${items.map(it => {
      const title = it.title_translated || it.title_original || it.pdf_name || '(無題)';
      const showOrig = it.title_original && it.title_original !== title;
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      const icon = it.status === 'done' ? '📑' : it.status === 'error' ? '❌' : '⏳';
      const dirMark = it.direction === 'ja2en' ? '🇯🇵→🇬🇧' : '🇬🇧→🇯🇵';
      return `
        <a class="ai-tile" href="#/paper-translate-full/r/${escapeHtml(it.share_token)}">
          <div class="ai-tile-head">
            <span>${icon}</span>
            ${it.is_shared ? '<span style="color:#15803d">🌐</span>' : ''}
            <span style="margin-left:auto; font-size:11px">${dirMark} ・ ${escapeHtml(it.model || '')}</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(title)}</div>
          ${showOrig ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.title_original)}</div>` : ''}
          ${meta ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>` : ''}
          ${it.snippet ? `<div class="ai-tile-snippet">${escapeHtml(it.snippet)}</div>` : ''}
          <div class="ai-tile-foot">
            <span>${escapeHtml(it.created_at || '')}</span>
            <span style="margin-left:auto">
              ${starButtonHtml({ kind: 'paper_full_translation', refId: it.id, count: it.star_count, mine: it.my_starred, users: it.star_users })}
              ${bookmarkButtonHtml({ kind: 'paper_full_translation', refId: it.id, count: it.bookmark_count, mine: it.my_bookmarked })}
            </span>
            <button class="ghost" data-pft-del="${it.id}" title="削除" style="font-size:12px; padding:2px 6px; margin-left:2px"
              onclick="event.preventDefault(); event.stopPropagation();">🗑</button>
          </div>
        </a>`;
    }).join('')}</div>`;
    bindStarButtons(root);
    bindBookmarkButtons(root);
    root.querySelectorAll('[data-pft-del]').forEach(b => {
      b.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (!confirm('この全訳を履歴から削除しますか? (PDF も一緒に削除)')) return;
        try { await del('/api/ai/paper_full_translate/' + b.dataset.pftDel); toast('削除しました'); await loadHistory(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v807 みんなの公開全訳 (q で検索)
async function loadSharedList(q) {
  const root = document.getElementById('pft-list');
  if (!root) return;
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  viewState.lastQuery = q;
  try {
    const params = [];
    if (q) params.push('q=' + encodeURIComponent(q));
    if (viewState.pubSort === 'stars') params.push('sort=stars');
    const url = '/api/ai/paper_full_translate/shared' + (params.length ? '?' + params.join('&') : '');
    const d = await get(url);
    let items = d.items || [];
    if (viewState.mineOnly_pub) items = items.filter(r => r.my_starred);

    const ctlRoot = document.getElementById('pft-controls');
    if (ctlRoot) {
      ctlRoot.innerHTML = viewControlsHtml({ id: 'pft-pub-vc', sort: viewState.pubSort, mineOnly: viewState.mineOnly_pub, total: items.length });
      bindViewControls(ctlRoot, ({ mineOnly, sort }) => { viewState.mineOnly_pub = mineOnly; viewState.pubSort = sort; loadSharedList(viewState.lastQuery); });
    }

    if (!items.length) {
      root.innerHTML = viewState.mineOnly_pub
        ? '<div class="empty">スター付きの公開全訳はありません</div>'
        : (q ? `<div class="empty">「${escapeHtml(q)}」に該当する公開全訳がありません</div>`
             : '<div class="empty">まだ公開されている全訳はありません</div>');
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">${items.map(it => {
      const title = it.title_translated || it.title_original || it.pdf_name;
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      const dirMark = it.direction === 'ja2en' ? '🇯🇵→🇬🇧' : '🇬🇧→🇯🇵';
      return `
        <a class="ai-tile" href="#/paper-translate-full/r/${escapeHtml(it.share_token)}">
          <div class="ai-tile-head">
            ${avatarHtml(it.author_name, it.author_avatar, 'xs')}
            <span style="font-size:11px">${escapeHtml(it.author_name || '')}</span>
            <span style="margin-left:auto; font-size:11px">${dirMark}</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(title)}</div>
          ${meta ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>` : ''}
          <div class="ai-tile-foot">
            <span>${escapeHtml(it.shared_at || it.created_at || '')}</span>
            <span style="margin-left:auto">
              ${starButtonHtml({ kind: 'paper_full_translation', refId: it.id, count: it.star_count, mine: it.my_starred, users: it.star_users })}
              ${bookmarkButtonHtml({ kind: 'paper_full_translation', refId: it.id, count: it.bookmark_count, mine: it.my_bookmarked })}
            </span>
          </div>
        </a>`;
    }).join('')}</div>`;
    bindStarButtons(root);
    bindBookmarkButtons(root);
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function go() {
  const f = document.getElementById('pft-file').files?.[0];
  if (!f) { toast('PDF を選んで'); return; }
  const direction = document.getElementById('pft-direction').value;
  const model = document.getElementById('pft-model').value;
  const btn = document.getElementById('pft-go');
  btn.disabled = true; btn.textContent = '⏳ アップロード中…';
  const root = document.getElementById('pft-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ PDF を OpenAI に送信中…</div></div>';
  // v796 #397 await 中に別ページに移ったら引き戻さない
  const startedHash = location.hash;
  // v798 同時要約オプション
  const alsoSum = document.getElementById('pft-also-summary')?.checked;
  const sumModel = document.getElementById('pft-sum-model')?.value;
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('direction', direction);
    fd.append('model', model);
    // v804 完了と同時に公開 ON
    if (document.getElementById('pft-auto-share')?.checked) fd.append('auto_share', '1');
    const resp = await fetch('/api/ai/paper_full_translate', {
      method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    if (j.deduped) toast('🔁 同じ PDF + 方向 + モデルの全訳が既にあったので流用 (課金なし)');

    // v798 同時に要約も開始するなら 2 本目を投げる
    let sumToken = null;
    if (alsoSum && sumModel) {
      try {
        const fd2 = new FormData();
        fd2.append('file', f);
        fd2.append('model', sumModel);
        // v913 同じ 「公開 ON」 判定を 要約側にも 引き継ぐ
        if (document.getElementById('pft-auto-share')?.checked) fd2.append('auto_share', '1');
        const r2 = await fetch('/api/ai/paper_translate', {
          method: 'POST', body: fd2, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
        });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(j2?.error?.message || j2?.error || ('HTTP ' + r2.status));
        sumToken = j2.share_token;
        if (j2.deduped) toast('🔁 要約も既存 row を流用 (課金なし)');
        else             toast('要約も開始 (' + (j2.model || sumModel) + ')');
      } catch (e2) {
        toast('要約開始失敗: ' + e2.message + ' (全訳は走ってます)');
      }
    }

    if (location.hash === startedHash || location.hash.startsWith('#/paper-translate-full')) {
      location.hash = '#/paper-translate-full/r/' + j.share_token;
      if (sumToken) toast('要約は /#/paper-summary/r/' + sumToken + ' で進捗確認');
    } else {
      toast('裏で全訳中。通知が届いたら結果ページを開いてください');
    }
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
    btn.disabled = false; btn.textContent = '📑 全訳開始';
  }
}

let pollTimer = null;
export async function renderPaperTranslateFullShared({ params }) {
  const token = params.token;
  const app = document.getElementById('app');
  app.innerHTML = '<div class="card"><div class="muted">読み込み中…</div></div>';
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  await refresh(token);
  const stopOnLeave = () => {
    if (!location.hash.includes('/paper-translate-full/r/' + token)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      window.removeEventListener('hashchange', stopOnLeave);
    }
  };
  window.addEventListener('hashchange', stopOnLeave);
}

async function refresh(token) {
  const app = document.getElementById('app');
  // v798 別ページに移っているなら触らず timer 自殺
  if (!location.hash.includes('/paper-translate-full/r/' + token)) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    return;
  }
  try {
    const d = await get('/api/ai/paper_full_translate/r/' + encodeURIComponent(token));
    // fetch 中に移動したかもう一度確認
    if (!location.hash.includes('/paper-translate-full/r/' + token)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      return;
    }
    const myUid = Number(state.me?.id || 0);
    const isOwner = myUid > 0 && Number(d.author_id) === myUid;
    const isShared = !!d.is_shared;
    // v807 要約ページと同じ「ボタン形式」公開切替
    const shareButton = (isOwner && d.status === 'done') ? `
      <button class="btn ${isShared ? 'primary' : ''}" id="pft-share-toggle" data-on="${isShared ? 1 : 0}" style="font-size:12px; padding:3px 10px; margin-left:6px">
        ${isShared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)'}
      </button>` : '';
    const sharedTag = (isShared && !isOwner) ? '<span class="tag ok" style="font-size:11px; margin-left:6px">🌐 公開全訳</span>' : '';
    const header = `
      <div class="card">
        <div class="row no-print" style="gap:6px; align-items:center">
          <a href="#/paper-translate-full" class="hint" style="flex:1">← 論文全訳</a>
          <button id="pft-pdf" class="btn" style="font-size:12px; padding:3px 10px" title="ブラウザ の 印刷 → 「PDF として 保存」">📥 PDF に する</button>
          <button id="pft-share-dialog" class="btn primary" style="font-size:12px; padding:3px 10px">📤 共有</button>
        </div>
        <h2 style="margin:6px 0; font-size:17px">📑 ${escapeHtml(d.result?.title_translated || d.result?.title_original || d.pdf_name)}
          ${d.status === 'pending' || d.status === 'processing' ? '<span class="tag warn">処理中</span>' : ''}
          ${d.status === 'error' ? '<span class="tag" style="background:#fecaca; color:#b91c1c">エラー</span>' : ''}
          ${sharedTag}
        </h2>
        ${d.result?.title_original && d.result?.title_translated ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(d.result.title_original)}</div>` : ''}
        ${d.result?.authors ? `<div class="meta" style="font-size:13px; margin-top:2px">👥 ${escapeHtml(d.result.authors)}</div>` : ''}
        ${d.result?.venue   ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(d.result.venue)}</div>` : ''}
        <div class="meta" style="font-size:11px; margin-top:6px">
          ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼・
          ${escapeHtml(d.direction)} ・ ${escapeHtml(d.model || '')} ・ ${d.cost_points}pt ・ ${escapeHtml(d.created_at || '')}
        </div>
        <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
          ${d.pdf_path ? `<a class="btn" href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📥 元の PDF を開く</a>` : ''}
          ${shareButton}
          <a class="btn" href="#/paper-translate-full" style="font-size:12px; padding:3px 10px">← 一覧へ</a>
        </div>
        ${renderFullCrossRefsAndCreate(d)}
      </div>
      <div id="pft-r"></div>`;
    app.innerHTML = header;
    if (d.status === 'pending' || d.status === 'processing') {
      // v810 30 分以上経っていれば stale な可能性 → 本人に「再投入」ボタンを出す。
      const myUidS = Number(state.me?.id || 0);
      const isOwnerS = myUidS > 0 && Number(d.author_id) === myUidS;
      const ageMin = d.created_at ? Math.round((Date.now() - new Date(String(d.created_at).replace(' ', 'T') + '+09:00').getTime()) / 60000) : 0;
      const isStale = ageMin >= 30;
      const staleBanner = (isStale && isOwnerS && d.pdf_path) ? `
        <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
          <div class="bold" style="color:#9a3412">⏳ もう ${ageMin} 分処理中。 OpenAI の background job が詰まっているか、結果取得が失敗した可能性があります。</div>
          <p class="hint" style="font-size:12.5px; margin:6px 0 8px">同 PDF で再投入します (新規課金なし)。</p>
          <button id="pft-retry-stale" class="primary">🔁 再投入 (新規課金なし)</button>
        </div>` : '';
      document.getElementById('pft-r').innerHTML = `
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">⏳ 全訳中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            10-30 分程度 (論文長とモデルにより変動)。閉じても OK、完了で通知が届きます。
            10 秒ごとに自動更新。
          </p>
          ${d.progress_text ? `
            <div style="margin-top:10px; padding:10px 14px; background:#f0f9ff; border-left:4px solid #0284c7; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:13px; color:#0284c7">📡 現在の状況</div>
              <div style="font-size:13.5px; margin-top:4px">${escapeHtml(d.progress_text)}</div>
            </div>` : ''}
        </div>
        ${staleBanner}`;
      document.getElementById('pft-retry-stale')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再投入中…';
        try {
          await post('/api/ai/paper_full_translate/' + d.id + '/retry', {});
          toast('再投入を開始しました');
          refresh(token);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再投入 (新規課金なし)'; }
      });
      if (!pollTimer) pollTimer = setInterval(() => refresh(token), 10000);
      return;
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (d.status === 'error') {
      const myUid = Number(state.me?.id || 0);
      const isOwner2 = myUid > 0 && Number(d.author_id) === myUid;
      document.getElementById('pft-r').innerHTML = `
        <div class="card">
          <div class="muted">❌ ${escapeHtml(d.error_msg || '不明なエラー')}</div>
          ${isOwner2 && d.pdf_path ? `<div style="margin-top:10px"><button id="pft-retry" class="primary">🔁 再実施 (新規課金なし)</button></div>` : ''}
        </div>`;
      document.getElementById('pft-retry')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再投入中…';
        try {
          await post('/api/ai/paper_full_translate/' + d.id + '/retry', {});
          toast('再投入を開始しました');
          refresh(token);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再実施 (新規課金なし)'; }
      });
      return;
    }
    // v807 button-style 公開切替
    // v933 PDF 出力
    document.getElementById('pft-pdf')?.addEventListener('click', async () => {
      const { printAsPdf } = await import('../print_helpers.js');
      printAsPdf(`全訳 - ${d.result?.title_translated || d.result?.title_original || d.pdf_name || '論文'}`);
    });
    document.getElementById('pft-share-dialog')?.addEventListener('click', () => {
      const t = d.result?.title_translated || d.result?.title_original || d.pdf_name || '論文全訳';
      shareDialog('📑 論文全訳: ' + t, '#/paper-translate-full/r/' + token);
    });
    // v914 share_priced=1 の row は toggle で 差額 追加課金/返金。 事前に確認プロンプト。
    document.getElementById('pft-share-toggle')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const wasOn = btn.dataset.on === '1';
      if (d.share_priced) {
        const paid = Number(d.cost_points || 0);
        const half = Math.floor(paid / 2);
        const msg = wasOn
          ? `非公開に戻すと 半額割引 が 停止 して 差額 ${paid}pt が 追加課金 されます。 (現在 ${paid}pt 支払済 → ${paid + paid}pt に)。 続けますか?`
          : `🎁 公開 ON にすると 半額割引 が 発動 して ${half}pt が 返金 されます。 (現在 ${paid}pt 支払済 → ${paid - half}pt に)。 続けますか?`;
        if (!confirm(msg)) return;
      }
      btn.disabled = true;
      try {
        await patch('/api/ai/paper_full_translate/' + d.id, { is_shared: !wasOn });
        toast(!wasOn ? '公開しました' : '非公開にしました');
        refresh(token);
      } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; }
    });
    paint(d);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

async function paint(d) {
  const r = d.result || {};
  const u = d.usage || {};
  const root = document.getElementById('pft-r');
  root.innerHTML = `
    ${r.title_original || r.title_translated ? `
      <div class="card">
        ${r.title_translated ? `<div class="bold" style="font-size:16px; color:var(--primary)">${escapeHtml(r.title_translated)}</div>` : ''}
        ${r.title_original   ? `<div style="font-size:13px; color:#6b7280; margin-top:2px">${escapeHtml(r.title_original)}</div>` : ''}
        ${r.authors          ? `<div style="font-size:12.5px; margin-top:4px">${escapeHtml(r.authors)}</div>` : ''}
        ${r.venue            ? `<div style="font-size:12px; color:#6b7280">${escapeHtml(r.venue)}</div>` : ''}
      </div>` : ''}

    ${u.total_tokens || u.chapters_count ? `
      <div class="card" style="background:#faf5ff">
        <div style="font-size:12px; color:#6b21a8">📊 使用量: ${u.input_tokens||0} in / ${u.output_tokens||0} out / 計 ${u.total_tokens||0} tok ・章 ${u.chapters_count||0} 本</div>
      </div>` : ''}

    ${(() => {
      // v955 論文本体と無関係のボイラープレート章 (CCS Concepts / ACM
      //   Reference Format / Permission / Copyright / References / Front matter
      //   等) を除外。 代わりに 上部に:
      //     - 著者カード (Front matter から parse)
      //     - キーワードタグ (Keywords 章から parse、 タップで検索)
      //   を出す。
      if (!Array.isArray(r.chapters) || !r.chapters.length) return '';
      const authors = parseAuthorsFromChapters(r.chapters);
      const kws = extractKeywordsFromChapters(r.chapters);
      const filtered = r.chapters.filter(ch => !isBoilerplateChapter(ch));
      let out = renderAuthorCards(authors);
      if (kws.length) {
        out += `
          <div class="card" style="background:#faf5ff">
            <div class="bold" style="color:#7b3fa0; font-size:13px; margin-bottom:6px">🏷 キーワード</div>
            <div class="row" style="gap:6px; flex-wrap:wrap">
              ${kws.map(kw => `<button data-pft-kw="${escapeHtml(kw)}" class="btn" style="background:#f3e8ff; color:#7b3fa0; font-size:12px; padding:2px 10px; border:1px solid #d8b4fe; border-radius:12px; cursor:pointer">${escapeHtml(kw)}</button>`).join('')}
            </div>
            <div class="hint-sm" style="margin-top:6px">タップで公開全訳から関連論文を検索</div>
          </div>`;
      }
      if (filtered.length) {
        out += `
          <div class="card">
            <div class="bold" style="color:var(--primary); font-size:15px; margin-bottom:6px">📚 章別翻訳</div>
            <div style="display:flex; flex-direction:column; gap:14px">
              ${filtered.map((ch, i) => renderChapter(ch, i, d.direction)).join('')}
            </div>
          </div>`;
      }
      return out;
    })()}

    <div id="pft-interactions-slot"></div>

    ${r.overall_polish ? `
      <div class="card" style="border:2px solid #6b21a8">
        <div class="bold" style="color:#6b21a8; font-size:14px">🪡 全体ポリッシュ</div>
        ${r.overall_polish.terminology_consistency ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">📘 用語統一:</span>
            <div style="font-size:13px; line-height:1.7; margin-top:2px; white-space:pre-wrap">${escapeHtml(r.overall_polish.terminology_consistency)}</div>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.adjustments_made) && r.overall_polish.adjustments_made.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">✏️ 修正した点:</span>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.overall_polish.adjustments_made.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.gpt_ism_scrub) && r.overall_polish.gpt_ism_scrub.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">🧹 GPT-ism 除去ログ:</span>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.overall_polish.gpt_ism_scrub.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.remaining_concerns) && r.overall_polish.remaining_concerns.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px; color:#a16207">⚠ 残った懸念:</span>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.overall_polish.remaining_concerns.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
      </div>` : ''}
  `;
  // v789 #389 いいね・ブックマーク・コメント
  if (d.id) {
    try {
      const mod = await import('../paper_interactions.js');
      const slot = document.getElementById('pft-interactions-slot');
      if (slot) {
        slot.innerHTML = mod.renderInteractionsCard({ apiBase: '/api/ai/paper_full_translate', refId: d.id, reactions: d.reactions });
        mod.mountInteractionsCard({ apiBase: '/api/ai/paper_full_translate', refId: d.id });
      }
    } catch (_) {}
  }
  // v813 #405 ペアの要約を作るボタン
  bindMakeSummary(d);
  // v955 キーワードタグ の クリック → 公開全訳 一覧 の 検索 に 飛ばす
  document.querySelectorAll('[data-pft-kw]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.pftKw || '').trim();
      if (!q) return;
      // #/paper-translate-full?q=<keyword> で 一覧 側 が pick up
      location.hash = '#/paper-translate-full?q=' + encodeURIComponent(q);
    });
  });
}

// v813 #406 cross_refs を「📄 要約へ」ボタンに簡素化 + #405 ペアの要約が無い場合は
//   「📄 要約を作る」ボタンを出す (本人 + PDF 保存済 + status=done なとき)。
function renderFullCrossRefsAndCreate(d) {
  const refs = Array.isArray(d.cross_refs) ? d.cross_refs : [];
  const myUid = Number(state.me?.id || 0);
  const isOwner = !!d.author_id && Number(d.author_id) === myUid;
  const hasSummary = refs.some(x => x.kind === 'paper_translate');
  const canCreate = isOwner && d.status === 'done' && !!d.pdf_path && !hasSummary;
  if (!refs.length && !canCreate) return '';
  const refBtns = refs.map(x => `
    <a class="btn" href="#/${escapeHtml(x.url_slug)}/r/${escapeHtml(x.share_token)}" style="font-size:12px; padding:3px 10px; margin-right:6px">
      ${x.kind === 'paper_translate' ? '📄 要約へ' : '📑 全訳へ'}
    </a>`).join('');
  const createBtn = canCreate ? `
    <button class="btn primary" id="pft-make-summary" style="font-size:12px; padding:3px 10px">📄 要約を作る</button>` : '';
  return `
    <div style="margin-top:8px; padding:6px 10px; background:#f0f9ff; border-left:3px solid #0284c7; border-radius:0 6px 6px 0; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
      ${refBtns}${createBtn}
    </div>`;
}

async function bindMakeSummary(d) {
  const btn = document.getElementById('pft-make-summary');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const { openModal } = await import('../modal.js');
  btn.addEventListener('click', async () => {
    const html = `
      <p style="font-size:13px; margin:0 0 8px">この PDF で論文要約を開始します。課金はポイント残高から (中村 PI は無料)。</p>
      <label class="field"><span class="lbl">モデル</span>
        <select id="mfs-model" style="font-size:13px">
          <option value="gpt-4.1">gpt-4.1 (20pt)</option>
          <option value="gpt-5-mini">gpt-5-mini (30pt)</option>
          <option value="gpt-5" selected>gpt-5 (50pt)</option>
          <option value="o1">o1 (80pt)</option>
        </select>
      </label>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px">
        <input type="checkbox" id="mfs-auto-share"> 🌐 完了と同時に公開 ON
      </label>`;
    openModal({
      title: '📄 要約を作る',
      bodyHtml: html,
      buttons: [
        { label: 'キャンセル', onClick: (close) => close() },
        { label: '開始', primary: true, onClick: async (close) => {
          const model = document.getElementById('mfs-model')?.value || 'gpt-5';
          const auto_share = !!document.getElementById('mfs-auto-share')?.checked;
          try {
            const j = await post(`/api/ai/paper_translate/from_full/${d.id}`, { model, auto_share });
            close();
            toast('📄 要約を開始しました');
            if (j?.share_token) location.hash = '#/paper-summary/r/' + encodeURIComponent(j.share_token);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        }},
      ],
    });
  });
}

// v955 論文本体と無関係のボイラープレート章を判定 (章別翻訳から除外)。
//   Front matter は 上部 の 著者カード で 別出しにする ので ここでは 除外。
function isBoilerplateChapter(ch) {
  const t = String(ch?.chapter_title_original || '').trim().toLowerCase();
  return /^(ccs (concept|categorie)|keywords?|acm reference format|permission|copyright|references|bibliography|acknowledg?ments?|appendix|front matter|title page)/.test(t);
}

// v955 Keywords 章 (もしあれば) から カンマ / 「;」 区切り の キーワード を 抽出。
function extractKeywordsFromChapters(chapters) {
  const kwCh = chapters.find(c => /^keywords?/i.test(String(c?.chapter_title_original || '').trim()));
  if (!kwCh) return [];
  let text = String(kwCh.translation || '');
  text = text.replace(/^\s*keywords?\s*[:：]?\s*/i, '').trim();
  return text.split(/[,;、・；]+/).map(s => s.trim()).filter(s => s.length && s.length <= 60).slice(0, 20);
}

// v955 Front matter 章 の 訳 テキスト から 著者ブロック を パース。
//   ブロック は 空行区切り、 email が ある もの を 著者 と 判定、 name / affiliation / email を 抽出。
function parseAuthorsFromChapters(chapters) {
  const fmCh = chapters.find(c => /^(front matter|title page)/i.test(String(c?.chapter_title_original || '').trim()));
  if (!fmCh) return [];
  const text = String(fmCh.translation || '');
  const blocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  const authors = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const emailIdx = lines.findIndex(l => /[\w.+-]+@[\w-]+\.[\w-]+/.test(l));
    if (emailIdx < 0) continue;
    const emailMatch = lines[emailIdx].match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (!emailMatch) continue;
    // 名前 は 最初 の 行 (英字 / 記号 で 「, 」 を 含ま ない ような 短い もの)。
    const name = lines[0];
    if (name.length > 80) continue;   // タイトル行が紛れた
    if (/\.$/.test(name)) continue;   // 文っぽいもの (References 等) を 除外
    const affiliation = lines.slice(1, emailIdx).join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '');
    authors.push({ name, affiliation, email: emailMatch[0] });
  }
  // 上限 30 で 打ち切り (安全策)
  return authors.slice(0, 30);
}

// v955 名前から 決定的に 色 と イニシャル を 生成 (顔画像 の 代替、 外部 API なし)。
function initialsAvatar(name) {
  const clean = String(name || '').trim();
  if (!clean) return { initials: '?', color: '#9ca3af' };
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '');
  // ハッシュ から 色 (パステル系 の 色相 だけ 変える)
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { initials: initials.toUpperCase().slice(0, 2), color: `hsl(${hue}, 55%, 55%)` };
}

function renderAuthorCards(authors) {
  if (!authors.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); font-size:13px; margin-bottom:8px">👥 著者</div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:8px">
        ${authors.map(a => {
          const av = initialsAvatar(a.name);
          return `
            <div style="display:flex; gap:10px; padding:8px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; min-width:0">
              <div style="flex:none; width:38px; height:38px; border-radius:50%; background:${av.color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; font-family:system-ui, sans-serif">${escapeHtml(av.initials)}</div>
              <div style="flex:1; min-width:0; font-size:12px">
                <div class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.name)}</div>
                ${a.affiliation ? `<div style="color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHtml(a.affiliation)}">${escapeHtml(a.affiliation)}</div>` : ''}
                ${a.email ? `<a href="mailto:${escapeHtml(a.email)}" style="font-size:11px; color:#7b3fa0; text-decoration:none">${escapeHtml(a.email)}</a>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderChapter(ch, idx, direction) {
  const titleOrig = ch.chapter_title_original || '';
  const titleTrans = ch.chapter_title_translated || '';
  const samples = Array.isArray(ch.back_translation_samples) ? ch.back_translation_samples : [];
  const terms = Array.isArray(ch.key_terms) ? ch.key_terms : [];
  // v808 #399 章番号 (1, 2, ...) を出さない。元タイトルに既に「1.」「Chapter 1」「第1章」等
  //   が含まれてるケースが多く、二重表記で違和感があった。タイトルをそのまま出す。
  return `
    <div style="padding:10px 12px; border-left:3px solid var(--primary); background:#fafafa; border-radius:0 6px 6px 0">
      <div class="bold" style="font-size:14px; color:var(--primary)">${escapeHtml(titleTrans || '(無題)')} ${titleOrig ? `<span style="font-size:12px; color:#6b7280; font-weight:400">(${escapeHtml(titleOrig)})</span>` : ''}</div>
      <div style="font-size:13.5px; line-height:1.85; margin-top:8px; white-space:pre-wrap">${escapeHtml(ch.translation || '')}</div>
      ${samples.length ? `
        <details style="margin-top:8px; background:#fff; padding:6px 10px; border-radius:6px">
          <summary style="cursor:pointer; font-size:12.5px; color:#0284c7; font-weight:600">🔁 back-translation チェック (${samples.length} 件)</summary>
          <div style="margin-top:6px; display:flex; flex-direction:column; gap:8px">
            ${samples.map(s => `
              <div style="padding:6px 10px; background:#f0f9ff; border-radius:4px; font-size:12.5px; line-height:1.7">
                <div><b>${direction === 'ja2en' ? '英訳' : '訳文'}:</b> ${escapeHtml(s.ja_translation || s.en_translation || '')}</div>
                <div style="margin-top:2px"><b>逆翻訳:</b> ${escapeHtml(s.back_to_en || s.back_to_ja || '')}</div>
                <div style="margin-top:2px"><b>原文:</b> ${escapeHtml(s.original_en || s.original_ja || '')}</div>
                ${s.notes ? `<div style="margin-top:2px; color:#a16207"><b>メモ:</b> ${escapeHtml(s.notes)}</div>` : ''}
              </div>`).join('')}
          </div>
        </details>` : ''}
      ${terms.length ? `
        <details style="margin-top:6px; background:#fff; padding:6px 10px; border-radius:6px">
          <summary style="cursor:pointer; font-size:12.5px; color:#6b21a8; font-weight:600">📘 重要用語 (${terms.length} 件)</summary>
          <ul style="margin:4px 0 0 0; padding-left:20px; font-size:12.5px; line-height:1.7">
            ${terms.map(t => `<li><b>${escapeHtml(t.original || '')}</b> → ${escapeHtml(t.translation || '')}${t.note ? ` <span style="color:#6b7280">(${escapeHtml(t.note)})</span>` : ''}</li>`).join('')}
          </ul>
        </details>` : ''}
    </div>`;
}
