// /#/paper-translate — v748 #359-#361 / v750 #365-#367 論文 和訳 要約。
//   PDF を OpenAI Files API 経由で GPT-4o に直接読ませ、 論文構造に沿った 詳細サマリ +
//   重要 図表 (ページ画像 を pdftoppm で 抽出 表示) + 最後 に 落合メソッド の 6 項目 で
//   全体 を 重ね合わせて まとめる。 結果は share_token で URL 共有可能。

import { get, patch, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons, viewControlsHtml, bindViewControls, setFormOpen } from '../ui_ai_stars.js';
import { shareDialog } from '../share_to_sns.js';

let sharedPollTimer = null;
let viewState = { mineSort: 'new', mineOnly_mine: false, pubSort: 'new', mineOnly_pub: false, lastQuery: '' };

// v762 #381 既存 result_json に 入って いる 日本語 中 の 不要 な スペース を 取り除く
//   defensive helper。 日本語文字 (ひらがな / カタカナ / 漢字) どうし の 間 の 半角 スペース
//   を 1 個 ずつ 削除。 英数字 / 記号 と 日本語 の 境界 スペース は 残す。
const JA_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
function stripJaSpaces(s) {
  if (!s || typeof s !== 'string') return s;
  let prev;
  do {
    prev = s;
    s = s.replace(/([぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]) +([぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ])/g, '$1$2');
  } while (s !== prev);
  return s;
}
function stripJaSpacesDeep(v) {
  if (typeof v === 'string') return stripJaSpaces(v);
  if (Array.isArray(v)) return v.map(stripJaSpacesDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = stripJaSpacesDeep(v[k]);
    return out;
  }
  return v;
}

export async function renderPaperTranslate() {
  const app = document.getElementById('app');
  app.innerHTML = stripJaSpaces(`
    <div class="card page-header">
      <h2 style="margin:0">📑 論文要約 <span style="font-size:12px; color:#9ca3af; font-weight:normal">(自動翻訳)</span></h2>
    </div>
    <details class="card" id="pt-form">
      <summary style="cursor:pointer; font-weight:600; padding:4px 0; user-select:none">➕ 新しい論文要約を依頼</summary>
      <p class="hint" style="font-size:13px; margin:8px 0">
        論文 PDF をアップすると、 全体要約 → RQ/仮説 + 結果 → 主張する貢献 → 章立て要約 (重要図表 inline) →
        今後の課題 → 落合メソッドまとめ という順番で構造化して返します。 全体 1500-2500 字 (≒ 3-5 分で読める分量)。
      </p>
      <label class="field">
        <span class="lbl">🤖 モデル (高いほど高品質)</span>
        <select id="pt-model" style="font-size:13px">
          <option value="">読み込み中…</option>
        </select>
        <div class="hint-sm" id="pt-model-info" style="margin-top:4px; font-size:11px"></div>
      </label>
      <label class="field">
        <span class="lbl">論文 PDF (最大 30 MB)</span>
        <input type="file" id="pt-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pt-file-status" style="margin-top:4px"></div>
      </label>
      <label class="field" style="display:flex; align-items:center; gap:6px; margin-top:4px">
        <input type="checkbox" id="pt-auto-share">
        <span style="font-size:13px">🌐 完了 と 同時 に 公開 ON に する (= みんな の 検索 に 載せる)</span>
      </label>
      <fieldset class="field" style="border:1px dashed var(--line); border-radius:6px; padding:8px; margin-top:4px">
        <legend style="font-size:12px; color:#6b7280">📑📑 同時 に 全訳 も 走らせる (任意)</legend>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px">
          <input type="checkbox" id="pt-also-full">
          全訳 (章 ごと + back-translation) も 一緒 に 開始
        </label>
        <div id="pt-also-full-opts" style="margin-top:6px; display:none">
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">方向</span>
            <select id="pt-ft-direction" style="font-size:12px">
              <option value="en2ja" selected>英→日</option>
              <option value="ja2en">日→英 (5x)</option>
            </select>
          </label>
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">全訳 モデル</span>
            <select id="pt-ft-model" style="font-size:12px"></select>
            <div class="hint-sm" id="pt-ft-cost-info" style="font-size:11px; margin-top:2px"></div>
          </label>
        </div>
      </fieldset>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pt-go" class="primary" disabled>📑 要約を作る</button>
      </div>
    </details>
    <div id="pt-result"></div>
    <!-- v756 #372 自分 の 履歴 と みんな の 公開 一覧 を タブ で 切替 -->
    <div class="card" style="margin-top:8px">
      <div class="row" style="gap:6px; margin-bottom:8px; align-items:center">
        <button id="pt-tab-mine"   class="btn primary" data-tab="mine"   style="font-size:13px">📜 自分の履歴</button>
        <button id="pt-tab-shared" class="btn"         data-tab="shared" style="font-size:13px">🌐 みんなの公開要約</button>
        <span style="flex:1"></span>
        <input type="search" id="pt-search" placeholder="🔍 検索 (公開のみ、 タイトル / 著者 / 本文)" maxlength="100" style="font-size:13px; padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; min-width:180px" hidden>
      </div>
      <div id="pt-controls"></div>
      <div id="pt-history"><div class="muted">読み込み中…</div></div>
    </div>
  `);
  const fileInput = document.getElementById('pt-file');
  const fileStatus = document.getElementById('pt-file-status');
  const btn = document.getElementById('pt-go');
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) { fileStatus.textContent = ''; btn.disabled = true; return; }
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      fileStatus.innerHTML = '<span style="color:#dc2626">PDF ファイル を 選んで ください</span>';
      btn.disabled = true; return;
    }
    if (f.size > 30 * 1024 * 1024) {
      fileStatus.innerHTML = '<span style="color:#dc2626">30 MB を 超えて います</span>';
      btn.disabled = true; return;
    }
    fileStatus.innerHTML = stripJaSpaces(`<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size / 1024 / 1024).toFixed(1)} MB)</span>`);
    btn.disabled = false;
  });
  btn.addEventListener('click', go);
  // v796 #398 「同時 に 全訳 も」 トグル + 全訳 モデル ロード
  setupAlsoFullTranslate();
  // v756 #372 タブ 切替 + 検索
  let curTab = 'mine';
  let searchTimer = null;
  const tabMine   = document.getElementById('pt-tab-mine');
  const tabShared = document.getElementById('pt-tab-shared');
  const searchEl  = document.getElementById('pt-search');
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
  await loadHistory();    // history 取得 と 同時 に models / cost を ロード
}

