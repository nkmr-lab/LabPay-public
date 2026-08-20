// /#/paper-translate-full — 論文全訳 (v788 #386 #387 #388)。
//   章ごとに完全翻訳 + サンプル文の back-translation 整合確認 + 用語統一ポリッシュ。
//   direction:
//     en2ja: 英語論文 → 日本語 (標準料金)
//     ja2en: 日本語論文 → 英語 (5x、 em-dash 等 GPT-isms 除去まで含む)

import { get, post, del, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { renderAuthorAvatar, mountAuthorAvatars, initLabUsersCache } from '../author_avatar.js';
import { state, toast, setAiContext } from '../app.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons, viewControlsHtml, bindViewControls, setFormOpen } from '../ui_ai_stars.js';
import { shareDialog } from '../share_to_sns.js';
import { renderAskAiButton } from '../ai_checklist.js';   // v1144

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
      <!-- v1280 中村さん要望で順序変更: (1) PDF → (2) 方向 + モデル → (3) 同時依頼 → (4) 共有 -->
      <label class="field">
        <span class="lbl">① 論文 PDF (最大 30 MB)</span>
        <input type="file" id="pft-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pft-file-status" style="margin-top:4px"></div>
      </label>
      <label class="field" style="margin-top:8px">
        <span class="lbl">② 🌐 翻訳方向</span>
        <select id="pft-direction">
          <option value="en2ja" selected>英語 → 日本語 (E→J)</option>
          <option value="ja2en">日本語 → 英語 (J→E、 5x 料金)</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">③ 🤖 モデル</span>
        <select id="pft-model"></select>
        <div class="hint-sm" id="pft-cost-info" style="font-size:12px; margin-top:4px; color:#6b21a8"></div>
      </label>
      <!-- v1221 同時依頼。 v1280 「(お得!)」表記削除 (中村さん指摘「別にお得じゃないのでは？」)
           = backend は単に POST を 2 本順に投げるだけで割引は無い。 -->
      <fieldset class="field" style="border:1px dashed #7b3fa0; border-radius:6px; padding:8px; margin:8px 0; background:#faf5ff">
        <legend style="font-size:12px; color:#4a106d; font-weight:600">④ 📑📑 同時依頼 (任意)</legend>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600">
          <input type="checkbox" id="pft-also-summary" checked>
          全訳と一緒に要約も依頼する
        </label>
        <div class="hint-sm" style="font-size:11px; color:#6b7280; margin:2px 0 6px 22px">
          1 度のアップロードで両方まとめて依頼できます (料金は別々に依頼した場合と同じ)。
        </div>
        <div id="pft-also-summary-opts" style="margin-top:6px">
          <label class="field" style="margin:4px 0">
            <span class="lbl" style="font-size:11px">要約モデル</span>
            <select id="pft-sum-model" style="font-size:12px"></select>
            <div class="hint-sm" id="pft-sum-cost-info" style="font-size:11px; margin-top:2px"></div>
          </label>
        </div>
      </fieldset>
      <!-- v916/v1221 共有=半額割引 (default ON) -->
      <div style="background:linear-gradient(135deg, #dcfce7, #bbf7d0); border:2px solid #22c55e; border-radius:10px; padding:14px 16px; margin:8px 0; box-shadow:0 2px 6px rgba(34,197,94,0.15)">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer">
          <input type="checkbox" id="pft-auto-share" checked style="width:20px; height:20px; accent-color:#16a34a; cursor:pointer">
          <span style="font-size:16px; font-weight:700; color:#14532d">⑤ 🎁 共有チェック ON で半額になります!</span>
        </label>
        <div style="font-size:12px; color:#166534; margin-top:8px; line-height:1.6">
          完了と同時に公開 ON にする (= みんなの検索に載せる)。研究室全体で共有すると誰かの参考になる資産なので、共有なら半額割引。<br>
          あとから公開 ON にすると半額分返金 / 公開 OFF に戻すと半額割引分追加課金されます。
        </div>
      </div>
      ${state.me?.ai_sub_active ? '<div style="background:#d1fae5; color:#065f46; padding:6px 10px; border-radius:6px; font-size:12px; margin:6px 0; text-align:center">🤖 <b>AIサブスク契約中</b> — この機能は無料でご利用いただけます</div>' : ''}
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pft-go" class="primary" disabled>📑 全訳開始${state.me?.ai_sub_active ? ' (無料)' : ''}</button>
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
  // v955/v1066 hash に ?q=<keyword> や ?pdfurl=<url> を処理
  const qParam = location.hash.includes('?') ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1)) : new URLSearchParams();
  const hashQ = qParam.get('q');
  const hashPdfUrl = qParam.get('pdfurl');
  if (hashPdfUrl) {
    renderPftPdfUrlBanner(hashPdfUrl, hashQ || '');
  }
  if (hashQ) {
    searchEl.value = hashQ;
    switchTab('shared');
    if (!hashPdfUrl) return;
  }
  await loadHistory();   // 初期は自分の履歴
}

