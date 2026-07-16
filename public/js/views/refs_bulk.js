// v1093 文献管理: PDF まとめてアップロード + 自動 metadata 抽出 + Web/Semantic Scholar
//   検索で足りない情報を埋め + 検証。中村さん要望:
//   「文献管理に、PDF をまとめてアップロードする機能を追加したい。まとめて
//    アップロードすると、順次下記の処理をして欲しい: タイトルや著者情報、
//    文献情報、キーワード、アブストなどを自動で読み込んで、順次情報として
//    適用していく。文献情報などが欠落している場合があるので、しっかり Web 検索、
//    文献検索して、情報を埋めるとともに、情報があっているかも検証する」
//
// フロー (1 PDF ずつ直列に、UI で進捗表示):
//   1. Extract: POST /api/refs/extract_pdf (multipart)
//      → 内部で pdftotext + DOI 抽出 + crossref / arXiv / OpenAI で meta 取得
//   2. Verify+enrich: DOI が無い場合 title で Semantic Scholar 検索、
//      タイトル類似度 >= 0.85 の最上位マッチが見つかれば meta を merge (DOI/venue/year/
//      abstract/authors/keywords を SS 側で補完)。一致度も UI に出す。
//   3. Duplicate check: 既存 refs に同 DOI or 同 arxiv_id なら skip (id 表示)
//   4. Create: POST /api/refs (meta + author list + tags 空)
//   5. Attach PDF: POST /api/refs/{id}/attach_pdf (multipart)
//   6. Enrich: POST /api/refs/{id}/ss_enrich — SS で citation_count / references 埋め
//   7. Done — 詳細リンクを出す
//
// エラーは各ステップごとに catch して行に赤字表示、次のファイルに続行。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const MAX_PARALLEL = 1;   // シーケンシャルに (SS API rate-limit 保護)。並列にしても extract の
                          // openai 呼びが最も重い。 1 by 1 で安全側。

let currentRows = [];     // 表示行 (state)
let processing = false;

export async function renderRefsBulk() {
  const app = document.getElementById('app');
  currentRows = [];
  processing = false;
  app.innerHTML = renderShell();
  wireControls();
}

function renderShell() {
  return `
    <div class="card page-header">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <a class="hint" href="#/refs">← 文献管理</a>
        <h2 style="margin:0; flex:1">📚 PDF まとめてアップロード</h2>
      </div>
      <div class="hint-sm" style="margin-top:6px; line-height:1.6">
        PDF をまとめて (何十本でも) アップすると、 1 本ずつ順番に:<br>
        ① PDF から <b>DOI / arXiv ID</b> を検出 → crossref / arXiv API で metadata 取得。 <b>取れなければ OpenAI で抽出</b><br>
        ② タイトルで <b>Semantic Scholar 検索</b> → タイトル一致度 85% 以上なら SS 側の情報 (DOI / venue / year / abstract / 著者) を merge して補完 + 検証<br>
        ③ 既存 refs に同 DOI or arXiv があれば <b>skip</b> (重複防止)<br>
        ④ 新規 ref を作成 → PDF を添付 → SS で citation_count / 引用文献埋め (ss_enrich)<br>
        処理中何かがコケても次の PDF に続行。完了した文献の詳細リンクは下の表に出ます。
      </div>
    </div>
    <div class="card">
      <div id="rb-drop" style="border:2px dashed #a78bfa; border-radius:12px; padding:24px; text-align:center; cursor:pointer; background:#faf5ff">
        <div style="font-size:36px">📄 📚</div>
        <div style="font-weight:600; margin-top:6px">PDF ファイルをドロップ or タップして選択</div>
        <div class="hint-sm" style="margin-top:4px">複数選択 OK (1 ファイル 30MB まで)</div>
        <input type="file" id="rb-files" accept="application/pdf,.pdf" multiple hidden>
      </div>
      <div id="rb-selected" style="margin-top:10px"></div>
      <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end; flex-wrap:wrap">
        <button class="btn" id="rb-clear" disabled>クリア</button>
        <button class="btn primary" id="rb-start" disabled>▶ 処理開始</button>
      </div>
    </div>
    <div id="rb-progress"></div>
  `;
}

