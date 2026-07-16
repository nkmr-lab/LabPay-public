// /#/paper-review — 論文 PDF を OpenAI Files API に直接渡して章別和訳要約 + 査読 (v552 #206 #211 #212)。
//   - 査読 1 回ごとに 10pt (システム宛て)
//   - 結果は DB 保存 → share_token で URL 共有
//   - 起案者が事前設定した system prompt と共有対象 user (= 主著/共著等) を尊重

import { get, put } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

let cachedSettings = null;

export async function renderPaperReview() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📄 論文査読</h2>
    </div>
    <details class="card" style="padding:0">
      <summary style="cursor:pointer; padding:10px 14px; font-weight:700; font-size:14px; color:var(--primary)">
        ⚙️ 査読プロンプト + 共有対象 <span style="font-weight:400; font-size:12px; color:#6b21a8">(クリックで開閉)</span>
      </summary>
      <div id="pr-settings-wrap" style="padding:0 14px 14px"><div class="muted">読み込み中…</div></div>
    </details>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        論文の PDF をアップロードすると、 OpenAI に直接読ませて章立てを意識した和訳要約 + 指定基準での査読コメントを返します (図表・式も解釈可能)。
        ターゲット会議が空欄なら「HCI 系国際会議」想定。
        <strong>1 回につき 10pt がシステムに支払われます</strong>。
      </p>
      <label class="field">
        <span class="lbl">ターゲット会議 (任意)</span>
        <input type="text" id="pr-venue" maxlength="200" placeholder="例: CHI, UIST, IEEE VR (空欄なら HCI 系全般)">
      </label>
      <label class="field">
        <span class="lbl">査読の厳しさ</span>
        <select id="pr-strict">
          <option value="緩め">緩め</option>
          <option value="やや厳しめ" selected>やや厳しめ (デフォルト)</option>
          <option value="厳しめ">厳しめ</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">🤖 モデル (高いほど高品質)</span>
        <select id="pr-model"><option value="">読み込み中…</option></select>
        <div class="hint-sm" id="pr-model-info" style="font-size:11px; margin-top:4px"></div>
      </label>
      <label class="field">
        <span class="lbl">論文 PDF (最大 30 MB、通常〜10 ページ程度)</span>
        <input type="file" id="pr-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pr-file-status" style="margin-top:4px"></div>
      </label>
      <label class="field">
        <span class="lbl">🗨️ 著者の回答文 / リバトル (任意 — テキスト or PDF)</span>
        <textarea id="pr-response" rows="5" maxlength="20000" placeholder="査読コメントへの回答 (rebuttal) を貼ると、査読 + 回答の妥当性も評価するモードになります。空欄なら通常の査読のみ。 PDF アップロードでも OK。"></textarea>
        <input type="file" id="pr-response-pdf" accept="application/pdf,.pdf" style="margin-top:6px">
        <div class="hint-sm" id="pr-response-pdf-status" style="font-size:11px; margin-top:4px"></div>
        <div class="hint-sm" style="font-size:11px; margin-top:4px; color:#6b21a8">入力 (テキスト or PDF) すると、査読指摘が回答でカバーされているか / 論文本文と矛盾していないか / 安直な「N増・再実験」で流していないかまで評価します。両方入れたら両方参照。</div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pr-go" class="primary" disabled>📄 査読開始</button>
      </div>
    </div>
    <div id="pr-result"></div>
    <div id="pr-history" class="card" style="margin-top:8px"><div class="muted">過去の査読履歴…</div></div>
  `;
  const fileInput = document.getElementById('pr-file');
  const fileStatus = document.getElementById('pr-file-status');
  const btn = document.getElementById('pr-go');
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
    fileStatus.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size / 1024 / 1024).toFixed(1)} MB)</span>`;
    btn.disabled = false;
  });
  btn.addEventListener('click', go);
  // v782 #379 回答文 PDF プレビュー
  const respPdfInput = document.getElementById('pr-response-pdf');
  const respPdfStatus = document.getElementById('pr-response-pdf-status');
  respPdfInput?.addEventListener('change', () => {
    const rf = respPdfInput.files?.[0];
    if (!rf) { respPdfStatus.textContent = ''; return; }
    if (rf.type !== 'application/pdf' && !/\.pdf$/i.test(rf.name)) {
      respPdfStatus.innerHTML = '<span style="color:#dc2626">PDF ファイルを選んでください</span>';
      respPdfInput.value = '';
      return;
    }
    if (rf.size > 30 * 1024 * 1024) {
      respPdfStatus.innerHTML = '<span style="color:#dc2626">30 MB を超えています</span>';
      respPdfInput.value = '';
      return;
    }
    respPdfStatus.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(rf.name)} (${(rf.size / 1024 / 1024).toFixed(1)} MB)</span>`;
  });
  await loadSettings();
  await loadHistory();
}

async function loadSettings() {
  try { cachedSettings = await get('/api/ai/paper_review/settings'); }
  catch (e) { document.getElementById('pr-settings-wrap').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`; return; }
  // v774 #396 モデルドロップダウンを埋める
  const sel = document.getElementById('pr-model');
  const info = document.getElementById('pr-model-info');
  const btn = document.getElementById('pr-go');
  if (sel && cachedSettings.models) {
    const def = cachedSettings.default_model || 'gpt-5';
    sel.innerHTML = Object.entries(cachedSettings.models).map(([m, pt]) =>
      `<option value="${escapeHtml(m)}" ${m === def ? 'selected' : ''}>${escapeHtml(m)} (${pt}pt)</option>`).join('');
    const refresh = () => {
      const m = sel.value;
      const pt = cachedSettings.models[m] || 10;
      if (info) info.textContent = `選択中: ${m} ・ 1 回 ${pt}pt`;
      if (btn) btn.textContent = `📄 査読開始 (${pt}pt)`;
    };
    sel.addEventListener('change', refresh);
    refresh();
  }
  const wrap = document.getElementById('pr-settings-wrap');
  const cur = cachedSettings.custom_prompt || '';
  wrap.innerHTML = `
    <label class="field">
      <span class="lbl">査読 system prompt (空ならデフォルト)</span>
      <textarea id="pr-prompt" rows="5" maxlength="4000" placeholder="${escapeHtml(cachedSettings.default_prompt)}">${escapeHtml(cur)}</textarea>
      <div class="hint-sm">空欄ならデフォルト (HCI 査読者 10 年キャリア) が使われます。</div>
    </label>
    <div style="margin-top:8px">
      <div class="lbl">共有対象 (査読完了時に通知 + 結果 URL を共有)</div>
      <div id="pr-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
      <div id="pr-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
    </div>
    <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
      <button id="pr-save-settings" class="primary">設定を保存</button>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('pr-bulk'),
      chipsContainer: document.getElementById('pr-chips'),
      initial: cachedSettings.share_target_ids || [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('pr-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('pr-save-settings').addEventListener('click', async () => {
    const customPrompt = document.getElementById('pr-prompt').value;
    const shareIds = picker ? [...picker.getSelected()] : [];
    try {
      await put('/api/ai/paper_review/settings', {
        custom_prompt: customPrompt,
        share_target_ids: shareIds,
      });
      toast('保存しました');
      await loadSettings();
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadHistory() {
  const root = document.getElementById('pr-history');
  if (!root) return;
  try {
    const d = await get('/api/ai/paper_review');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = ''; return; }
    root.innerHTML = `
      <div class="bold" style="margin-bottom:6px">📜 過去の査読</div>
      <div class="list">${items.map(r => `
        <a class="list-item" href="#/paper-review/r/${escapeHtml(r.share_token)}" style="gap:6px">
          <div class="grow">
            <div class="bold" style="font-size:13px">${escapeHtml(r.pdf_name || '(no name)')}</div>
            <div class="meta" style="font-size:11px">${escapeHtml(r.target_venue || '')} · ${escapeHtml(r.strictness || '')} · ${escapeHtml(r.created_at)}</div>
          </div>
        </a>
      `).join('')}</div>`;
  } catch (e) { root.innerHTML = ''; }
}

async function go() {
  const f = document.getElementById('pr-file').files[0];
  if (!f) { toast('PDF ファイルを選んでください'); return; }
  const venue = document.getElementById('pr-venue').value.trim();
  const strictness = document.getElementById('pr-strict').value;
  const btn = document.getElementById('pr-go');
  btn.disabled = true; btn.textContent = '⏳ アップロード中…';
  const root = document.getElementById('pr-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ PDF を OpenAI にアップロード中…</div></div>';
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('target_venue', venue);
    fd.append('strictness', strictness);
    const model = document.getElementById('pr-model')?.value || 'gpt-5';
    fd.append('model', model);
    // v780 #404 任意の回答文 (rebuttal)。空なら送らない (= 通常の査読モード)
    const responseText = (document.getElementById('pr-response')?.value || '').trim();
    if (responseText !== '') fd.append('response_text', responseText);
    // v782 #379 PDF 回答文 (textarea と同時添付も OK、 GPT に両方渡る)
    const respPdf = document.getElementById('pr-response-pdf')?.files?.[0];
    if (respPdf) {
      if (respPdf.size > 30 * 1024 * 1024) { toast('回答文 PDF は 30 MB まで'); btn.disabled = false; btn.textContent = '📄 査読開始'; return; }
      fd.append('response_pdf', respPdf);
    }
    const resp = await fetch('/api/ai/paper_review', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    // v557 #211 非同期: 結果ページに遷移、そこで polling
    location.hash = '#/paper-review/r/' + j.share_token;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
    // 失敗時は「(Xpt)」表記を残さず、シンプルに戻す (次のモデル選択変更で refresh される)
    btn.disabled = false; btn.textContent = '📄 査読開始';
  }
}

let sharedPollTimer = null;
export async function renderPaperReviewShared({ params }) {
  const token = params.token;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
  await refreshShared(token);
  // hash 抜けたら polling 停止
  const stopOnLeave = () => {
    if (!location.hash.includes('/paper-review/r/' + token)) {
      if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
      window.removeEventListener('hashchange', stopOnLeave);
    }
  };
  window.addEventListener('hashchange', stopOnLeave);
}

async function refreshShared(token) {
  const app = document.getElementById('app');
  try {
    const d = await get('/api/ai/paper_review/r/' + encodeURIComponent(token));
    const header = `
      <div class="card">
        <a href="#/paper-review" class="hint">← 査読</a>
        <h2 style="margin:6px 0">📄 ${escapeHtml(d.pdf_name || '論文査読')}
          ${d.status === 'pending' || d.status === 'processing' ? '<span class="tag warn">処理中</span>' : ''}
          ${d.status === 'error' ? '<span class="tag" style="background:#fecaca; color:#b91c1c">エラー</span>' : ''}
        </h2>
        <div class="meta">
          ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} の査読 · ${escapeHtml(d.created_at)}
        </div>
        <div class="meta" style="font-size:12px">対象会議: ${escapeHtml(d.target_venue || '')} · 厳しさ: ${escapeHtml(d.strictness || '')}</div>
        ${d.pdf_path || d.response_pdf_path ? `
          <div style="margin-top:6px; font-size:13px; display:flex; gap:10px; flex-wrap:wrap">
            ${d.pdf_path ? `<a href="${escapeHtml(d.pdf_path)}" target="_blank" rel="noopener">📄 元 PDF を開く ↗</a>` : ''}
            ${d.response_pdf_path ? `<a href="${escapeHtml(d.response_pdf_path)}" target="_blank" rel="noopener">📎 回答 PDF を開く ↗</a>` : ''}
          </div>` : ''}
      </div>
      <div id="pr-result"></div>
    `;
    app.innerHTML = header;
    if (d.status === 'pending' || d.status === 'processing') {
      document.getElementById('pr-result').innerHTML = `
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">⏳ AI が査読中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            通常 2〜5 分で完了します。このページを閉じても大丈夫です (完了したら通知が届きます)。<br>
            また後で /#/paper-review/r/${escapeHtml(token)} を開けば結果が見れます。
          </p>
          <div style="margin-top:10px; padding:10px; background:#f0f9ff; border-radius:6px; font-size:13px">
            🤖 PDF を OpenAI が読み込み中…<br>
            <span class="hint-sm">10 秒ごとに自動更新</span>
          </div>
        </div>
      `;
      // 10 秒ごとに polling
      if (!sharedPollTimer) {
        sharedPollTimer = setInterval(() => refreshShared(token), 10000);
      }
      return;
    }
    if (d.status === 'error') {
      document.getElementById('pr-result').innerHTML = `
        <div class="card"><div class="muted">❌ 査読失敗: ${escapeHtml(d.error_msg || '不明なエラー')}</div></div>
      `;
      if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
      return;
    }
    // 完了
    if (sharedPollTimer) { clearInterval(sharedPollTimer); sharedPollTimer = null; }
    paint({ venue: d.target_venue, strictness: d.strictness, response_text: d.response_text, sections: d.sections, review: d.review }, token, true);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function paint(d, shareToken, isShared) {
  const r = d.review || {};
  const decColor = decisionColor(r.decision || '');
  const shareUrl = shareToken ? (location.origin + '/#/paper-review/r/' + shareToken) : '';
  document.getElementById('pr-result').innerHTML = `
    <div class="card">
      <div class="row no-print" style="gap:6px; justify-content:flex-end; margin-bottom:6px">
        <button id="pr-pdf" class="btn" style="font-size:12px; padding:3px 10px" title="ブラウザの印刷 → 「PDF として保存」">📥 PDF にする</button>
      </div>
      <div class="bold" style="font-size:16px; color:var(--primary)">🎯 査読結果</div>
      <div class="meta" style="font-size:12px; margin-bottom:8px">対象会議: ${escapeHtml(d.venue || '')} · 厳しさ: ${escapeHtml(d.strictness || '')}</div>
      ${r.decision ? `<div style="font-size:18px; font-weight:700; padding:6px 12px; background:${decColor}22; color:${decColor}; border-left:5px solid ${decColor}; border-radius:6px; display:inline-block">${escapeHtml(r.decision)}${r.score ? ` (Score ${r.score}/5)` : ''}${r.confidence ? ` (Confidence ${r.confidence}/5)` : ''}</div>` : ''}
      ${r.summary_one_line ? `<div class="meta" style="font-size:13px; margin-top:6px">${escapeHtml(r.summary_one_line)}</div>` : ''}

      ${r.plain_summary_for_student ? `
      <div style="margin-top:12px; padding:12px 14px; background:linear-gradient(180deg,#fefce8,#fff7ed); border:2px solid #f59e0b; border-radius:10px">
        <div class="bold" style="color:#a16207; font-size:14px; margin-bottom:6px">🌱 まずこれだけ読めば OK (学生向け平易まとめ)</div>
        <div style="font-size:14px; line-height:1.85; white-space:pre-wrap; color:#1f2937">${escapeHtml(r.plain_summary_for_student)}</div>
        <div class="meta" style="font-size:11px; margin-top:6px; color:#a16207">↓ 詳しい査読は下につづく</div>
      </div>` : ''}

      ${d.response_text ? `
      <div style="margin-top:10px">
        <div class="bold" style="color:#6b21a8">🗨️ 著者の回答文</div>
        <div style="font-size:12.5px; padding:8px 12px; background:#faf5ff; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0; white-space:pre-wrap; margin-top:4px; line-height:1.7">${escapeHtml(d.response_text)}</div>
      </div>` : ''}

      ${r.response_evaluation ? `
      <div style="margin-top:10px; padding:10px 14px; background:#f5f3ff; border:2px solid #6b21a8; border-radius:8px">
        <div class="bold" style="color:#6b21a8; font-size:14px">🧐 回答文の妥当性評価</div>
        ${r.response_evaluation.overall_assessment ? `
          <div style="font-size:13px; padding:8px 10px; background:#fff; border-radius:6px; white-space:pre-wrap; margin-top:6px; line-height:1.7">${escapeHtml(r.response_evaluation.overall_assessment)}</div>` : ''}
        ${r.response_evaluation.covered_points && r.response_evaluation.covered_points.length ? `
          <div style="margin-top:6px">
            <div class="bold" style="color:#15803d; font-size:12.5px">✅ 良くカバーできている指摘</div>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.response_evaluation.covered_points.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${r.response_evaluation.missing_points && r.response_evaluation.missing_points.length ? `
          <div style="margin-top:6px">
            <div class="bold" style="color:#a16207; font-size:12.5px">⚠️ 回答が触れていない / 不十分な論点</div>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.response_evaluation.missing_points.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${r.response_evaluation.inconsistencies && r.response_evaluation.inconsistencies.length ? `
          <div style="margin-top:6px">
            <div class="bold" style="color:#dc2626; font-size:12.5px">⛔ 論文本文との矛盾点</div>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.response_evaluation.inconsistencies.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${r.response_evaluation.weak_arguments && r.response_evaluation.weak_arguments.length ? `
          <div style="margin-top:6px">
            <div class="bold" style="color:#b91c1c; font-size:12.5px">🪨 主張が弱い / 曖昧 / 飛躍がある箇所</div>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.response_evaluation.weak_arguments.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${r.response_evaluation.recommended_revisions_to_response && r.response_evaluation.recommended_revisions_to_response.length ? `
          <div style="margin-top:6px">
            <div class="bold" style="color:#1d4ed8; font-size:12.5px">📝 回答文の書き換え提案</div>
            <ul style="margin:3px 0 0 0; padding-left:20px; font-size:13px">${r.response_evaluation.recommended_revisions_to_response.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
      </div>` : ''}

      ${r.contribution_validity ? `
      <div style="margin-top:10px">
        <div class="bold" style="color:var(--primary)">🎯 貢献の妥当性</div>
        <div style="font-size:13px; padding:6px 10px; background:#f8f5fb; border-radius:6px; white-space:pre-wrap; margin-top:4px">${escapeHtml(r.contribution_validity)}</div>
      </div>` : ''}

      ${(r.author_claimed_contributions && r.author_claimed_contributions.length) || (r.reviewer_perceived_contributions && r.reviewer_perceived_contributions.length) || r.contribution_gap_explanation ? `
      <div style="margin-top:10px">
        <div class="bold" style="color:var(--primary)">🔍 貢献の独立解釈 (著者主張 ⇔ GPT 解釈)</div>
        <div style="display:grid; grid-template-columns:1fr; gap:6px; margin-top:6px">
          ${r.author_claimed_contributions && r.author_claimed_contributions.length ? `
            <div style="padding:8px 12px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0">
              <div class="bold" style="color:#a16207; font-size:12px">📋 著者が主張する貢献</div>
              <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
                ${r.author_claimed_contributions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>` : ''}
          ${r.reviewer_perceived_contributions && r.reviewer_perceived_contributions.length ? `
            <div style="padding:8px 12px; background:#dcfce7; border-left:3px solid #15803d; border-radius:0 6px 6px 0">
              <div class="bold" style="color:#15803d; font-size:12px">🤖 GPT が読み取った貢献候補</div>
              <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
                ${r.reviewer_perceived_contributions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>` : ''}
          ${r.contribution_gap_explanation ? `
            <div style="padding:8px 12px; background:#eef2ff; border-left:3px solid #4f46e5; border-radius:0 6px 6px 0">
              <div class="bold" style="color:#4f46e5; font-size:12px">⚖️ ギャップの説明</div>
              <div style="font-size:13px; white-space:pre-wrap; margin-top:4px">${escapeHtml(r.contribution_gap_explanation)}</div>
            </div>` : ''}
        </div>
      </div>` : ''}

      ${r.missing_descriptions && r.missing_descriptions.length ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#a16207">📋 記述漏れ (実験 / 統計など)</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.missing_descriptions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.logical_flow ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#2563eb">🔗 論理のつながり</div>
        <div style="font-size:13px; padding:6px 10px; background:#eff6ff; border-radius:6px; white-space:pre-wrap; margin-top:4px">${escapeHtml(r.logical_flow)}</div>
      </div>` : ''}

      ${r.consistency_check ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#7c3aed">🪡 章間の一気通貫性</div>
        <div style="font-size:12px; margin-top:4px">
          ${[
            ['背景→手法', r.consistency_check.background_to_method],
            ['手法→実験', r.consistency_check.method_to_experiment],
            ['実験→結果', r.consistency_check.experiment_to_result],
            ['結果→議論→結論', r.consistency_check.result_to_discussion],
          ].filter(([k, v]) => v).map(([k, v]) => `
            <div style="padding:6px 10px; background:#faf5ff; border-left:3px solid #7c3aed; border-radius:0 4px 4px 0; margin-bottom:4px">
              <span class="bold">${k}:</span> ${escapeHtml(v)}
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${r.hypothesis_vs_results ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#9333ea">❓ 仮説/問い ⇔ 結果の対応</div>
        <div style="font-size:13px; padding:6px 10px; background:#faf5ff; border-radius:6px; white-space:pre-wrap; margin-top:4px">${escapeHtml(r.hypothesis_vs_results)}</div>
      </div>` : ''}

      ${r.editorial_check ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#0891b2">📝 編集面のチェック</div>
        <div style="font-size:12px; margin-top:4px">
          ${[
            ['用語の一貫性', r.editorial_check.terminology_consistency],
            ['専門用語の説明', r.editorial_check.jargon_explanation],
            ['図表の参照', r.editorial_check.figure_table_references],
            ['参考文献の妥当性', r.editorial_check.references_validity],
          ].filter(([k, v]) => v).map(([k, v]) => `
            <div style="padding:6px 10px; background:#ecfeff; border-left:3px solid #0891b2; border-radius:0 4px 4px 0; margin-bottom:4px">
              <span class="bold">${k}:</span> ${escapeHtml(v)}
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${r.statistical_validity ? renderStatisticalValidity(r.statistical_validity) : ''}

      ${r.citations_check ? renderCitationsCheck(r.citations_check) : ''}

      ${r.strengths && r.strengths.length ? `
      <div style="margin-top:12px">
        <div class="bold" style="color:#15803d">✅ Strengths</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.weaknesses && r.weaknesses.length ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#dc2626">⚠️ Weaknesses (+ 改稿案)</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.weaknesses.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.rewrite_suggestions && r.rewrite_suggestions.length ? `
      <div style="margin-top:10px">
        <div class="bold" style="color:#b91c1c">✍️ 主張が強すぎる / 記述がおかしい箇所のリライト案</div>
        <div style="font-size:13px; margin-top:4px">
          ${r.rewrite_suggestions.map(s => {
            // v795 新形式 (en + ja) と旧形式 (suggested_rewrite のみ) の両対応
            const enRw = s.suggested_rewrite_en || '';
            const jaRw = s.suggested_rewrite_ja || s.suggested_rewrite || '';
            return `
            <div style="padding:8px 12px; background:#fef2f2; border-left:3px solid #b91c1c; border-radius:0 6px 6px 0; margin-bottom:8px">
              <div style="margin-bottom:4px"><span class="bold" style="color:#b91c1c">原文:</span> 「${escapeHtml(s.original || '')}」</div>
              ${s.original_ja ? `<div style="margin-bottom:4px; font-size:12.5px; color:#374151"><span class="bold">原文訳:</span> ${escapeHtml(s.original_ja)}</div>` : ''}
              ${s.reason ? `<div style="margin-bottom:4px; font-size:12px"><span class="bold">理由:</span> ${escapeHtml(s.reason)}</div>` : ''}
              ${enRw ? `<div style="padding:6px 10px; background:#dcfce7; border-radius:4px; margin-bottom:4px"><span class="bold" style="color:#15803d">提案 (英文):</span> ${escapeHtml(enRw)}</div>` : ''}
              ${jaRw ? `<div style="padding:6px 10px; background:#dcfce7; border-radius:4px"><span class="bold" style="color:#15803d">提案 (和訳):</span> ${escapeHtml(jaRw)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${r.strengthening_analyses && r.strengthening_analyses.length ? `
      <div style="margin-top:10px; padding:8px 12px; background:#eff6ff; border-left:4px solid #2563eb; border-radius:0 6px 6px 0">
        <div class="bold" style="color:#2563eb">💪 こうすると論文が強くなる (追加分析の提案)</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.strengthening_analyses.map(s => `<li style="margin-bottom:4px">${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.alternatives_when_no_reexp && r.alternatives_when_no_reexp.length ? `
      <div style="margin-top:8px; padding:8px 12px; background:#fef3c7; border-left:4px solid #a16207; border-radius:0 6px 6px 0">
        <div class="bold" style="color:#a16207">🧭 追加実験ができない場合の代替案</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.alternatives_when_no_reexp.map(s => `<li style="margin-bottom:4px">${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.revision_to_accept && r.revision_to_accept.length ? `
      <div style="margin-top:10px; padding:8px 12px; background:#dcfce7; border-left:4px solid #15803d; border-radius:0 6px 6px 0">
        <div class="bold" style="color:#15803d">🛠 採録に導く修正案 (優先度順、 N増の安易な提案は p-hacking リスクを添えて)</div>
        <ol style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.revision_to_accept.map(s => `<li style="margin-bottom:4px">${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>` : ''}

      ${r.comments_to_authors ? `
      <div style="margin-top:10px">
        <div class="bold">💬 Comments to Authors</div>
        <div style="white-space:pre-wrap; font-size:13px; padding:8px; background:#f8f5fb; border-radius:6px; margin-top:4px">${escapeHtml(r.comments_to_authors)}</div>
      </div>` : ''}

      ${shareUrl && !isShared ? `
      <div style="margin-top:10px; padding:8px; background:#eef6ff; border:1px dashed #2563eb; border-radius:6px">
        <div class="bold" style="font-size:13px; color:#2563eb">🔗 共有 URL</div>
        <div class="row" style="gap:6px; margin-top:4px">
          <input type="text" id="pr-share" readonly value="${escapeHtml(shareUrl)}" style="flex:1; font-size:12px; padding:4px 6px">
          <button id="pr-copy" class="btn" style="font-size:11px; padding:4px 10px">📋 コピー</button>
        </div>
        ${d.shared_count > 0 ? `<div class="hint-sm" style="margin-top:4px">${d.shared_count} 名の共有対象に通知済み</div>` : ''}
      </div>` : ''}
    </div>

    ${(d.sections && d.sections.length) ? `
    <div class="card">
      <div class="bold" style="font-size:16px; color:var(--primary); margin-bottom:8px">📖 章立て和訳要約</div>
      ${d.sections.map(s => `
        <div style="margin-bottom:12px; padding-left:8px; border-left:3px solid var(--primary)">
          <div class="bold" style="font-size:14px">${escapeHtml(s.title || '')}</div>
          <div style="font-size:13px; line-height:1.6; margin-top:4px; white-space:pre-wrap">${escapeHtml(s.summary_ja || '')}</div>
        </div>
      `).join('')}
    </div>` : ''}
  `;
  if (shareUrl && !isShared) {
    document.getElementById('pr-copy')?.addEventListener('click', () => {
      const inp = document.getElementById('pr-share');
      inp.select();
      navigator.clipboard?.writeText(shareUrl).then(() => toast('コピーしました'), () => toast('コピー失敗'));
    });
  }
  // v933 PDF 出力
  document.getElementById('pr-pdf')?.addEventListener('click', async () => {
    const { printAsPdf } = await import('../print_helpers.js');
    const title = d.sections?.[0]?.title || d.venue || '査読';
    printAsPdf(`査読 (${d.venue || 'venue'}) - ${title}`);
  });
}

// v993 統計指標の妥当性 (中村さん要望)。全体スコア + 個別 issue リスト。
function renderStatisticalValidity(sv) {
  const score = Number(sv.score) || 0;
  const overall = String(sv.overall_comment || '');
  const issues = Array.isArray(sv.issues) ? sv.issues : [];
  const barColor = score >= 4 ? '#15803d' : score >= 3 ? '#a16207' : '#dc2626';
  const bgColor  = score >= 4 ? '#f0fdf4' : score >= 3 ? '#fefce8' : '#fef2f2';
  const scoreLabel = ['要大幅改稿','多数の重大問題','中程度の問題','ほぼ妥当','妥当'][Math.max(0, Math.min(4, score - 1))] || '';
  const typeLabel = {
    wrong_test:            '🎯 検定選択の誤り',
    assumption_violated:   '📏 仮定の不検証',
    no_effect_size:        '📐 効果量なし',
    no_correction:         '➗ 多重比較補正なし',
    wrong_model:           '🧮 モデル選択の誤り',
    inconsistent_reporting:'⚠ 報告の内的不整合',
    misinterpretation:     '🔄 統計解釈の誤り',
    p_hacking:             '🎣 p-hacking疑い',
    harking:               '🔮 HARKing疑い',
    small_n:               '📉 サンプル過小',
    lickert_mean:          '📊 リッカート尺度の平均化',
    no_ci:                 '📏 信頼区間なし',
    other:                 '❓ その他',
  };
  return `
    <div style="margin-top:12px">
      <div class="bold" style="color:${barColor}">📊 統計指標の妥当性 <span style="color:#6b7280; font-weight:400; font-size:11.5px">score: ${score}/5 ${scoreLabel}</span></div>
      ${overall ? `
        <div style="padding:6px 10px; background:${bgColor}; border-left:3px solid ${barColor}; border-radius:0 4px 4px 0; font-size:12.5px; margin-top:4px; white-space:pre-wrap">${escapeHtml(overall)}</div>` : ''}
      ${issues.map(i => `
        <div style="margin-top:6px; padding:8px 10px; background:#fff; border:1px solid #fecaca; border-radius:6px; font-size:12.5px">
          <div class="bold" style="color:#dc2626">${typeLabel[i.issue_type] || i.issue_type || '⚠ 統計上の問題'}</div>
          ${i.location ? `<div style="margin-top:3px; font-size:11.5px; color:#6b7280; font-family:ui-monospace, monospace">${escapeHtml(i.location)}</div>` : ''}
          ${i.explanation ? `<div style="margin-top:4px">${escapeHtml(i.explanation)}</div>` : ''}
          ${i.suggestion ? `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border-left:2px solid #16a34a; font-size:12px">💡 改善案: ${escapeHtml(i.suggestion)}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

// v971.3 引用文献の妥当性チェック (中村さん要望)。
//   suspicious_citations があれば警告色で表示、なければ「妥当性確認済」の緑バナー。
function renderCitationsCheck(cc) {
  const total = Number(cc.total_citations) || 0;
  const verified = Number(cc.verified_count) || 0;
  const suspicious = Array.isArray(cc.suspicious_citations) ? cc.suspicious_citations : [];
  const issueLabel = {
    author_error:         '👤 著者名の誤り',
    title_not_found:      '📕 タイトルが存在しない疑い',
    bibinfo_error:        '📅 書誌情報の誤り',
    venue_year_mismatch:  '🗓 会議と年のずれ',
    body_mismatch:        '↔ 本文引用との不一致',
    format_inconsistent:  '📐 フォーマット不統一',
    possibly_hallucinated:'🤖 実在しない可能性 (ハルシネーション疑い)',
    other:                '❓ その他',
  };
  const confColor = { high: '#dc2626', medium: '#ea580c', low: '#a16207' };
  const barColor = suspicious.length ? '#dc2626' : '#15803d';
  const bgColor  = suspicious.length ? '#fef2f2' : '#f0fdf4';
  return `
    <div style="margin-top:12px">
      <div class="bold" style="color:${barColor}">📚 参考文献の検証</div>
      <div style="padding:6px 10px; background:${bgColor}; border-left:3px solid ${barColor}; border-radius:0 4px 4px 0; font-size:12.5px; margin-top:4px">
        合計 ${total} 件中、妥当性が確認できた引用は ${verified} 件、疑わしい引用は <span class="bold">${suspicious.length}</span> 件。
      </div>
      ${suspicious.map(s => `
        <div style="margin-top:6px; padding:8px 10px; background:#fff; border:1px solid #fecaca; border-radius:6px; font-size:12.5px">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            <span class="bold" style="color:#dc2626">${issueLabel[s.issue_type] || s.issue_type || '⚠ 疑問点'}</span>
            <span style="font-size:11px; padding:1px 6px; border-radius:4px; background:${confColor[s.confidence] || '#9ca3af'}; color:#fff">${s.confidence || 'medium'}</span>
          </div>
          ${s.original_citation ? `
            <div style="margin-top:4px; font-family:ui-monospace, monospace; font-size:11.5px; padding:4px 8px; background:#fff5f5; border-radius:4px; white-space:pre-wrap">${escapeHtml(s.original_citation)}</div>` : ''}
          ${s.cited_as ? `<div style="margin-top:3px; font-size:11px; color:#6b7280">本文中: ${escapeHtml(s.cited_as)}</div>` : ''}
          ${s.explanation ? `<div style="margin-top:4px">${escapeHtml(s.explanation)}</div>` : ''}
          ${s.suggested_fix ? `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border-left:2px solid #16a34a; font-size:12px">💡 修正案: ${escapeHtml(s.suggested_fix)}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function decisionColor(d) {
  if (/Strong Accept/i.test(d)) return '#15803d';
  if (/Accept|Weak Accept/i.test(d)) return '#16a34a';
  if (/Borderline/i.test(d)) return '#a16207';
  if (/Weak Reject/i.test(d)) return '#ea580c';
  if (/Reject|Strong Reject/i.test(d)) return '#dc2626';
  return '#666';
}