// v1066 fb#486 DeepResearch からの「?pdfurl=...」の場合、「PDF から新規全訳」 banner。
function renderPftPdfUrlBanner(pdfUrl, titleQuery) {
  const target = document.getElementById('pft-result');
  if (!target) return;
  target.innerHTML = `
    <div class="card" style="border:2px dashed var(--primary); background:#faf5ff">
      <div class="bold" style="color:var(--primary); font-size:14px; margin-bottom:6px">🔎 DeepResearch からの論文</div>
      <div style="font-size:12.5px; margin-bottom:6px">
        <b>URL:</b> <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener" style="word-break:break-all">${escapeHtml(pdfUrl)}</a>
        ${titleQuery ? `<div style="margin-top:2px"><b>タイトルで既存検索:</b> ${escapeHtml(titleQuery)}</div>` : ''}
      </div>
      <div class="hint-sm" style="margin-bottom:8px">既存の全訳が無ければ、下のボタンで PDF を取得して新規全訳を作れます。</div>
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <label style="font-size:12.5px">方向:
          <select id="pft-fromurl-dir" style="font-size:12.5px">
            <option value="en2ja" selected>英→日</option>
            <option value="ja2en">日→英 (5x)</option>
          </select>
        </label>
        <select id="pft-fromurl-model" style="font-size:12.5px"></select>
        <label style="font-size:12.5px; display:flex; align-items:center; gap:4px"><input type="checkbox" id="pft-fromurl-share" checked> 🎁 共有 ON (半額)</label>
        <button id="pft-fromurl-go" class="btn primary" style="font-size:12.5px">🔗 この URL から PDF を取得して全訳を作る</button>
      </div>
      <div id="pft-fromurl-status" style="margin-top:6px; font-size:12.5px"></div>
    </div>`;
  const setModels = () => {
    const src = document.getElementById('pft-model');
    const dst = document.getElementById('pft-fromurl-model');
    if (src && dst && src.options.length > 0) dst.innerHTML = src.innerHTML;
    else setTimeout(setModels, 300);
  };
  setModels();
  document.getElementById('pft-fromurl-go').addEventListener('click', async () => {
    const btn = document.getElementById('pft-fromurl-go');
    const status = document.getElementById('pft-fromurl-status');
    const model = document.getElementById('pft-fromurl-model').value || 'gpt-5';
    const share = document.getElementById('pft-fromurl-share').checked;
    const direction = document.getElementById('pft-fromurl-dir').value;
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
      status.innerHTML = `<span style="color:#15803d">✓ PDF 取得 (${(blob.size / 1024 / 1024).toFixed(1)} MB) → 全訳開始中…</span>`;
      btn.textContent = '⏳ 全訳依頼中…';
      const file = new File([blob], 'paper.pdf', {type: 'application/pdf'});
      const fd = new FormData();
      fd.append('file', file);
      fd.append('model', model);
      fd.append('direction', direction);
      fd.append('auto_share', share ? '1' : '0');
      const r2 = await fetch('/api/ai/paper_translate_full', {method: 'POST', body: fd, credentials: 'same-origin'});
      if (!r2.ok) {
        let msg = '全訳開始失敗 (HTTP ' + r2.status + ')';
        try { const j = await r2.json(); if (j.error?.message) msg = j.error.message; } catch (_) {}
        throw new Error(msg);
      }
      const j = await r2.json();
      status.innerHTML = `<span style="color:#15803d">✅ 全訳依頼受付。結果ページに移動…</span>`;
      setTimeout(() => { location.hash = '#/paper-translate-full/r/' + j.share_token; }, 500);
    } catch (e) {
      status.innerHTML = `<span style="color:#dc2626">失敗: ${escapeHtml(e.message || String(e))}</span>`;
      btn.disabled = false; btn.textContent = '🔗 この URL から PDF を取得して全訳を作る';
    }
  });
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
  // v1342 AI サブスク契約中は「無料」表記に (state.me.ai_sub_active)
  const aiSubActive = () => !!state.me?.ai_sub_active;
  function rebuildModelOptions() {
    if (!settings) return;
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const def = settings.default_model || Object.keys(models)[0];
    const sub = aiSubActive();
    // v916 選択肢に「共有なら Xpt」を明記 (v1342 サブスク中は「無料」)
    sel.innerHTML = Object.entries(models).map(([m, pt]) => {
      const label = sub
        ? `${m} — AIサブスク中につき無料`
        : `${m} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)`;
      return `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    refreshCost();
  }
  function refreshCost() {
    const models = dir.value === 'ja2en' ? settings.models_ja2en : settings.models_en2ja;
    const m = sel.value;
    const base = models[m] || 0;
    // v914 共有で半額割引
    const shared = !!document.getElementById('pft-auto-share')?.checked;
    const pt = shared ? Math.floor(base / 2) : base;
    // v1221 同時要約も走らせる場合は合計を出す
    const alsoSum = !!document.getElementById('pft-also-summary')?.checked;
    let sumPt = 0;
    if (alsoSum && summarySettingsCache) {
      const sModels = summarySettingsCache.models || {};
      const sBase = sModels[document.getElementById('pft-sum-model')?.value] || 0;
      sumPt = shared ? Math.floor(sBase / 2) : sBase;
    }
    const sub = aiSubActive();
    if (info) {
      const dirLabel = dir.value === 'ja2en' ? '日本語→英語' : '英語→日本語';
      if (sub) {
        info.innerHTML = (alsoSum ? '全訳 + 要約' : `選択中: ${escapeHtml(m)}`) +
          ` <span style="color:#059669; font-weight:600">AIサブスク中につき無料</span> (${dirLabel})`;
      } else if (alsoSum && sumPt > 0) {
        info.innerHTML = `全訳 ${pt}pt + 要約 ${sumPt}pt = <b style="color:#4a106d">合計 ${pt + sumPt}pt</b> (${dirLabel})` +
          (shared ? ` <span style="color:#15803d">(共有 ON、半額)</span>` : '');
      } else {
        info.innerHTML = `選択中: ${escapeHtml(m)} ・ ${pt}pt (${dirLabel})` +
          (shared ? ` <span style="color:#15803d">(公開 ON、半額割引 = 基本 ${base}pt の半額)</span>`
                  : ` <span style="color:#6b7280">(非公開、基本額)</span>`);
      }
    }
    if (sub) {
      btn.textContent = alsoSum ? `📑 全訳+要約開始 (AIサブスク中につき無料)` : `📑 全訳開始 (AIサブスク中につき無料)`;
    } else {
      btn.textContent = alsoSum && sumPt > 0 ? `📑 全訳+要約開始 (${pt + sumPt}pt)` : `📑 全訳開始 (${pt}pt)`;
    }
  }
  dir?.addEventListener('change', rebuildModelOptions);
  sel?.addEventListener('change', refreshCost);
  document.getElementById('pft-auto-share')?.addEventListener('change', refreshCost);
  btn?.addEventListener('click', go);
  if (settings) rebuildModelOptions();
  // v798 同時に要約も走らせるオプション
  setupAlsoSummary(refreshCost);
}

// v798/v1221 同時要約オプションのセットアップ (default ON なので初期 load 済ませる + 合計更新コールバック)
let summarySettingsCache = null;
async function setupAlsoSummary(onCostChange) {
  const toggle = document.getElementById('pft-also-summary');
  const opts   = document.getElementById('pft-also-summary-opts');
  const modSel = document.getElementById('pft-sum-model');
  const info   = document.getElementById('pft-sum-cost-info');
  if (!toggle) return;
  const loadAndBuild = async () => {
    if (!summarySettingsCache) {
      try { summarySettingsCache = await get('/api/ai/paper_translate'); }
      catch (e) { toast('要約設定読込失敗: ' + e.message); return; }
    }
    rebuildSummaryModels();
    if (typeof onCostChange === 'function') onCostChange();
  };
  toggle.addEventListener('change', async () => {
    opts.style.display = toggle.checked ? '' : 'none';
    if (toggle.checked) await loadAndBuild();
    else if (typeof onCostChange === 'function') onCostChange();
  });
  // v1342 サブスク中は「無料」表記に
  const aiSubActive2 = () => !!state.me?.ai_sub_active;
  function rebuildSummaryModels() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const def = summarySettingsCache.default_model || Object.keys(models)[0];
    const sub = aiSubActive2();
    modSel.innerHTML = Object.entries(models).map(([m, pt]) => {
      const label = sub
        ? `${m} — AIサブスク中につき無料`
        : `${m} — ${pt}pt (🎁 共有なら ${Math.floor(pt / 2)}pt)`;
      return `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    refreshCost();
  }
  function refreshCost() {
    if (!summarySettingsCache) return;
    const models = summarySettingsCache.models || {};
    const m = modSel.value;
    const base = models[m] || 0;
    const shared = !!document.getElementById('pft-auto-share')?.checked;
    const pt = shared ? Math.floor(base / 2) : base;
    if (aiSubActive2()) {
      info.innerHTML = `要約 <span style="color:#059669; font-weight:600">AIサブスク中につき無料</span>`;
    } else {
      info.innerHTML = `要約 ${pt}pt` +
        (shared ? ` <span style="color:#15803d">(公開 ON、半額割引 = 基本 ${base}pt の半額)</span>`
                : ` <span style="color:#6b7280">(非公開、基本額)</span>`);
    }
    if (typeof onCostChange === 'function') onCostChange();
  }
  modSel.addEventListener('change', refreshCost);
  document.getElementById('pft-auto-share')?.addEventListener('change', refreshCost);
  // v1221 default ON なので初期 load
  if (toggle.checked) loadAndBuild();
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
        // v913 同じ「公開 ON」判定を要約側にも引き継ぐ
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
  // v1330 fb#515: v1227 の resetFsInnerNav() を撤去 (paper_translate.js と同じ理由)。
  //   一覧 → 詳細の深さを router 側で count させて、 ✕ 一発で一覧に戻す。
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
    // v1003 中村さん指摘「要約と全訳で冒頭の論文情報 / 著者情報の出し方が違う」→ 統一。
    //   要約 (paper_translate.js) の paintResult 冒頭に合わせてタイトル → 原題 → venue →
    //   依頼者 meta → ボタン row の順に。
    const header = `
      <div class="card page-header">
        <h2 style="margin:0; font-size:18px">📑 ${escapeHtml(d.result?.title_translated || d.result?.title_original || d.pdf_name)}
          ${d.status === 'pending' || d.status === 'processing' ? '<span class="tag warn">処理中</span>' : ''}
          ${d.status === 'error' ? '<span class="tag" style="background:#fecaca; color:#b91c1c">エラー</span>' : ''}
          ${sharedTag}
        </h2>
        ${d.result?.title_original && d.result?.title_translated ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(d.result.title_original)}</div>` : ''}
        ${d.result?.venue ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(d.result.venue)}</div>` : ''}
        <div class="meta" style="font-size:11px; margin-top:6px">
          ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at || '')}
        </div>
        <!-- v1020 「一覧へ」廃止 (✕で戻れる)、要約へボタンも横並びに -->
        <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
          <button class="btn primary" id="pft-share-dialog" style="font-size:12px; padding:3px 10px">📤 共有</button>
          ${d.pdf_path ? `<a class="btn" href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📄 元の PDF を開く</a>` : ''}
          ${shareButton}
          ${isOwner ? `<button class="btn" id="pft-delete" title="この全訳を削除 (PDF ごと)" style="font-size:12px; padding:3px 10px; background:#fee2e2; color:#991b1b; border:1px solid #fca5a5">🗑 削除</button>` : ''}
        </div>
      </div>
      <!-- v1214/v1223 中村さん要望「タブは著者情報の下に」→ 著者カード + キーワードのあとに独立配置 (paintResult 内で差し込む)。 -->
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
    // v1018 「PDFにする」ボタンは共有モーダル内に移動
    document.getElementById('pft-share-dialog')?.addEventListener('click', () => {
      const t = d.result?.title_translated || d.result?.title_original || d.pdf_name || '論文全訳';
      shareDialog('📑 論文全訳: ' + t, '#/paper-translate-full/r/' + token,
        { pdfTitle: `全訳 - ${t}` });
    });
    // v914 share_priced=1 の row は toggle で差額追加課金/返金。事前に確認プロンプト。
    document.getElementById('pft-share-toggle')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const wasOn = btn.dataset.on === '1';
      if (d.share_priced) {
        const paid = Number(d.cost_points || 0);
        const half = Math.floor(paid / 2);
        const msg = wasOn
          ? `非公開に戻すと半額割引が停止して差額 ${paid}pt が追加課金されます。 (現在 ${paid}pt 支払済 → ${paid + paid}pt に)。続けますか?`
          : `🎁 公開 ON にすると半額割引が発動して ${half}pt が返金されます。 (現在 ${paid}pt 支払済 → ${paid - half}pt に)。続けますか?`;
        if (!confirm(msg)) return;
      }
      btn.disabled = true;
      try {
        await patch('/api/ai/paper_full_translate/' + d.id, { is_shared: !wasOn });
        toast(!wasOn ? '公開しました' : '非公開にしました');
        refresh(token);
      } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; }
    });
    // v1331 fb#514 詳細からその場で削除 (PDF ごと)。削除後は履歴一覧に戻る。
    document.getElementById('pft-delete')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (!confirm('この全訳を完全に削除しますか?\n(PDF も一緒に削除、復元不可)')) return;
      btn.disabled = true; const old = btn.textContent; btn.textContent = '🗑 削除中…';
      try {
        await del('/api/ai/paper_full_translate/' + d.id);
        toast('削除しました');
        location.hash = '#/paper-translate-full?tab=mine';
      } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = old; }
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
  await initLabUsersCache();   // v1004 著者アバター用
  //   v1003 冒頭のタイトル重複表示は削除 (header で既に出ている)。
  //   代わりに要約側と同様に著者カードを一番先に出す。
  root.innerHTML = `
    ${(() => {
      // v992 著者カードは r.authors 文字列を第一ソースに (要約 view と統一)。
      //   Front matter parse (affiliation/email 付き) は r.authors が拾えたら merge、
      //   完全に空なら fallback として単独で使う。これで従来の「r.authors のヘッダ表示」と
      //   「Front matter 由来カード」の 2 ブロック重複を解消。「責任著者」ラベル問題も
      //   Front matter 単独時に出ていた変な訳語 (Corresponding author の直訳) が消える。
      if (!Array.isArray(r.chapters) || !r.chapters.length) return '';
      const kws = extractKeywordsFromChapters(r.chapters);
      const filtered = r.chapters.filter(ch => !isBoilerplateChapter(ch));
      const authors = mergeAuthors(r.authors, r.chapters);
      let out = renderAuthorCards(authors);
      // v1224 キーワードスロット (中村さん指摘「全訳にするとキーワードが消える」)。
      //   1. sync: chapters から抽出 (直接の Keywords 章 or front matter/abstract の Keywords 行)
      //   2. async: 空なら sibling summary の keywords を取ってきて差し込む
      out += `<div id="pft-kw-slot">${kws.length ? renderKwCardHtml(kws) : ''}</div>`;
      // v1214/v1223 中村さん要望「タブは著者情報の下に」→ 著者 + キーワードの後、章別翻訳の前に挿入。
      out += renderFullCrossRefsAndCreate(d);
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

    ${u.total_tokens || u.chapters_count ? `
      <div class="hint-sm" style="text-align:right; margin-top:8px; padding:4px 8px; font-size:11px; color:#9ca3af">
        📊 ${u.input_tokens||0} in / ${u.output_tokens||0} out / 計 ${u.total_tokens||0} tok ・章 ${u.chapters_count||0} 本
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
    // v1219/v1220 詳細ページでだけ 💬 fab を出す
    setAiContext({
      sourceType: 'paper_translate_full', sourceId: Number(d.id),
      title: (d.pdf_name || '論文全訳'),
    });
  }
  // v813 #405 ペアの要約を作るボタン
  bindMakeSummary(d);
  // v1224/v1225 キーワード: sibling summary があればその keywords を優先 (中村さん指摘
  //   「要約と全訳で表示されるキーワード違うの気持ち悪い」)。 summary は AI 構造化の
  //   r.keywords、全訳は Keywords 章抽出で一致しないため、 sibling があれば上書きで統一。
  //   sibling 無しの場合のみ全訳側の chapters 抽出 (sync render で既に入っている) を使う。
  const kwSlot = document.getElementById('pft-kw-slot');
  if (kwSlot) {
    const summaryRef = (d.cross_refs || []).find(x => x.kind === 'paper_translate');
    if (summaryRef && summaryRef.share_token) {
      (async () => {
        try {
          const sib = await get('/api/ai/paper_translate/r/' + encodeURIComponent(summaryRef.share_token));
          const sibKws = Array.isArray(sib?.result?.keywords) ? sib.result.keywords.filter(x => x && typeof x === 'string').slice(0, 20) : [];
          if (sibKws.length && kwSlot) {
            kwSlot.innerHTML = renderKwCardHtml(sibKws);
            kwSlot.querySelectorAll('[data-pft-kw]').forEach(b => {
              b.addEventListener('click', (ev) => {
                ev.preventDefault();
                const q = String(b.dataset.pftKw || '').trim();
                if (q) location.hash = '#/paper-translate-full?q=' + encodeURIComponent(q);
              });
            });
          }
        } catch (_) { /* silent */ }
      })();
    }
  }
  // v955 キーワードのクリック → 公開全訳一覧の検索に、
  // v1004 著者名のクリック → 著者ページ (/#/authors/{name}) に。
  document.querySelectorAll('[data-pft-kw]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.pftKw || '').trim();
      if (!q) return;
      location.hash = '#/paper-translate-full?q=' + encodeURIComponent(q);
    });
  });
  document.querySelectorAll('[data-pft-author]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = String(b.dataset.pftAuthor || '').trim();
      if (!q) return;
      location.hash = '#/authors/' + encodeURIComponent(q);
    });
  });
  // v1004 著者アバター Gravatar への動的差し替え
  mountAuthorAvatars(document.getElementById('app'));
}

// v813/v1214 cross_refs を「要約 / 全訳」のタブバーに昇華 (中村さん要望
//   「1 つの論文を扱うのでタブで切り替える形式にしたら良いのかも」)。
//   スラッグはそのまま (URL は個別)、タブ UI で相互リンクを明示する。
function renderFullCrossRefsAndCreate(d) {
  return _renderPaperTabBar(d, 'full');
}
// 共通 tab bar: 現在ページを active、反対側は (a) 存在すればその share_token へ link、
//   (b) 存在しないが本人 + status=done + PDF ありなら「+ 作る」ボタン、 (c) それ以外は grey。
function _renderPaperTabBar(d, currentKind) {
  const refs = Array.isArray(d.cross_refs) ? d.cross_refs : [];
  const myUid = Number(state.me?.id || 0);
  const isOwner = !!d.author_id && Number(d.author_id) === myUid;
  const summaryRef = refs.find(x => x.kind === 'paper_translate');
  const fullRef    = refs.find(x => x.kind === 'paper_full_translation');
  const canCreateSummary = isOwner && d.status === 'done' && !!d.pdf_path && !summaryRef;
  const canCreateFull    = isOwner && d.status === 'done' && !!d.pdf_path && !fullRef;
  const active = 'background:#7b3fa0; color:#fff; border:1px solid #7b3fa0; border-bottom:1px solid #7b3fa0';
  const linked = 'background:#f9fafb; color:#374151; border:1px solid #d1d5db; text-decoration:none';
  const create = 'background:#fff; color:#7b3fa0; border:1px dashed #7b3fa0';
  const grey   = 'background:#f3f4f6; color:#9ca3af; border:1px solid #e5e7eb; opacity:0.7';
  const base   = 'display:inline-block; font-size:13px; padding:6px 14px; border-radius:6px 6px 0 0';
  const tabHtml = (label, isActive, href, createId, canCreate) => {
    if (isActive) return `<span style="${base}; ${active}; font-weight:600">${label}</span>`;
    if (href)     return `<a href="${href}" style="${base}; ${linked}">${label}</a>`;
    if (canCreate) return `<button class="btn" id="${createId}" style="${base}; ${create}; cursor:pointer">＋ ${label} を作る</button>`;
    return `<span style="${base}; ${grey}">${label} (未作成)</span>`;
  };
  const summaryTab = tabHtml('📄 要約', currentKind === 'summary',
    summaryRef ? `#/${escapeHtml(summaryRef.url_slug)}/r/${escapeHtml(summaryRef.share_token)}` : null,
    'pft-make-summary', canCreateSummary);
  const fullTab = tabHtml('📑 全訳', currentKind === 'full',
    fullRef ? `#/${escapeHtml(fullRef.url_slug)}/r/${escapeHtml(fullRef.share_token)}` : null,
    'pt-make-full', canCreateFull);
  // v1217 中村さん指摘「タブ表示がおかしい」→ .row は子要素を flex:1 で引き伸ばす CSS があり
  //   タブが巨大化していた。単純な display:flex で幅を子要素の実サイズに。
  return `<div style="display:flex; gap:4px; margin-top:6px; border-bottom:2px solid #7b3fa0; padding-bottom:0; flex-wrap:wrap">${summaryTab}${fullTab}</div>`;
}

async function bindMakeSummary(d) {
  const btn = document.getElementById('pft-make-summary');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const { openModal } = await import('../modal.js');
  btn.addEventListener('click', async () => {
    const html = `
      <p style="font-size:13px; margin:0 0 8px">この PDF で論文要約を開始します。課金はポイント残高から。</p>
      <label class="field"><span class="lbl">モデル</span>
        <select id="mfs-model" style="font-size:13px">
          <option value="gpt-5" selected>gpt-5 (63pt)</option>
          <option value="o1">o1 (100pt)</option>
        </select>
      </label>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px">
        <input type="checkbox" id="mfs-auto-share"> 🌐 完了と同時に公開 ON
      </label>`;
    // v1217 中村さん報告「キャンセルが押せない」の原因: openModal の onClick は
    //   (api) を受け取る契約だが (close) と誤解し呼ぶと api() = TypeError で沈黙。
    //   primary: true も効かない (kind: 'primary' が正解)。両方修正。
    openModal({
      title: '📄 要約を作る',
      bodyHtml: html,
      buttons: [
        { label: 'キャンセル', kind: 'btn', onClick: (m) => m.close() },
        { label: '開始', kind: 'primary', onClick: async (m) => {
          const model = document.getElementById('mfs-model')?.value || 'gpt-5';
          const auto_share = !!document.getElementById('mfs-auto-share')?.checked;
          try {
            const j = await post(`/api/ai/paper_translate/from_full/${d.id}`, { model, auto_share });
            m.close();
            toast('📄 要約を開始しました');
            if (j?.share_token) location.hash = '#/paper-summary/r/' + encodeURIComponent(j.share_token);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        }},
      ],
    });
  });
}

// v955 論文本体と無関係のボイラープレート章を判定 (章別翻訳から除外)。
//   Front matter は上部の著者カードで別出しにするのでここでは除外。
function isBoilerplateChapter(ch) {
  const t = String(ch?.chapter_title_original || '').trim().toLowerCase();
  return /^(ccs (concept|categorie)|keywords?|acm reference format|permission|copyright|references|bibliography|acknowledg?ments?|appendix|front matter|title page)/.test(t);
}

// v1224 キーワードカード HTML を生成 (sync/async 両方で使う)
function renderKwCardHtml(kws) {
  if (!kws || !kws.length) return '';
  return `
    <div class="card" style="background:#faf5ff">
      <div class="bold" style="color:#7b3fa0; font-size:13px; margin-bottom:6px">🏷 キーワード</div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        ${kws.map(kw => `<button data-pft-kw="${escapeHtml(kw)}" class="btn" style="background:#f3e8ff; color:#7b3fa0; font-size:12px; padding:2px 10px; border:1px solid #d8b4fe; border-radius:12px; cursor:pointer">${escapeHtml(kw)}</button>`).join('')}
      </div>
      <div class="hint-sm" style="margin-top:6px">タップで公開全訳から関連論文を検索</div>
    </div>`;
}

// v955/v1224 Keywords 章 or Front matter / Abstract 章の「Keywords: ...」行から抽出
//   多くの論文で Keywords が独立章になっていないので、 front matter や冒頭章の中も走査。
//   中村さん指摘「全訳にするとキーワードが消える」対応。
function extractKeywordsFromChapters(chapters) {
  const parseLine = (raw) => {
    let text = String(raw || '').trim();
    text = text.replace(/^\s*(keywords?|キーワード)\s*[:：]?\s*/i, '').trim();
    return text.split(/[,;、・；]+/).map(s => s.trim()).filter(s => s.length && s.length <= 60).slice(0, 20);
  };
  // (a) 独立 Keywords 章
  const kwCh = chapters.find(c => /^keywords?/i.test(String(c?.chapter_title_original || '').trim()));
  if (kwCh) {
    const kws = parseLine(kwCh.translation);
    if (kws.length) return kws;
  }
  // (b) front matter / abstract / index terms 章の中の「Keywords: ...」/「キーワード: ...」行
  for (const c of chapters) {
    const t = String(c?.chapter_title_original || '').toLowerCase().trim();
    if (!/^(front matter|title page|abstract|index terms|ccs (concept|categorie))/.test(t)) continue;
    const body = String(c?.translation || '');
    // 行単位で Keywords: ... を探す
    const m = /(?:^|\n)\s*(?:keywords?|index terms|キーワード)\s*[:：]([^\n]+)/i.exec(body);
    if (m) {
      const kws = parseLine(m[1]);
      if (kws.length) return kws;
    }
  }
  return [];
}

// v955/v957 Front matter 章の訳テキストから著者ブロックをパース。
//   フォーマット 2 種類:
//     (a) 1 行「Name（所属, email）」形式 (半角/全角括弧両方対応、 gpt-5 v953+)
//     (b) 空行区切りブロック「Name\n所属\n国\nemail」形式 (旧 gpt-5)
//   (a) を先に試して、見つからなかったら (b) に fallback。
// v992 r.authors 文字列 (再精査済で全著者フルネーム) を主ソースにし、
//   Front matter parse で affiliation / email を merge (名前一致で)。
//   r.authors が空なら Front matter 単独 fallback。
function mergeAuthors(authorsStr, chapters) {
  const fromStr = parseAuthorsFromString(authorsStr);
  const fromFm  = parseAuthorsFromChapters(chapters || []);
  if (!fromStr.length) return fromFm;
  if (!fromFm.length)  return fromStr;
  // 名前一致で affiliation / email を merge (surname か fullname の含有で緩め判定)
  return fromStr.map(a => {
    const cmp = a.name.toLowerCase();
    const fm = fromFm.find(f => {
      const fn = f.name.toLowerCase();
      return fn === cmp || fn.includes(cmp) || cmp.includes(fn);
    });
    return fm ? { ...a, affiliation: fm.affiliation, email: fm.email } : a;
  });
}

// 「Kelly Mack, Emma McDonnell, Dhruv Jain, ...」形式を分解して [{name}, ...]。
function parseAuthorsFromString(s) {
  if (!s || typeof s !== 'string') return [];
  const cleaned = s
    .replace(/,\s*and\s+/gi, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .replace(/\bet al\.?/gi, '');
  return cleaned.split(/[,;、]/)
    .map(x => x.trim())
    .filter(x => x.length > 1 && x.length <= 80)
    .map(name => ({ name, affiliation: '', email: '' }));
}

function parseAuthorsFromChapters(chapters) {
  const fmCh = chapters.find(c => /^(front matter|title page)/i.test(String(c?.chapter_title_original || '').trim()));
  if (!fmCh) return [];
  const text = String(fmCh.translation || '');
  const authors = [];

  // (a) 1 行括弧パターン
  for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([^（(]{2,80})\s*[（(]\s*(.+?)\s*[)）]\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    const rest = m[2];
    const emailMatch = rest.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (!emailMatch) continue;
    if (/^(figure|table|abstract|keywords?)\b/i.test(name)) continue;
    const affiliation = rest.replace(emailMatch[0], '')
      .replace(/,\s*,/g, ',').replace(/,\s*$/, '').replace(/^,\s*/, '').trim();
    authors.push({ name, affiliation, email: emailMatch[0] });
  }
  if (authors.length) return authors.slice(0, 30);

  // (b) 空行区切りブロック (旧 format) fallback
  const blocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const emailIdx = lines.findIndex(l => /[\w.+-]+@[\w-]+\.[\w-]+/.test(l));
    if (emailIdx < 0) continue;
    const emailMatch = lines[emailIdx].match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (!emailMatch) continue;
    const name = lines[0];
    if (name.length > 80) continue;
    if (/\.$/.test(name)) continue;
    if (/^(figure|table|abstract|keywords?)\b/i.test(name)) continue;
    const affiliation = lines.slice(1, emailIdx).join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '');
    authors.push({ name, affiliation, email: emailMatch[0] });
  }
  return authors.slice(0, 30);
}

// v955 名前から決定的に色とイニシャルを生成 (顔画像の代替、外部 API なし)。
function initialsAvatar(name) {
  const clean = String(name || '').trim();
  if (!clean) return { initials: '?', color: '#9ca3af' };
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '');
  // ハッシュから色 (パステル系の色相だけ変える)
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { initials: initials.toUpperCase().slice(0, 2), color: `hsl(${hue}, 55%, 55%)` };
}

function renderAuthorCards(authors) {
  if (!authors.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); font-size:13px; margin-bottom:8px">👥 著者 <span class="hint-sm" style="font-weight:normal">タップで著者ページ (LabPay 内の他論文 / Google Scholar 等)</span></div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:8px">
        ${authors.map(a => `
          <div style="display:flex; gap:10px; padding:8px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; min-width:0">
            ${renderAuthorAvatar({ name: a.name, email: a.email }, { size: 38 })}
            <div style="flex:1; min-width:0; font-size:12px">
              <button data-pft-author="${escapeHtml(a.name)}" class="bold" style="font-size:13px; background:none; border:none; padding:0; color:#7b3fa0; cursor:pointer; text-align:left; font-family:inherit; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.name)}</button>
              ${a.affiliation ? `<div style="color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHtml(a.affiliation)}">${escapeHtml(a.affiliation)}</div>` : ''}
              ${a.email ? `<a href="mailto:${escapeHtml(a.email)}" style="font-size:11px; color:#7b3fa0; text-decoration:none">${escapeHtml(a.email)}</a>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// v1226 中村さん指摘「全訳にページ番号が混じるケース」対策の描画時サニタイザ。
//   PDF 由来の単独行ページ番号 / 「Page N of M」/ 「N ページ」/ 章の末尾空白を除去。
//   段落の途中に現れる数字は触らない (引用/数式/年号で混乱するので)。
function sanitizeChapterTranslation(text) {
  if (!text) return '';
  let s = String(text);
  // 単独行のページ番号 (1〜4 桁)
  s = s.replace(/(^|\n)\s*\d{1,4}\s*(?=\n|$)/g, '\n');
  // 「Page N (of M)?」/「p. N」/「N ページ」単独行
  s = s.replace(/(^|\n)\s*(?:Page|Pg\.?|p\.?|ページ|頁)\s*\d+(?:\s*(?:of|\/|・)?\s*\d+)?\s*(?=\n|$)/gi, '\n');
  // 3 連以上の空行を 2 連に圧縮
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function renderChapter(ch, idx, direction) {
  const titleOrig = ch.chapter_title_original || '';
  const titleTrans = ch.chapter_title_translated || '';
  const samples = Array.isArray(ch.back_translation_samples) ? ch.back_translation_samples : [];
  const terms = Array.isArray(ch.key_terms) ? ch.key_terms : [];
  const cleanedTranslation = sanitizeChapterTranslation(ch.translation || '');
  // v808 #399 章番号 (1, 2, ...) を出さない。元タイトルに既に「1.」「Chapter 1」「第1章」等
  //   が含まれてるケースが多く、二重表記で違和感があった。タイトルをそのまま出す。
  return `
    <div style="padding:10px 12px; border-left:3px solid var(--primary); background:#fafafa; border-radius:0 6px 6px 0">
      <div class="bold" style="font-size:14px; color:var(--primary)">${escapeHtml(titleTrans || '(無題)')} ${titleOrig ? `<span style="font-size:12px; color:#6b7280; font-weight:400">(${escapeHtml(titleOrig)})</span>` : ''}</div>
      <div style="font-size:13.5px; line-height:1.85; margin-top:8px; white-space:pre-wrap">${escapeHtml(cleanedTranslation)}</div>
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
