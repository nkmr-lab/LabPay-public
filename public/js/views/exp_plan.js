// v1023 実験計画書チェック / v1131 二モード対応 (厳密 + 初学者)。
//   中村さん要望:
//     - 厳密にチェックするバージョンと、特に初学者向けのバージョンが欲しい
//     - タブで内容を両方チェックできるようにするのも手
//     - 一覧に戻ると入力ページになってしまう (履歴を先に出したい)

import { escapeHtml } from '../router.js';
import { get, post, del } from '../api.js';
import { toast } from '../app.js';
import { renderChecklistBox, renderAskAiButton } from '../ai_checklist.js';   // v1141 + v1144

const MAX_CHARS = 40000;

export async function renderExpPlan() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🧪 実験計画書チェック</h2>
      <div class="hint-sm" style="margin-top:4px">
        書いた実験計画書を精査。 RQ / 仮説 / 実験対応 / データ / 統計 / サンプルサイズを見ます。
        <b>初学者モード</b> は「先輩が一緒に読んでくれる」トーンで、専門用語を平易に解説付きで。
        <b>厳密モード</b> は査読者ノリで細かく指摘。 <b>どのモードでも 1 回 20pt</b> (両方選んでも 20pt)。
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
        <h3 style="margin:0; font-size:14px">📚 履歴</h3>
        <button id="epc-open-new" class="btn primary" style="font-size:12px; padding:4px 12px">＋ 新しく依頼する</button>
      </div>
      <div id="epc-list"><div class="hint-sm">読み込み中…</div></div>
    </div>

    <details class="card" id="epc-new-details">
      <summary style="cursor:pointer; font-weight:700; font-size:14px; color:var(--primary)">✏️ 新しく実験計画書をチェックする</summary>
      <div style="margin-top:10px">
        <label class="field">
          <span class="lbl">タイトル (任意、未指定なら本文の先頭行から自動)</span>
          <input type="text" id="epc-title" maxlength="200" placeholder="例: 眉毛対称ガイドの主観評価実験">
        </label>
        <label class="field">
          <span class="lbl">チェックモード</span>
          <div class="row" style="gap:8px; flex-wrap:wrap; font-size:13px">
            <label style="display:inline-flex; gap:4px; align-items:center; padding:6px 10px; border:1px solid var(--line); border-radius:8px; cursor:pointer">
              <input type="radio" name="epc-mode" value="both" checked>
              <span>🎓+🌱 両方 (20pt) <span class="hint-sm" style="font-size:11px">タブ切替 / おすすめ</span></span>
            </label>
            <label style="display:inline-flex; gap:4px; align-items:center; padding:6px 10px; border:1px solid var(--line); border-radius:8px; cursor:pointer">
              <input type="radio" name="epc-mode" value="student">
              <span>🌱 初学者モード (20pt) <span class="hint-sm" style="font-size:11px">平易・具体的</span></span>
            </label>
            <label style="display:inline-flex; gap:4px; align-items:center; padding:6px 10px; border:1px solid var(--line); border-radius:8px; cursor:pointer">
              <input type="radio" name="epc-mode" value="strict">
              <span>🎓 厳密モード (20pt) <span class="hint-sm" style="font-size:11px">査読者ノリ</span></span>
            </label>
          </div>
        </label>
        <label class="field">
          <span class="lbl">実験計画書 (Scrapbox 形式で貼付、 100 文字以上〜 ${MAX_CHARS} 文字まで)</span>
          <textarea id="epc-text" rows="18" placeholder="例:
[[RQ1]] 眉毛対称ガイドは、描画時間を短縮するか?
  H1: 対称ガイドあり条件は、なし条件より描画時間が短い
  H2: 対称ガイドあり条件は、対称度スコアが高い

[[実験1]] 参加者内比較
  参加者: 大学生 24 名 (18-24 歳、描画経験 5 年以内)
  条件: 対称ガイドあり / なし
  タスク: 与えられた顔画像に対して眉毛を描く (10 分)
  ...