function wireControls() {
  const dropEl = document.getElementById('rb-drop');
  const fileInput = document.getElementById('rb-files');
  dropEl.addEventListener('click', () => fileInput.click());
  dropEl.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.style.background = '#ede4f7'; });
  dropEl.addEventListener('dragleave', () => { dropEl.style.background = '#faf5ff'; });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropEl.style.background = '#faf5ff';
    const files = [...(e.dataTransfer?.files || [])].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (files.length) addFiles(files);
  });
  fileInput.addEventListener('change', (e) => {
    const files = [...e.target.files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (files.length) addFiles(files);
  });
  document.getElementById('rb-clear').addEventListener('click', () => {
    if (processing) { toast('処理中のためクリアできません'); return; }
    currentRows = [];
    renderSelected();
    renderProgress();
    updateButtons();
  });
  document.getElementById('rb-start').addEventListener('click', () => {
    if (processing || !currentRows.length) return;
    startProcessing();
  });
}

function addFiles(files) {
  for (const f of files) {
    if (f.size > 30 * 1024 * 1024) {
      toast(`${f.name}: 30MB を超えるためスキップ`, 4000);
      continue;
    }
    currentRows.push({
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',
      steps: [],
      ref_id: null,
      meta: null,
      error: null,
      verified_by: null,
      similarity: null,
    });
  }
  renderSelected();
  updateButtons();
}