function updateModelInfo(d) {
  const sel = document.getElementById('pt-model');
  const info = document.getElementById('pt-model-info');
  if (!sel || !info) return;
  const models = d.models || { 'gpt-4o': 20 };
  const def = d.default_model || 'gpt-4o';
  sel.innerHTML = Object.entries(models).map(([m, pt]) =>
    `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} (${pt}pt)</option>`
  ).join('');
  const refresh = () => {
    const m = sel.value;
    const pt = models[m] || 20;
    info.textContent = `選択中: ${m} ・ 1 回 ${pt}pt`;
    const btn = document.getElementById('pt-go');
    if (btn) btn.textContent = `📑 要約を作る (${pt}pt)`;
  };
  sel.addEventListener('change', refresh);
  refresh();
}

// v796 #398 全訳 オプション の セット アップ
let ftSettingsCache = null;
async function setupAlsoFullTranslate() {
  const toggle = document.getElementById('pt-also-full');
  const opts   = document.getElementById('pt-also-full-opts');
  const dirSel = document.getElementById('pt-ft-direction');
  const modSel = document.getElementById('pt-ft-model');
  const info   = document.getElementById('pt-ft-cost-info');
  if (!toggle) return;
  toggle.addEventListener('change', async () => {
    opts.style.display = toggle.checked ? '' : 'none';
    if (toggle.checked && !ftSettingsCache) {
      try { ftSettingsCache = await get('/api/ai/paper_full_translate'); }
      catch (e) { toast('全訳 設定 読込 失敗: ' + e.message); return; }
      rebuildFtModels();
    }
  });
  function rebuildFtModels() {
    if (!ftSettingsCache) return;
    const models = dirSel.value === 'ja2en' ? ftSettingsCache.models_ja2en : ftSettingsCache.models_en2ja;
    const def = ftSettingsCache.default_model || Object.keys(models)[0];
    modSel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} (${pt}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    if (!ftSettingsCache) return;
    const models = dirSel.value === 'ja2en' ? ftSettingsCache.models_ja2en : ftSettingsCache.models_en2ja;
    const m = modSel.value;
    const pt = models[m] || 0;
    info.textContent = `全訳 ${pt}pt (要約 + 全訳 を 同時 課金)`;
  }
  dirSel.addEventListener('change', rebuildFtModels);
  modSel.addEventListener('change', refreshCost);
}

