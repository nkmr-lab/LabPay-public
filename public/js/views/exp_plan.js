// v1023 実験計画書チェック (中村さん要望「Scrapbox 形式で書かれた実験計画書 を チェック。
//   RQ / 仮説 の 書き方、 仮説と実験 の 対応、 データ の 適切さ、 統計手法、 サンプルサイズ を
//   特に 重視」)。 20pt / 回 flat、 gpt-5 で 精査。

import { escapeHtml } from '../router.js';
import { get, post, del } from '../api.js';
import { toast } from '../app.js';

const MAX_CHARS = 40000;

export async function renderExpPlan() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🧪 実験計画書チェック</h2>
      <div class="hint-sm" style="margin-top:4px">Scrapbox 形式で書いた実験計画書を精査。 RQ / 仮説の書き方、 仮説と実験の対応、 データの適切さ、 統計手法、 サンプルサイズ を特に重視して構造化レポートを返します。 1 回 20pt。</div>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">タイトル (任意、 未指定なら本文の先頭行から自動)</span>
        <input type="text" id="epc-title" maxlength="200" placeholder="例: 眉毛対称ガイドの主観評価実験">
      </label>
      <label class="field">
        <span class="lbl">実験計画書 (Scrapbox 形式で貼付、 100 文字以上 〜 ${MAX_CHARS} 文字まで)</span>
        <textarea id="epc-text" rows="18" placeholder="例:
[[RQ1]] 眉毛対称ガイドは、 描画時間を短縮するか?
  H1: 対称ガイドあり条件は、 なし条件より 描画時間が短い
  H2: 対称ガイドあり条件は、 対称度スコアが 高い

[[実験1]] 参加者内比較
  参加者: 大学生 24 名 (18-24 歳、 描画経験 5 年以内)
  条件: 対称ガイドあり / なし
  タスク: 与えられた顔画像に対して眉毛を描く (10 分)
  ...
"
          style="width:100%; box-sizing:border-box; font-family:monospace; font-size:13px"></textarea>
        <div id="epc-count" class="hint-sm" style="text-align:right; margin-top:2px">0 / ${MAX_CHARS} 字</div>
      </label>
      <div class="row" style="gap:6px; margin-top:4px">
        <button id="epc-submit" class="btn primary">🧪 精査を依頼 (20pt)</button>
        <button id="epc-clear" class="btn">クリア</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px; font-size:14px">📚 履歴</h3>
      <div id="epc-list"><div class="hint-sm">読み込み中…</div></div>
    </div>
  `;

  const ta = document.getElementById('epc-text');
  const cnt = document.getElementById('epc-count');
  const updateCount = () => {
    const n = Array.from(ta.value).length;   // 文字数 (surrogate 対応)
    cnt.textContent = `${n.toLocaleString()} / ${MAX_CHARS.toLocaleString()} 字`;
    cnt.style.color = n > MAX_CHARS ? '#dc2626' : (n < 100 ? '#a16207' : '#6b7280');
  };
  ta.addEventListener('input', updateCount);
  updateCount();

  document.getElementById('epc-submit').addEventListener('click', onSubmit);
  document.getElementById('epc-clear').addEventListener('click', () => {
    document.getElementById('epc-title').value = '';
    ta.value = ''; updateCount();
  });
  loadList();
}

async function onSubmit() {
  const title = document.getElementById('epc-title').value.trim();
  const text  = document.getElementById('epc-text').value.trim();
  if (!text || text.length < 100) { toast('実験計画書が短すぎます (100 文字以上)'); return; }
  if (text.length > MAX_CHARS)    { toast(`長すぎます (${MAX_CHARS} 文字まで)`); return; }
  if (!confirm(`実験計画書チェックを 依頼します (20pt)。 続けますか?`)) return;
  const btn = document.getElementById('epc-submit');
  btn.disabled = true; btn.textContent = '⏳ 依頼中…';
  try {
    const r = await post('/api/ai/exp_plan', { title, text });
    toast('依頼を受け付けました');
    location.hash = '#/exp-plan/' + r.id;
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false; btn.textContent = '🧪 精査を依頼 (20pt)';
  }
}

async function loadList() {
  const root = document.getElementById('epc-list');
  try {
    const d = await get('/api/ai/exp_plan');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<div class="hint-sm">まだ 依頼した チェックは ありません。</div>'; return; }
    root.innerHTML = items.map(it => `
      <a class="list-item" href="#/exp-plan/${it.id}" style="display:flex; gap:8px; padding:8px 10px; border-bottom:1px solid #f3f4f6; text-decoration:none; color:inherit">
        <div style="flex:1; min-width:0">
          <div class="bold" style="font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.title || '(無題)')}</div>
          <div class="hint-sm" style="font-size:11px">${escapeHtml(it.created_at)} · ${escapeHtml(it.model || 'gpt-5')} · ${it.cost_points}pt</div>
        </div>
        <div style="align-self:center; font-size:11px; padding:2px 8px; border-radius:8px; ${statusStyle(it.status)}">${statusLabel(it.status)}</div>
      </a>
    `).join('');
  } catch (e) {
    root.innerHTML = `<div class="hint-sm" style="color:#dc2626">${escapeHtml(e.message)}</div>`;
  }
}
function statusLabel(s) { return ({pending:'依頼中', processing:'精査中', done:'完了', error:'失敗'})[s] || s; }
function statusStyle(s) {
  if (s === 'done')    return 'background:#dcfce7; color:#166534';
  if (s === 'error')   return 'background:#fee2e2; color:#991b1b';
  return 'background:#fef3c7; color:#a16207';
}

export async function renderExpPlanDetail({ params }) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `<div class="card">読み込み中…</div>`;
  await refresh(id, app);
  // pending / processing なら polling
  let timer = setInterval(async () => {
    const cur = await refresh(id, app, true);
    if (!cur || (cur.status !== 'pending' && cur.status !== 'processing')) {
      clearInterval(timer); timer = null;
    }
  }, 5000);
  window.addEventListener('hashchange', () => { if (timer) { clearInterval(timer); timer = null; } }, { once: true });
}

async function refresh(id, app, quiet = false) {
  try {
    const d = await get('/api/ai/exp_plan/' + id);
    paint(d, app);
    return d;
  } catch (e) {
    if (!quiet) app.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message)}</div>`;
    return null;
  }
}