function renderSelected() {
  const el = document.getElementById('rb-selected');
  if (!currentRows.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="hint-sm" style="margin-bottom:4px">選択中: ${currentRows.length} 件 (合計 ${fmtSize(currentRows.reduce((a, r) => a + r.size, 0))})</div>
    <ul style="margin:0; padding-left:20px; font-size:12px; color:#374151">
      ${currentRows.slice(0, 20).map(r => `<li>${escapeHtml(r.name)} <span style="color:#9ca3af">(${fmtSize(r.size)})</span></li>`).join('')}
      ${currentRows.length > 20 ? `<li>… 他 ${currentRows.length - 20} 件</li>` : ''}
    </ul>
  `;
}
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function updateButtons() {
  document.getElementById('rb-clear').disabled = processing || !currentRows.length;
  document.getElementById('rb-start').disabled = processing || !currentRows.length;
  document.getElementById('rb-drop').style.opacity = processing ? '0.5' : '1';
  document.getElementById('rb-drop').style.pointerEvents = processing ? 'none' : '';
  document.getElementById('rb-start').textContent = processing ? '⌛ 処理中…' : '▶ 処理開始';
}

async function startProcessing() {
  processing = true;
  updateButtons();
  renderProgress();
  for (let i = 0; i < currentRows.length; i++) {
    const row = currentRows[i];
    if (row.status !== 'pending') continue;   // 過去のバッチ分は飛ばす
    row.status = 'processing';
    row.steps = [];
    renderProgress();
    try {
      await processOne(row);
      row.status = 'done';
    } catch (e) {
      row.status = 'error';
      row.error = e?.message || String(e);
    }
    renderProgress();
  }
  processing = false;
  updateButtons();
  toast(`✅ ${currentRows.filter(r => r.status === 'done').length} 件完了 / ${currentRows.filter(r => r.status === 'skipped').length} 件既存 / ${currentRows.filter(r => r.status === 'error').length} 件エラー`, 6000);
}

async function processOne(row) {
  // 1) Extract
  addStep(row, '📄 PDF から metadata 抽出中…');
  const fd = new FormData();
  fd.append('file', row.file);
  const r1 = await fetch('/api/refs/extract_pdf', { method: 'POST', headers: { 'X-Requested-With': 'labpay' }, body: fd, credentials: 'same-origin' });
  const j1 = await r1.json();
  if (!r1.ok) throw new Error(j1?.error?.message || `extract_pdf HTTP ${r1.status}`);
  let meta = j1.meta || {};
  const method = j1.method || 'unknown';
  markStep(row, `✓ metadata 抽出 (${method === 'pdf_doi_crossref' ? 'DOI→Crossref' : method === 'pdf_arxiv_api' ? 'arXiv API' : method === 'pdf_openai_extract' ? 'OpenAI 推定' : method})`);

  // 既存が返っていれば skip
  if (j1.existing && j1.existing.id) {
    row.ref_id = j1.existing.id;
    row.meta = meta;
    row.status = 'skipped';
    addStep(row, `⏭ すでに登録済 (id=${j1.existing.id}: ${j1.existing.title})`);
    return;
  }

  // 2) Verify + enrich via Semantic Scholar (DOI がまだ無い場合、 title で検索)
  const hasStrongId = !!(meta.doi || (meta.authors && meta.authors.length && meta.title));
  if (meta.title && meta.title.length >= 8) {
    try {
      addStep(row, '🔎 Semantic Scholar で検証・情報補完中…');
      const query = meta.title;
      const r2 = await post('/api/refs/ss_search', { query, limit: 5 });
      const cand = (r2.items || [])[0];
      if (cand && cand.title) {
        const sim = titleSimilarity(meta.title, cand.title);
        row.similarity = sim;
        if (sim >= 0.85) {
          // 既存 ref (SS からの同 DOI) があれば skip
          if (cand.existing_ref_id) {
            row.ref_id = cand.existing_ref_id;
            row.status = 'skipped';
            markStep(row, `⏭ SS 一致 (${Math.round(sim*100)}%) → 既存 refs id=${cand.existing_ref_id}`);
            return;
          }
          // SS の情報で meta を補完 (空欄のみ埋める、抽出済みは上書きしない)
          meta = mergeMetaFromSs(meta, cand);
          row.verified_by = 'semantic_scholar';
          markStep(row, `✓ SS 一致 (${Math.round(sim*100)}%) — DOI/venue/年/abstract を補完 → ${cand.title.slice(0, 60)}${cand.title.length > 60 ? '…' : ''}`);
        } else {
          markStep(row, `⚠ SS 検索したが類似度 ${Math.round(sim*100)}% (< 85%) のため補完せず (最上位: ${cand.title.slice(0, 60)}…)`);
        }
      } else {
        markStep(row, '⚠ SS 検索: マッチなし (PDF 抽出情報のみで登録)');
      }
    } catch (e) {
      markStep(row, `⚠ SS 検索エラー (無視して続行): ${e?.message || e}`);
    }
    // DOI が新たに埋まった場合、 duplicate 再チェック
    if (meta.doi) {
      // 既存確認は SS 側で existing_ref_id を見たので、 create 時の duplicate error に任せる
    }
  }

  // 3) Create ref
  addStep(row, '📝 refs に登録中…');
  const authors = (meta.authors || []).map(a => (typeof a === 'string' ? { name: a } : a)).filter(a => a && a.name);
  const createBody = {
    title:    meta.title || row.name.replace(/\.pdf$/i, ''),
    doi:      meta.doi || undefined,
    arxiv_id: meta.arxiv_id || undefined,
    year:     meta.year || undefined,
    venue:    meta.venue || undefined,
    abstract: meta.abstract || undefined,
    url:      meta.url || undefined,
    authors,
  };
  let created;
  try {
    created = await post('/api/refs', createBody);
  } catch (e) {
    // duplicate なら既存 id を使う (api.js は e.details に載せて throw)
    if (e && e.status === 409 && e.details?.existing_id) {
      const existingId = e.details.existing_id;
      row.ref_id = existingId;
      row.status = 'skipped';
      markStep(row, `⏭ 重複検出 (create 時)、既存 id=${existingId}`);
      return;
    }
    throw e;
  }
  row.ref_id = created.id;
  row.meta = meta;
  markStep(row, `✓ ref id=${created.id} 作成`);

  // 4) Attach PDF
  addStep(row, '📎 PDF 添付中…');
  const fd2 = new FormData();
  fd2.append('file', row.file);
  const r3 = await fetch(`/api/refs/${created.id}/attach_pdf`, { method: 'POST', headers: { 'X-Requested-With': 'labpay' }, body: fd2, credentials: 'same-origin' });
  const j3 = await r3.json();
  if (!r3.ok) throw new Error(j3?.error?.message || `attach_pdf HTTP ${r3.status}`);
  markStep(row, '✓ PDF 添付');

  // 5) SS enrich (citation_count / references)。失敗は非致命
  try {
    addStep(row, '🔗 SS で citation 情報埋め中…');
    await post(`/api/refs/${created.id}/ss_enrich`, {});
    markStep(row, '✓ citation / references 補完');
  } catch (e) {
    markStep(row, `⚠ ss_enrich スキップ: ${e?.message || e}`);
  }
}

function addStep(row, text) {
  row.steps.push({ text, ts: Date.now(), status: 'active' });
  renderProgress();
}
function markStep(row, text) {
  if (row.steps.length) {
    row.steps[row.steps.length - 1].text = text;
    row.steps[row.steps.length - 1].status = 'done';
  } else {
    addStep(row, text);
    row.steps[row.steps.length - 1].status = 'done';
  }
  renderProgress();
}

function renderProgress() {
  const el = document.getElementById('rb-progress');
  if (!currentRows.length) { el.innerHTML = ''; return; }
  const nDone = currentRows.filter(r => r.status === 'done').length;
  const nSkip = currentRows.filter(r => r.status === 'skipped').length;
  const nErr  = currentRows.filter(r => r.status === 'error').length;
  const nActive = currentRows.filter(r => r.status === 'processing').length;
  const nPending = currentRows.filter(r => r.status === 'pending').length;
  el.innerHTML = `
    <div class="card">
      <div class="row" style="gap:12px; flex-wrap:wrap; margin-bottom:8px; font-size:13px">
        <span>合計 <b>${currentRows.length}</b></span>
        <span style="color:#059669">✅ 完了 <b>${nDone}</b></span>
        <span style="color:#0284c7">⏭ 既存 <b>${nSkip}</b></span>
        <span style="color:#dc2626">❌ エラー <b>${nErr}</b></span>
        ${nActive ? `<span style="color:#7b3fa0">⌛ 処理中 <b>${nActive}</b></span>` : ''}
        ${nPending ? `<span style="color:#6b7280">⏸ 待ち <b>${nPending}</b></span>` : ''}
      </div>
      <div style="display:flex; flex-direction:column; gap:6px">
        ${currentRows.map((r, i) => renderRow(r, i)).join('')}
      </div>
    </div>
  `;
}
function renderRow(r, i) {
  const statusMeta = {
    pending:    { emoji: '⏸', color: '#6b7280', label: '待機' },
    processing: { emoji: '⌛', color: '#7b3fa0', label: '処理中' },
    done:       { emoji: '✅', color: '#059669', label: '完了' },
    skipped:    { emoji: '⏭', color: '#0284c7', label: '既存' },
    error:      { emoji: '❌', color: '#dc2626', label: 'エラー' },
  }[r.status] || { emoji: '?', color: '#6b7280', label: r.status };
  const refLink = r.ref_id ? `<a href="#/refs/${r.ref_id}" target="_blank" rel="noopener" style="color:${statusMeta.color}; font-size:11px">→ 詳細 (id=${r.ref_id})</a>` : '';
  const verifiedBadge = r.verified_by === 'semantic_scholar' && r.similarity
    ? `<span style="font-size:10px; padding:1px 6px; border-radius:3px; background:#dcfce7; color:#059669; margin-left:6px">🔗 SS 検証 (${Math.round(r.similarity*100)}%)</span>` : '';
  const errBlock = r.error ? `<div style="margin-top:4px; padding:4px 8px; background:#fef2f2; color:#991b1b; font-size:12px; border-radius:4px">${escapeHtml(r.error)}</div>` : '';
  const steps = r.steps.slice(-6).map(s => `<div style="font-size:11px; color:${s.status === 'done' ? '#059669' : '#7b3fa0'}; margin-left:16px">・${escapeHtml(s.text)}</div>`).join('');
  return `
    <div style="padding:6px 10px; border-left:3px solid ${statusMeta.color}; background:#fafafa; border-radius:0 6px 6px 0">
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <span>${statusMeta.emoji}</span>
        <span style="font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px">${escapeHtml(r.name)}</span>
        <span class="hint-sm" style="color:${statusMeta.color}">${statusMeta.label}</span>
        ${verifiedBadge}
        ${refLink}
      </div>
      ${steps}
      ${errBlock}
    </div>
  `;
}

// ------- helpers -------
function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
// Jaccard 類似度 (トークン集合の共通/合計)
function titleSimilarity(a, b) {
  const A = new Set(normalizeTitle(a).split(' ').filter(w => w.length >= 2));
  const B = new Set(normalizeTitle(b).split(' ').filter(w => w.length >= 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
// meta merge: 抽出済み値を優先しつつ、空欄を SS 情報で埋める
function mergeMetaFromSs(meta, ss) {
  const out = { ...meta };
  if (!out.doi && ss.doi) out.doi = ss.doi;
  if (!out.arxiv_id && ss.arxiv_id) out.arxiv_id = ss.arxiv_id;
  if (!out.year && ss.year) out.year = ss.year;
  if ((!out.venue || out.venue.length < 3) && ss.venue) out.venue = ss.venue;
  if ((!out.abstract || out.abstract.length < 20) && ss.abstract) out.abstract = ss.abstract;
  if ((!out.authors || !out.authors.length) && ss.authors) {
    out.authors = (ss.authors || []).map(a => ({ name: a.name || a }));
  }
  if (!out.url && ss.url) out.url = ss.url;
  return out;
}