async function go() {
  const fileInput = document.getElementById('pt-file');
  const f = fileInput.files[0];
  if (!f) { toast('PDF を 選んで ください'); return; }
  const btn = document.getElementById('pt-go');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '送信中…';
  // v796 #397 ユーザ が 既に 他 ページ へ 移って いる 場合 は location.hash を 触らない (= 強制 引き 戻し 防止)
  const startedHash = location.hash;
  // v796 #398 同時 全訳 オプション
  const alsoFull = document.getElementById('pt-also-full')?.checked;
  const ftDir   = document.getElementById('pt-ft-direction')?.value;
  const ftModel = document.getElementById('pt-ft-model')?.value;
  try {
    const fd = new FormData();
    fd.append('file', f);
    const model = document.getElementById('pt-model')?.value || 'gpt-4o';
    fd.append('model', model);
    // v804 完了 と 同時 に 公開 ON
    if (document.getElementById('pt-auto-share')?.checked) fd.append('auto_share', '1');
    const resp = await fetch('/api/ai/paper_translate', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    // v797 同 PDF + 同 モデル の 既存 row を 流用 した 場合 は 別 メッセージ
    if (j.deduped) toast('🔁 同じ PDF の 要約 が 既に あった の で 流用 しま した (課金 なし)');
    else            toast('要約 開始 (' + (j.model || model) + ')');

    // v796 #398 全訳 も 同時 開始 する なら ここ で 2 本目 を 投げる (同じ PDF を 別 アップロード)
    let ftToken = null;
    if (alsoFull && ftDir && ftModel) {
      try {
        const fd2 = new FormData();
        fd2.append('file', f);
        fd2.append('direction', ftDir);
        fd2.append('model', ftModel);
        const r2 = await fetch('/api/ai/paper_full_translate', {
          method: 'POST', body: fd2, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
        });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(j2?.error?.message || j2?.error || ('HTTP ' + r2.status));
        ftToken = j2.share_token;
        // v797 全訳 側 も dedup 流用 した か どうか で メッセージ を 分ける
        if (j2.deduped) toast('🔁 全訳 も 既存 row を 流用 (課金 なし)');
        else             toast('全訳 も 開始 (' + (j2.model || ftModel) + ')');
      } catch (e2) {
        toast('全訳 開始 失敗: ' + e2.message + ' (要約 は 走って ます)');
      }
    }

    // v796 #397 await が 解決 した 時点 で ユーザ が paper-summary から 離れて いた ら 移動 しない
    if (location.hash === startedHash || location.hash.startsWith('#/paper-summary')) {
      location.hash = '#/paper-summary/r/' + j.share_token;
      // 全訳 も 同時 開始 した なら 履歴 で 確認 できる よう に トースト で 案内
      if (ftToken) toast('全訳 は /#/paper-translate-full/r/' + ftToken + ' で 進捗 確認');
    } else {
      toast('裏 で 処理 中。 通知 が 届いたら 結果 ページ を 開いて ください');
    }
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false; btn.textContent = oldText;
  }
}

async function loadHistory() {
  try {
    const url = '/api/ai/paper_translate' + (viewState.mineSort === 'stars' ? '?sort=stars' : '');
    const d = await get(url);
    updateModelInfo(d);
    let items = d.items || [];
    if (viewState.mineOnly_mine) items = items.filter(r => r.my_starred);

    // 履歴が空 (初回) なら form を 開く、 ある なら 閉じる
    setFormOpen('pt-form', (d.items || []).length === 0);

    const ctlRoot = document.getElementById('pt-controls');
    if (ctlRoot) {
      ctlRoot.innerHTML = viewControlsHtml({ id: 'pt-mine-vc', sort: viewState.mineSort, mineOnly: viewState.mineOnly_mine, total: items.length });
      bindViewControls(ctlRoot, ({ mineOnly, sort }) => { viewState.mineOnly_mine = mineOnly; viewState.mineSort = sort; loadHistory(); });
    }

    const root = document.getElementById('pt-history');
    if (!items.length) {
      root.innerHTML = `<div class="empty">${viewState.mineOnly_mine ? 'スター付きの要約はまだありません' : 'まだ要約履歴がありません'}</div>`;
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">${items.map(it => {
      const title = it.title_ja || it.title_orig || it.pdf_name || '(無題)';
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      const showOrig = it.title_orig && it.title_orig !== title;
      const summary = it.summary_one_paragraph || '';
      const statusIcon = it.status === 'done' ? '📑' : it.status === 'error' ? '❌' : '⏳';
      return `
        <a class="ai-tile" href="#/paper-summary/r/${escapeHtml(it.share_token)}">
          <div class="ai-tile-head">
            <span>${statusIcon}</span>
            ${it.is_shared ? '<span style="color:#15803d">🌐</span>' : ''}
            <span style="margin-left:auto; font-size:11px">${escapeHtml(it.status || '')}</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(title)}</div>
          ${showOrig ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.title_orig)}</div>` : ''}
          ${meta ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>` : ''}
          ${summary ? `<div class="ai-tile-snippet">${escapeHtml(summary)}</div>` : ''}
          <div class="ai-tile-foot">
            <span>${escapeHtml(it.created_at || '')}</span>
            <span style="margin-left:auto">
              ${starButtonHtml({ kind: 'paper_translate', refId: it.id, count: it.star_count, mine: it.my_starred, users: it.star_users })}
              ${bookmarkButtonHtml({ kind: 'paper_translate', refId: it.id, count: it.bookmark_count, mine: it.my_bookmarked })}
            </span>
            <button class="ghost" data-pt-del="${it.id}" title="削除" style="font-size:12px; padding:2px 6px; margin-left:2px"
              onclick="event.preventDefault(); event.stopPropagation();">🗑</button>
          </div>
        </a>`;
    }).join('')}</div>`;
    bindStarButtons(root);
    bindBookmarkButtons(root);
    root.querySelectorAll('[data-pt-del]').forEach(b => {
      b.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = b.dataset.ptDel;
        if (!confirm('この要約を履歴から削除しますか? (PDF やページ画像も一緒に削除)')) return;
        try {
          await del('/api/ai/paper_translate/' + id);
          toast('削除しました');
          await loadHistory();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('pt-history').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v756 #372 みんなの公開要約一覧 (q= で検索)
async function loadSharedList(q) {
  const root = document.getElementById('pt-history');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  viewState.lastQuery = q;
  try {
    const params = [];
    if (q) params.push('q=' + encodeURIComponent(q));
    if (viewState.pubSort === 'stars') params.push('sort=stars');
    const url = '/api/ai/paper_translate/shared' + (params.length ? '?' + params.join('&') : '');
    const d = await get(url);
    let items = d.items || [];
    if (viewState.mineOnly_pub) items = items.filter(r => r.my_starred);

    const ctlRoot = document.getElementById('pt-controls');
    if (ctlRoot) {
      ctlRoot.innerHTML = viewControlsHtml({ id: 'pt-pub-vc', sort: viewState.pubSort, mineOnly: viewState.mineOnly_pub, total: items.length });
      bindViewControls(ctlRoot, ({ mineOnly, sort }) => { viewState.mineOnly_pub = mineOnly; viewState.pubSort = sort; loadSharedList(viewState.lastQuery); });
    }

    if (!items.length) {
      root.innerHTML = viewState.mineOnly_pub
        ? '<div class="empty">スター付きの公開要約はありません</div>'
        : (q ? `<div class="empty">「${escapeHtml(q)}」 に該当する公開要約がありません</div>`
             : '<div class="empty">まだ公開されている要約はありません</div>');
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">${items.map(it => {
      const title = it.title_ja || it.pdf_name;
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      const summary = it.summary_one_paragraph || '';
      return `
        <a class="ai-tile" href="#/paper-summary/r/${escapeHtml(it.share_token)}">
          <div class="ai-tile-head">
            ${avatarHtml(it.author_name, it.author_avatar, 'xs')}
            <span style="font-size:11px">${escapeHtml(it.author_name || '')}</span>
            <span style="margin-left:auto; font-size:11px">📑 要約</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(title)}</div>
          ${meta ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>` : ''}
          ${summary ? `<div class="ai-tile-snippet">${escapeHtml(summary)}</div>` : ''}
          <div class="ai-tile-foot">
            <span>${escapeHtml(it.shared_at || it.created_at || '')}</span>
            <span style="margin-left:auto">
              ${starButtonHtml({ kind: 'paper_translate', refId: it.id, count: it.star_count, mine: it.my_starred, users: it.star_users })}
              ${bookmarkButtonHtml({ kind: 'paper_translate', refId: it.id, count: it.bookmark_count, mine: it.my_bookmarked })}
            </span>
          </div>
        </a>`;
    }).join('')}</div>`;
    bindStarButtons(root);
    bindBookmarkButtons(root);
  } catch (e) {
    root.innerHTML = stripJaSpaces(`<div class="muted">${escapeHtml(e.message)}</div>`);
  }
}

// /#/paper-summary/r/:token  個別 結果ページ。
export async function renderPaperTranslateShared() {
  const token = decodeURIComponent(location.hash.split('/').pop() || '');
  const app = document.getElementById('app');
  if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
  await refreshShared(token, app);
}

async function refreshShared(token, app) {
  if (!app) app = document.getElementById('app');
  // v798 ユーザ が 既に 別 ページ に 移って いる なら 何 も 触らず、 タイマー を 自殺 させる
  //   (= 10 秒 ごと の 「要約 中… 」 表示 で 強制 引き 戻し に なる の を 防ぐ)。
  if (!location.hash.includes('/paper-summary/r/' + token)
   && !location.hash.includes('/paper-translate/r/' + token)) {
    if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
    return;
  }
  try {
    const d = await get('/api/ai/paper_translate/r/' + encodeURIComponent(token));
    // v798 fetch 中 に ユーザ が 移動 した 可能性 を もう 一度 確認
    if (!location.hash.includes('/paper-summary/r/' + token)
     && !location.hash.includes('/paper-translate/r/' + token)) {
      if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
      return;
    }
    if (d.status === 'pending' || d.status === 'processing') {
      // v810 30 分 以上 処理 中 = 詰まって る 可能性 (PHP プロセス が タイム アウト で 死んだ)。
      //   本人 に は 「再 投入」 ボタン を 出す。
      const myUid = Number(state.me?.id) || 0;
      const isOwner = myUid && myUid === Number(d.author_id);
      const ageMin = d.created_at ? Math.round((Date.now() - new Date(String(d.created_at).replace(' ', 'T') + '+09:00').getTime()) / 60000) : 0;
      const isStale = ageMin >= 30;
      const staleBanner = (isStale && isOwner && d.pdf_path) ? `
        <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
          <div class="bold" style="color:#9a3412">⏳ もう ${ageMin} 分 処理 中。 サーバ プロセス が 途中 で 死んだ 可能性 が あります。</div>
          <p class="hint" style="font-size:12.5px; margin:6px 0 8px">同 PDF で 再 投入 し ます (新規 課金 なし)。</p>
          <button id="pt-retry-stale" class="primary">🔁 再 投入 (新規 課金 なし)</button>
        </div>` : '';
      app.innerHTML = stripJaSpaces(`
        <div class="card page-header">
          <h2 style="margin:0">⏳ 要約中… 「${escapeHtml(d.pdf_name)}」</h2>
          <div class="meta">${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}</div>
        </div>
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">🤖 OpenAI が 要約中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            通常 1-4 分 で 完了 します。 このページ を 閉じて も 大丈夫 です (完了 通知 が 届きます)。<br>
            10 秒 ごと に 自動更新。
          </p>
        </div>
        ${staleBanner}
      `);
      document.getElementById('pt-retry-stale')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再 投入 中…';
        try {
          await post('/api/ai/paper_translate/' + d.id + '/retry', {});
          toast('再 投入 を 開始 しました');
          refreshShared(token, app);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再 投入 (新規 課金 なし)'; }
      });
      if (!sharedPollTimer) sharedPollTimer = setInterval(() => refreshShared(token, app), 10000);
      return;
    }
    if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
    if (d.status === 'error') {
      const myUid = Number(state.me?.id) || 0;
      const isOwner = myUid && myUid === Number(d.author_id);
      app.innerHTML = stripJaSpaces(`
        <div class="card">
          <div class="muted">❌ 要約失敗: ${escapeHtml(d.error_msg || '不明なエラー')}</div>
          ${isOwner && d.pdf_path ? `<div style="margin-top:10px"><button id="pt-retry" class="primary">🔁 再 実施 (新規 課金 なし)</button></div>` : ''}
        </div>`);
      document.getElementById('pt-retry')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再 投入 中…';
        try {
          await post('/api/ai/paper_translate/' + d.id + '/retry', {});
          toast('再 投入 を 開始 しました');
          refreshShared(token, app);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再 実施 (新規 課金 なし)'; }
      });
      return;
    }
    paintResult(d, token);
  } catch (e) {
    // v798 エラー 時 も 滞在 確認 して から 表示
    if (location.hash.includes('/paper-summary/r/' + token) || location.hash.includes('/paper-translate/r/' + token)) {
      app.innerHTML = stripJaSpaces(`<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`);
    }
  }
}

async function paintResult(d, token) {
  // v762 #381 既存 result_json の 日本語 中 の 不要 な 半角 スペース を 取り除いて から 描画
  const r = stripJaSpacesDeep(d.result || {});
  const app = document.getElementById('app');
  const shareUrl = location.origin + '/#/paper-summary/r/' + token;
  const pagesDir = d.pages_dir || null;
  const pagesCount = d.pages_count || 0;
  const meId = Number(state.me?.id) || 0;
  const isOwner = meId && meId === Number(d.author_id);
  const isShared = !!d.is_shared;
  app.innerHTML = stripJaSpaces(`
    <div class="card page-header">
      <h2 style="margin:0; font-size:18px">📑 ${escapeHtml(r.title_ja || d.pdf_name)}</h2>
      ${r.title_orig ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(r.title_orig)}</div>` : ''}
      ${r.authors ? `<div class="meta" style="font-size:13px; margin-top:2px">👥 ${escapeHtml(r.authors)}</div>` : ''}
      ${r.venue ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(r.venue)}</div>` : ''}
      <div class="meta" style="font-size:11px; margin-top:6px">
        ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}
      </div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" id="pt-share-dialog" style="font-size:12px; padding:3px 10px">📤 共有</button>
        <button class="btn" id="pt-copy" style="font-size:12px; padding:3px 10px">🔗 共有 URL を コピー</button>
        ${d.pdf_path ? `<a class="btn" href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📄 元の PDF を 開く</a>` : ''}
        ${isOwner ? `
          <button class="btn ${isShared ? 'primary' : ''}" id="pt-share-toggle" data-on="${isShared ? 1 : 0}" style="font-size:12px; padding:3px 10px">
            ${isShared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)'}
          </button>` : ''}
        ${isOwner && d.pdf_path ? `<button class="btn" id="pt-redo" title="保存された PDF で同じモデルで再処理 (再課金)" style="font-size:12px; padding:3px 10px">🔁 やりなおす (${escapeHtml(d.model || 'gpt-4o')})</button>` : ''}
        ${isShared && !isOwner ? '<span class="tag ok" style="font-size:11px">🌐 公開要約</span>' : ''}
        <a class="btn" href="#/paper-summary" style="font-size:12px; padding:3px 10px">← 一覧へ</a>
      </div>
      ${renderPaperCrossRefsAndCreate(d)}
    </div>

    ${r.summary_one_paragraph ? `
    <div class="card" style="background:linear-gradient(135deg,#ede4f3,#fafaf5); border-left:4px solid var(--primary)">
      <div class="bold" style="color:var(--primary); margin-bottom:6px">📌 まず全体要約</div>
      <div style="font-size:14px; line-height:1.7; white-space:pre-wrap">${escapeHtml(r.summary_one_paragraph)}</div>
    </div>` : ''}

    ${renderRqHypothesis(r.rq_hypothesis)}

    ${renderListSection('🎯 主張する貢献', r.contributions)}

    ${renderDetailedSections(r.detailed_sections, pagesDir, pagesCount)}

    ${renderExperimentsBlock(r.experiments, r.results_summary)}

    ${renderListSection('🚀 今後の課題', r.future_work)}

    ${renderKeyReferences(r.key_references)}

    ${renderOchiai(r.ochiai_method || r.ochiai)}

    <div id="pt-interactions-slot"></div>
  `);
  // v789 #389 いいね・ブックマーク・コメント
  if (d.id) {
    try {
      const mod = await import('../paper_interactions.js');
      const slot = document.getElementById('pt-interactions-slot');
      if (slot) {
        slot.innerHTML = mod.renderInteractionsCard({ apiBase: '/api/ai/paper_translate', refId: d.id, reactions: d.reactions });
        mod.mountInteractionsCard({ apiBase: '/api/ai/paper_translate', refId: d.id });
      }
    } catch (_) { /* fall through */ }
  }
  document.getElementById('pt-share-dialog')?.addEventListener('click', () => {
    shareDialog('📑 論文要約: ' + (r.title_ja || d.pdf_name), '#/paper-summary/r/' + d.share_token);
  });
  document.getElementById('pt-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('コピーしました');
    } catch (_) { toast(shareUrl); }
  });
  // v813 #405 ペア の 全訳 を 作る ボタン
  bindMakeFullTranslate(d);
  // v758 #377 やりなおす (本人 のみ、 保存 PDF で 再 処理 + 再課金)
  document.getElementById('pt-redo')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!confirm('保存 された PDF で 同じ モデル で 再 処理 します (再 課金 されます)。 続行 しますか?')) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '🔁 開始中…';
    try {
      const r = await post('/api/ai/paper_translate/' + d.id + '/redo', {});
      toast('再 処理 を 開始 しました (' + (r.model || '') + ')');
      // status=pending に なった ので polling 状態 を 表示 し直す
      await refreshShared(token, document.getElementById('app'));
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = old; }
  });
  // v756 #372 公開 ON/OFF toggle (本人 のみ)
  document.getElementById('pt-share-toggle')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const wasOn = btn.dataset.on === '1';
    btn.disabled = true;
    try {
      const r = await patch('/api/ai/paper_translate/' + d.id, { is_shared: !wasOn });
      btn.dataset.on = r.is_shared ? '1' : '0';
      btn.classList.toggle('primary', !!r.is_shared);
      btn.textContent = r.is_shared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)';
      toast(r.is_shared ? '🌐 公開しました' : '🔒 非公開にしました');
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; }
  });
  // 画像 タップ で lightbox (戻る ボタン で 閉じる)
  document.querySelectorAll('[data-pt-zoom]').forEach(el => {
    el.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const { openImageLightbox } = await import('../lightbox.js');
      openImageLightbox(el.dataset.ptZoom);
    });
  });
}

// v813 #406 cross_refs を 「📑 全訳 へ」 ボタン に 簡素化 + #405 ペア が 無い 場合 は
//   「📑 全訳 を 作る」 ボタン を 出す (本人 + PDF 保存 済 + status=done な とき)。
function renderPaperCrossRefsAndCreate(d) {
  const refs = Array.isArray(d.cross_refs) ? d.cross_refs : [];
  const myUid = Number(state.me?.id || 0);
  const isOwner = !!d.author_id && Number(d.author_id) === myUid;
  const hasFull = refs.some(x => x.kind === 'paper_full_translation');
  const canCreate = isOwner && d.status === 'done' && !!d.pdf_path && !hasFull;
  if (!refs.length && !canCreate) return '';
  const refBtns = refs.map(x => `
    <a class="btn" href="#/${escapeHtml(x.url_slug)}/r/${escapeHtml(x.share_token)}" style="font-size:12px; padding:3px 10px; margin-right:6px">
      ${x.kind === 'paper_full_translation' ? '📑 全訳 へ' : '📄 要約 へ'}
    </a>`).join('');
  const createBtn = canCreate ? `
    <button class="btn primary" id="pt-make-full" style="font-size:12px; padding:3px 10px">📑 全訳 を 作る</button>` : '';
  return `
    <div style="margin-top:8px; padding:6px 10px; background:#f0f9ff; border-left:3px solid #0284c7; border-radius:0 6px 6px 0; display:flex; gap:6px; align-items:center; flex-wrap:wrap">
      ${refBtns}${createBtn}
    </div>`;
}

// 「📑 全訳 を 作る」 ボタン の クリック ハンドラ。 paintResult 後 に bind。
async function bindMakeFullTranslate(d) {
  const btn = document.getElementById('pt-make-full');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const { openModal } = await import('../modal.js');
  btn.addEventListener('click', async () => {
    const html = `
      <p style="font-size:13px; margin:0 0 8px">この PDF で 論文 全訳 を 開始 します。 課金 は ポイント 残高 から (中村 PI は 無料)。</p>
      <label class="field"><span class="lbl">方向</span>
        <select id="mft-dir" style="font-size:13px">
          <option value="en2ja" selected>英 → 日 (en2ja)</option>
          <option value="ja2en">日 → 英 (ja2en)</option>
        </select>
      </label>
      <label class="field"><span class="lbl">モデル</span>
        <select id="mft-model" style="font-size:13px">
          <option value="gpt-5-mini">gpt-5-mini (30pt / ja2en 150pt)</option>
          <option value="gpt-5" selected>gpt-5 (50pt / ja2en 250pt)</option>
          <option value="o1">o1 (80pt / ja2en 400pt)</option>
        </select>
      </label>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px">
        <input type="checkbox" id="mft-auto-share"> 🌐 完了 と 同時 に 公開 ON
      </label>`;
    openModal({
      title: '📑 全訳 を 作る',
      bodyHtml: html,
      buttons: [
        { label: 'キャンセル', onClick: (close) => close() },
        { label: '開始', primary: true, onClick: async (close) => {
          const direction = document.getElementById('mft-dir')?.value || 'en2ja';
          const model     = document.getElementById('mft-model')?.value || 'gpt-5';
          const auto_share = !!document.getElementById('mft-auto-share')?.checked;
          try {
            const j = await post(`/api/ai/paper_full_translate/from_summary/${d.id}`, { direction, model, auto_share });
            close();
            toast('📑 全訳 を 開始 しました');
            if (j?.share_token) location.hash = '#/paper-translate-full/r/' + encodeURIComponent(j.share_token);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        }},
      ],
    });
  });
}

// v759 #378 pdftoppm は 総ページ数 の 桁 に 合わせて 0 パディング する。
//   例: 32 ページ なら page-01.jpg / page-02.jpg ... 100 ページ なら page-001.jpg。
//   pagesCount を 使って 桁数 を 求めて 同じ パディング を 入れる。
function pageImgUrl(pagesDir, page, pagesCount) {
  if (!pagesDir) return null;
  const digits = Math.max(1, String(Number(pagesCount) || page || 1).length);
  const padded = String(page).padStart(digits, '0');
  return pagesDir + '/page-' + padded + '.jpg';
}

function renderDetailedSections(sections, pagesDir, pagesCount) {
  if (!Array.isArray(sections) || !sections.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px; font-size:15px">📖 詳細要約</div>
      ${sections.map(s => {
        const heading = (s && s.heading) ? String(s.heading) : '';
        const body = (s && s.body) ? String(s.body) : '';
        const figs = Array.isArray(s?.figure_refs) ? s.figure_refs : [];
        return `
          <div style="margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #e5e7eb">
            <div class="bold" style="font-size:14px; color:#4a106d; margin-bottom:6px">▍ ${escapeHtml(heading)}</div>
            <div style="font-size:14px; line-height:1.8; white-space:pre-wrap; margin-bottom:8px">${escapeHtml(body)}</div>
            ${figs.length ? `
              <div style="display:flex; flex-direction:column; gap:8px">
                ${figs.map(fig => renderFigure(fig, pagesDir, pagesCount)).join('')}
              </div>` : ''}
          </div>
        `;
      }).join('')}
    </div>`;
}

