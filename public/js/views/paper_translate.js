// /#/paper-translate — v748 #359-#361 / v750 #365-#367 論文和訳要約。
//   PDF を OpenAI Files API 経由で GPT-4o に直接読ませ、論文構造に沿った詳細サマリ +
//   重要図表 (ページ画像を pdftoppm で抽出表示) + 最後に落合メソッドの 6 項目で
//   全体を重ね合わせてまとめる。結果は share_token で URL 共有可能。

import { get, patch, post, del } from '../api.js';
import { escapeHtml, avatarHtml, resetFsInnerNav } from '../router.js';
import { renderAuthorAvatar, mountAuthorAvatars, initLabUsersCache } from '../author_avatar.js';
import { state, toast, setAiContext } from '../app.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons, viewControlsHtml, bindViewControls, setFormOpen } from '../ui_ai_stars.js';
import { shareDialog } from '../share_to_sns.js';
import { renderAskAiButton } from '../ai_checklist.js';   // v1144

let sharedPollTimer = null;
let viewState = { mineSort: 'new', mineOnly_mine: false, pubSort: 'new', mineOnly_pub: false, lastQuery: '' };

// v762 #381 既存 result_json に入っている日本語中の不要なスペースを取り除く
//   defensive helper。日本語文字 (ひらがな / カタカナ / 漢字) どうしの間の半角スペース
//   を 1 個ずつ削除。英数字 / 記号と日本語の境界スペースは残す。
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
      <!-- v1221 中村さん要望「同時依頼 チェック は 依頼ボタン すぐ下 に、 default ON、
           モデル 額 は チェック 有無 で 切替、 共有 も default ON、 ラベル を 共有チェック に」 -->
      <fieldset class="field" style="border:1px dashed #7b3fa0; border-radius:6px; padding:8px; margin:8px 0; background:#faf5ff">
        <legend style="font-size:12px; color:#4a106d; font-weight:600">📑📑 同時 依頼</legend>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600">
          <input type="checkbox" id="pt-also-full" checked>
          要約 と 全訳 を 同時に 依頼 する (お得!)
        </label>
        <div id="pt-also-full-opts" style="margin-top:6px">
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">全訳 の 翻訳方向</span>
            <select id="pt-ft-direction" style="font-size:12px">
              <option value="en2ja" selected>英語 → 日本語 (E→J)</option>
              <option value="ja2en">日本語 → 英語 (J→E、 5x 料金)</option>
            </select>
          </label>
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">全訳モデル</span>
            <select id="pt-ft-model" style="font-size:12px"></select>
            <div class="hint-sm" id="pt-ft-cost-info" style="font-size:11px; margin-top:2px"></div>
          </label>
        </div>
      </fieldset>
      <p class="hint" style="font-size:13px; margin:8px 0">
        論文 PDF をアップすると、全体要約 → RQ/仮説 + 結果 → 主張する貢献 → 章立て要約 (重要図表 inline) →
        今後の課題 → 落合メソッドまとめという順番で構造化して返します。全体 1500-2500 字 (≒ 3-5 分で読める分量)。
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
      <!-- v916/v1221 共有=半額割引 (default ON) -->
      <div style="background:linear-gradient(135deg, #dcfce7, #bbf7d0); border:2px solid #22c55e; border-radius:10px; padding:14px 16px; margin:8px 0; box-shadow:0 2px 6px rgba(34,197,94,0.15)">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer">
          <input type="checkbox" id="pt-auto-share" checked style="width:20px; height:20px; accent-color:#16a34a; cursor:pointer">
          <span style="font-size:16px; font-weight:700; color:#14532d">🎁 共有チェック ON で半額になります!</span>
        </label>
        <div style="font-size:12px; color:#166534; margin-top:8px; line-height:1.6">
          完了と同時に公開 ON にする (= みんなの検索に載せる)。研究室全体で共有すると誰かの参考になる資産なので、共有なら半額割引。<br>
          あとから公開 ON にすると半額分返金 / 公開 OFF に戻すと半額割引分追加課金されます。
        </div>
      </div>
      ${state.me?.ai_sub_active ? '<div style="background:#d1fae5; color:#065f46; padding:6px 10px; border-radius:6px; font-size:12px; margin:6px 0; text-align:center">🤖 <b>AIサブスク契約中</b> — この機能は無料でご利用いただけます</div>' : ''}
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pt-go" class="primary" disabled>📑 要約を作る${state.me?.ai_sub_active ? ' (無料)' : ''}</button>
      </div>
    </details>
    <div id="pt-result"></div>
    <!-- v756 #372 自分の履歴とみんなの公開一覧をタブで切替 -->
    <div class="card" style="margin-top:8px">
      <div class="row" style="gap:6px; margin-bottom:8px; align-items:center">
        <button id="pt-tab-mine"   class="btn primary" data-tab="mine"   style="font-size:13px">📜 自分の履歴</button>
        <button id="pt-tab-shared" class="btn"         data-tab="shared" style="font-size:13px">🌐 みんなの公開要約</button>
        <span style="flex:1"></span>
        <input type="search" id="pt-search" placeholder="🔍 検索 (公開のみ、タイトル / 著者 / 本文)" maxlength="100" style="font-size:13px; padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; min-width:180px" hidden>
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
      fileStatus.innerHTML = '<span style="color:#dc2626">PDF ファイルを選んでください</span>';
      btn.disabled = true; return;
    }
    if (f.size > 30 * 1024 * 1024) {
      fileStatus.innerHTML = '<span style="color:#dc2626">30 MB を超えています</span>';
      btn.disabled = true; return;
    }
    fileStatus.innerHTML = stripJaSpaces(`<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size / 1024 / 1024).toFixed(1)} MB)</span>`);
    btn.disabled = false;
  });
  btn.addEventListener('click', go);
  // v796 #398 「同時に全訳も」トグル + 全訳モデルロード
  setupAlsoFullTranslate();
  // v756 #372 タブ切替 + 検索
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
  // v957 hash に ?q=<keyword> が付いていたら shared タブに切り替えて検索実行
  //   (詳細ページの著者 / キーワードクリックから飛んで来る用)
  // v1066 fb#486 hash に ?pdfurl=<url> があれば「URL から PDF 取得して要約」 banner を表示
  const qParam = location.hash.includes('?') ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1)) : new URLSearchParams();
  const hashQ = qParam.get('q');
  const hashPdfUrl = qParam.get('pdfurl');
  if (hashPdfUrl) {
    renderPdfUrlBanner(hashPdfUrl, hashQ || '');
  }
  if (hashQ) {
    searchEl.value = hashQ;
    switchTab('shared');
    if (!hashPdfUrl) return;   // pdfurl 併記時は履歴も見せるため fall-through
  }
  await loadHistory();    // history 取得と同時に models / cost をロード
}

