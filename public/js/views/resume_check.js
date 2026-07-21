// v583 #225 レジュメ原稿チェック — 1-2 ページ短原稿向け軽量査読 (v1068 で gpt-5 20pt に)。
//   /#/resume-check       一覧 + 新規入力
//   /#/resume-check/:id   詳細
//
// paper-review より軽い (テキスト入力 / 短文 / より速い)。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast, setAiContext } from '../app.js';
import { renderChecklistBox, renderAskAiButton } from '../ai_checklist.js';   // v1141 + v1144

const POLL_MS = 5000;

export async function renderResumeCheck() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 原稿チェック</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        レジュメ / 発表概要 / 申請書など 1-2 ページの短原稿を、 先輩が一緒に読み直すノリで
        チェックします。 背景の妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用を
        一通り見て、 まず「良かった点」 → 「効く改善 3 つ」を返します。
        <b>1 回 20pt</b>。失敗時は自動返金。
      </p>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
        <h3 style="margin:0; font-size:14px">📚 過去のチェック</h3>
        <button id="rc-open-new" class="btn primary" style="font-size:12px; padding:4px 12px">＋ 新しく依頼する</button>
      </div>
      <div id="rc-list"><div class="hint">読み込み中…</div></div>
    </div>

    <details class="card" id="rc-new-details">
      <summary style="cursor:pointer; font-weight:700; font-size:14px; color:var(--primary)">✏️ 新しい原稿をチェックする</summary>
      <div style="margin-top:10px">
        <label style="display:block; margin-bottom:8px">
          <div class="bold" style="font-size:13px; margin-bottom:4px">タイトル (任意)</div>
          <input id="rc-title" class="input" maxlength="200" placeholder="例: WISS 2026 投稿原稿第1稿">
        </label>
        <div class="bold" style="font-size:13px; margin-bottom:4px">原稿 PDF (10 MB まで)</div>
        <input id="rc-pdf" type="file" accept="application/pdf" class="input">
        <div class="hint-sm" style="margin-top:4px">図表入りで OK。 レイアウトのまま AI に渡るので論理展開が伝わりやすい。</div>
        <div style="display:flex; gap:8px; align-items:center; margin-top:10px">
          <button id="rc-submit" class="btn primary">20pt を支払ってチェック依頼</button>
          <span class="hint-sm" id="rc-status"></span>
        </div>
      </div>
    </details>
  `;
  document.getElementById('rc-open-new').addEventListener('click', () => {
    const det = document.getElementById('rc-new-details');
    det.open = true;
    det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('rc-submit').addEventListener('click', async () => {
    const title = document.getElementById('rc-title').value.trim();
    const btn   = document.getElementById('rc-submit');
    const sts   = document.getElementById('rc-status');
    const f = document.getElementById('rc-pdf').files?.[0];
    if (!f) { toast('PDF を選んでください'); return; }
    if (f.size > 10 * 1024 * 1024) { toast('PDF は 10 MB まで'); return; }
    btn.disabled = true; btn.textContent = '送信中…'; sts.textContent = 'PDF アップロード中…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (title) fd.append('title', title);
      const res = await fetch('/api/ai/resume_check', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const r = await res.json();
      if (!res.ok || r?.error) throw new Error(r?.error?.message || ('HTTP ' + res.status));
      sts.textContent = `受付けました (id=${r.id})。結果ページへ…`;
      navigate('#/resume-check/' + r.id);
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
      btn.disabled = false; btn.textContent = '20pt を支払ってチェック依頼';
    }
  });
  await renderResumeCheckList();
}

async function renderResumeCheckList() {
  const root = document.getElementById('rc-list');
  try {
    const d = await get('/api/ai/resume_check');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="hint">まだチェック履歴がありません</div>';
      return;
    }
    root.innerHTML = items.map(it => `
      <a class="list-item" href="#/resume-check/${it.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(it.title || '(無題)')}
            ${statusBadge(it.status)}
          </div>
          <div class="meta" style="font-size:12px">${escapeHtml(it.input_head || '').replace(/\n/g, ' ')}…</div>
          <div class="hint-sm" style="font-size:11px">${escapeHtml(it.created_at)}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    root.innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div>`;
  }
}

function statusBadge(st) {
  switch (st) {
    case 'pending':    return '<span style="background:#fef3c7; color:#946d00; padding:1px 6px; border-radius:6px; font-size:11px">待機</span>';
    case 'processing': return '<span style="background:#dbeafe; color:#1d4ed8; padding:1px 6px; border-radius:6px; font-size:11px">処理中</span>';
    case 'done':       return '<span style="background:#dcfce7; color:#15803d; padding:1px 6px; border-radius:6px; font-size:11px">完了</span>';
    case 'error':      return '<span style="background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:6px; font-size:11px">失敗 (返金済)</span>';
    default: return '';
  }
}

let pollTimer = null;
export async function renderResumeCheckDetail({ params }) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  await loadAndPaint(id);
}

async function loadAndPaint(id) {
  let d;
  try {
    d = await get('/api/ai/resume_check/' + id);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a class="hint" href="#/resume-check">← 一覧</a><div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div></div>`;
    return;
  }
  const app = document.getElementById('app');
  if (d.status === 'pending' || d.status === 'processing') {
    app.innerHTML = `
      <div class="card">
        <a class="hint" href="#/resume-check">← 一覧</a>
        <h2 style="margin:6px 0">${escapeHtml(d.title || '(無題)')}</h2>
        <div class="hint">${statusBadge(d.status)} ・ 5秒ごとに自動更新中…</div>
      </div>`;
    pollTimer = setInterval(async () => {
      const d2 = await get('/api/ai/resume_check/' + id).catch(() => null);
      if (d2 && (d2.status === 'done' || d2.status === 'error')) {
        clearInterval(pollTimer); pollTimer = null;
        loadAndPaint(id);
      }
    }, POLL_MS);
    return;
  }
  if (d.status === 'error') {
    app.innerHTML = `
      <div class="card">
        <a class="hint" href="#/resume-check">← 一覧</a>
        <h2 style="margin:6px 0">${escapeHtml(d.title || '(無題)')}</h2>
        <div class="hint">${statusBadge(d.status)}</div>
        <p>${escapeHtml(d.error_msg || '不明なエラー')}</p>
        <p class="hint">課金は返金されました。もう一度お試しください。</p>
      </div>`;
    return;
  }
  // done
  const r = d.result || {};
  const scoreColor = (s) => s >= 4 ? '#15803d' : s === 3 ? '#946d00' : '#b91c1c';
  // v993 統計指標の妥当性 (中村さん要望)。 issues 構造が他と違う (location + issue_type +
  //   explanation + suggestion) ので別ハンドラ。統計記述がない原稿は score=5 で「なし」表示。
  const renderStatValidity = (sv) => {
    if (!sv) return '';
    const score = Number(sv.score) || 0;
    const issues = Array.isArray(sv.issues) ? sv.issues : [];
    const typeLabel = {
      wrong_test:'🎯 検定選択の誤り', no_effect_size:'📐 効果量なし', no_correction:'➗ 多重比較補正なし',
      small_n:'📉 サンプル過小', misinterpretation:'🔄 統計解釈の誤り', lickert_mean:'📊 リッカート平均化',
      no_ci:'📏 信頼区間なし', other:'❓ その他',
    };
    return `
      <div style="margin-top:12px; padding:10px; background:#fafafa; border-radius:8px">
        <div style="display:flex; align-items:center; gap:8px">
          <b style="font-size:14px">📊 統計指標の妥当性</b>
          <span style="color:${scoreColor(score)}; font-weight:700">${score}/5</span>
        </div>
        <div style="font-size:13px; margin-top:4px; line-height:1.5">${escapeHtml(sv.comment || '')}</div>
        ${issues.map(i => `
          <div style="margin-top:6px; padding:6px 10px; background:#fff; border:1px solid #fecaca; border-radius:6px; font-size:12.5px">
            <div class="bold" style="color:#dc2626">${typeLabel[i.issue_type] || i.issue_type || '⚠'}</div>
            ${i.location ? `<div style="margin-top:3px; font-size:11.5px; color:#6b7280; font-family:ui-monospace, monospace">${escapeHtml(i.location)}</div>` : ''}
            ${i.explanation ? `<div style="margin-top:4px">${escapeHtml(i.explanation)}</div>` : ''}
            ${i.suggestion ? `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border-left:2px solid #16a34a; font-size:12px">💡 ${escapeHtml(i.suggestion)}</div>` : ''}
          </div>`).join('')}
      </div>`;
  };

  const renderScored = (key, label) => {
    const v = r[key];
    if (!v) return '';
    return `
      <div style="margin-top:12px; padding:10px; background:#fafafa; border-radius:8px">
        <div style="display:flex; align-items:center; gap:8px">
          <b style="font-size:14px">${escapeHtml(label)}</b>
          <span style="color:${scoreColor(v.score)}; font-weight:700">${v.score}/5</span>
        </div>
        <div style="font-size:13px; margin-top:4px; line-height:1.5">${escapeHtml(v.comment || '')}</div>
        ${Array.isArray(v.issues) && v.issues.length ? `
          <ul style="margin:6px 0 0; padding-left:20px; font-size:13px">
            ${v.issues.map(x => typeof x === 'string'
              ? `<li>${escapeHtml(x)}</li>`
              : `<li><b>${escapeHtml(x.original || '')}</b> → ${escapeHtml(x.suggested || '')}</li>`).join('')}
          </ul>` : ''}
        ${Array.isArray(v.missing) && v.missing.length ? `
          <div class="hint-sm" style="margin-top:4px">説明不足: ${v.missing.map(escapeHtml).join(', ')}</div>` : ''}
        ${Array.isArray(v.variations) && v.variations.length ? `
          <div class="hint-sm" style="margin-top:4px">揺れ: ${v.variations.map(escapeHtml).join(', ')}</div>` : ''}
      </div>`;
  };
  app.innerHTML = `
    <div class="card">
      <a class="hint" href="#/resume-check">← 一覧</a>
      <h2 style="margin:6px 0">${escapeHtml(d.title || '(無題)')}</h2>
      <div style="display:flex; gap:10px; align-items:center">
        ${statusBadge(d.status)}
        <span class="hint-sm">完了 ${escapeHtml(d.finished_at || '')}</span>
      </div>
    </div>

    <div id="rc-ask-ai-mount" style="margin:6px 0"></div>
    <div id="rc-checklist-mount"></div>

    ${r.plain_summary_for_student ? `
      <div class="card" style="background:linear-gradient(180deg,#fefce8,#fff7ed); border:2px solid #f59e0b">
        <div class="bold" style="color:#a16207; font-size:14px; margin-bottom:6px">🌱 まず ここだけ 読めば OK</div>
        <div style="font-size:14px; line-height:1.85; white-space:pre-wrap; color:#1f2937">${escapeHtml(r.plain_summary_for_student)}</div>
      </div>` : ''}

    ${Array.isArray(r.good_points) && r.good_points.length ? `
      <div class="card" style="border-left:4px solid #15803d; background:#f0fdf4">
        <div class="bold" style="color:#15803d; margin-bottom:4px">✨ ここが 良い</div>
        <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.7">
          ${r.good_points.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${Array.isArray(r.next_three_steps) && r.next_three_steps.length ? `
      <div class="card" style="border-left:4px solid #ea580c; background:#fff7ed">
        <div class="bold" style="color:#9a3412; margin-bottom:6px">🚀 まず この 3 ステップから 着手</div>
        <ol style="margin:0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.next_three_steps.map(x => `<li style="margin-bottom:4px">${escapeHtml(String(x))}</li>`).join('')}
        </ol>
      </div>` : ''}

    <div class="card">
      <h3 style="margin:0 0 6px">📊 総合</h3>
      <div style="font-size:20px; font-weight:700; color:${scoreColor(r.overall_score)}">${r.overall_score ?? '-'} / 5</div>
      <div style="font-size:14px; margin-top:4px">${escapeHtml(r.summary_one_line || '')}</div>
    </div>
    ${renderScored('background_validity',     '🎯 背景説明の妥当性')}
    ${renderScored('logical_flow',            '🔗 論理展開')}
    ${renderScored('jargon_explanation',      '📚 専門用語の説明')}
    ${renderScored('japanese_connectives',    '✍️ 日本語の接続詞')}
    ${renderScored('terminology_consistency', '📐 表記の一貫性')}
    ${renderScored('citations_check',         '📑 引用')}
    ${renderStatValidity(r.statistical_validity)}
    ${Array.isArray(r.rewrite_suggestions) && r.rewrite_suggestions.length ? `
      <div class="card">
        <h3 style="margin:0 0 6px">✏️ リライト案</h3>
        ${r.rewrite_suggestions.map(s => `
          <div style="padding:8px; border-left:3px solid #4a106d; background:#faf7fc; margin:6px 0; border-radius:4px">
            <div style="font-size:13px"><b>原文:</b> ${escapeHtml(s.original || '')}</div>
            <div style="font-size:12px; color:#666; margin-top:2px"><b>理由:</b> ${escapeHtml(s.reason || '')}</div>
            <div style="font-size:13px; margin-top:4px; color:#4a106d"><b>提案:</b> ${escapeHtml(s.suggested_rewrite || '')}</div>
          </div>
        `).join('')}
      </div>` : ''}
    ${r.comments_to_author ? `
      <div class="card">
        <h3 style="margin:0 0 6px">💬 著者へのコメント</h3>
        <div style="white-space:pre-wrap; font-size:14px; line-height:1.6">${escapeHtml(r.comments_to_author)}</div>
      </div>` : ''}
    <details class="card">
      <summary style="cursor:pointer; font-weight:700">📄 入力原稿を見る</summary>
      <div style="white-space:pre-wrap; font-size:13px; line-height:1.5; padding:8px; margin-top:6px; background:#fafafa; border-radius:6px; max-height:400px; overflow:auto">${escapeHtml(d.input_text || '')}</div>
    </details>
  `;
  // v1141 修正 TODO チェックリスト (画面上部)
  renderChecklistBox(document.getElementById('rc-checklist-mount'), {
    sourceType: 'resume_check',
    sourceId: Number(d.id),
    resultJson: r,
  });
  // v1219/v1220 詳細ページ で だけ 💬 fab を 出す
  setAiContext({
    sourceType: 'resume_check', sourceId: Number(d.id),
    title: (r.summary_one_line || d.title || '原稿チェック'),
  });
}