function renderFigure(fig, pagesDir, pagesCount) {
  const label = (fig && fig.label) ? String(fig.label) : '';
  const cap = (fig && fig.caption_ja) ? String(fig.caption_ja) : '';
  const visual = (fig && fig.visual_content) ? String(fig.visual_content) : '';
  const why = (fig && fig.why_important) ? String(fig.why_important) : '';
  const page = Number(fig?.page) || null;
  const region = (fig && fig.page_region) ? String(fig.page_region).toLowerCase() : 'full';
  const inRange = page && pagesCount && page >= 1 && page <= pagesCount;
  const imgUrl = (inRange && pagesDir) ? pageImgUrl(pagesDir, page, pagesCount) : null;
  // v767 #385 crop は GPT region の 精度 が 安定 しない ので 廃止。 全 ページ を そのまま
  //   サムネ 表示 + click で lightbox。 region は label の 補足 表示 に だけ 使う。
  const wrap = 220;       // box 幅 (ページ 全体 を 含める)
  const regionLabel = region === 'top' ? '(上部)' : region === 'middle' ? '(中央)' : region === 'bottom' ? '(下部)' : '';
  return `
    <div style="display:flex; gap:10px; padding:8px 10px; background:#fafafa; border-left:3px solid var(--primary); border-radius:0 6px 6px 0; align-items:flex-start">
      ${imgUrl ? `
        <a href="#" data-pt-zoom="${escapeHtml(imgUrl)}" style="flex:none; display:block; cursor:zoom-in">
          <img src="${escapeHtml(imgUrl)}" loading="lazy" style="width:${wrap}px; height:auto; max-height:340px; object-fit:contain; background:#fff; border:1px solid #ddd; border-radius:4px; display:block">
          <div class="hint-sm" style="font-size:9px; text-align:center; margin-top:2px; color:#9ca3af">タップで拡大</div>
        </a>` : ''}
      <div style="flex:1; min-width:0; font-size:13px">
        <div class="bold" style="color:#4a106d">${escapeHtml(label)}${page ? ` <span style="font-weight:normal; color:#666">(p.${page}${regionLabel})</span>` : ''}</div>
        ${cap ? `<div style="margin-top:3px"><b>キャプション:</b> ${escapeHtml(cap)}</div>` : ''}
        ${visual ? `<div style="margin-top:3px"><b>👁 視覚要素:</b> ${escapeHtml(visual)}</div>` : ''}
        ${why ? `<div style="margin-top:3px"><b>なぜ重要:</b> ${escapeHtml(why)}</div>` : ''}
      </div>
    </div>`;
}

