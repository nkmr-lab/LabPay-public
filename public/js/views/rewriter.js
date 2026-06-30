// v613 文字数 / 単語数制限リライター。 アブスト・リバッタルの文字数制限と戦うためのツール。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

export async function renderRewriter() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">✂️ 文字数・単語数リライター</h2>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        アブストやリバッタルなど、 文字数・単語数の上限と戦うためのツール。
        GPT の自己カウントは間違うので、 サーバ側で正確にカウントして超過時は再依頼します (最大3回)。
        <b>1回 1pt</b>。 失敗時は自動返金。
      </p>
    </div>
    <div class="card">
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">原稿</div>
        <textarea id="rw-text" class="input" rows="12" placeholder="ここに原稿を貼り付け…"></textarea>
        <div class="hint-sm" id="rw-count">— 文字 (スペースなし) / — 文字 (込み) / — 単語</div>
      </label>
      <div style="display:flex; gap:10px; margin-bottom:10px">
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">制限のモード</div>
          <select id="rw-mode" class="input">
            <option value="chars_no_space">スペースなし文字数</option>
            <option value="chars_with_space">スペース込み文字数</option>
            <option value="words">英単語数</option>
          </select>
        </label>
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">上限</div>
          <input id="rw-target" class="input" type="number" min="10" max="5000" value="200">
        </label>
      </div>
      <div style="display:flex; gap:8px; align-items:center">
        <button id="rw-go" class="btn primary">1pt を支払ってリライト</button>
        <span id="rw-status" class="hint-sm"></span>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">過去のリライト</h3>
      <div id="rw-list"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  const ta = document.getElementById('rw-text');
  const cnt = document.getElementById('rw-count');
  const updateCount = () => {
    const v = ta.value;
    const nWith = v.length;
    const nNo   = v.replace(/\s+/g, '').length;
    const nWord = (v.trim().match(/\S+/g) || []).length;
    cnt.textContent = `${nNo} 文字 (スペースなし) / ${nWith} 文字 (込み) / ${nWord} 単語`;
  };
  ta.addEventListener('input', updateCount);
  updateCount();
  document.getElementById('rw-go').addEventListener('click', async () => {
    const text = ta.value.trim();
    const mode = document.getElementById('rw-mode').value;
    const target = parseInt(document.getElementById('rw-target').value, 10);
    if (text.length < 20) { toast('原稿が短すぎ (20文字以上)'); return; }
    if (!(target >= 10 && target <= 5000)) { toast('上限は 10-5000'); return; }
    const btn = document.getElementById('rw-go');
    const sts = document.getElementById('rw-status');
    btn.disabled = true; btn.textContent = 'リライト中…';
    sts.textContent = 'GPT に依頼 (10-40秒)';
    try {
      const r = await post('/api/ai/rewriter', { text, mode, target });
      navigate('#/rewriter/' + r.id);
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
      btn.disabled = false; btn.textContent = '1pt を支払ってリライト';
      sts.textContent = '';
    }
  });
  await renderRewriterList();
}

async function renderRewriterList() {
  const root = document.getElementById('rw-list');
  try {
    const d = await get('/api/ai/rewriter');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<div class="hint">まだリライト履歴がありません</div>'; return; }
    root.innerHTML = items.map(it => `
      <a class="list-item" href="#/rewriter/${it.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(it.source_head || '')}…</div>
          <div class="meta" style="font-size:12px">
            ${modeLabel(it.target_mode)} 上限 ${it.target_count} →
            ${it.status === 'done'
              ? `${countForMode(it, it.target_mode)} (${it.iterations}回試行)`
              : statusBadge(it.status)}
            ・ ${escapeHtml(it.created_at)}
          </div>
        </div>
      </a>
    `).join('');
  } catch (e) { root.innerHTML = `<div class="hint">読み込み失敗</div>`; }
}

function modeLabel(m) {
  return { chars_no_space: 'スペースなし文字数', chars_with_space: 'スペース込み文字数', words: '英単語数' }[m] || m;
}
function countForMode(it, mode) {
  if (mode === 'chars_no_space') return `${it.rewritten_chars_no_space} 文字`;
  if (mode === 'chars_with_space') return `${it.rewritten_chars_with_space} 文字`;
  return `${it.rewritten_words} 単語`;
}
function statusBadge(s) {
  switch (s) {
    case 'pending':    return '<span style="background:#fef3c7; color:#946d00; padding:1px 6px; border-radius:6px; font-size:11px">待機</span>';
    case 'processing': return '<span style="background:#dbeafe; color:#1d4ed8; padding:1px 6px; border-radius:6px; font-size:11px">処理中</span>';
    case 'done':       return '<span style="background:#dcfce7; color:#15803d; padding:1px 6px; border-radius:6px; font-size:11px">完了</span>';
    case 'error':      return '<span style="background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:6px; font-size:11px">失敗 (返金済)</span>';
  }
  return '';
}

