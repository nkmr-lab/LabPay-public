// /#/paper-translate — v748 #359-#361 / v750 #365-#367 論文 和訳 要約。
//   PDF を OpenAI Files API 経由で GPT-4o に直接読ませ、 論文構造に沿った 詳細サマリ +
//   重要 図表 (ページ画像 を pdftoppm で 抽出 表示) + 最後 に 落合メソッド の 6 項目 で
//   全体 を 重ね合わせて まとめる。 結果は share_token で URL 共有可能。

import { get, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let sharedPollTimer = null;

export async function renderPaperTranslate() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文要約 <span style="font-size:12px; color:#9ca3af; font-weight:normal">(自動翻訳)</span></h2>
    </div>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        論文 PDF を アップ すると、 全体要約 → RQ/仮説 + 結果 → 主張する貢献 → 章立て要約 (重要図表 inline) →
        今後の課題 → 落合メソッドまとめ という 順番 で 構造化 して 返します。 全体 1500-2500 字 (≒ 3-5 分 で 読める 分量)。
      </p>
      <label class="field">
        <span class="lbl">🤖 モデル (高い ほど 高品質)</span>
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
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pt-go" class="primary" disabled>📑 要約を作る</button>
      </div>
    </div>
    <div id="pt-result"></div>
    <!-- v756 #372 自分 の 履歴 と みんな の 公開 一覧 を タブ で 切替 -->
    <div class="card" style="margin-top:8px">
      <div class="row" style="gap:6px; margin-bottom:8px; align-items:center">
        <button id="pt-tab-mine"   class="btn primary" data-tab="mine"   style="font-size:13px">📜 自分の履歴</button>
        <button id="pt-tab-shared" class="btn"         data-tab="shared" style="font-size:13px">🌐 みんなの公開要約</button>
        <span style="flex:1"></span>
        <input type="search" id="pt-search" placeholder="🔍 検索 (公開のみ、 タイトル / 著者 / 本文)" maxlength="100" style="font-size:13px; padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; min-width:180px" hidden>
      </div>
      <div id="pt-history"><div class="muted">読み込み中…</div></div>
    </div>
  `;
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
    fileStatus.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size / 1024 / 1024).toFixed(1)} MB)</span>`;
    btn.disabled = false;
  });
  btn.addEventListener('click', go);
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

async function go() {
  const fileInput = document.getElementById('pt-file');
  const f = fileInput.files[0];
  if (!f) { toast('PDF を 選んで ください'); return; }
  const btn = document.getElementById('pt-go');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const fd = new FormData();
    fd.append('file', f);
    const model = document.getElementById('pt-model')?.value || 'gpt-4o';
    fd.append('model', model);
    const resp = await fetch('/api/ai/paper_translate', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    toast('要約 開始 (' + (j.model || model) + ')');
    location.hash = '#/paper-translate/r/' + j.share_token;
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false; btn.textContent = oldText;
  }
}

