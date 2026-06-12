// /#/paper-review — 論文 章立て和訳要約 + 査読 (v550 #206)。
//   論文の本文を貼って、 ターゲット会議と査読の厳しさを指定 → AI が章立て要約 + 査読。

import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export function renderPaperReview() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📄 論文 査読</h2>
    </div>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        論文の PDF をアップロードすると、 OpenAI に直接読ませて 章立てを意識した和訳要約 + 指定基準での査読コメントを返します (図表・式も解釈可能)。
        ターゲット会議が空欄なら 「HCI 系国際会議 (CHI / UIST / IUI / DIS / CSCW など) 」 想定。
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
        <span class="lbl">論文 PDF (最大 30 MB、 通常 〜10 ページ程度)</span>
        <input type="file" id="pr-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="pr-file-status" style="margin-top:4px"></div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="pr-go" class="primary" disabled>📄 査読開始</button>
      </div>
    </div>
    <div id="pr-result"></div>
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
}

async function go() {
  const f = document.getElementById('pr-file').files[0];
  if (!f) { toast('PDF ファイルを選んでください'); return; }
  const venue = document.getElementById('pr-venue').value.trim();
  const strictness = document.getElementById('pr-strict').value;
  const btn = document.getElementById('pr-go');
  btn.disabled = true; btn.textContent = '🤖 査読中… (2-4 分かかります)';
  const root = document.getElementById('pr-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ PDF を OpenAI にアップロード → 査読中…</div></div>';
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('target_venue', venue);
    fd.append('strictness', strictness);
    const resp = await fetch('/api/ai/paper_review', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'labpay' },
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    paint(j);
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
  } finally {
    btn.disabled = false; btn.textContent = '📄 査読開始';
  }
}

function paint(d) {
  const r = d.review || {};
  const decColor = decisionColor(r.decision || '');
  document.getElementById('pr-result').innerHTML = `
    <div class="card">
      <div class="bold" style="font-size:16px; color:var(--primary)">🎯 査読結果</div>
      <div class="meta" style="font-size:12px; margin-bottom:8px">対象会議: ${escapeHtml(d.venue || '')} · 厳しさ: ${escapeHtml(d.strictness || '')}</div>
      ${r.decision ? `<div style="font-size:18px; font-weight:700; padding:6px 12px; background:${decColor}22; color:${decColor}; border-left:5px solid ${decColor}; border-radius:6px; display:inline-block">${escapeHtml(r.decision)}${r.score ? ` (Score ${r.score}/5)` : ''}${r.confidence ? ` (Confidence ${r.confidence}/5)` : ''}</div>` : ''}
      ${r.summary_one_line ? `<div class="meta" style="font-size:13px; margin-top:6px">${escapeHtml(r.summary_one_line)}</div>` : ''}

      ${r.strengths && r.strengths.length ? `
      <div style="margin-top:12px">
        <div class="bold" style="color:#15803d">✅ Strengths</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.weaknesses && r.weaknesses.length ? `
      <div style="margin-top:8px">
        <div class="bold" style="color:#dc2626">⚠️ Weaknesses</div>
        <ul style="margin:4px 0 0 0; padding-left:20px; font-size:13px">
          ${r.weaknesses.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${r.comments_to_authors ? `
      <div style="margin-top:10px">
        <div class="bold">💬 Comments to Authors</div>
        <div style="white-space:pre-wrap; font-size:13px; padding:8px; background:#f8f5fb; border-radius:6px; margin-top:4px">${escapeHtml(r.comments_to_authors)}</div>
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
}

function decisionColor(d) {
  if (/Strong Accept/i.test(d)) return '#15803d';
  if (/Accept|Weak Accept/i.test(d)) return '#16a34a';
  if (/Borderline/i.test(d)) return '#a16207';
  if (/Weak Reject/i.test(d)) return '#ea580c';
  if (/Reject|Strong Reject/i.test(d)) return '#dc2626';
  return '#666';
}