function renderOchiai(o) {
  if (!o || typeof o !== 'object') return '';
  const sections = [
    ['what',          '1. どんな もの?',                '🧩'],
    ['vs_prior_work', '2. 先行研究 と 比べて すごい点',  '🆚'],
    ['key_method',    '3. 技術 / 手法 の キモ',         '🔧'],
    ['validation',    '4. どう 検証 した?',              '✅'],
    ['discussion',    '5. 議論 は ある?',                '💬'],
  ];
  let html = '<div class="card" style="background:#fafaf5; border:1px dashed #d4b8e0"><div class="bold" style="color:var(--primary); margin-bottom:6px; font-size:15px">📚 落合メソッドでまとめ</div><div class="hint-sm" style="font-size:11px; margin-bottom:8px">論文全体を6項目で重ね合わせ</div>';
  for (const [key, label, icon] of sections) {
    let txt = (o[key] || '').toString().trim();
    if (!txt) continue;
    // v756 #374 GPT が 値 の 先頭 に 「1. どんなもの?」 等 の 設問 を 繰り返して 入れる ことが
    //   ある ので、 先頭 が ラベル と 同じ 設問 で 始まる 場合 は 取り除く (重複表示 防止)。
    txt = txt.replace(/^\s*\d+\.\s*[^\n]{0,40}[?？]\s*/, '').trim();
    html += `
      <div style="margin-bottom:10px">
        <div class="bold" style="font-size:13px; color:#4a106d">${icon} ${escapeHtml(label)}</div>
        <div style="font-size:14px; line-height:1.7; padding:6px 10px; background:#fafafa; border-radius:6px; white-space:pre-wrap; margin-top:4px">${escapeHtml(txt)}</div>
      </div>`;
  }
  const next = Array.isArray(o.next_papers) ? o.next_papers : [];
  if (next.length) {
    html += `
      <div style="margin-bottom:6px">
        <div class="bold" style="font-size:13px; color:#4a106d">🔖 6. 次に 読む べき 論文</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px; line-height:1.7">
          ${next.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>`;
  }
  html += '</div>';
  return html;
}