// v1066 fb#486 DeepResearch からの「?pdfurl=...」の場合、 result カードの前に
//   「🔗 URL から PDF を取得して新規要約」の banner を出す。押すと fetch → File 化 →
//   既存の paper_translate multipart POST に流し込む。
function renderPdfUrlBanner(pdfUrl, titleQuery) {
  const target = document.getElementById('pt-result');
  if (!target) return;
  target.innerHTML = `
    <div class="card" style="border:2px dashed var(--primary); background:#faf5ff">
      <div class="bold" style="color:var(--primary); font-size:14px; margin-bottom:6px">🔎 DeepResearch からの論文</div>
      <div style="font-size:12.5px; margin-bottom:6px">
        <b>URL:</b> <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener" style="word-break:break-all">${escapeHtml(pdfUrl)}</a>
        ${titleQuery ? `<div style="margin-top:2px"><b>タイトルで既存検索:</b> ${escapeHtml(titleQuery)} — 下の履歴/公開一覧で該当を確認</div>` : ''}
      </div>
      <div class="hint-sm" style="margin-bottom:8px">既存の要約が無ければ、下のボタンで PDF を取得して新規要約を作れます。</div>
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <button id="pt-fromurl-go" class="btn primary" style="font-size:12.5px">🔗 この URL から PDF を取得して要約を作る</button>
        <select id="pt-fromurl-model" style="font-size:12.5px"></select>
        <label style="font-size:12.5px; display:flex; align-items:center; gap:4px"><input type="checkbox" id="pt-fromurl-share" checked> 🎁 共有 ON (半額)</label>
      </div>
      <div id="pt-fromurl-status" style="margin-top:6px; font-size:12.5px"></div>
    </div>`;
  // モデル選択肢を読み込む (config 呼び出し) — 既存の updateModelInfo の結果を待つ
  const setModels = () => {
    const src = document.getElementById('pt-model');
    const dst = document.getElementById('pt-fromurl-model');
    if (src && dst && src.options.length > 0) dst.innerHTML = src.innerHTML;
    else setTimeout(setModels, 300);
  };
  setModels();
  document.getElementById('pt-fromurl-go').addEventListener('click', async () => {
    const btn = document.getElementById('pt-fromurl-go');
    const status = document.getElementById('pt-fromurl-status');
    const model = document.getElementById('pt-fromurl-model').value || 'gpt-5';
    const share = document.getElementById('pt-fromurl-share').checked;
    btn.disabled = true; btn.textContent = '⏳ PDF 取得中…';
    status.innerHTML = '';
    try {
      const resp = await fetch('/api/ai/fetch_pdf', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({ url: pdfUrl }),
      });
      if (!resp.ok) {
        let msg = 'PDF 取得失敗 (HTTP ' + resp.status + ')';
        try { const j = await resp.json(); if (j.error?.message) msg = j.error.message; } catch (_) {}
        throw new Error(msg);
      }
      const blob = await resp.blob();
      status.innerHTML = `<span style="color:#15803d">✓ PDF 取得 (${(blob.size / 1024 / 1024).toFixed(1)} MB) → 要約開始中…</span>`;
      btn.textContent = '⏳ 要約依頼中…';
      const file = new File([blob], 'paper.pdf', {type: 'application/pdf'});
      const fd = new FormData();
      fd.append('file', file);
      fd.append('model', model);
      fd.append('auto_share', share ? '1' : '0');
      const r2 = await fetch('/api/ai/paper_translate', {method: 'POST', body: fd, credentials: 'same-origin'});
      if (!r2.ok) {
        let msg = '要約開始失敗 (HTTP ' + r2.status + ')';
        try { const j = await r2.json(); if (j.error?.message) msg = j.error.message; } catch (_) {}
        throw new Error(msg);
      }
      const j = await r2.json();
      status.innerHTML = `<span style="color:#15803d">✅ 要約依頼受付。結果ページに移動…</span>`;
      setTimeout(() => { location.hash = '#/paper-summary/r/' + j.share_token; }, 500);
    } catch (e) {
      status.innerHTML = `<span style="color:#dc2626">失敗: ${escapeHtml(e.message || String(e))}</span>`;
      btn.disabled = false; btn.textContent = '🔗 この URL から PDF を取得して要約を作る';
    }
  });
}

function updateModelInfo(d) {
  const sel = document.getElementById('pt-model');
  const info = document.getElementById('pt-model-info');
  if (!sel || !info) return;
  const models = d.models || { 'gpt-4o': 20 };
  const def = d.default_model || 'gpt-4o';
  // v916 選択肢に「共有なら Xpt」を明記 (画面で見えるまま比較できるように)
  sel.innerHTML = Object.entries(models).map(([m, pt]) =>
    `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)</option>`
  ).join('');
  const autoShare = document.getElementById('pt-auto-share');
  const refresh = () => {
    const m = sel.value;
    const base = models[m] || 20;
    const shared = !!autoShare?.checked;
    const pt = shared ? Math.floor(base / 2) : base;  // v914 共有は半額割引
    info.innerHTML = `選択中: ${escapeHtml(m)} ・ 1 回 ${pt}pt` +
      (shared ? ` <span style="color:#15803d">(公開 ON、半額割引 = 基本 ${base}pt の半額)</span>`
              : ` <span style="color:#6b7280">(非公開、基本額)</span>`);
    const btn = document.getElementById('pt-go');
    if (btn) btn.textContent = `📑 要約を作る (${pt}pt)`;
  };
  sel.addEventListener('change', refresh);
  autoShare?.addEventListener('change', refresh);
  refresh();
}