// 単純な単語レベル diff (LCS ベース)。 共通部分は灰色、 削除は赤、 追加は緑で表示
function wordDiff(a, b) {
  const aw = a.match(/\S+|\s+/g) || [];
  const bw = b.match(/\S+|\s+/g) || [];
  // LCS DP
  const m = aw.length, n = bw.length;
  const dp = Array.from({length: m + 1}, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aw[i-1] === bw[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
      else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  // バックトレース
  const ops = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (aw[i-1] === bw[j-1]) { ops.unshift({ t: 'same', w: aw[i-1] }); i--; j--; }
    else if (dp[i-1][j] >= dp[i][j-1]) { ops.unshift({ t: 'del', w: aw[i-1] }); i--; }
    else { ops.unshift({ t: 'add', w: bw[j-1] }); j--; }
  }
  while (i > 0) { ops.unshift({ t: 'del', w: aw[i-1] }); i--; }
  while (j > 0) { ops.unshift({ t: 'add', w: bw[j-1] }); j--; }
  return ops;
}

function renderDiffSide(ops, sideKind) {
  // sideKind: 'src' = 元 (delete マーカー / same は薄色) / 'dst' = 書き直し (add マーカー / same は薄色)
  return ops.map(op => {
    if (op.t === 'same') return `<span style="color:#666">${escapeHtml(op.w)}</span>`;
    if (op.t === 'del')  return sideKind === 'src' ? `<span style="background:#fecaca; color:#7f1d1d; text-decoration:line-through">${escapeHtml(op.w)}</span>` : '';
    if (op.t === 'add')  return sideKind === 'dst' ? `<span style="background:#d1fae5; color:#065f46; font-weight:600">${escapeHtml(op.w)}</span>` : '';
    return '';
  }).join('');
}

export async function renderRewriterDetail({ params }) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let d;
  try { d = await get('/api/ai/rewriter/' + id); }
  catch (e) {
    app.innerHTML = `<div class="card"><a href="#/rewriter" class="hint">← 一覧</a><div class="hint">${escapeHtml(e?.message || e)}</div></div>`;
    return;
  }
  if (d.status !== 'done') {
    app.innerHTML = `<div class="card">
      <a href="#/rewriter" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">✂️ リライト</h2>
      <div>${statusBadge(d.status)}</div>
      ${d.error_msg ? `<p style="margin-top:6px">${escapeHtml(d.error_msg)}</p>` : ''}
    </div>`;
    return;
  }

  const overTarget = countForMode(d, d.target_mode);
  const target = d.target_count;
  const overValue = (() => {
    if (d.target_mode === 'chars_no_space') return d.rewritten_chars_no_space;
    if (d.target_mode === 'chars_with_space') return d.rewritten_chars_with_space;
    return d.rewritten_words;
  })();
  const success = overValue <= target;

  const ops = wordDiff(d.source_text, d.rewritten_text);

  app.innerHTML = `
    <div class="card">
      <a href="#/rewriter" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">✂️ リライト結果</h2>
      <div style="font-size:13px">
        モード: <b>${modeLabel(d.target_mode)}</b> ・上限: <b>${target}</b> ・結果: <b style="color:${success ? '#15803d' : '#dc2626'}">${overTarget}</b> ${success ? '✓' : '⚠️'}
        ${d.iterations > 1 ? ` ・試行 ${d.iterations} 回` : ''}
      </div>
      <div class="hint-sm" style="margin-top:4px">
        元: ${d.source_chars_no_space}文字 (スペースなし) / ${d.source_chars_with_space}文字 (込み) / ${d.source_words}単語
        → 書き直し: ${d.rewritten_chars_no_space}文字 / ${d.rewritten_chars_with_space}文字 / ${d.rewritten_words}単語
        ${d.detected_lang === 'en' ? ' ・言語: 英文' : ' ・言語: 日本語'}
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">📝 元の原稿</h3>
      <div style="white-space:pre-wrap; font-size:14px; line-height:1.7; padding:8px; background:#fafafa; border-radius:6px">${renderDiffSide(ops, 'src')}</div>
      ${d.source_translation ? `
        <details style="margin-top:8px">
          <summary class="hint" style="cursor:pointer">🇯🇵 和訳を見る</summary>
          <div style="white-space:pre-wrap; font-size:13px; line-height:1.6; padding:8px; margin-top:6px; background:#f3f4f6; border-radius:6px">${escapeHtml(d.source_translation)}</div>
        </details>` : ''}
    </div>

    <div class="card">
      <div style="display:flex; align-items:center; gap:8px">
        <h3 style="margin:0; flex:1">✨ 書き直し</h3>
        <button id="rw-copy" class="btn" style="font-size:12px; padding:4px 8px">📋 コピー</button>
      </div>
      <div style="white-space:pre-wrap; font-size:14px; line-height:1.7; padding:8px; background:#fafafa; border-radius:6px; margin-top:6px">${renderDiffSide(ops, 'dst')}</div>
      ${d.rewritten_translation ? `
        <details style="margin-top:8px">
          <summary class="hint" style="cursor:pointer">🇯🇵 和訳を見る</summary>
          <div style="white-space:pre-wrap; font-size:13px; line-height:1.6; padding:8px; margin-top:6px; background:#f3f4f6; border-radius:6px">${escapeHtml(d.rewritten_translation)}</div>
        </details>` : ''}
    </div>

    <div class="hint-sm" style="text-align:center; padding:10px">
      🟥 削除部分 = 元にあって削った所、 🟩 追加部分 = 書き直しで足した所、 灰色 = 共通
    </div>
  `;
  document.getElementById('rw-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(d.rewritten_text);
      toast('書き直し原稿をコピーしました');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = d.rewritten_text; document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('コピーしました'); }
      catch (e) { toast('コピー失敗'); }
      finally { document.body.removeChild(ta); }
    }
  });
}
