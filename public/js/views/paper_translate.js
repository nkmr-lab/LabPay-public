// /#/paper-translate — v748 #359 #360 #361 論文 和訳 要約 (落合メソッド + 図表ピックアップ + 20pt)。
//   PDF を OpenAI Files API 経由で GPT-4o に直接読ませ、 落合メソッド の 章立て で
//   3-5 分 (= 1500-2500 字) 程度 の 構造化 要約 を 作る。 結果は share_token で URL 共有可能。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let sharedPollTimer = null;

export async function renderPaperTranslate() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文 和訳 要約 (落合メソッド)</h2>
    </div>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        論文 PDF を アップ すると、 GPT-4o が <b>落合陽一メソッド</b> で 章立て 要約 +
        リサーチクエスチョン / 貢献 / 今後の課題 / 重要図表 を 抽出 して 返します。
        全体 1500-2500 字 (≒ 3-5 分 で 読める 分量)。 <b>1 回 ${escapeHtml('20pt がシステムに支払われます')}</b>。
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
      <div class="bold" style="color:var(--primary); margin-bottom:6px">📌 一段落 サマリ</div>
      <div style="font-size:14px; line-height:1.7; white-space:pre-wrap">${escapeHtml(r.summary_one_paragraph)}</div>
    </div>` : ''}

    ${renderOchiai(r.ochiai)}

    ${renderListSection('🔬 RQ と 仮説',
        [...(r.rq_hypothesis?.research_questions || []).map(s => '【RQ】 ' + s),
         ...(r.rq_hypothesis?.hypotheses          || []).map(s => '【H】 ' + s)])}

    ${renderListSection('🎯 主張する 貢献', r.contributions)}

    ${renderListSection('🚀 今後 の 課題', r.future_work)}

    ${renderFigures(r.important_figures)}
  `;
  document.getElementById('pt-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('コピーしました');
    } catch (_) { toast(shareUrl); }
  });
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
  let html = '<div class="card"><div class="bold" style="color:var(--primary); margin-bottom:6px">📚 落合メソッド</div>';
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

function renderFigures(figs) {
  if (!Array.isArray(figs) || !figs.length) return '';
  return `
    <div class="card">
      <div class="bold" style="color:var(--primary); margin-bottom:6px">🖼 重要 な 図 / 表</div>
      <div class="hint-sm" style="font-size:11px; margin-bottom:8px">※ v1 では 図 / 表 の 抽出 までは していません。 番号を 参考 に 元 PDF を 確認 して ください</div>
      <div style="display:flex; flex-direction:column; gap:10px">
        ${figs.map(fig => {
          const label = (fig && fig.label) ? String(fig.label) : '';
          const cap = (fig && fig.caption_ja) ? String(fig.caption_ja) : '';
          const why = (fig && fig.why_important) ? String(fig.why_important) : '';
          return `
            <div style="padding:10px; background:#fafafa; border-left:3px solid var(--primary); border-radius:6px">
              <div class="bold" style="font-size:13px; color:#4a106d">${escapeHtml(label)}</div>
              ${cap ? `<div style="font-size:13px; margin-top:4px"><b>キャプション:</b> ${escapeHtml(cap)}</div>` : ''}
              ${why ? `<div style="font-size:13px; margin-top:4px"><b>なぜ重要:</b> ${escapeHtml(why)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