async function loadHistory() {
  try {
    const d = await get('/api/ai/paper_translate');
    updateModelInfo(d);
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('pt-history').innerHTML = '<div class="empty">まだ 要約 履歴 が ありません</div>';
      return;
    }
    document.getElementById('pt-history').innerHTML = items.map(it => {
      const sharedBadge = it.is_shared ? ' <span class="tag ok" style="font-size:10px">🌐 公開中</span>' : '';
      return `
        <a href="#/paper-translate/r/${escapeHtml(it.share_token)}" class="list-item" style="text-decoration:none; color:inherit; gap:8px">
          <div style="flex:none; font-size:20px">${it.status === 'done' ? '📑' : it.status === 'error' ? '❌' : '⏳'}</div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.pdf_name)}${sharedBadge}</div>
            <div class="hint-sm" style="font-size:11px">${escapeHtml(it.created_at)} · ${escapeHtml(it.status)}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('pt-history').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v756 #372 みんな の 公開 要約 一覧 (q= で 検索)
async function loadSharedList(q) {
  const root = document.getElementById('pt-history');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    const url = '/api/ai/paper_translate/shared' + (q ? '?q=' + encodeURIComponent(q) : '');
    const d = await get(url);
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = q
        ? `<div class="empty">「${escapeHtml(q)}」 に 該当 する 公開 要約 が ありません</div>`
        : '<div class="empty">まだ 公開 されて いる 要約 は ありません</div>';
      return;
    }
    root.innerHTML = items.map(it => {
      const title = it.title_ja || it.pdf_name;
      const meta = [it.authors, it.venue].filter(Boolean).join(' ・ ');
      const summary = it.summary_one_paragraph || '';
      return `
        <a href="#/paper-translate/r/${escapeHtml(it.share_token)}" class="list-item" style="text-decoration:none; color:inherit; gap:8px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #f0f0f0">
          <div style="flex:none; font-size:20px">📑</div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:14px">${escapeHtml(title)}</div>
            ${meta ? `<div class="hint-sm" style="font-size:11px; color:#666; margin-top:1px">${escapeHtml(meta)}</div>` : ''}
            ${summary ? `<div style="font-size:12px; color:#374151; margin-top:4px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical">${escapeHtml(summary)}</div>` : ''}
            <div class="hint-sm" style="font-size:10px; margin-top:3px; color:#9ca3af">${avatarHtml(it.author_name, it.author_avatar, 'xs')} ${escapeHtml(it.author_name)} · ${escapeHtml(it.shared_at || it.created_at)}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// /#/paper-translate/r/:token  個別 結果ページ。
export async function renderPaperTranslateShared() {
  const token = decodeURIComponent(location.hash.split('/').pop() || '');
  const app = document.getElementById('app');
  if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
  await refreshShared(token, app);
}

async function refreshShared(token, app) {
  if (!app) app = document.getElementById('app');
  try {
    const d = await get('/api/ai/paper_translate/r/' + encodeURIComponent(token));
    if (d.status === 'pending' || d.status === 'processing') {
      app.innerHTML = `
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
      `;
      if (!sharedPollTimer) sharedPollTimer = setInterval(() => refreshShared(token, app), 10000);
      return;
    }
    if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
    if (d.status === 'error') {
      app.innerHTML = `<div class="card"><div class="muted">❌ 要約失敗: ${escapeHtml(d.error_msg || '不明なエラー')}</div></div>`;
      return;
    }
    paintResult(d, token);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function paintResult(d, token) {
  const r = d.result || {};
  const app = document.getElementById('app');
  const shareUrl = location.origin + '/#/paper-translate/r/' + token;
  const pagesDir = d.pages_dir || null;
  const pagesCount = d.pages_count || 0;
  const meId = Number(state.me?.id) || 0;
  const isOwner = meId && meId === Number(d.author_id);
  const isShared = !!d.is_shared;
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0; font-size:18px">📑 ${escapeHtml(r.title_ja || d.pdf_name)}</h2>
      ${r.title_orig ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(r.title_orig)}</div>` : ''}
      ${r.authors ? `<div class="meta" style="font-size:13px; margin-top:2px">👥 ${escapeHtml(r.authors)}</div>` : ''}
      ${r.venue ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(r.venue)}</div>` : ''}
      <div class="meta" style="font-size:11px; margin-top:6px">
        ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}
      </div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn" id="pt-copy" style="font-size:12px; padding:3px 10px">🔗 共有 URL を コピー</button>
        ${isOwner ? `
          <button class="btn ${isShared ? 'primary' : ''}" id="pt-share-toggle" data-on="${isShared ? 1 : 0}" style="font-size:12px; padding:3px 10px">
            ${isShared ? '🌐 公開中 (タップで非公開)' : '🔒 非公開 (タップで公開)'}
          </button>` : ''}
        ${isShared && !isOwner ? '<span class="tag ok" style="font-size:11px">🌐 公開要約</span>' : ''}
        <a class="btn" href="#/paper-translate" style="font-size:12px; padding:3px 10px">← 一覧へ</a>
      </div>
    </div>

    ${r.summary_one_paragraph ? `
    <div class="card" style="background:linear-gradient(135deg,#ede4f3,#fafaf5); border-left:4px solid var(--primary)">
      <div class="bold" style="color:var(--primary); margin-bottom:6px">📌 まず 全体 要約</div>
      <div style="font-size:14px; line-height:1.7; white-space:pre-wrap">${escapeHtml(r.summary_one_paragraph)}</div>
    </div>` : ''}

    ${renderRqHypothesis(r.rq_hypothesis)}

    ${renderListSection('🎯 主張する 貢献', r.contributions)}

    ${renderDetailedSections(r.detailed_sections, pagesDir, pagesCount)}

    ${renderListSection('🚀 今後 の 課題', r.future_work)}

    ${renderKeyReferences(r.key_references)}

    ${renderOchiai(r.ochiai_method || r.ochiai)}
  `;
  document.getElementById('pt-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('コピーしました');
    } catch (_) { toast(shareUrl); }
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

function pageImgUrl(pagesDir, page) {
  if (!pagesDir) return null;
  const padded = String(page).padStart(pagesDir.includes('paper_pages') ? 1 : 1, '0');
  // pdftoppm は page-1.jpg, page-2.jpg ... の 形 (パディングは 桁数次第 で 自動)
  //   → 桁数 を 推定: page < 10 は 1 桁、 100 未満 は 2 桁、 など
  return pagesDir + '/page-' + page + '.jpg';
}

function renderDetailedSections(sections, pagesDir, pagesCount) {
  if (!Array.isArray(sections) || !sections.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px; font-size:15px">📖 詳細 要約</div>
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
  const why = (fig && fig.why_important) ? String(fig.why_important) : '';
  const page = Number(fig?.page) || null;
  const region = (fig && fig.page_region) ? String(fig.page_region).toLowerCase() : 'full';
  const inRange = page && pagesCount && page >= 1 && page <= pagesCount;
  const imgUrl = (inRange && pagesDir) ? pageImgUrl(pagesDir, page) : null;
  // v757 #375 ページ画像 を page_region で crop 表示。 top/middle/bottom/full。
  //   object-position で 上下 オフセット + 視野 を 制限 して 図表 部分 だけ 見せる。
  const cropStyle = (() => {
    switch (region) {
      case 'top':    return 'height:230px; object-fit:cover; object-position:50% 0%';
      case 'middle': return 'height:230px; object-fit:cover; object-position:50% 50%';
      case 'bottom': return 'height:230px; object-fit:cover; object-position:50% 100%';
      default:       return 'max-height:300px; object-fit:contain';
    }
  })();
  return `
    <div style="display:flex; gap:10px; padding:8px 10px; background:#fafafa; border-left:3px solid var(--primary); border-radius:0 6px 6px 0; align-items:flex-start">
      ${imgUrl ? `
        <a href="#" data-pt-zoom="${escapeHtml(imgUrl)}" style="flex:none; display:block; width:200px; cursor:zoom-in">
          <img src="${escapeHtml(imgUrl)}" loading="lazy" style="width:200px; ${cropStyle}; background:#fff; border:1px solid #ddd; border-radius:4px">
          <div class="hint-sm" style="font-size:9px; text-align:center; margin-top:2px; color:#9ca3af">タップで全ページ表示</div>
        </a>` : ''}
      <div style="flex:1; min-width:0; font-size:13px">
        <div class="bold" style="color:#4a106d">${escapeHtml(label)}${page ? ` <span style="font-weight:normal; color:#666">(p.${page})</span>` : ''}</div>
        ${cap ? `<div style="margin-top:3px"><b>キャプション:</b> ${escapeHtml(cap)}</div>` : ''}
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
  let html = '<div class="card" style="background:#fafaf5; border:1px dashed #d4b8e0"><div class="bold" style="color:var(--primary); margin-bottom:6px; font-size:15px">📚 落合メソッド で まとめ</div><div class="hint-sm" style="font-size:11px; margin-bottom:8px">論文 全体 を 6 項目 で 重ね合わせ</div>';
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
function renderRqHypothesis(rh) {
  if (!rh || typeof rh !== 'object') return '';
  const rqs = Array.isArray(rh.research_questions) ? rh.research_questions : [];
  const hys = Array.isArray(rh.hypotheses)         ? rh.hypotheses         : [];
  if (!rqs.length && !hys.length) return '';
  const rqHtml = rqs.map(item => {
    if (typeof item === 'string') return `<div style="padding:8px 12px; background:#eef2ff; border-left:3px solid #4f46e5; border-radius:0 6px 6px 0; margin-bottom:6px"><div class="bold" style="font-size:13px; color:#4f46e5">RQ</div><div style="font-size:14px">${escapeHtml(item)}</div></div>`;
    const rq = item?.rq ? String(item.rq) : '';
    const ans = item?.answer ? String(item.answer) : '';
    return `<div style="padding:8px 12px; background:#eef2ff; border-left:3px solid #4f46e5; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#4f46e5">❓ ${escapeHtml(rq)}</div>
      ${ans ? `<div style="font-size:13px; margin-top:4px"><b>✅ 結果:</b> ${escapeHtml(ans)}</div>` : ''}
    </div>`;
  }).join('');
  const hyHtml = hys.map(item => {
    if (typeof item === 'string') return `<div style="padding:8px 12px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0; margin-bottom:6px"><div class="bold" style="font-size:13px; color:#a16207">仮説</div><div style="font-size:14px">${escapeHtml(item)}</div></div>`;
    const hyp = item?.hypothesis ? String(item.hypothesis) : '';
    const res = item?.result     ? String(item.result)     : '';
    return `<div style="padding:8px 12px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0; margin-bottom:6px">
      <div class="bold" style="font-size:13px; color:#a16207">💡 ${escapeHtml(hyp)}</div>
      ${res ? `<div style="font-size:13px; margin-top:4px"><b>📊 結果:</b> ${escapeHtml(res)}</div>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px">🔬 RQ / 仮説 と 結果</div>
      ${rqHtml}
      ${hyHtml}
    </div>`;
}

// v757 #375 参考文献 で 特に 重要 な もの。
function renderKeyReferences(refs) {
  if (!Array.isArray(refs) || !refs.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:8px">📚 押さえて おく べき 参考文献</div>
      <div style="display:flex; flex-direction:column; gap:8px">
        ${refs.map(ref => {
          const cit = ref?.citation ? String(ref.citation) : '';
          const title = ref?.title ? String(ref.title) : '';
          const why = ref?.why_important ? String(ref.why_important) : '';
          return `
            <div style="padding:8px 10px; background:#fafafa; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0; font-size:13px">
              <div class="bold" style="color:#6b21a8">${escapeHtml(cit)}${title ? ` ・ ${escapeHtml(title)}` : ''}</div>
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