// v753 RQ と 仮説 + それぞれ の 結果 を ペア 表示。 旧 schema (文字列 配列) も fallback 表示。
// v764 #382 1 個 だけ の とき は「RQ1」 → 「RQ」、「H1」 → 「H」 に 自動変換。
function normalizeQLabel(s, prefix, isSingle) {
  // prefix 例: "RQ" / "H"。 GPT が「RQ1: ...」「RQ：…」 や 単に「1. …」 で 来る場合 を 正規化。
  if (typeof s !== 'string') return s;
  let txt = s.trim();
  // 数字 + コロン or 数字 + ピリオド の 接頭辞 を 検出 + 取り除く
  const m = txt.match(new RegExp(`^${prefix}(\\d+)?\\s*[:：.]?\\s*(.*)$`, 'i')) || txt.match(/^(\d+)\s*[:：.]?\s*(.*)$/);
  let body = txt;
  if (m) {
    body = (m[2] !== undefined ? m[2] : m[1]) || txt;
    body = body.trim() || txt;
  }
  return (isSingle ? prefix : (m && m[1] ? `${prefix}${m[1]}` : prefix)) + ': ' + body;
}

function renderRqHypothesis(rh) {
  if (!rh || typeof rh !== 'object') return '';
  const rqs = Array.isArray(rh.research_questions) ? rh.research_questions : [];
  const hys = Array.isArray(rh.hypotheses)         ? rh.hypotheses         : [];
  if (!rqs.length && !hys.length) return '';
  const rqSingle = rqs.length === 1;
  const hySingle = hys.length === 1;
  // v768 #387 「💡 示唆:」 ラベル は 廃止 (GPT が 値 の 先頭 にも「示唆:」 を 書く 場合 が あり
  //   「💡 示唆: 示唆: …」 に なって しまう ため)。 値 の 先頭 の 「示唆:」「結果:」 等 も strip。
  const stripPrefix = (s) => String(s || '').replace(/^\s*(示唆|結果|答え)\s*[:：]\s*/u, '').trim();
  const rqHtml = rqs.map((item) => {
    const raw = typeof item === 'string' ? item : (item?.rq || '');
    const label = normalizeQLabel(raw, 'RQ', rqSingle);
    const ans = (typeof item === 'object' && item?.answer) ? stripPrefix(item.answer) : '';
    return `<div style="padding:8px 12px; background:#eef2ff; border-left:3px solid #4f46e5; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#4f46e5">❓ ${escapeHtml(label)}</div>
      ${ans ? `<div style="font-size:13px; margin-top:4px">${escapeHtml(ans)}</div>` : ''}
    </div>`;
  }).join('');
  const hyHtml = hys.map((item) => {
    const raw = typeof item === 'string' ? item : (item?.hypothesis || '');
    const label = normalizeQLabel(raw, 'H', hySingle);
    const res = (typeof item === 'object' && item?.result) ? stripPrefix(item.result) : '';
    return `<div style="padding:8px 12px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#a16207">💡 ${escapeHtml(label)}</div>
      ${res ? `<div style="font-size:13px; margin-top:4px">${escapeHtml(res)}</div>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px">🔬 RQ / 仮説と示唆</div>
      ${rqHtml}
      ${hyHtml}
    </div>`;
}

// v772 #392 実験 と 結果 を 研究名 (例: "Kirmani & Wright 1989") で 自動 ペアリング 表示。
//   experiments と results_summary の 各 文 から 「Author Year」 を 抽出 → 同じ key で 紐付け。
function studyKey(s) {
  const str = String(s).replace(/^\s*\(?\s*引用\s*\)?[\s)]*/, '');
  // 西暦 (1900-2099) を 探して、 先頭 から 西暦 + 直後 の 閉じ括弧 まで を 研究名 と みなす。
  //   著者名 に 「Smith, A. (1989)」 等 の パターン が ある ので 括弧 内 の 年 も 含める。
  const m = str.match(/(?:19|20)\d{2}/);
  if (!m) return null;
  let end = m.index + m[0].length;
  if (str[end] === ')' || str[end] === '）') end++;
  return str.substring(0, end).replace(/\s+/g, ' ').trim();
}
function stripStudyKey(s, key) {
  let str = String(s).replace(/^\s*\(?\s*引用\s*\)?[\s)]*/, '');
  if (key) {
    const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    str = str.replace(new RegExp('^' + escaped + '\\s*'), '');
  }
  // 残った 「)」「の実験:」「の結果:」「:」 等 の 接続 文字 を 除去
  str = str.replace(/^[)）]+\s*/, '').replace(/^の?(実験|研究|結果)[\s:：]*/, '').replace(/^[:：]\s*/, '').trim();
  return str;
}
// v778 #402 自前実験 を「実験N」 単位 で ペア リング する 用 の キー 抽出。
//   「研究1：...」「実験1: ...」「Study 1: ...」「Experiment 1 - ...」 等 を 全部 「実験1」 に 正規化。
// v779 #403 結果側 は 「実験1 (引用 X):」 の よう に「実験1 + 空白 + (引用 X)」 形 が 多い ため、
//   「実験1」 の 後 が 「:」 で なくて も 数字 で 終わって いれば キー と 認める (look-ahead で 非数字)。
function ownExpKey(s) {
  const str = String(s).trim();
  const norm = str.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const m = norm.match(/^(?:研究|実験|Study|Experiment|Exp\.?)\s*(\d+)(?=\D|$)/i);
  if (!m) return null;
  return '実験' + m[1];
}
function stripOwnExpKey(s) {
  // 先頭 の 「研究1：」「実験1:」「Study 1 -」「実験1 (引用 X):」 等 を 取り除いて 本文 だけ 返す。
  // 数字 の 後 に 「:」 が ある なら そこまで、 なければ 数字 + 直後 の 空白 を 取る。
  return String(s).replace(/^(?:研究|実験|Study|Experiment|Exp\.?)\s*[0-9０-９]+\s*[:：・\-]?\s*/i, '').trim();
}
// v779 #403 「(引用)」「(引用 X)」「(引用 X 19xx)」 が 本文 中 に 含まれて いる か。 全 要素 が
//   引用 なら 「参考 に した 実験」 ラベル に 切り替える。
function isCitedItem(s) {
  return /\(\s*引用/.test(String(s));
}
function renderExperimentsBlock(expsRaw, resRaw) {
  const exps = Array.isArray(expsRaw) ? expsRaw : [];
  const ress = Array.isArray(resRaw)  ? resRaw  : [];
  const isCited = s => /^\s*\(?\s*引用/.test(String(s));
  const own = { exps: [], ress: [] };
  const cited = new Map();  // key → { exp, res }
  const addCited = (k, kind, item) => {
    if (!cited.has(k)) cited.set(k, { key: k, exp: '', res: '' });
    cited.get(k)[kind] = item;
  };
  for (const e of exps) {
    if (!isCited(e)) { own.exps.push(e); continue; }
    const k = studyKey(e); if (k) addCited(k, 'exp', e); else own.exps.push(e);
  }
  for (const rs of ress) {
    if (!isCited(rs)) { own.ress.push(rs); continue; }
    const k = studyKey(rs); if (k) addCited(k, 'res', rs); else own.ress.push(rs);
  }
  // v778 #402 自前 実験 を 「実験N」 で ペア リング (insertion order を 保つ)
  const ownPairs = new Map();
  const ownUnkeyedExps = [];
  const ownUnkeyedRess = [];
  const addOwnPair = (key, kind, body) => {
    if (!ownPairs.has(key)) ownPairs.set(key, { key, exp: '', res: '' });
    ownPairs.get(key)[kind] = body;
  };
  for (const e of own.exps) {
    const k = ownExpKey(e);
    if (k) addOwnPair(k, 'exp', e); else ownUnkeyedExps.push(e);
  }
  for (const rs of own.ress) {
    const k = ownExpKey(rs);
    if (k) addOwnPair(k, 'res', rs); else ownUnkeyedRess.push(rs);
  }

  // v779 #403 ペア の 中身 を 見て 「引用 比率」 を 判定。 全 ペア (or 全 体) が 引用 なら
  //   「📚 この論文 が 参考 に した 実験」 ラベル に 切り替える。 自前 と 引用 が 混在 する
  //   場合 は デフォルト の 「🔬 この論文 で 行った 実験」 を 使い、 引用 / 自前 を 個別 タグ で 区別。
  const allBodies = [...ownPairs.values()].flatMap(p => [p.exp, p.res].filter(Boolean));
  const citedCount = allBodies.filter(isCitedItem).length;
  const isAllCited = ownPairs.size > 0 && citedCount === allBodies.length;
  const expsHeader = isAllCited ? '📚 この論文が参考にした実験' : '🔬 この論文で行った実験';
  const resHeaderForPair = (p, key) => {
    const cited = isCitedItem(p.exp) || isCitedItem(p.res);
    return cited
      ? `📊 ${escapeHtml(key)} の結果 (引用元からの要約)`
      : `📊 ${escapeHtml(key)} の結果`;
  };
  const pairTitle = (p, key) => {
    const cited = isCitedItem(p.exp) || isCitedItem(p.res);
    return cited
      ? `${escapeHtml(key)}: 参考にした実験の内容`
      : `${escapeHtml(key)}: 実験の内容`;
  };

  let html = '';
  if (ownPairs.size > 0) {
    html += `
      <div class="card">
        <div class="bold" style="color:var(--primary); margin-bottom:10px">${expsHeader}</div>
        <div style="display:flex; flex-direction:column; gap:14px">
          ${[...ownPairs.values()].map(p => {
            const expBody = stripOwnExpKey(p.exp);
            const resBody = stripOwnExpKey(p.res);
            return `
              <div>
                <div style="padding:10px 12px; border:2px solid var(--primary); border-radius:8px; background:#fff">
                  <div class="bold" style="color:var(--primary); margin-bottom:5px">${pairTitle(p, p.key)}</div>
                  ${expBody
                    ? `<div style="font-size:13.5px; line-height:1.75">${escapeHtml(expBody)}</div>`
                    : `<div style="font-size:13px; color:#999">(実験記述なし)</div>`}
                </div>
                ${resBody ? `
                  <div style="margin-top:6px; padding:8px 12px; background:#f5f0fa; border-left:3px solid var(--primary); border-radius:0 6px 6px 0">
                    <div class="bold" style="font-size:13px; color:var(--primary); margin-bottom:3px">${resHeaderForPair(p, p.key)}</div>
                    <div style="font-size:13.5px; line-height:1.75">${escapeHtml(resBody)}</div>
                  </div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
    // 「実験N」 形式 で 拾え なかった 残り は 補足 リスト に
    html += renderListSection('🔬 その他の実験記述', ownUnkeyedExps);
    html += renderListSection('📊 その他の結果記述', ownUnkeyedRess);
  } else {
    // 全部 「実験N」 で 拾え なかった → 従来 の リスト 表示。 配列 全体 が 引用 中心 なら
    //   ヘッダ を 「参考 に した 実験」 に 切り替える。
    const fallbackAllCited = own.exps.length > 0 && own.exps.every(isCitedItem);
    html += renderListSection(
      fallbackAllCited ? '📚 この論文が参考にした実験' : '🔬 この論文で行った実験',
      own.exps
    );
    html += renderListSection(
      fallbackAllCited ? '📊 引用研究の結果' : '📊 この論文の結果',
      own.ress
    );
  }
  if (cited.size > 0) {
    html += `
      <div class="card">
        <div class="bold" style="color:var(--primary); margin-bottom:8px">📚 引用された関連研究 (実験 + 結果)</div>
        <div style="display:flex; flex-direction:column; gap:10px">
          ${[...cited.values()].map(p => {
            const expBody = stripStudyKey(p.exp, p.key);
            const resBody = stripStudyKey(p.res, p.key);
            return `
              <div style="padding:8px 12px; background:#fafafa; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0">
                <div class="bold" style="font-size:13px; color:#6b21a8">${escapeHtml(p.key)}</div>
                ${expBody ? `<div style="margin-top:4px; font-size:13px"><b>🔬 実験:</b> ${escapeHtml(expBody)}</div>` : ''}
                ${resBody ? `<div style="margin-top:3px; font-size:13px"><b>📊 結果:</b> ${escapeHtml(resBody)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  return html;
}

// v757 #375 参考文献 で 特に 重要 な もの。 v759 #378 原題 + 和訳 を 分けて 表示。
function renderKeyReferences(refs) {
  if (!Array.isArray(refs) || !refs.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px">📚 押さえておくべき参考文献</div>
      <div style="display:flex; flex-direction:column; gap:8px">
        ${refs.map(ref => {
          const cit       = ref?.citation       ? String(ref.citation)       : '';
          const titleOrig = ref?.title_orig     ? String(ref.title_orig)     : '';
          const titleJa   = ref?.title_ja       ? String(ref.title_ja)       : (ref?.title || '');
          const why       = ref?.why_important  ? String(ref.why_important)  : '';
          return `
            <div style="padding:8px 10px; background:#fafafa; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0; font-size:13px">
              <div class="bold" style="color:#6b21a8">${escapeHtml(cit)}</div>
              ${titleOrig ? `<div style="margin-top:2px; font-size:13px"><b>原題:</b> ${escapeHtml(titleOrig)}</div>` : ''}
              ${titleJa   ? `<div style="margin-top:2px; font-size:13px; color:#374151"><b>和訳:</b> ${escapeHtml(titleJa)}</div>` : ''}
              ${why ? `<div style="margin-top:3px"><b>なぜ重要:</b> ${escapeHtml(why)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderListSection(title, list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:6px">${title}</div>
      <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8">
        ${list.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
      </ul>
    </div>`;
}

// v750 #366 旧 renderFigures は 詳細サマリ 内 の figure_refs に 統合 された ので 撤去。