function paint(d, app) {
  const r = d.result || {};
  const isReady = d.status === 'done';
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🧪 ${escapeHtml(d.title || '(無題)')}</h2>
      <div class="hint-sm">${escapeHtml(d.created_at)} · ${escapeHtml(d.model || 'gpt-5')} · ${d.cost_points}pt</div>
      <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <a href="#/exp-plan" class="btn">← 一覧</a>
        <button id="epc-del" class="btn danger" style="font-size:12px">🗑 削除</button>
      </div>
    </div>

    ${!isReady ? `
      <div class="card">
        <div class="bold" style="color:var(--primary)">${d.status === 'error' ? '❌ 失敗' : '⏳ 精査中…'}</div>
        ${d.error_msg ? `<div class="hint-sm" style="color:#dc2626; margin-top:6px; white-space:pre-wrap">${escapeHtml(d.error_msg)}</div>` : ''}
        ${d.status !== 'error' ? '<div class="hint-sm" style="margin-top:6px">5 秒ごとに自動更新。 30 秒 〜 2 分で完了予定。</div>' : ''}
      </div>` : ''}

    ${isReady && r.summary_one_line ? `
      <div class="card" style="background:linear-gradient(135deg,#ede4f3,#fafaf5); border-left:4px solid var(--primary)">
        <div class="bold" style="color:var(--primary); margin-bottom:6px">📌 全体講評 ${scoreBadge(r.overall_score, '#7b3fa0')}</div>
        <div style="font-size:14px; line-height:1.7">${escapeHtml(r.summary_one_line)}</div>
      </div>` : ''}

    ${isReady ? renderSection('❓ RQ の書き方',           r.rq_review,                  '#4f46e5') : ''}
    ${isReady ? renderSection('💡 仮説の書き方',          r.hypothesis_review,          '#a16207') : ''}
    ${isReady ? renderSection('🔗 仮説と実験の対応',      r.hypothesis_experiment_link, '#0284c7') : ''}
    ${isReady ? renderSection('📊 データの適切さ',        r.data_appropriateness,       '#0ea5e9') : ''}
    ${isReady ? renderSection('📈 統計手法',              r.statistics,                 '#059669') : ''}
    ${isReady ? renderSection('👥 サンプルサイズ',        r.sample_size,                '#dc2626') : ''}

    ${isReady && Array.isArray(r.top_priority_fixes) && r.top_priority_fixes.length ? `
      <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
        <div class="bold" style="color:#9a3412; margin-bottom:6px">🔥 優先度の高い修正提案</div>
        <ol style="margin:0; padding-left:18px; font-size:13.5px; line-height:1.7">
          ${r.top_priority_fixes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
        </ol>
      </div>` : ''}

    ${isReady && Array.isArray(r.other_notes) && r.other_notes.length ? `
      <div class="card">
        <div class="bold" style="color:#6b7280; margin-bottom:6px">📝 その他の気づき</div>
        <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.7; color:#374151">
          ${r.other_notes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
        </ul>
      </div>` : ''}

    <details class="card">
      <summary style="cursor:pointer; font-weight:600">📄 提出した実験計画書</summary>
      <pre style="white-space:pre-wrap; font-family:monospace; font-size:12px; line-height:1.6; margin-top:8px; padding:8px 10px; background:#f9fafb; border-radius:6px; overflow-x:auto">${escapeHtml(d.input_text || '')}</pre>
    </details>
  `;
  document.getElementById('epc-del')?.addEventListener('click', async () => {
    if (!confirm('この チェック 結果 を 削除 しますか?')) return;
    try {
      await del('/api/ai/exp_plan/' + d.id);
      toast('削除しました');
      location.hash = '#/exp-plan';
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

function scoreBadge(score, color) {
  if (typeof score !== 'number') return '';
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return `<span style="display:inline-block; margin-left:6px; font-size:12px; color:${color}">${'★'.repeat(filled)}${'☆'.repeat(5 - filled)} <span style="font-size:11px; color:#6b7280">(${score}/5)</span></span>`;
}

function renderSection(title, sec, color) {
  if (!sec || typeof sec !== 'object') return '';
  const score = sec.score;
  const notes = sec.notes || '';
  const issues = Array.isArray(sec.issues) ? sec.issues : [];
  return `
    <div class="card">
      <div class="bold" style="color:${color}; font-size:14px">${title} ${scoreBadge(score, color)}</div>
      ${notes ? `<div style="font-size:13px; line-height:1.7; margin-top:6px; white-space:pre-wrap">${escapeHtml(notes)}</div>` : ''}
      ${issues.length ? `
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px">
          ${issues.map(iss => renderIssue(iss, color)).join('')}
        </div>` : ''}
    </div>`;
}

function renderIssue(iss, color) {
  const severity = String(iss?.severity || '').toLowerCase();
  const sevColor = severity === 'high' ? '#dc2626' : (severity === 'med' ? '#a16207' : '#0891b2');
  const sevLabel = ({high: '🚨 高', med: '⚠ 中', low: 'ℹ 低'})[severity] || severity;
  // v1044 中村さん指摘「RQ や 仮説 の 書き方 を 指摘してくれるのは 良いが、 オリジナルが
  //   何だったかが 示されて いなくて 参照が 面倒。 原文は これだった よ を 示して」
  //   → issue の 上 に 計画書 の 原文 を Georgia 系 で 引用表示。 該当なし の 場合 は
  //   薄グレーで 「(該当記述なし)」 のみ。
  const quote = (iss?.quote || '').trim();
  const isNoQuote = quote === '(該当記述なし)' || quote === '' || quote === '(なし)';
  const quoteBlock = quote
    ? (isNoQuote
        ? `<div style="font-size:11.5px; color:#9ca3af; font-style:italic; margin-bottom:4px">📄 計画書 の 原文: (該当記述なし)</div>`
        : `<div style="font-size:12px; padding:5px 9px; margin-bottom:6px; background:#f9fafb; border-left:2px solid #9ca3af; font-family: Georgia, 'Times New Roman', serif; line-height:1.55; color:#4b5563">📄 原文: ${escapeHtml(quote)}</div>`)
    : '';
  return `
    <div style="padding:8px 10px; background:#fff; border-left:3px solid ${sevColor}; border-radius:0 6px 6px 0">
      ${quoteBlock}
      <div style="display:flex; gap:6px; align-items:baseline; flex-wrap:wrap">
        ${sevLabel ? `<span style="font-size:10.5px; padding:1px 6px; border-radius:8px; background:${sevColor}22; color:${sevColor}">${escapeHtml(sevLabel)}</span>` : ''}
        <div class="bold" style="font-size:13px">${escapeHtml(iss?.issue || '')}</div>
      </div>
      ${iss?.suggestion ? `<div style="font-size:12.5px; line-height:1.65; margin-top:4px; color:#374151"><span style="color:${color}">→</span> ${escapeHtml(iss.suggestion)}</div>` : ''}
    </div>`;
}