// v796 #398 全訳オプションのセットアップ / v1221 default ON なので 初期 load 済ませる + 合計 表示
let ftSettingsCache = null;
// v1232 fb (中村さん) 「最新の依頼で 同時全訳 が 効いていない」→
//  PDF 選択 → 即 送信 で ftSettingsCache が まだ 無く、 modSel.value === '' に なって
//  条件 fail → 全訳 スキップ が root cause。 loadAndBuild の Promise を 外部 (go) から
//  await できる ように 公開 する。
let _ftLoadPromise = null;
async function ensureFtLoaded() {
  if (ftSettingsCache) return true;
  if (!_ftLoadPromise) return false;
  try { await _ftLoadPromise; } catch { /* ignore, checked below */ }
  return !!ftSettingsCache;
}
async function setupAlsoFullTranslate() {
  const toggle = document.getElementById('pt-also-full');
  const opts   = document.getElementById('pt-also-full-opts');
  const dirSel = document.getElementById('pt-ft-direction');
  const modSel = document.getElementById('pt-ft-model');
  const info   = document.getElementById('pt-ft-cost-info');
  if (!toggle) return;
  const loadAndBuild = async () => {
    if (!ftSettingsCache) {
      try { ftSettingsCache = await get('/api/ai/paper_full_translate'); }
      catch (e) { toast('全訳設定読込失敗: ' + e.message); return; }
    }
    rebuildFtModels();
    refreshTopCombinedCost();
  };
  toggle.addEventListener('change', async () => {
    opts.style.display = toggle.checked ? '' : 'none';
    if (toggle.checked) { _ftLoadPromise = loadAndBuild(); await _ftLoadPromise; }
    else refreshTopCombinedCost();
  });
  function rebuildFtModels() {
    if (!ftSettingsCache) return;
    const models = dirSel.value === 'ja2en' ? ftSettingsCache.models_ja2en : ftSettingsCache.models_en2ja;
    const def = ftSettingsCache.default_model || Object.keys(models)[0];
    modSel.innerHTML = Object.entries(models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)</option>`).join('');
    refreshCost();
  }
  function refreshCost() {
    if (!ftSettingsCache) return;
    const models = dirSel.value === 'ja2en' ? ftSettingsCache.models_ja2en : ftSettingsCache.models_en2ja;
    const m = modSel.value;
    const base = models[m] || 0;
    const shared = !!document.getElementById('pt-auto-share')?.checked;
    const pt = shared ? Math.floor(base / 2) : base;
    info.innerHTML = `全訳 ${pt}pt` +
      (shared ? ` <span style="color:#15803d">(公開 ON、半額割引 = 基本 ${base}pt の半額)</span>`
              : ` <span style="color:#6b7280">(非公開、基本額)</span>`);
    refreshTopCombinedCost();
  }
  dirSel.addEventListener('change', rebuildFtModels);
  modSel.addEventListener('change', refreshCost);
  document.getElementById('pt-auto-share')?.addEventListener('change', () => { refreshCost(); refreshTopCombinedCost(); });
  document.getElementById('pt-model')?.addEventListener('change', refreshTopCombinedCost);
  // 初期 (default ON) で 全訳 モデル を 読み込む。 Promise を 保持して go() から await できる ように
  if (toggle.checked) _ftLoadPromise = loadAndBuild();
}

// v1221 モデル 額 は 同時依頼 の チェック 状態 で 「合計」表示 を 切替
// v1222 中村さん指摘「下のボタンも 要約&全訳 を 作る (合計pt) に なるべき」→ pt-go ラベル も 同時 更新
function refreshTopCombinedCost() {
  const info = document.getElementById('pt-model-info');
  const goBtn = document.getElementById('pt-go');
  if (!info) return;
  const sumSel = document.getElementById('pt-model');
  const sumBase = _sumModelBaseCost(sumSel?.value);
  if (sumBase === null) return;
  const shared = !!document.getElementById('pt-auto-share')?.checked;
  const sumPt = shared ? Math.floor(sumBase / 2) : sumBase;
  const alsoFull = !!document.getElementById('pt-also-full')?.checked;
  let ftBase = 0;
  if (alsoFull && ftSettingsCache) {
    const dir = document.getElementById('pt-ft-direction')?.value || 'en2ja';
    const models = dir === 'ja2en' ? ftSettingsCache.models_ja2en : ftSettingsCache.models_en2ja;
    ftBase = models[document.getElementById('pt-ft-model')?.value] || 0;
  }
  const ftPt = shared ? Math.floor(ftBase / 2) : ftBase;
  if (alsoFull && ftBase > 0) {
    info.innerHTML = `要約 ${sumPt}pt + 全訳 ${ftPt}pt = <b style="color:#4a106d">合計 ${sumPt + ftPt}pt</b>` +
      (shared ? ` <span style="color:#15803d">(共有 ON、 半額)</span>` : '');
    if (goBtn) goBtn.textContent = `📑 要約 ＆ 全訳 を 作る (${sumPt + ftPt}pt)`;
  } else {
    info.innerHTML = `要約 ${sumPt}pt` +
      (shared ? ` <span style="color:#15803d">(共有 ON、 半額)</span>` : ' <span style="color:#6b7280">(基本額)</span>');
    if (goBtn) goBtn.textContent = `📑 要約 を 作る (${sumPt}pt)`;
  }
}
// 要約 モデル の 基本額 は loadHistory で option に 埋め込まれる。 select 側 の 値 だけ から は 引けない ので
// select の 現在 option の text から 「NN pt」を 抽出 する 簡易 実装。
function _sumModelBaseCost(modelVal) {
  const sel = document.getElementById('pt-model');
  if (!sel) return null;
  const opt = sel.querySelector(`option[value="${CSS.escape(modelVal || '')}"]`);
  if (!opt) return null;
  const m = /(\d+)\s*pt/.exec(opt.textContent || '');
  return m ? Number(m[1]) : null;
}

async function go() {
  const fileInput = document.getElementById('pt-file');
  const f = fileInput.files[0];
  if (!f) { toast('PDF を選んでください'); return; }
  const btn = document.getElementById('pt-go');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '送信中…';
  // v796 #397 ユーザが既に他ページへ移っている場合は location.hash を触らない (= 強制引き戻し防止)
  const startedHash = location.hash;
  // v796 #398 同時全訳オプション
  const alsoFull = document.getElementById('pt-also-full')?.checked;
  // v1232 fb (中村さん) 「最新の依頼で 同時全訳 が 効いていない」→ setupAlsoFullTranslate の
  //  loadAndBuild が fire-and-forget で await されておらず、 PDF 選択 直後 に 送信 すると
  //  ftSettingsCache が 未 load、 modSel.value が '' で 条件 fail → 全訳 スキップ が root cause。
  //  ここで 同時依頼 チェック時 のみ 明示的 に load 完了 を 待つ。
  if (alsoFull) await ensureFtLoaded();
  const ftDir   = document.getElementById('pt-ft-direction')?.value;
  const ftModel = document.getElementById('pt-ft-model')?.value;
  // v1232 同時依頼 ON なのに モデル が 空 は 明示的 に エラー にする (静かな スキップ が
  //  「効いていない」の 原因 だった の で 二度と 起こさない)
  if (alsoFull && (!ftDir || !ftModel)) {
    toast('⚠️ 全訳モデルがまだ読み込まれていません。もう一度お試しください。');
    btn.disabled = false; btn.textContent = oldText;
    return;
  }
  try {
    const fd = new FormData();
    fd.append('file', f);
    const model = document.getElementById('pt-model')?.value || 'gpt-4o';
    fd.append('model', model);
    // v804 完了と同時に公開 ON
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
    // v797 同 PDF + 同モデルの既存 row を流用した場合は別メッセージ
    if (j.deduped) toast('🔁 同じ PDF の要約が既にあったので流用しました (課金なし)');
    else            toast('要約開始 (' + (j.model || model) + ')');

    // v796 #398 全訳も同時開始するならここで 2 本目を投げる (同じ PDF を別アップロード)
    let ftToken = null;
    if (alsoFull && ftDir && ftModel) {
      try {
        const fd2 = new FormData();
        fd2.append('file', f);
        fd2.append('direction', ftDir);
        fd2.append('model', ftModel);
        // v913 同じ「公開 ON」判定を全訳側にも引き継ぐ (両方とも基本額 or 両方とも倍額)
        if (document.getElementById('pt-auto-share')?.checked) fd2.append('auto_share', '1');
        const r2 = await fetch('/api/ai/paper_full_translate', {
          method: 'POST', body: fd2, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' },
        });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(j2?.error?.message || j2?.error || ('HTTP ' + r2.status));
        ftToken = j2.share_token;
        // v797 全訳側も dedup 流用したかどうかでメッセージを分ける
        if (j2.deduped) toast('🔁 全訳も既存 row を流用 (課金なし)');
        else             toast('全訳も開始 (' + (j2.model || ftModel) + ')');
      } catch (e2) {
        toast('全訳開始失敗: ' + e2.message + ' (要約は走ってます)');
      }
    }

    // v796 #397 await が解決した時点でユーザが paper-summary から離れていたら移動しない
    if (location.hash === startedHash || location.hash.startsWith('#/paper-summary')) {
      location.hash = '#/paper-summary/r/' + j.share_token;
      // 全訳も同時開始したなら履歴で確認できるようにトーストで案内
      if (ftToken) toast('全訳は /#/paper-translate-full/r/' + ftToken + ' で進捗確認');
    } else {
      toast('裏で処理中。通知が届いたら結果ページを開いてください');
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

    // 履歴が空 (初回) なら form を開く、あるなら閉じる
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
      // v954 thumbnail: 最初の figure_ref の page + region をサムネ表示
      const thumbHtml = renderTileThumb(it.thumb);
      return `
        <a class="ai-tile" href="#/paper-summary/r/${escapeHtml(it.share_token)}">
          <div class="ai-tile-head">
            <span>${statusIcon}</span>
            ${it.is_shared ? '<span style="color:#15803d">🌐</span>' : ''}
            <span style="margin-left:auto; font-size:11px">${escapeHtml(it.status || '')}</span>
          </div>
          <div style="display:flex; gap:8px; align-items:flex-start; margin-top:2px">
            ${thumbHtml}
            <div style="flex:1; min-width:0">
              <div class="ai-tile-title">${escapeHtml(title)}</div>
              ${showOrig ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.title_orig)}</div>` : ''}
              ${meta ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>` : ''}
            </div>
          </div>
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
        : (q ? `<div class="empty">「${escapeHtml(q)}」に該当する公開要約がありません</div>`
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

// /#/paper-summary/r/:token  個別結果ページ。
export async function renderPaperTranslateShared() {
  // v1227 中村さん指摘「✕ で なかなか 戻らない」→ tab で 全訳 ↔ 要約 を 何度 か 切り替える と
  //   fsInnerNavCount が 積み上がる ので、 detail 入場 で 常に 0 リセット。 ✕ 一発 で 元 の 場所 (papers-recent) へ。
  resetFsInnerNav();
  const token = decodeURIComponent(location.hash.split('/').pop() || '');
  const app = document.getElementById('app');
  if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
  await refreshShared(token, app);
}

async function refreshShared(token, app) {
  if (!app) app = document.getElementById('app');
  // v798 ユーザが既に別ページに移っているなら何も触らず、タイマーを自殺させる
  //   (= 10 秒ごとの「要約中… 」表示で強制引き戻しになるのを防ぐ)。
  if (!location.hash.includes('/paper-summary/r/' + token)
   && !location.hash.includes('/paper-translate/r/' + token)) {
    if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
    return;
  }
  try {
    const d = await get('/api/ai/paper_translate/r/' + encodeURIComponent(token));
    // v798 fetch 中にユーザが移動した可能性をもう一度確認
    if (!location.hash.includes('/paper-summary/r/' + token)
     && !location.hash.includes('/paper-translate/r/' + token)) {
      if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
      return;
    }
    if (d.status === 'pending' || d.status === 'processing') {
      // v810 30 分以上処理中 = 詰まってる可能性 (PHP プロセスがタイムアウトで死んだ)。
      //   本人には「再投入」ボタンを出す。
      const myUid = Number(state.me?.id) || 0;
      const isOwner = myUid && myUid === Number(d.author_id);
      const ageMin = d.created_at ? Math.round((Date.now() - new Date(String(d.created_at).replace(' ', 'T') + '+09:00').getTime()) / 60000) : 0;
      const isStale = ageMin >= 30;
      const staleBanner = (isStale && isOwner && d.pdf_path) ? `
        <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
          <div class="bold" style="color:#9a3412">⏳ もう ${ageMin} 分処理中。サーバプロセスが途中で死んだ可能性があります。</div>
          <p class="hint" style="font-size:12.5px; margin:6px 0 8px">同 PDF で再投入します (新規課金なし)。</p>
          <button id="pt-retry-stale" class="primary">🔁 再投入 (新規課金なし)</button>
        </div>` : '';
      app.innerHTML = stripJaSpaces(`
        <div class="card page-header">
          <h2 style="margin:0">⏳ 要約中… 「${escapeHtml(d.pdf_name)}」</h2>
          <div class="meta">${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}</div>
        </div>
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">🤖 OpenAI が要約中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            通常 1-4 分で完了します。このページを閉じても大丈夫です (完了通知が届きます)。<br>
            10 秒ごとに自動更新。
          </p>
        </div>
        ${staleBanner}
      `);
      document.getElementById('pt-retry-stale')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再投入中…';
        try {
          await post('/api/ai/paper_translate/' + d.id + '/retry', {});
          toast('再投入を開始しました');
          refreshShared(token, app);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再投入 (新規課金なし)'; }
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
          ${isOwner && d.pdf_path ? `<div style="margin-top:10px"><button id="pt-retry" class="primary">🔁 再実施 (新規課金なし)</button></div>` : ''}
        </div>`);
      document.getElementById('pt-retry')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = '⏳ 再投入中…';
        try {
          await post('/api/ai/paper_translate/' + d.id + '/retry', {});
          toast('再投入を開始しました');
          refreshShared(token, app);
        } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🔁 再実施 (新規課金なし)'; }
      });
      return;
    }
    paintResult(d, token);
  } catch (e) {
    // v798 エラー時も滞在確認してから表示
    if (location.hash.includes('/paper-summary/r/' + token) || location.hash.includes('/paper-translate/r/' + token)) {
      app.innerHTML = stripJaSpaces(`<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`);
    }
  }
}

async function paintResult(d, token) {
  // v762 #381 既存 result_json の日本語中の不要な半角スペースを取り除いてから描画
  const r = stripJaSpacesDeep(d.result || {});
  const app = document.getElementById('app');
  await initLabUsersCache();   // v1004 著者アバター用
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
      ${r.venue ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(r.venue)}</div>` : ''}
      <div class="meta" style="font-size:11px; margin-top:6px">
        ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}
      </div>
      <!-- v1020 中村さん指摘「共有URLをコピーは共有モーダルにあるからいらない」「一覧へも不要 (✕で戻れる)」「全訳へボタンも横並びで」 -->
      <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" id="pt-share-dialog" style="font-size:12px; padding:3px 10px">📤 共有</button>
        ${d.pdf_path ? `<a class="btn" href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📄 元の PDF を開く</a>` : ''}
        ${isOwner ? `
          <button class="btn ${isShared ? 'primary' : ''}" id="pt-share-toggle" data-on="${isShared ? 1 : 0}" style="font-size:12px; padding:3px 10px">
            ${isShared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)'}
          </button>` : ''}
        ${isOwner && d.pdf_path ? `<button class="btn" id="pt-redo" title="保存された PDF で同じモデルで再処理 (v1022 以降課金なし)" style="font-size:12px; padding:3px 10px">🔁 やりなおす (${escapeHtml(d.model || 'gpt-4o')})</button>` : ''}
        ${isShared && !isOwner ? '<span class="tag ok" style="font-size:11px">🌐 公開要約</span>' : ''}
      </div>
      <div id="pt-ask-ai-mount" style="margin-top:8px"></div>
    </div>

    ${ptRenderAuthorCards(r.authors)}

    ${ptRenderKeywords(r.keywords)}

    <!-- v1214/v1223 中村さん要望「タブは 著者情報 の 下 に (著者情報 まで は 同一 の 内容 の はず)」→ 著者カード + キーワード の 直後 に 独立 して 配置。 -->
    ${renderPaperCrossRefsAndCreate(d)}

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

    ${renderFactCheck(r.fact_check)}

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
    // v1219/v1220 詳細ページ で だけ 💬 fab を 出す (中村さん指摘「どこでも ついてくる の 気になる」)
    setAiContext({
      sourceType: 'paper_translate', sourceId: Number(d.id),
      title: (r.title_ja || r.title_orig || d.pdf_name || '論文要約'),
    });
  }
  // v1018 「PDFにする」ボタンは共有モーダル内に移動
  document.getElementById('pt-share-dialog')?.addEventListener('click', () => {
    shareDialog(
      '📑 論文要約: ' + (r.title_ja || d.pdf_name),
      '#/paper-summary/r/' + d.share_token,
      { pdfTitle: `要約 - ${r.title_ja || r.title_en || d.pdf_name || '論文'}` }
    );
  });
  // v1020 pt-copy 削除 (共有モーダルにコピー機能があるため)
  // v813 #405 ペアの全訳を作るボタン
  bindMakeFullTranslate(d);
  // v758 #377 やりなおす (本人のみ、保存 PDF で再処理)
  // v1022 fb#480 中村さん指摘「システムの問題の可能性があるので、課金はしないで」→ 課金なしに変更
  document.getElementById('pt-redo')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!confirm('保存された PDF で同じモデルで再処理します (課金なし)。続行しますか?')) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '🔁 開始中…';
    try {
      const r = await post('/api/ai/paper_translate/' + d.id + '/redo', {});
      toast('再処理を開始しました (' + (r.model || '') + ')');
      // status=pending になったので polling 状態を表示し直す
      await refreshShared(token, document.getElementById('app'));
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = old; }
  });
  // v756 #372 公開 ON/OFF toggle (本人のみ)
  // v914 share_priced=1 の row は toggle で差額追加課金/返金。事前に確認プロンプト。
  document.getElementById('pt-share-toggle')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const wasOn = btn.dataset.on === '1';
    const shared = !!d.share_priced;
    if (shared) {
      const paid = Number(d.cost_points || 0);
      const half = Math.floor(paid / 2);
      const msg = wasOn
        ? `非公開に戻すと半額割引が停止して差額 ${paid}pt が追加課金されます。 (現在 ${paid}pt 支払済 → ${paid + paid}pt に)。続けますか?`
        : `🎁 公開 ON にすると半額割引が発動して ${half}pt が返金されます。 (現在 ${paid}pt 支払済 → ${paid - half}pt に)。続けますか?`;
      if (!confirm(msg)) return;
    }
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
  // 画像タップで lightbox (戻るボタンで閉じる)
  document.querySelectorAll('[data-pt-zoom]').forEach(el => {
    el.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const { openImageLightbox } = await import('../lightbox.js');
      openImageLightbox(el.dataset.ptZoom);
    });
  });
  // v1004 著者カードのクリック → 著者ページに移動 (中村さん指摘「上に論文要約と出るのは変」)。
  document.querySelectorAll('[data-pt-author]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.ptAuthor || '').trim();
      if (!q) return;
      location.hash = '#/authors/' + encodeURIComponent(q);
    });
  });
  // v1005 キーワードのクリック → 公開要約の検索
  document.querySelectorAll('[data-pt-kw]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.ptKw || '').trim();
      if (!q) return;
      location.hash = '#/paper-summary?q=' + encodeURIComponent(q);
    });
  });
  // v1004 著者アバター Gravatar への動的差し替え
  mountAuthorAvatars(document.getElementById('app'));
}