"
            style="width:100%; box-sizing:border-box; font-family:monospace; font-size:13px"></textarea>
          <div id="epc-count" class="hint-sm" style="text-align:right; margin-top:2px">0 / ${MAX_CHARS} 字</div>
        </label>
        <div class="row" style="gap:6px; margin-top:4px; flex-wrap:wrap">
          <button id="epc-submit" class="btn primary">🧪 精査を依頼</button>
          <button id="epc-clear" class="btn">クリア</button>
          <button id="epc-scrapbox" class="btn" title="Scrapbox のページ URL からタイトル + 本文を取り込みます (PAT 設定が必要)">🔗 Scrapboxから取り込む</button>
        </div>
      </div>
    </details>
  `;

  const ta = document.getElementById('epc-text');
  const cnt = document.getElementById('epc-count');
  const updateCount = () => {
    const n = Array.from(ta.value).length;
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
  document.getElementById('epc-scrapbox').addEventListener('click', onFetchScrapbox);
  document.getElementById('epc-open-new').addEventListener('click', () => {
    const det = document.getElementById('epc-new-details');
    det.open = true;
    det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  loadList();
}

async function onFetchScrapbox() {
  const url = prompt('Scrapbox のページ URL を入力してください\n例: https://scrapbox.io/nkmr-lab/眉毛対称ガイドの実験計画');
  if (!url || !url.trim()) return;
  const btn = document.getElementById('epc-scrapbox');
  const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 取得中…';
  try {
    const r = await post('/api/ai/exp_plan/fetch_scrapbox', { url: url.trim() });
    const titleEl = document.getElementById('epc-title');
    const ta = document.getElementById('epc-text');
    if (ta.value.trim() && !confirm('現在の本文を Scrapbox の内容で上書きしますか?')) return;
    if (!titleEl.value.trim()) titleEl.value = r.title || '';
    ta.value = r.text || '';
    ta.dispatchEvent(new Event('input'));
    toast(`Scrapbox から取り込みました (${r.chars} 字)`);
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes('PAT') || msg.includes('412')) {
      if (confirm('Scrapbox の PAT が未登録です。設定ページに移動しますか?')) location.hash = '#/settings';
    } else {
      toast('取得失敗: ' + msg);
    }
  } finally {
    btn.disabled = false; btn.textContent = origText;
  }
}

async function onSubmit() {
  const title = document.getElementById('epc-title').value.trim();
  const text  = document.getElementById('epc-text').value.trim();
  const mode  = document.querySelector('input[name="epc-mode"]:checked')?.value || 'both';
  if (!text || text.length < 100) { toast('実験計画書が短すぎます (100 文字以上)'); return; }
  if (text.length > MAX_CHARS)    { toast(`長すぎます (${MAX_CHARS} 文字まで)`); return; }
  const modeLabel = mode === 'both' ? '両方 (同時実施)' : (mode === 'student' ? '初学者モード' : '厳密モード');
  if (!confirm(`実験計画書チェック (${modeLabel}) を依頼します (20pt)。続けますか?`)) return;
  const btn = document.getElementById('epc-submit');
  btn.disabled = true; btn.textContent = '⏳ 依頼中…';
  try {
    const r = await post('/api/ai/exp_plan', { title, text, mode });
    toast('依頼を受け付けました');
    location.hash = '#/exp-plan/' + r.id;
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false; btn.textContent = '🧪 精査を依頼';
  }
}

async function loadList() {
  const root = document.getElementById('epc-list');
  try {
    const d = await get('/api/ai/exp_plan');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="hint-sm">まだ依頼したチェックはありません。上の「＋ 新しく依頼する」から始めましょう。</div>';
      return;
    }
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

// v1131 詳細ページの表示中モード (student / strict)
let _currentTab = 'student';

export async function renderExpPlanDetail({ params }) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `<div class="card">読み込み中…</div>`;
  await refresh(id, app);
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
  const isReady = d.status === 'done';
  const hasStrict  = !!d.result_strict;
  const hasStudent = !!d.result_student;
  // 初回描画時のタブ選定: 両方あるなら student をデフォルト、片方だけならそれ
  if (isReady) {
    if (!hasStrict && hasStudent)      _currentTab = 'student';
    else if (hasStrict && !hasStudent) _currentTab = 'strict';
    // 両方ある / 初期値のまま student
  }
  const activeResult = isReady
    ? (_currentTab === 'strict' ? d.result_strict : d.result_student) || d.result
    : null;

  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🧪 ${escapeHtml(d.title || '(無題)')}</h2>
      <div class="hint-sm">${escapeHtml(d.created_at)} · ${escapeHtml(d.model || 'gpt-5')} · ${d.cost_points}pt · モード: ${modeLabel(d.mode)}</div>
      <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <a href="#/exp-plan" class="btn">← 一覧に戻る</a>
        <button id="epc-del" class="btn danger" style="font-size:12px">🗑 削除</button>
      </div>
    </div>

    <div id="epc-ask-ai-mount" style="margin:6px 0"></div>
    <div id="epc-checklist-mount"></div>

    ${!isReady ? `
      <div class="card">
        <div class="bold" style="color:var(--primary)">${d.status === 'error' ? '❌ 失敗' : '⏳ 精査中…'}</div>
        ${d.error_msg ? `<div class="hint-sm" style="color:#dc2626; margin-top:6px; white-space:pre-wrap">${escapeHtml(d.error_msg)}</div>` : ''}
        ${d.status !== 'error' ? `<div class="hint-sm" style="margin-top:6px">5 秒ごとに自動更新。 ${d.mode === 'both' ? '両モードは並列実行なので 30 秒〜 2 分' : '30 秒〜 2 分'}で完了予定。</div>` : ''}
      </div>` : ''}

    ${isReady && (hasStrict || hasStudent) ? `
      <div class="card" style="padding:0; overflow:hidden">
        <div class="row" style="gap:0; border-bottom:1px solid var(--line)">
          ${hasStudent ? tabBtn('student', '🌱 初学者モード', _currentTab === 'student') : ''}
          ${hasStrict  ? tabBtn('strict',  '🎓 厳密モード',   _currentTab === 'strict')  : ''}
        </div>
        <div style="padding:2px 0 10px">
          ${_currentTab === 'student'
            ? renderStudentBody(activeResult)
            : renderStrictBody(activeResult)}
        </div>
      </div>` : ''}

    <details class="card">
      <summary style="cursor:pointer; font-weight:600">📄 提出した実験計画書</summary>
      <pre style="white-space:pre-wrap; font-family:monospace; font-size:12px; line-height:1.6; margin-top:8px; padding:8px 10px; background:#f9fafb; border-radius:6px; overflow-x:auto">${escapeHtml(d.input_text || '')}</pre>
    </details>
  `;

  document.getElementById('epc-del')?.addEventListener('click', async () => {
    if (!confirm('このチェック結果を削除しますか?')) return;
    try {
      await del('/api/ai/exp_plan/' + d.id);
      toast('削除しました');
      location.hash = '#/exp-plan';
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      _currentTab = b.dataset.tab;
      paint(d, app);
    });
  });
  // v1141 修正 TODO チェックリスト (画面上部) — 学生モード優先で候補抽出、両モードで
  //   同じ source (exp_plan + id) を共有するのでチェック状態は 1 セット
  if (isReady && d.id && activeResult) {
    renderChecklistBox(document.getElementById('epc-checklist-mount'), {
      sourceType: 'exp_plan',
      sourceId: Number(d.id),
      resultJson: activeResult,
    });
    // v1219 中村さん要望「inline ボタン は 不要、 floating AI bubble」 → context 登録のみ
    window.__labpay_ai_context = {
      sourceType: 'exp_plan', sourceId: Number(d.id),
      title: (activeResult.summary_one_line || d.title || '実験計画書チェック'),
    };
  }
}

