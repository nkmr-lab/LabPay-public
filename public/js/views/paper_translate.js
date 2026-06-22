// /#/paper-translate — v748 #359-#361 / v750 #365-#367 論文 和訳 要約。
//   PDF を OpenAI Files API 経由で GPT-4o に直接読ませ、 論文構造に沿った 詳細サマリ +
//   重要 図表 (ページ画像 を pdftoppm で 抽出 表示) + 最後 に 落合メソッド の 6 項目 で
//   全体 を 重ね合わせて まとめる。 結果は share_token で URL 共有可能。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let sharedPollTimer = null;

export async function renderPaperTranslate() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文 和訳 要約</h2>
    </div>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        論文 PDF を アップ すると、 GPT-4o が 論文構造 に 沿った 詳細サマリ + 重要な 図表 (ページ画像 を 抽出 して 表示) +
        RQ / 仮説 / 貢献 / 今後の課題 を 整理 し、 最後 に 落合陽一メソッド の 6 項目 で 全体 を 重ね合わせて まとめます。
        全体 1500-2500 字 (≒ 3-5 分 で 読める 分量)。 <b>1 回 20pt がシステムに支払われます</b>。
      </p>
      <label class="field">
        <span class="lbl">論文 PDF (最大 30 MB)</span>
        <input type="file" id="pt-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pt-file-status" style="margin-top:4px"></div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pt-go" class="primary" disabled>📑 要約を作る (20pt)</button>
      </div>
    </div>
    <div id="pt-result"></div>
    <div id="pt-history" class="card" style="margin-top:8px"><div class="muted">過去の要約履歴…</div></div>
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
  await loadHistory();
}

async function go() {
  const fileInput = document.getElementById('pt-file');
  const f = fileInput.files[0];
  if (!f) { toast('PDF を 選んで ください'); return; }
  const btn = document.getElementById('pt-go');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const fd = new FormData();
    fd.append('file', f);
    const resp = await fetch('/api/ai/paper_translate', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    toast('要約 開始 (1-4 分)');
    location.hash = '#/paper-translate/r/' + j.share_token;
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false; btn.textContent = '📑 要約を作る (20pt)';
  }
}

async function loadHistory() {
  try {
    const d = await get('/api/ai/paper_translate');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('pt-history').innerHTML = '<div class="empty">まだ 要約 履歴 が ありません</div>';
      return;
    }
    document.getElementById('pt-history').innerHTML = `
      <div class="bold" style="margin-bottom:6px">📜 過去の要約</div>
      ${items.map(it => `
        <a href="#/paper-translate/r/${escapeHtml(it.share_token)}" class="list-item" style="text-decoration:none; color:inherit; gap:8px">
          <div style="flex:none; font-size:20px">${it.status === 'done' ? '📑' : it.status === 'error' ? '❌' : '⏳'}</div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.pdf_name)}</div>
            <div class="hint-sm" style="font-size:11px">${escapeHtml(it.created_at)} · ${escapeHtml(it.status)}</div>
          </div>
        </a>
      `).join('')}
    `;
  } catch (e) {
    document.getElementById('pt-history').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
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
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0; font-size:18px">📑 ${escapeHtml(r.title_ja || d.pdf_name)}</h2>
      ${r.title_orig ? `<div class="meta" style="font-size:13px; opacity:0.8; margin-top:2px">原題: ${escapeHtml(r.title_orig)}</div>` : ''}
      ${r.authors ? `<div class="meta" style="font-size:13px; margin-top:2px">👥 ${escapeHtml(r.authors)}</div>` : ''}
      ${r.venue ? `<div class="meta" style="font-size:13px; margin-top:2px">📍 ${escapeHtml(r.venue)}</div>` : ''}
      <div class="meta" style="font-size:11px; margin-top:6px">
        ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の依頼 · ${escapeHtml(d.created_at)}
      </div>
      <div class="row" style="gap:6px; margin-top:8px">
        <button class="btn" id="pt-copy" style="font-size:12px; padding:3px 10px">🔗 共有 URL を コピー</button>
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

    ${renderOchiai(r.ochiai_method || r.ochiai)}
  `;
  document.getElementById('pt-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('コピーしました');
    } catch (_) { toast(shareUrl); }
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
  const inRange = page && pagesCount && page >= 1 && page <= pagesCount;
  const imgUrl = (inRange && pagesDir) ? pageImgUrl(pagesDir, page) : null;
  return `
    <div style="display:flex; gap:10px; padding:8px 10px; background:#fafafa; border-left:3px solid var(--primary); border-radius:0 6px 6px 0">
      ${imgUrl ? `
        <a href="#" data-pt-zoom="${escapeHtml(imgUrl)}" style="flex:none; display:block; width:140px; cursor:zoom-in">
          <img src="${escapeHtml(imgUrl)}" loading="lazy" style="width:140px; max-height:200px; object-fit:contain; background:#fff; border:1px solid #ddd; border-radius:4px">
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
    const txt = (o[key] || '').toString().trim();
    if (!txt) continue;
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