// v813/v1214 cross_refs を「要約 / 全訳」の タブバー に 昇華 (中村さん要望
//   「1 つの論文を 扱うので タブで 切り替える 形式にしたら 良いのかも」)。
//   スラッグ は そのまま、 タブ UI で 相互リンク を 明示。
function renderPaperCrossRefsAndCreate(d) {
  return _renderPaperTabBar(d, 'summary');
}
function _renderPaperTabBar(d, currentKind) {
  const refs = Array.isArray(d.cross_refs) ? d.cross_refs : [];
  const myUid = Number(state.me?.id || 0);
  const isOwner = !!d.author_id && Number(d.author_id) === myUid;
  const summaryRef = refs.find(x => x.kind === 'paper_translate');
  const fullRef    = refs.find(x => x.kind === 'paper_full_translation');
  const canCreateSummary = isOwner && d.status === 'done' && !!d.pdf_path && !summaryRef;
  const canCreateFull    = isOwner && d.status === 'done' && !!d.pdf_path && !fullRef;
  const active = 'background:#7b3fa0; color:#fff; border:1px solid #7b3fa0';
  const linked = 'background:#f9fafb; color:#374151; border:1px solid #d1d5db; text-decoration:none';
  const create = 'background:#fff; color:#7b3fa0; border:1px dashed #7b3fa0';
  const grey   = 'background:#f3f4f6; color:#9ca3af; border:1px solid #e5e7eb; opacity:0.7';
  const base   = 'display:inline-block; font-size:13px; padding:6px 14px; border-radius:6px 6px 0 0';
  const tabHtml = (label, isActive, href, createId, canCreate) => {
    if (isActive) return `<span style="${base}; ${active}; font-weight:600">${label}</span>`;
    if (href)     return `<a href="${href}" style="${base}; ${linked}">${label}</a>`;
    if (canCreate) return `<button class="btn" id="${createId}" style="${base}; ${create}; cursor:pointer">＋ ${label} を 作る</button>`;
    return `<span style="${base}; ${grey}">${label} (未作成)</span>`;
  };
  const summaryTab = tabHtml('📄 要約', currentKind === 'summary',
    summaryRef ? `#/${escapeHtml(summaryRef.url_slug)}/r/${escapeHtml(summaryRef.share_token)}` : null,
    'pft-make-summary', canCreateSummary);
  const fullTab = tabHtml('📑 全訳', currentKind === 'full',
    fullRef ? `#/${escapeHtml(fullRef.url_slug)}/r/${escapeHtml(fullRef.share_token)}` : null,
    'pt-make-full', canCreateFull);
  // v1217 中村さん指摘「タブ 表示 が おかしい」→ .row は 子要素 を flex:1 で 引き伸ばす CSS が あり
  //   タブ が 巨大化 していた。 単純 な display:flex で 幅 を 子要素 の 実サイズ に。
  return `<div style="display:flex; gap:4px; margin-top:6px; border-bottom:2px solid #7b3fa0; padding-bottom:0; flex-wrap:wrap">${summaryTab}${fullTab}</div>`;
}