function modeLabel(m) {
  return m === 'strict' ? '🎓 厳密' : m === 'student' ? '🌱 初学者' : '🎓+🌱 両方';
}

function tabBtn(key, label, active) {
  const color = key === 'strict' ? '#4f46e5' : '#a16207';
  return `<button data-tab="${key}" style="flex:1; padding:10px 6px; border:none; background:${active ? '#fff' : '#f9fafb'}; color:${active ? color : '#6b7280'}; font-weight:${active ? '700' : '500'}; font-size:13px; cursor:pointer; border-bottom:3px solid ${active ? color : 'transparent'}">${label}</button>`;
}

// v1131 初学者モード用の描画 (plain_summary_for_student + good_points + next_three_steps を強調)
function renderStudentBody(r) {
  if (!r) return '<div class="hint-sm" style="padding:14px">初学者モードの結果がまだありません。</div>';
  return `
    ${r.plain_summary_for_student ? `
      <div style="margin:10px 14px; padding:12px 14px; background:linear-gradient(180deg,#fefce8,#fff7ed); border:2px solid #f59e0b; border-radius:10px">
        <div class="bold" style="color:#a16207; font-size:14px; margin-bottom:6px">🌱 まず ここだけ 読めば OK</div>
        <div style="font-size:14px; line-height:1.85; white-space:pre-wrap; color:#1f2937">${escapeHtml(r.plain_summary_for_student)}</div>
      </div>` : ''}

    ${r.summary_one_line ? `
      <div style="margin:10px 14px; padding:8px 12px; background:#faf7fc; border-left:4px solid var(--primary); border-radius:0 6px 6px 0">
        <div class="bold" style="color:var(--primary); font-size:12px">📌 全体講評 ${scoreBadge(r.overall_score, '#7b3fa0')}</div>
        <div style="font-size:13.5px; line-height:1.6; margin-top:4px">${escapeHtml(r.summary_one_line)}</div>
      </div>` : ''}

    ${Array.isArray(r.good_points) && r.good_points.length ? `
      <div style="margin:10px 14px; padding:10px 12px; background:#dcfce7; border-left:4px solid #15803d; border-radius:0 6px 6px 0">
        <div class="bold" style="color:#15803d; margin-bottom:4px">✨ ここが 良い</div>
        <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.7">
          ${r.good_points.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${Array.isArray(r.next_three_steps) && r.next_three_steps.length ? `
      <div style="margin:10px 14px; padding:10px 12px; background:#fff7ed; border-left:4px solid #ea580c; border-radius:0 6px 6px 0">
        <div class="bold" style="color:#9a3412; margin-bottom:6px">🚀 まず この 3 ステップから 着手</div>
        <ol style="margin:0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.next_three_steps.map(x => `<li style="margin-bottom:4px">${escapeHtml(String(x))}</li>`).join('')}
        </ol>
      </div>` : ''}

    <div style="padding:0 14px">
      ${renderSection('❓ RQ の書き方',           r.rq_review,                  '#4f46e5', true)}
      ${renderSection('💡 仮説の書き方',          r.hypothesis_review,          '#a16207', true)}
      ${renderSection('🔗 仮説と実験の対応',      r.hypothesis_experiment_link, '#0284c7', true)}
      ${renderSection('📊 データの適切さ',        r.data_appropriateness,       '#0ea5e9', true)}
      ${renderSection('📈 統計手法',              r.statistics,                 '#059669', true)}
      ${renderSection('👥 サンプルサイズ',        r.sample_size,                '#dc2626', true)}

      ${Array.isArray(r.top_priority_fixes) && r.top_priority_fixes.length ? `
        <div class="card" style="background:#fef3c7; border-left:4px solid #d97706; margin-top:8px">
          <div class="bold" style="color:#92400e; margin-bottom:6px">🔥 特に 効く 修正 提案</div>
          <ol style="margin:0; padding-left:18px; font-size:13.5px; line-height:1.7">
            ${r.top_priority_fixes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
          </ol>
        </div>` : ''}

      ${Array.isArray(r.other_notes) && r.other_notes.length ? `
        <div class="card">
          <div class="bold" style="color:#6b7280; margin-bottom:6px">📝 その他の気づき</div>
          <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.7; color:#374151">
            ${r.other_notes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
          </ul>
        </div>` : ''}
    </div>`;
}

// v1131 厳密モード用の描画 (従来の paint 相当)
function renderStrictBody(r) {
  if (!r) return '<div class="hint-sm" style="padding:14px">厳密モードの結果がまだありません。</div>';
  return `
    ${r.summary_one_line ? `
      <div style="margin:10px 14px; padding:10px 14px; background:linear-gradient(135deg,#ede4f3,#fafaf5); border-left:4px solid var(--primary); border-radius:0 6px 6px 0">
        <div class="bold" style="color:var(--primary); margin-bottom:4px">📌 全体講評 ${scoreBadge(r.overall_score, '#7b3fa0')}</div>
        <div style="font-size:14px; line-height:1.7">${escapeHtml(r.summary_one_line)}</div>
      </div>` : ''}
    <div style="padding:0 14px">
      ${renderSection('❓ RQ の書き方',           r.rq_review,                  '#4f46e5', false)}
      ${renderSection('💡 仮説の書き方',          r.hypothesis_review,          '#a16207', false)}
      ${renderSection('🔗 仮説と実験の対応',      r.hypothesis_experiment_link, '#0284c7', false)}
      ${renderSection('📊 データの適切さ',        r.data_appropriateness,       '#0ea5e9', false)}
      ${renderSection('📈 統計手法',              r.statistics,                 '#059669', false)}
      ${renderSection('👥 サンプルサイズ',        r.sample_size,                '#dc2626', false)}
      ${Array.isArray(r.top_priority_fixes) && r.top_priority_fixes.length ? `
        <div class="card" style="background:#fff7ed; border-left:4px solid #ea580c">
          <div class="bold" style="color:#9a3412; margin-bottom:6px">🔥 優先度の高い修正提案</div>
          <ol style="margin:0; padding-left:18px; font-size:13.5px; line-height:1.7">
            ${r.top_priority_fixes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
          </ol>
        </div>` : ''}
      ${Array.isArray(r.other_notes) && r.other_notes.length ? `
        <div class="card">
          <div class="bold" style="color:#6b7280; margin-bottom:6px">📝 その他の気づき</div>
          <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.7; color:#374151">
            ${r.other_notes.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
          </ul>
        </div>` : ''}
    </div>`;
}

function scoreBadge(score, color) {
  if (typeof score !== 'number') return '';
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return `<span style="display:inline-block; margin-left:6px; font-size:12px; color:${color}">${'★'.repeat(filled)}${'☆'.repeat(5 - filled)} <span style="font-size:11px; color:#6b7280">(${score}/5)</span></span>`;
}

function renderSection(title, sec, color, isStudent) {
  if (!sec || typeof sec !== 'object') return '';
  const score = sec.score;
  const notes = sec.notes || '';
  const why   = isStudent ? (sec.why_it_matters || '') : '';
  const issues = Array.isArray(sec.issues) ? sec.issues : [];
  return `
    <div class="card">
      <div class="bold" style="color:${color}; font-size:14px">${title} ${scoreBadge(score, color)}</div>
      ${why ? `<div style="font-size:12px; color:#6b7280; margin-top:4px; padding:4px 8px; background:#f9fafb; border-radius:4px; font-style:italic">💭 ${escapeHtml(why)}</div>` : ''}
      ${notes ? `<div style="font-size:13px; line-height:1.7; margin-top:6px; white-space:pre-wrap">${escapeHtml(notes)}</div>` : ''}
      ${issues.length ? `
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px">
          ${issues.map(iss => renderIssue(iss, color, isStudent)).join('')}
        </div>` : ''}
    </div>`;
}

function renderIssue(iss, color, isStudent) {
  const sev = String(iss?.severity || '').toLowerCase();
  // v1131 学生モードは must/better/nice、厳密モードは high/med/low
  const sevMap = isStudent
    ? { must:  { c: '#dc2626', l: '🔥 まず直す' },
        better:{ c: '#a16207', l: '👍 直せると良い' },
        nice:  { c: '#0891b2', l: '✨ 余裕があれば' },
        // 旧値も念のため受ける
        high:  { c: '#dc2626', l: '🔥 まず直す' },
        med:   { c: '#a16207', l: '👍 直せると良い' },
        low:   { c: '#0891b2', l: '✨ 余裕があれば' } }
    : { high:  { c: '#dc2626', l: '🚨 高' },
        med:   { c: '#a16207', l: '⚠ 中' },
        low:   { c: '#0891b2', l: 'ℹ 低' },
        must:  { c: '#dc2626', l: '🚨 高' },
        better:{ c: '#a16207', l: '⚠ 中' },
        nice:  { c: '#0891b2', l: 'ℹ 低' } };
  const sevInfo = sevMap[sev] || null;

  const quote = (iss?.quote || '').trim();
  const isNoQuote = quote === '(該当記述なし)' || quote === '' || quote === '(なし)';
  const quoteBlock = quote
    ? (isNoQuote
        ? `<div style="font-size:11.5px; color:#9ca3af; font-style:italic; margin-bottom:4px">📄 計画書の原文: (該当記述なし)</div>`
        : `<div style="font-size:12px; padding:5px 9px; margin-bottom:6px; background:#f9fafb; border-left:2px solid #9ca3af; font-family: Georgia, 'Times New Roman', serif; line-height:1.55; color:#4b5563">📄 原文: ${escapeHtml(quote)}</div>`)
    : '';
  return `
    <div style="padding:8px 10px; background:#fff; border-left:3px solid ${sevInfo ? sevInfo.c : color}; border-radius:0 6px 6px 0">
      ${quoteBlock}
      <div style="display:flex; gap:6px; align-items:baseline; flex-wrap:wrap">
        ${sevInfo ? `<span style="font-size:10.5px; padding:1px 6px; border-radius:8px; background:${sevInfo.c}22; color:${sevInfo.c}">${escapeHtml(sevInfo.l)}</span>` : ''}
        <div class="bold" style="font-size:13px">${escapeHtml(iss?.issue || '')}</div>
      </div>
      ${iss?.suggestion ? `<div style="font-size:12.5px; line-height:1.65; margin-top:4px; color:#374151"><span style="color:${color}">→</span> ${escapeHtml(iss.suggestion)}</div>` : ''}
    </div>`;
}
