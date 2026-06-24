// /#/paper-translate-full — 論文 全訳 (v788 #386 #387 #388)。
//   章 ごと に 完全 翻訳 + サンプル 文 の back-translation 整合 確認 + 用語 統一 ポリッシュ。
//   direction:
//     en2ja: 英語 論文 → 日本語 (標準 料金)
//     ja2en: 日本語 論文 → 英語 (5x、 em-dash 等 GPT-isms 除去 まで 含む)

import { get, post, del, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let settings = null;

export async function renderPaperTranslateFull() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文 全訳</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        要約 で なく 全文 翻訳。 章 ごと に 訳 → back-translation で 整合 確認 → 用語 統一 と 全体 ポリッシュ。
        英→日 と 日→英 が 選べ ます (日→英 は em-dash 等 GPT-isms 除去 も 込み)。
      </p>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">🌐 翻訳 方向</span>
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
      <label class="field" style="display:flex; align-items:center; gap:6px; margin-top:4px">
        <input type="checkbox" id="pft-auto-share">
        <span style="font-size:13px">🌐 完了 と 同時 に 公開 ON に する</span>
      </label>
      <!-- v798 同時 に 要約 も 走らせる オプション -->
      <fieldset class="field" style="border:1px dashed var(--line); border-radius:6px; padding:8px; margin-top:4px">
        <legend style="font-size:12px; color:#6b7280">📑📑 同時 に 要約 も 走らせる (任意)</legend>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px">
          <input type="checkbox" id="pft-also-summary">
          要約 (落合 メソッド + 図表 抽出) も 一緒 に 開始
        </label>
        <div id="pft-also-summary-opts" style="margin-top:6px; display:none">
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">要約 モデル</span>
            <select id="pft-sum-model" style="font-size:12px"></select>
            <div class="hint-sm" id="pft-sum-cost-info" style="font-size:11px; margin-top:2px"></div>
          </label>
        </div>
      </fieldset>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pft-go" class="primary" disabled>📑 全訳 開始</button>
      </div>
    </div>
    <div id="pft-result"></div>
    <!-- v807 自分の履歴 と みんなの公開 全訳 を タブ で 切替 (要約 ページ と 同 形式) -->
    <div class="card" style="margin-top:8px">
      <div class="row" style="gap:6px; margin-bottom:8px; align-items:center">
        <button id="pft-tab-mine"   class="btn primary" data-tab="mine"   style="font-size:13px">📜 自分 の 履歴</button>
        <button id="pft-tab-shared" class="btn"         data-tab="shared" style="font-size:13px">🌐 みんなの 公開 全訳</button>
        <span style="flex:1"></span>
        <input type="search" id="pft-search" placeholder="🔍 検索 (公開 のみ、 タイトル / 著者 / 本文)" maxlength="100" style="font-size:13px; padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; min-width:180px" hidden>
      </div>
      <div id="pft-list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadSettings();
  bindEvents();
  // v807 タブ 切替
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
  await loadHistory();   // 初期 は 自分の履歴
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
      status.innerHTML = '<span style="color:#dc2626">30 MB を 超え</span>'; btn.disabled = true; return;
    }
    status.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size/1048576).toFixed(1)} MB)</span>`;
    btn.disabled = false;
  });
  function rebuildModelOptions() {
    if (!settings) return;
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const def = settings.default_model || Object.keys(models)[0];
    sel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} (${pt}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const m = sel.value;
    const pt = models[m] || 0;
    if (info) info.textContent = `選択中: ${m} ・ ${pt}pt (${dir.value === 'ja2en' ? '日→英' : '英→日'})`;
    btn.textContent = `📑 全訳 開始 (${pt}pt)`;
  }
  dir?.addEventListener('change', rebuildModelOptions);
  sel?.addEventListener('change', refreshCost);
  btn?.addEventListener('click', go);
  if (settings) rebuildModelOptions();
  // v798 同時 に 要約 も 走らせる オプション
  setupAlsoSummary();
}

// v798 同時 要約 オプション の セット アップ
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
      catch (e) { toast('要約 設定 読込 失敗: ' + e.message); return; }
      rebuildSummaryModels();
    }
  });
  function rebuildSummaryModels() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const def = summarySettingsCache.default_model || Object.keys(models)[0];
    modSel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} (${pt}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const m = modSel.value;
    const pt = models[m] || 0;
    info.textContent = `要約 ${pt}pt (全訳 + 要約 を 同時 課金)`;
  }
  modSel.addEventListener('change', refreshCost);
}

async function loadSettings() {
  try { settings = await get('/api/ai/paper_full_translate'); }
  catch (e) { toast('設定 読込 失敗: ' + e.message); return; }
}

// v807 自分 の 履歴 (タイトル / 公開中 バッジ / 削除 ボタン)
async function loadHistory() {
  const root = document.getElementById('pft-list');
  try {
    const d = await get('/api/ai/paper_full_translate');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ 全訳 履歴 が ありません</div>';
      return;
    }
    root.innerHTML = items.map(it => {
      const sharedBadge = it.is_shared ? ' <span class="tag ok" style="font-size:10px">🌐 公開中</span>' : '';
      const title = it.title_translated || it.title_original || it.pdf_name;
      const sub = it.title_translated
        ? `${it.pdf_name} ・ ${it.direction} ・ ${it.model} ・ ${it.cost_points}pt ・ ${it.status} ・ ${it.created_at}`
        : `${it.direction} ・ ${it.model} ・ ${it.cost_points}pt ・ ${it.status} ・ ${it.created_at}`;
      const icon = it.status === 'done' ? '📑' : it.status === 'error' ? '❌' : '⏳';
      return `
        <div class="list-item" style="gap:8px; align-items:flex-start; padding:8px 0">
          <a href="#/paper-translate-full/r/${escapeHtml(it.share_token)}" style="display:flex; gap:8px; flex:1; min-width:0; text-decoration:none; color:inherit; align-items:flex-start">
            <div style="flex:none; font-size:20px">${icon}</div>
            <div class="grow" style="min-width:0">
              <div class="bold" style="font-size:14px; line-height:1.4">${escapeHtml(title)}${sharedBadge}</div>
              <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:2px">${escapeHtml(sub)}</div>
            </div>
          </a>
          <button class="btn" data-pft-del="${it.id}" title="削除" style="font-size:11px; padding:2px 8px; flex:none">🗑</button>
        </div>`;
    }).join('');
    root.querySelectorAll('[data-pft-del]').forEach(b => {
      b.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!confirm('この 全訳 を 履歴 から 削除 します か? (PDF も 一緒 に 削除)')) return;
        try { await del('/api/ai/paper_full_translate/' + b.dataset.pftDel); toast('削除 しました'); await loadHistory(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v807 みんなの 公開 全訳 (q で 検索)
async function loadSharedList(q) {
  const root = document.getElementById('pft-list');
  if (!root) return;
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    const url = '/api/ai/paper_full_translate/shared' + (q ? '?q=' + encodeURIComponent(q) : '');
    const d = await get(url);
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = q
        ? `<div class="empty">「${escapeHtml(q)}」 に 該当 する 公開 全訳 が ありません</div>`
        : '<div class="empty">まだ 公開 されて いる 全訳 は ありません</div>';
      return;
    }
    root.innerHTML = items.map(it => {
      const title = it.title_translated || it.title_original || it.pdf_name;
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      return `
        <a href="#/paper-translate-full/r/${escapeHtml(it.share_token)}" class="list-item" style="text-decoration:none; color:inherit; gap:8px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #f0f0f0">
          <div style="flex:none; font-size:20px">📑</div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:14px">${escapeHtml(title)}</div>
            ${meta ? `<div class="hint-sm" style="font-size:11px; color:#666; margin-top:1px">${escapeHtml(meta)}</div>` : ''}
            <div class="hint-sm" style="font-size:10px; margin-top:3px; color:#9ca3af">${avatarHtml(it.author_name, it.author_avatar, 'xs')} ${escapeHtml(it.author_name)} ・ ${escapeHtml(it.direction)} ・ ${escapeHtml(it.shared_at || it.created_at)}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function go() {
  const f = document.getElementById('pft-file').files?.[0];
  if (!f) { toast('PDF を 選んで'); return; }
  const direction = document.getElementById('pft-direction').value;
  const model = document.getElementById('pft-model').value;
  const btn = document.getElementById('pft-go');
  btn.disabled = true; btn.textContent = '⏳ アップロード 中…';
  const root = document.getElementById('pft-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ PDF を OpenAI に 送信 中…</div></div>';
  // v796 #397 await 中 に 別 ページ に 移った ら 引き 戻さ ない
  const startedHash = location.hash;
  // v798 同時 要約 オプション
  const alsoSum = document.getElementById('pft-also-summary')?.checked;
  const sumModel = document.getElementById('pft-sum-model')?.value;
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('direction', direction);
    fd.append('model', model);
    // v804 完了 と 同時 に 公開 ON
    if (document.getElementById('pft-auto-share')?.checked) fd.append('auto_share', '1');
    const resp = await fetch('/api/ai/paper_full_translate', {
      method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    if (j.deduped) toast('🔁 同じ PDF + 方向 + モデル の 全訳 が 既に あった の で 流用 (課金 なし)');

    // v798 同時 に 要約 も 開始 する なら 2 本目 を 投げる
    let sumToken = null;
    if (alsoSum && sumModel) {
      try {
        const fd2 = new FormData();
        fd2.append('file', f);
        fd2.append('model', sumModel);
        const r2 = await fetch('/api/ai/paper_translate', {
          method: 'POST', body: fd2, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
        });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(j2?.error?.message || j2?.error || ('HTTP ' + r2.status));
        sumToken = j2.share_token;
        if (j2.deduped) toast('🔁 要約 も 既存 row を 流用 (課金 なし)');
        else             toast('要約 も 開始 (' + (j2.model || sumModel) + ')');
      } catch (e2) {
        toast('要約 開始 失敗: ' + e2.message + ' (全訳 は 走って ます)');
      }
    }

    if (location.hash === startedHash || location.hash.startsWith('#/paper-translate-full')) {
      location.hash = '#/paper-translate-full/r/' + j.share_token;
      if (sumToken) toast('要約 は /#/paper-summary/r/' + sumToken + ' で 進捗 確認');
    } else {
      toast('裏 で 全訳 中。 通知 が 届いたら 結果 ページ を 開いて ください');
    }
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
    btn.disabled = false; btn.textContent = '📑 全訳 開始';
  }
}

let pollTimer = null;
export async function renderPaperTranslateFullShared({ params }) {
  const token = params.token;
  const app = document.getElementById('app');
  app.innerHTML = '<div class="card"><div class="muted">読み込み 中…</div></div>';
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
  // v798 別 ページ に 移って いる なら 触らず timer 自殺
  if (!location.hash.includes('/paper-translate-full/r/' + token)) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    return;
  }
  try {
    const d = await get('/api/ai/paper_full_translate/r/' + encodeURIComponent(token));
    // fetch 中 に 移動 した か もう 一度 確認
    if (!location.hash.includes('/paper-translate-full/r/' + token)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      return;
    }
    const myUid = Number(state.me?.id || 0);
    const isOwner = myUid > 0 && Number(d.author_id) === myUid;
    const isShared = !!d.is_shared;
    // v807 要約 ページ と 同じ 「ボタン 形式」 公開 切替
    const shareButton = (isOwner && d.status === 'done') ? `
      <button class="btn ${isShared ? 'primary' : ''}" id="pft-share-toggle" data-on="${isShared ? 1 : 0}" style="font-size:12px; padding:3px 10px; margin-left:6px">
        ${isShared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)'}
      </button>` : '';
    const sharedTag = (isShared && !isOwner) ? '<span class="tag ok" style="font-size:11px; margin-left:6px">🌐 公開全訳</span>' : '';
    const header = `
      <div class="card">
        <a href="#/paper-translate-full" class="hint">← 論文 全訳</a>
        <h2 style="margin:6px 0; font-size:17px">📑 ${escapeHtml(d.result?.title_translated || d.result?.title_original || d.pdf_name)}
          ${d.status === 'pending' || d.status === 'processing' ? '<span class="tag warn">処理中</span>' : ''}
          ${d.status === 'error' ? '<span class="tag" style="background:#fecaca; color:#b91c1c">エラー</span>' : ''}
          ${sharedTag}
        </h2>
        ${d.result?.title_original && d.result?.title_translated ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(d.result.title_original)}</div>` : ''}
        ${d.result?.authors ? `<div class="meta" style="font-size:13px; margin-top:2px">👥 ${escapeHtml(d.result.authors)}</div>` : ''}
        ${d.result?.venue   ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(d.result.venue)}</div>` : ''}
        <div class="meta" style="font-size:11px; margin-top:6px">
          ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 ・
          ${escapeHtml(d.direction)} ・ ${escapeHtml(d.model || '')} ・ ${d.cost_points}pt ・ ${escapeHtml(d.created_at || '')}
        </div>
        <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
          ${d.pdf_path ? `<a class="btn" href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📥 元の PDF を 開く</a>` : ''}
          ${shareButton}
          <a class="btn" href="#/paper-translate-full" style="font-size:12px; padding:3px 10px">← 一覧へ</a>
        </div>
        ${renderFullCrossRefsAndCreate(d)}
      </div>
      <div id="pft-r"></div>`;
    app.innerHTML = header;
    if (d.status === 'pending' || d.status === 'processing') {
      // v810 30 分 以上 経って いれば stale な 可能性 → 本人 に 「再 投入」 ボタン を 出す。
      const myUidS = Number(state.me?.id || 0);
      const isOwnerS = myUidS > 0 && Number(d.author_id) === myUidS;
      const ageMin = d.created_at ? Math.round((Date.now() - new Date(String(d.created_at).replace(' ', 'T') + '+09:00').getTime()) / 60000) : 0;
      const isStale = ageMin >= 30;
      const staleBanner = (isStale && isOwnerS && d.pdf_path) ? `
        <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
          <div class="bold" style="color:#9a3412">⏳ もう ${ageMin} 分 処理 中。 OpenAI の background job が 詰まって いる か、 結果 取得 が 失敗 した 可能性 が あります。</div>
          <p class="hint" style="font-size:12.5px; margin:6px 0 8px">同 PDF で 再 投入 し ます (新規 課金 なし)。</p>
          <button id="pft-retry-stale" class="primary">🔁 再 投入 (新規 課金 なし)</button>
        </div>` : '';
      document.getElementById('pft-r').innerHTML = `
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">⏳ 全訳 中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            10-30 分 程度 (論文 長 と モデル に より 変動)。 閉じて も OK、 完了 で 通知 が 届きます。
            10 秒 ごと に 自動 更新。
          </p>
          ${d.progress_text ? `
            <div style="margin-top:10px; padding:10px 14px; background:#f0f9ff; border-left:4px solid #0284c7; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:13px; color:#0284c7">📡 現在 の 状況</div>
              <div style="font-size:13.5px; margin-top:4px">${escapeHtml(d.progress_text)}</div>
            </div>` : ''}
        </div>
        ${staleBanner}`;
      document.getElementById('pft-retry-stale')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再 投入 中…';
        try {
          await post('/api/ai/paper_full_translate/' + d.id + '/retry', {});
          toast('再 投入 を 開始 しました');
          refresh(token);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再 投入 (新規 課金 なし)'; }
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
          <div class="muted">❌ ${escapeHtml(d.error_msg || '不明 な エラー')}</div>
          ${isOwner2 && d.pdf_path ? `<div style="margin-top:10px"><button id="pft-retry" class="primary">🔁 再 実施 (新規 課金 なし)</button></div>` : ''}
        </div>`;
      document.getElementById('pft-retry')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再 投入 中…';
        try {
          await post('/api/ai/paper_full_translate/' + d.id + '/retry', {});
          toast('再 投入 を 開始 しました');
          refresh(token);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再 実施 (新規 課金 なし)'; }
      });
      return;
    }
    // v807 button-style 公開 切替
    document.getElementById('pft-share-toggle')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const wasOn = btn.dataset.on === '1';
      btn.disabled = true;
      try {
        await patch('/api/ai/paper_full_translate/' + d.id, { is_shared: !wasOn });
        toast(!wasOn ? '公開 しました' : '非公開 に しました');
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
        <div style="font-size:12px; color:#6b21a8">📊 使用量: ${u.input_tokens||0} in / ${u.output_tokens||0} out / 計 ${u.total_tokens||0} tok ・ 章 ${u.chapters_count||0} 本</div>
      </div>` : ''}

    ${Array.isArray(r.chapters) && r.chapters.length ? `
      <div class="card">
        <div class="bold" style="color:var(--primary); font-size:15px; margin-bottom:6px">📚 章 別 翻訳</div>
        <div style="display:flex; flex-direction:column; gap:14px">
          ${r.chapters.map((ch, i) => renderChapter(ch, i, d.direction)).join('')}
        </div>
      </div>` : ''}

    <div id="pft-interactions-slot"></div>

    ${r.overall_polish ? `
      <div class="card" style="border:2px solid #6b21a8">
        <div class="bold" style="color:#6b21a8; font-size:14px">🪡 全体 ポリッシュ</div>
        ${r.overall_polish.terminology_consistency ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">📘 用語 統一:</span>
            <div style="font-size:13px; line-height:1.7; margin-top:2px; white-space:pre-wrap">${escapeHtml(r.overall_polish.terminology_consistency)}</div>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.adjustments_made) && r.overall_polish.adjustments_made.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">✏️ 修正 した 点:</span>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.overall_polish.adjustments_made.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.gpt_ism_scrub) && r.overall_polish.gpt_ism_scrub.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px">🧹 GPT-ism 除去 ログ:</span>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.overall_polish.gpt_ism_scrub.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${Array.isArray(r.overall_polish.remaining_concerns) && r.overall_polish.remaining_concerns.length ? `
          <div style="margin-top:6px"><span class="bold" style="font-size:12.5px; color:#a16207">⚠ 残った 懸念:</span>
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
  // v813 #405 ペア の 要約 を 作る ボタン
  bindMakeSummary(d);
}

// v813 #406 cross_refs を 「📄 要約 へ」 ボタン に 簡素化 + #405 ペア の 要約 が 無い 場合 は
//   「📄 要約 を 作る」 ボタン を 出す (本人 + PDF 保存 済 + status=done な とき)。
function renderFullCrossRefsAndCreate(d) {
  const refs = Array.isArray(d.cross_refs) ? d.cross_refs : [];
  const myUid = Number(state.me?.id || 0);
  const isOwner = !!d.author_id && Number(d.author_id) === myUid;
  const hasSummary = refs.some(x => x.kind === 'paper_translate');
  const canCreate = isOwner && d.status === 'done' && !!d.pdf_path && !hasSummary;
  if (!refs.length && !canCreate) return '';
  const refBtns = refs.map(x => `
    <a class="btn" href="#/${escapeHtml(x.url_slug)}/r/${escapeHtml(x.share_token)}" style="font-size:12px; padding:3px 10px; margin-right:6px">
      ${x.kind === 'paper_translate' ? '📄 要約 へ' : '📑 全訳 へ'}
    </a>`).join('');
  const createBtn = canCreate ? `
    <button class="btn primary" id="pft-make-summary" style="font-size:12px; padding:3px 10px">📄 要約 を 作る</button>` : '';
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
      <p style="font-size:13px; margin:0 0 8px">この PDF で 論文 要約 を 開始 します。 課金 は ポイント 残高 から (中村 PI は 無料)。</p>
      <label class="field"><span class="lbl">モデル</span>
        <select id="mfs-model" style="font-size:13px">
          <option value="gpt-4.1">gpt-4.1 (20pt)</option>
          <option value="gpt-5-mini">gpt-5-mini (30pt)</option>
          <option value="gpt-5" selected>gpt-5 (50pt)</option>
          <option value="o1">o1 (80pt)</option>
        </select>
      </label>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px">
        <input type="checkbox" id="mfs-auto-share"> 🌐 完了 と 同時 に 公開 ON
      </label>`;
    openModal({
      title: '📄 要約 を 作る',
      bodyHtml: html,
      buttons: [
        { label: 'キャンセル', onClick: (close) => close() },
        { label: '開始', primary: true, onClick: async (close) => {
          const model = document.getElementById('mfs-model')?.value || 'gpt-5';
          const auto_share = !!document.getElementById('mfs-auto-share')?.checked;
          try {
            const j = await post(`/api/ai/paper_translate/from_full/${d.id}`, { model, auto_share });
            close();
            toast('📄 要約 を 開始 しました');
            if (j?.share_token) location.hash = '#/paper-summary/r/' + encodeURIComponent(j.share_token);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        }},
      ],
    });
  });
}

function renderChapter(ch, idx, direction) {
  const titleOrig = ch.chapter_title_original || '';
  const titleTrans = ch.chapter_title_translated || '';
  const samples = Array.isArray(ch.back_translation_samples) ? ch.back_translation_samples : [];
  const terms = Array.isArray(ch.key_terms) ? ch.key_terms : [];
  // v808 #399 章 番号 (1, 2, ...) を 出さない。 元 タイトル に 既に「1.」「Chapter 1」「第1章」 等
  //   が 含まれて る ケース が 多く、 二重 表記 で 違和感 が あった。 タイトル を そのまま 出す。
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
          <summary style="cursor:pointer; font-size:12.5px; color:#6b21a8; font-weight:600">📘 重要 用語 (${terms.length} 件)</summary>
          <ul style="margin:4px 0 0 0; padding-left:20px; font-size:12.5px; line-height:1.7">
            ${terms.map(t => `<li><b>${escapeHtml(t.original || '')}</b> → ${escapeHtml(t.translation || '')}${t.note ? ` <span style="color:#6b7280">(${escapeHtml(t.note)})</span>` : ''}</li>`).join('')}
          </ul>
        </details>` : ''}
    </div>`;
}