// 「📑 全訳を作る」ボタンのクリックハンドラ。 paintResult 後に bind。
async function bindMakeFullTranslate(d) {
  const btn = document.getElementById('pt-make-full');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const { openModal } = await import('../modal.js');
  btn.addEventListener('click', async () => {
    const html = `
      <p style="font-size:13px; margin:0 0 8px">この PDF で論文全訳を開始します。課金はポイント残高から。</p>
      <label class="field"><span class="lbl">方向</span>
        <select id="mft-dir" style="font-size:13px">
          <option value="en2ja" selected>英 → 日 (en2ja)</option>
          <option value="ja2en">日 → 英 (ja2en)</option>
        </select>
      </label>
      <label class="field"><span class="lbl">モデル</span>
        <select id="mft-model" style="font-size:13px">
          <option value="gpt-5" selected>gpt-5 (63pt / ja2en 313pt)</option>
          <option value="o1">o1 (100pt / ja2en 500pt)</option>
        </select>
      </label>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px">
        <input type="checkbox" id="mft-auto-share"> 🌐 完了と同時に公開 ON
      </label>`;
    // v1217 中村さん報告「キャンセルが押せない」の 原因: openModal の onClick は
    //   (api) を 受け取る 契約 だが (close) と 誤解し 呼ぶと api() = TypeError で 沈黙。
    //   primary: true も 効かない (kind: 'primary' が 正解)。 両方 修正。
    openModal({
      title: '📑 全訳を作る',
      bodyHtml: html,
      buttons: [
        { label: 'キャンセル', kind: 'btn', onClick: (m) => m.close() },
        { label: '開始', kind: 'primary', onClick: async (m) => {
          const direction = document.getElementById('mft-dir')?.value || 'en2ja';
          const model     = document.getElementById('mft-model')?.value || 'gpt-5';
          const auto_share = !!document.getElementById('mft-auto-share')?.checked;
          try {
            const j = await post(`/api/ai/paper_full_translate/from_summary/${d.id}`, { direction, model, auto_share });
            m.close();
            toast('📑 全訳を開始しました');
            if (j?.share_token) location.hash = '#/paper-translate-full/r/' + encodeURIComponent(j.share_token);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        }},
      ],
    });
  });
}

// v759 #378 pdftoppm は総ページ数の桁に合わせて 0 パディングする。
//   例: 32 ページなら page-01.jpg / page-02.jpg ... 100 ページなら page-001.jpg。
//   pagesCount を使って桁数を求めて同じパディングを入れる。
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

// v954 リストタイル用の図サムネ (fig=null なら空文字列)。詳細ページの renderFigure と同じ
//   background-position 方式で region を切り抜き、タイル内に 64x80 の小サムネ表示。
function renderTileThumb(thumb) {
  if (!thumb || !thumb.url) return '';
  const w = 64, h = 80;
  const region = String(thumb.region || 'full').toLowerCase();
  const bgPos = region === 'top'    ? 'center top'
              : region === 'middle' ? 'center center'
              : region === 'bottom' ? 'center bottom'
              : 'center top';
  if (region === 'full') {
    return `<img src="${escapeHtml(thumb.url)}" loading="lazy"
              style="flex:none; width:${w}px; height:${h}px; object-fit:contain; background:#fff; border:1px solid #e5e7eb; border-radius:4px"
              alt="thumb">`;
  }
  return `<div style="flex:none; width:${w}px; height:${h}px; background:#fff url('${escapeHtml(thumb.url)}') no-repeat ${bgPos}/100% auto; border:1px solid #e5e7eb; border-radius:4px"></div>`;
}

// v955 要約側でも著者カードを出したい。 r.authors は文字列 (「Kelly Mack, Emma McDonnell, ...」)
//   なので split して名前のみの簡易カード。全訳側 (paper_translate_full.js) と同じ
//   avatar / card スタイルに揃える。
function ptParseAuthorsFromString(s) {
  if (!s || typeof s !== 'string') return [];
  const cleaned = s
    .replace(/,\s*and\s+/gi, ', ')   // "A, B, and C" → "A, B, C"
    .replace(/\s+and\s+/gi, ', ')    // "A and B"    → "A, B"
    .replace(/\bet al\.?/gi, '');    // 「et al.」は落とす
  return cleaned.split(/[,;、]/)
    .map(x => x.trim())
    .filter(x => x.length > 1 && x.length <= 80);
}
function ptInitialsAvatar(name) {
  const clean = String(name || '').trim();
  if (!clean) return { initials: '?', color: '#9ca3af' };
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return { initials: initials.toUpperCase().slice(0, 2), color: `hsl(${hash % 360}, 55%, 55%)` };
}
// v1005 中村さん要望「要約にもキーワードが欲しい」。全訳 view と同スタイルで、
//   タップで公開要約一覧の検索 (#/paper-summary?q=…) に飛ぶ。
function ptRenderKeywords(kws) {
  if (!Array.isArray(kws)) return '';
  const list = kws.map(k => String(k || '').trim()).filter(Boolean);
  if (!list.length) return '';
  return `
    <div class="card" style="background:#faf5ff">
      <div class="bold" style="color:#7b3fa0; font-size:13px; margin-bottom:6px">🏷 キーワード</div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        ${list.map(kw => `<button data-pt-kw="${escapeHtml(kw)}" class="btn" style="background:#f3e8ff; color:#7b3fa0; font-size:12px; padding:2px 10px; border:1px solid #d8b4fe; border-radius:12px; cursor:pointer">${escapeHtml(kw)}</button>`).join('')}
      </div>
      <div class="hint-sm" style="margin-top:6px">タップで公開要約から関連論文を検索</div>
    </div>`;
}

function ptRenderAuthorCards(authorsStr) {
  const authors = ptParseAuthorsFromString(authorsStr);
  if (!authors.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); font-size:13px; margin-bottom:8px">👥 著者 <span class="hint-sm" style="font-weight:normal">タップで著者ページ (LabPay 内の他論文 / Google Scholar 等)</span></div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:8px">
        ${authors.map(a => `
          <button data-pt-author="${escapeHtml(a)}" style="display:flex; gap:8px; padding:6px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; align-items:center; min-width:0; cursor:pointer; text-align:left; font-family:inherit">
            ${renderAuthorAvatar({ name: a }, { size: 32 })}
            <div class="bold" style="flex:1; min-width:0; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a)}</div>
          </button>`).join('')}
      </div>
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
  // v954 crop 復活: background-image + background-position で region 位置を表示。
  //   region=full なら全体、 top/middle/bottom は該当 3 分の 1 部分を表示。
  //   タップで lightbox に元のフルページを表示 (region の精度が微妙でも
  //   本体は見れる)。
  // v1088 中村さん指示「要約の図もっと大きく表示してほしいな。 2 倍くらいにはしても良い」
  //   → 220px → 440px (max-height も併せて 320 → 640)。モバイルはカード幅で頭打ちになる
  //   ので気にならない、デスクトップで図が読みやすくなる。
  const wrap = 440;
  const regionLabel = region === 'top' ? '(上部)' : region === 'middle' ? '(中央)' : region === 'bottom' ? '(下部)' : '';
  // v996 中村さんアイデア: 図は下にキャプション、表は上にキャプションあるので、
  //   pdftotext -bbox-layout でキャプションの y 座標を特定して精密 crop 可能。
  //   crop_y_pct / crop_h_pct が result_json に付与されていればそれを使う (精密)。
  //   無ければ全ページ表示 (v995 の fallback、 region 推定の不精度は使わない)。
  const cropYPct = Number(fig?.crop_y_pct);
  const cropHPct = Number(fig?.crop_h_pct);
  // v997 段組対応: crop_x_pct / crop_w_pct があれば該当段だけ切り取る
  const cropXPct = Number.isFinite(Number(fig?.crop_x_pct)) ? Number(fig.crop_x_pct) : 5;
  const cropWPct = Number.isFinite(Number(fig?.crop_w_pct)) ? Number(fig.crop_w_pct) : 90;
  const hasCrop = Number.isFinite(cropYPct) && Number.isFinite(cropHPct) && cropHPct > 0;
  let imgElement;
  if (hasCrop) {
    // wrap は表示幅 (crop 領域の表示幅)。 A4 aspect 1.32 で crop 領域の実高さは
    //   pageH * cropHPct/100、幅は pageW * cropWPct/100。 wrap 幅に合わせて高さ計算。
    // 実 aspect = (cropHPct*pageH) / (cropWPct*pageW) = cropHPct/cropWPct * 1.32
    const displayH = Math.round(wrap * 1.32 * cropHPct / cropWPct);
    // bg-size: 幅を 100/(cropWPct/100)% = 100*100/cropWPct 倍、高も同様。
    const bgSizeW = (10000 / cropWPct).toFixed(1);
    const bgSizeH = (10000 / cropHPct).toFixed(1);
    const bgPosX  = (100 - cropWPct > 0 ? cropXPct * 100 / (100 - cropWPct) : 0).toFixed(1);
    const bgPosY  = (100 - cropHPct > 0 ? cropYPct * 100 / (100 - cropHPct) : 0).toFixed(1);
    imgElement = `<div style="width:${wrap}px; max-width:100%; height:${displayH}px;
      background-image: url('${escapeHtml(imgUrl)}');
      background-repeat: no-repeat;
      background-position: ${bgPosX}% ${bgPosY}%;
      background-size: ${bgSizeW}% ${bgSizeH}%;
      background-color:#fff; border:1px solid #ddd; border-radius:4px"></div>`;
  } else {
    imgElement = `<img src="${escapeHtml(imgUrl)}" loading="lazy" alt="page ${page}"
                     onerror="this.outerHTML='<div style=\\'width:${wrap}px; max-width:100%; padding:20px; background:#fef2f2; border:1px solid #fecaca; border-radius:4px; color:#dc2626; text-align:center; font-size:12px\\'>⚠ 画像読み込み失敗<br><a href=\\'${escapeHtml(imgUrl)}\\' target=_blank>直接開く</a></div>'"
                     style="width:${wrap}px; max-width:100%; height:auto; max-height:640px; object-fit:contain; background:#fff; border:1px solid #ddd; border-radius:4px; display:block">`;
  }
  // v1090 中村さん報告「Figure 6 があると言われてるが、でてない」→ imgUrl が構築されて
  //   いても onload/onerror での失敗 (キャッシュ/CORS/404) で img が見えないケースを救う。
  //   img の onerror で src を消して alt 内の「元 URL を開く」リンクだけ残す表示にする。
  //   さらに imgUrl 自体が null (page 範囲外や pages_dir 欠落) だった場合も「(ページ画像なし)」
  //   バッジを text 側に出して原因を可視化する。
  const noImgReason = !imgUrl
    ? (!pagesDir ? '(ページ画像未生成)'
       : (!page ? '(page 番号なし)'
       : (!inRange ? `(page ${page} は pages_count=${pagesCount} 範囲外)` : '(画像 URL 構築失敗)')))
    : '';
  // v1091 中村さん報告「Figure 6 があると言われてるが、でてない」→ サーバ側で
  //   PDF から「Figure N」キャプションを探して crop 領域を出す処理が失敗した場合
  //   crop_missing フラグが付く (v1091 で追加)。これは AI が hallucinate した図の
  //   強い疑い (PDF 中に該当キャプションが実在しない)。目立つ警告を出す。
  const cropMissing = !!(fig && fig.crop_missing);
  const suspiciousBanner = cropMissing
    ? `<div style="margin-top:4px; padding:6px 8px; background:#fef2f2; border-left:3px solid #dc2626; border-radius:0 4px 4px 0; font-size:11px; color:#991b1b">
         ⚠ <b>この図は AI が誤って生成した可能性が高い</b>: PDF 中に「${escapeHtml(label)}」というキャプションが見つかりませんでした。ページ画像は出せていますが、実際にこの位置にこの図がない可能性があります。
       </div>` : '';
  return `
    <div style="display:flex; gap:10px; padding:8px 10px; background:#fafafa; border-left:3px solid ${cropMissing ? '#dc2626' : 'var(--primary)'}; border-radius:0 6px 6px 0; align-items:flex-start">
      ${imgUrl ? `
        <a href="${escapeHtml(imgUrl)}" data-pt-zoom="${escapeHtml(imgUrl)}" target="_blank" rel="noopener" style="flex:none; display:block; cursor:zoom-in; min-width:120px">
          ${imgElement}
          <div class="hint-sm" style="font-size:9px; text-align:center; margin-top:2px; color:#9ca3af">タップで全ページ表示</div>
        </a>` : ''}
      <div style="flex:1; min-width:0; font-size:13px">
        <div class="bold" style="color:${cropMissing ? '#991b1b' : '#4a106d'}">${escapeHtml(label)}${page ? ` <span style="font-weight:normal; color:#666">(p.${page}${regionLabel})</span>` : ''}${noImgReason ? ` <span style="font-weight:normal; color:#dc2626; font-size:11px">${escapeHtml(noImgReason)}</span>` : ''}${cropMissing ? ' <span style="font-weight:normal; color:#dc2626; font-size:11px">⚠ AI 生成疑い</span>' : ''}</div>
        ${suspiciousBanner}
        ${cap ? `<div style="margin-top:3px"><b>キャプション:</b> ${escapeHtml(cap)}</div>` : ''}
        ${visual ? `<div style="margin-top:3px"><b>👁 視覚要素:</b> ${escapeHtml(visual)}</div>` : ''}
        ${why ? `<div style="margin-top:3px"><b>なぜ重要:</b> ${escapeHtml(why)}</div>` : ''}
        ${imgUrl ? `<div class="hint-sm" style="margin-top:4px; font-size:10px; color:#9ca3af">画像が表示されない場合: <a href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener">直接開く</a></div>` : ''}
      </div>
    </div>`;
}

// v972 要約の自己検証 (back-translation + 引用実在性)。 fact_check が無いエントリは非表示。
function renderFactCheck(fc) {
  if (!fc || typeof fc !== 'object') return '';
  const issues = Array.isArray(fc.issues) ? fc.issues : [];
  const suspSources = Array.isArray(fc.suspicious_citations) ? fc.suspicious_citations : [];
  const clean = fc.verified === true && issues.length === 0 && suspSources.length === 0;
  const verifiedSecs = Array.isArray(fc.verified_sections) ? fc.verified_sections : [];
  const barColor = clean ? '#15803d' : '#dc2626';
  const bgColor  = clean ? '#f0fdf4' : '#fef2f2';
  const issueTypeLabel = {
    number_mismatch:        '🔢 数値の誤り',
    term_wrong:             '📖 用語の誤り',
    claim_distortion:       '↔ 主張の曲解',
    out_of_scope_addition:  '➕ 範囲外の追加',
    omission:               '📉 落とし',
    over_summarization:     '📏 過剰要約',
    other:                  '❓ その他',
  };
  const citTypeLabel = {
    author_error:         '👤 著者名の誤り',
    title_not_found:      '📕 タイトルが存在しない疑い',
    bibinfo_error:        '📅 書誌情報の誤り',
    venue_year_mismatch:  '🗓 会議と年のずれ',
    possibly_hallucinated:'🤖 実在しない可能性 (ハルシネーション疑い)',
    other:                '❓ その他',
  };
  const confColor = { high: '#dc2626', medium: '#ea580c', low: '#a16207' };
  return `
    <div class="card" style="margin-top:12px">
      <div class="bold" style="color:${barColor}">🔍 back-translation + 引用実在性の自己検証</div>
      <div style="padding:6px 10px; background:${bgColor}; border-left:3px solid ${barColor}; border-radius:0 4px 4px 0; font-size:12.5px; margin-top:4px">
        ${clean
          ? '要約と原文の突合、および引用文献の実在性で問題は見つかりませんでした。'
          : `要約に <span class="bold">${issues.length}</span> 件の懸念、引用文献に <span class="bold">${suspSources.length}</span> 件の疑いあり。下記を確認してください。`}
      </div>
      ${verifiedSecs.length ? `
        <div style="font-size:11.5px; color:#15803d; margin-top:4px">
          ✓ 検証済セクション: ${verifiedSecs.map(s => escapeHtml(s)).join(' / ')}
        </div>` : ''}
      ${issues.map(i => `
        <div style="margin-top:6px; padding:8px 10px; background:#fff; border:1px solid #fecaca; border-radius:6px; font-size:12.5px">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            <span class="bold" style="color:#dc2626">${issueTypeLabel[i.issue_type] || i.issue_type || '⚠'}</span>
            <span style="font-size:11px; padding:1px 6px; border-radius:4px; background:${confColor[i.confidence] || '#9ca3af'}; color:#fff">${i.confidence || 'medium'}</span>
            ${i.section ? `<span style="font-size:11px; color:#6b7280; font-family:ui-monospace, monospace">${escapeHtml(i.section)}</span>` : ''}
          </div>
          ${i.explanation ? `<div style="margin-top:4px">${escapeHtml(i.explanation)}</div>` : ''}
          ${i.suggested_fix ? `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border-left:2px solid #16a34a; font-size:12px">💡 修正案: ${escapeHtml(i.suggested_fix)}</div>` : ''}
        </div>`).join('')}
      ${suspSources.map(s => `
        <div style="margin-top:6px; padding:8px 10px; background:#fff; border:1px solid #fecaca; border-radius:6px; font-size:12.5px">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            <span class="bold" style="color:#dc2626">${citTypeLabel[s.issue_type] || s.issue_type || '⚠ 引用の疑問点'}</span>
            <span style="font-size:11px; padding:1px 6px; border-radius:4px; background:${confColor[s.confidence] || '#9ca3af'}; color:#fff">${s.confidence || 'medium'}</span>
          </div>
          ${s.citation ? `<div style="margin-top:4px; font-family:ui-monospace, monospace; font-size:11.5px; padding:4px 8px; background:#fff5f5; border-radius:4px; white-space:pre-wrap">${escapeHtml(s.citation)}</div>` : ''}
          ${s.explanation ? `<div style="margin-top:4px">${escapeHtml(s.explanation)}</div>` : ''}
          ${s.suggested_fix ? `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border-left:2px solid #16a34a; font-size:12px">💡 修正案: ${escapeHtml(s.suggested_fix)}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderOchiai(o) {
  if (!o || typeof o !== 'object') return '';
  const sections = [
    ['what',          '1. どんなもの?',                '🧩'],
    ['vs_prior_work', '2. 先行研究と比べてすごい点',  '🆚'],
    ['key_method',    '3. 技術 / 手法のキモ',         '🔧'],
    ['validation',    '4. どう検証した?',              '✅'],
    ['discussion',    '5. 議論はある?',                '💬'],
  ];
  let html = '<div class="card" style="background:#fafaf5; border:1px dashed #d4b8e0"><div class="bold" style="color:var(--primary); margin-bottom:6px; font-size:15px">📚 落合メソッドでまとめ</div><div class="hint-sm" style="font-size:11px; margin-bottom:8px">論文全体を6項目で重ね合わせ</div>';
  for (const [key, label, icon] of sections) {
    let txt = (o[key] || '').toString().trim();
    if (!txt) continue;
    // v756 #374 GPT が値の先頭に「1. どんなもの?」等の設問を繰り返して入れることが
    //   あるので、先頭がラベルと同じ設問で始まる場合は取り除く (重複表示防止)。
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
        <div class="bold" style="font-size:13px; color:#4a106d">🔖 6. 次に読むべき論文</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px; line-height:1.7">
          ${next.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>`;
  }
  html += '</div>';
  return html;
}

// v753 RQ と仮説 + それぞれの結果をペア表示。旧 schema (文字列配列) も fallback 表示。
// v764 #382 1 個だけのときは「RQ1」 → 「RQ」、「H1」 → 「H」に自動変換。
function normalizeQLabel(s, prefix, isSingle) {
  // prefix 例: "RQ" / "H"。 GPT が「RQ1: ...」「RQ：…」や単に「1. …」で来る場合を正規化。
  if (typeof s !== 'string') return s;
  let txt = s.trim();
  // 数字 + コロン or 数字 + ピリオドの接頭辞を検出 + 取り除く
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
  // v768 #387 「💡 示唆:」ラベルは廃止 (GPT が値の先頭にも「示唆:」を書く場合があり
  //   「💡 示唆: 示唆: …」になってしまうため)。値の先頭の「示唆:」「結果:」等も strip。
  const stripPrefix = (s) => String(s || '').replace(/^\s*(示唆|結果|答え)\s*[:：]\s*/u, '').trim();
  // v1017 中村さん要望「何ページ目にあるかも明記、 RQ / 仮説の書き方の勉強になるため原文も」
  const pageBadge = (p) => (typeof p === 'number' && p > 0)
    ? `<span style="font-size:10.5px; padding:1px 6px; border-radius:8px; background:#fff; color:#4f46e5; border:1px solid #c7d2fe; margin-left:6px">p.${p}</span>`
    : '';
  const pageBadgeAmber = (p) => (typeof p === 'number' && p > 0)
    ? `<span style="font-size:10.5px; padding:1px 6px; border-radius:8px; background:#fff; color:#a16207; border:1px solid #fde68a; margin-left:6px">p.${p}</span>`
    : '';
  // v1018 中村さん指摘「RQは、 RQ 自体の原文も示してね」→ 折り畳みを廃止して常に表示。
  // v1020 中村さん再要望「仮説とRQは、和訳の下に、原文 (英語) も示して欲しい」→
  //   「原文:」ラベルを添えて、何が英語原文なのか一目で分かる形に。
  const origBlock = (orig, color) => {
    const s = String(orig || '').trim();
    if (!s) return '';
    return `<div style="margin-top:6px">
      <div style="font-size:10.5px; color:${color}; font-weight:600; margin-bottom:2px">📄 原文</div>
      <div style="padding:6px 10px; background:#fff; border-left:2px solid ${color}; border-radius:0 4px 4px 0; font-size:12px; line-height:1.65; font-family: Georgia, 'Times New Roman', serif; white-space:pre-wrap; color:#374151">${escapeHtml(s)}</div>
    </div>`;
  };
  const rqHtml = rqs.map((item) => {
    const raw = typeof item === 'string' ? item : (item?.rq || '');
    const label = normalizeQLabel(raw, 'RQ', rqSingle);
    const ans  = (typeof item === 'object' && item?.answer)   ? stripPrefix(item.answer) : '';
    const page = (typeof item === 'object') ? Number(item?.page) : 0;
    const orig = (typeof item === 'object') ? item?.original : '';
    return `<div style="padding:8px 12px; background:#eef2ff; border-left:3px solid #4f46e5; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#4f46e5">❓ ${escapeHtml(label)}${pageBadge(page)}</div>
      ${ans ? `<div style="font-size:13px; margin-top:4px">${escapeHtml(ans)}</div>` : ''}
      ${origBlock(orig, '#4f46e5')}
    </div>`;
  }).join('');
  const hyHtml = hys.map((item) => {
    const raw = typeof item === 'string' ? item : (item?.hypothesis || '');
    const label = normalizeQLabel(raw, 'H', hySingle);
    const res  = (typeof item === 'object' && item?.result)   ? stripPrefix(item.result) : '';
    const page = (typeof item === 'object') ? Number(item?.page) : 0;
    const orig = (typeof item === 'object') ? item?.original : '';
    return `<div style="padding:8px 12px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#a16207">💡 ${escapeHtml(label)}${pageBadgeAmber(page)}</div>
      ${res ? `<div style="font-size:13px; margin-top:4px">${escapeHtml(res)}</div>` : ''}
      ${origBlock(orig, '#a16207')}
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px">🔬 RQ / 仮説と示唆</div>
      ${rqHtml}
      ${hyHtml}
    </div>`;
}

// v772 #392 実験と結果を研究名 (例: "Kirmani & Wright 1989") で自動ペアリング表示。
//   experiments と results_summary の各文から「Author Year」を抽出 → 同じ key で紐付け。
function studyKey(s) {
  const str = String(s).replace(/^\s*\(?\s*引用\s*\)?[\s)]*/, '');
  // 西暦 (1900-2099) を探して、先頭から西暦 + 直後の閉じ括弧までを研究名とみなす。
  //   著者名に「Smith, A. (1989)」等のパターンがあるので括弧内の年も含める。
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
  // 残った「)」「の実験:」「の結果:」「:」等の接続文字を除去
  str = str.replace(/^[)）]+\s*/, '').replace(/^の?(実験|研究|結果)[\s:：]*/, '').replace(/^[:：]\s*/, '').trim();
  return str;
}
// v778 #402 自前実験を「実験N」単位でペアリングする用のキー抽出。
//   「研究1：...」「実験1: ...」「Study 1: ...」「Experiment 1 - ...」等を全部「実験1」に正規化。
// v779 #403 結果側は「実験1 (引用 X):」のように「実験1 + 空白 + (引用 X)」形が多いため、
//   「実験1」の後が「:」でなくても数字で終わっていればキーと認める (look-ahead で非数字)。
function ownExpKey(s) {
  const str = String(s).trim();
  const norm = str.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const m = norm.match(/^(?:研究|実験|Study|Experiment|Exp\.?)\s*(\d+)(?=\D|$)/i);
  if (!m) return null;
  return '実験' + m[1];
}
function stripOwnExpKey(s) {
  // 先頭の「研究1：」「実験1:」「Study 1 -」「実験1 (引用 X):」等を取り除いて本文だけ返す。
  // 数字の後に「:」があるならそこまで、なければ数字 + 直後の空白を取る。
  return String(s).replace(/^(?:研究|実験|Study|Experiment|Exp\.?)\s*[0-9０-９]+\s*[:：・\-]?\s*/i, '').trim();
}
// v779 #403 「(引用)」「(引用 X)」「(引用 X 19xx)」が本文中に含まれているか。全要素が
//   引用なら「参考にした実験」ラベルに切り替える。
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
  // v778 #402 自前実験を「実験N」でペアリング (insertion order を保つ)
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

  // v779 #403 ペアの中身を見て「引用比率」を判定。全ペア (or 全体) が引用なら
  //   「📚 この論文が参考にした実験」ラベルに切り替える。自前と引用が混在する
  //   場合はデフォルトの「🔬 この論文で行った実験」を使い、引用 / 自前を個別タグで区別。
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
    // 「実験N」形式で拾えなかった残りは補足リストに
    html += renderListSection('🔬 その他の実験記述', ownUnkeyedExps);
    html += renderListSection('📊 その他の結果記述', ownUnkeyedRess);
  } else {
    // 全部「実験N」で拾えなかった → 従来のリスト表示。配列全体が引用中心なら
    //   ヘッダを「参考にした実験」に切り替える。
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

// v757 #375 参考文献で特に重要なもの。 v759 #378 原題 + 和訳を分けて表示。
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

// v750 #366 旧 renderFigures は詳細サマリ内の figure_refs に統合されたので撤去。
