// v1282 📝 原稿チェック依頼 (中村さん pr.nkmr.io チャットで仕様確定、
//   docs/HANDOFF_manuscript_review.md 参照)。
//   依頼者が PDF + 複数チェッカー を指定 → 各チェッカーが pr.nkmr.io の
//   校閲モードで音声+手書き校正 → 結果 URL が LabPay に戻る。
//
// route:
//   /#/manuscript-reviews         — 一覧 (自分が依頼した + 頼まれた)
//   /#/manuscript-reviews/new     — 新規依頼フォーム
//   /#/manuscript-reviews/{id}    — 詳細 (reviewer 行ごとに 校閲ボタン / 結果 URL)

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

function fmtYmd(s) {
  if (!s) return '';
  return String(s).slice(5, 16).replace('-', '/');
}

const STATUS_LABEL = {
  open:      { label: '📝 対応中',   color: '#059669', bg: '#f0fdf4' },
  done:      { label: '✅ 完了',     color: '#6b7280', bg: '#f9fafb' },
  cancelled: { label: '❌ キャンセル', color: '#991b1b', bg: '#fef2f2' },
};
const RV_LABEL = {
  pending:   { label: '⏳ 未着手',   color: '#a16207' },
  in_review: { label: '🔍 校閲中',   color: '#0284c7' },
  done:      { label: '✅ 校閲完了', color: '#059669' },
};

// ---------- 一覧 ----------

export async function renderManuscriptReviews() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 原稿チェック依頼</h2>
      <div class="hint-sm" style="margin-top:4px">
        PDF 原稿を渡して、指定した人に <b>pr.nkmr.io</b> で 音声+手書き 校閲してもらう仕組み。
        複数人に同時依頼可、各チェッカーが独立に校閲 → 結果 URL が並びます。
      </div>
      <div class="row" style="margin-top:8px; gap:6px">
        <a href="#/manuscript-reviews/new" class="btn primary" style="text-decoration:none; padding:6px 14px; font-size:13px">＋ 新規依頼</a>
        <a href="#/requests-hub" class="btn" style="text-decoration:none; padding:6px 14px; font-size:13px">← 依頼ハブ</a>
      </div>
    </div>
    <div id="mr-list"><div class="hint">読み込み中…</div></div>
  `;
  await loadList();
}

async function loadList() {
  const root = document.getElementById('mr-list');
  try {
    const d = await get('/api/manuscript-reviews');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="card"><div class="empty">まだ依頼はありません。 「＋ 新規依頼」から始めよう。</div></div>`;
      return;
    }
    root.innerHTML = items.map(r => renderCard(r)).join('');
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
  }
}

function renderCard(r) {
  const st = STATUS_LABEL[r.status] || STATUS_LABEL.open;
  const doneCount = (r.reviewers || []).filter(rv => rv.status === 'done').length;
  const totalCount = (r.reviewers || []).length;
  const roleBadge = r.is_requester
    ? '<span style="background:#e0e7ff; color:#3730a3; padding:1px 6px; border-radius:6px; font-size:10px; margin-left:4px">依頼者</span>'
    : (r.is_reviewer ? '<span style="background:#fef3c7; color:#78350f; padding:1px 6px; border-radius:6px; font-size:10px; margin-left:4px">チェッカー</span>' : '');
  return `
    <a class="card" href="#/manuscript-reviews/${r.id}" style="display:block; text-decoration:none; color:inherit; margin-bottom:8px; padding:10px 14px">
      <div class="row center" style="gap:6px; margin-bottom:4px">
        <span style="background:${st.bg}; color:${st.color}; padding:1px 8px; border-radius:8px; font-size:11px; font-weight:600">${st.label}</span>
        <span class="hint-sm" style="font-size:11px">${escapeHtml(fmtYmd(r.created_at))}</span>
        ${roleBadge}
      </div>
      <div class="bold" style="font-size:15px">📄 ${escapeHtml(r.title)}</div>
      <div class="hint-sm" style="margin-top:3px; font-size:12px">
        依頼: ${escapeHtml(r.requester_display_name || '?')} · チェッカー ${doneCount}/${totalCount} 完了
      </div>
    </a>`;
}

// ---------- 新規 ----------

export async function renderManuscriptReviewNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">＋ 新しい原稿チェック依頼</h2>
      <div class="hint-sm" style="margin-top:4px">
        ① PDF アップ → ② タイトル → ③ チェッカー選択 → ④ ひとこと (任意) → 送信。
        各チェッカーに 通知 + Slack で届きます。
      </div>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">① 論文/原稿 PDF (最大 50 MB)</span>
        <input type="file" id="mr-file" accept="application/pdf,.pdf">
        <div class="hint-sm" id="mr-file-status" style="margin-top:4px"></div>
      </label>
      <label class="field">
        <span class="lbl">② タイトル</span>
        <input type="text" id="mr-title" maxlength="300" placeholder="例: WISS 2026 投稿原稿 第 1 稿">
      </label>
      <div class="field">
        <div class="lbl">③ チェッカー (複数選択可、20 人まで)</div>
        <div id="mr-members-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="mr-members-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div class="hint-sm" id="mr-members-count" style="font-size:11px; margin-top:4px"></div>
      </div>
      <label class="field">
        <span class="lbl">④ ひとこと (任意)</span>
        <textarea id="mr-message" maxlength="4000" rows="3" placeholder="例: WISS の 締切前に 1 度 見てほしいです、 特に 3 章 の 提案 部分 を"></textarea>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <a href="#/manuscript-reviews" class="btn">キャンセル</a>
        <button id="mr-submit" class="btn primary">送信</button>
      </div>
    </div>
  `;
  const fileEl = document.getElementById('mr-file');
  const fileStatus = document.getElementById('mr-file-status');
  const titleEl = document.getElementById('mr-title');
  fileEl.addEventListener('change', () => {
    const f = fileEl.files[0];
    if (!f) { fileStatus.textContent = ''; return; }
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      fileStatus.innerHTML = '<span style="color:#dc2626">PDF ファイルを選んでください</span>';
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      fileStatus.innerHTML = '<span style="color:#dc2626">50 MB を超えています</span>';
      return;
    }
    fileStatus.innerHTML = `<span style="color:#15803d">✓ ${escapeHtml(f.name)} (${(f.size/1024/1024).toFixed(1)} MB)</span>`;
    // タイトル 未入力なら ファイル名から (拡張子除去)
    if (!titleEl.value.trim()) {
      titleEl.value = f.name.replace(/\.[^.]+$/, '').slice(0, 300);
    }
  });

  // メンバー picker
  const { createMemberPicker } = await import('../member_picker.js');
  const picker = await createMemberPicker({
    bulkContainer: document.getElementById('mr-members-bulk'),
    chipsContainer: document.getElementById('mr-members-chips'),
    countLabel: document.getElementById('mr-members-count'),
    initial: [],
    excludeIds: [Number(state.me?.id)],
    showGenderBulk: false,
  });

  document.getElementById('mr-submit').addEventListener('click', async () => {
    const f = fileEl.files[0];
    if (!f) { toast('PDF を選んでください'); return; }
    const title = titleEl.value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    const ids = [...picker.getSelected()];
    if (!ids.length) { toast('チェッカーを 1 人以上 選んでください'); return; }
    if (ids.length > 20) { toast('チェッカーは 20 人まで'); return; }
    const message = document.getElementById('mr-message').value.trim();
    const btn = document.getElementById('mr-submit');
    btn.disabled = true; btn.textContent = '送信中…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', title);
      if (message) fd.append('message', message);
      ids.forEach(i => fd.append('reviewers[]', String(i)));
      const resp = await fetch('/api/manuscript-reviews', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      toast('📝 依頼しました');
      navigate('#/manuscript-reviews/' + j.id);
    } catch (e) {
      btn.disabled = false; btn.textContent = '送信';
      toast('失敗: ' + (e?.message || e));
    }
  });
}

// ---------- 詳細 ----------

export async function renderManuscriptReviewDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let r;
  try {
    r = await get('/api/manuscript-reviews/' + id);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const st = STATUS_LABEL[r.status] || STATUS_LABEL.open;
  const meId = Number(state.me?.id);
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; margin-bottom:6px">
        <span style="background:${st.bg}; color:${st.color}; padding:1px 8px; border-radius:8px; font-size:11px; font-weight:600">${st.label}</span>
        ${r.is_requester ? '<span style="background:#e0e7ff; color:#3730a3; padding:1px 6px; border-radius:6px; font-size:10px">依頼者</span>' : ''}
        ${r.is_reviewer ? '<span style="background:#fef3c7; color:#78350f; padding:1px 6px; border-radius:6px; font-size:10px">チェッカー</span>' : ''}
        <span class="hint-sm" style="font-size:11px">${escapeHtml(fmtYmd(r.created_at))}</span>
      </div>
      <h2 style="margin:0">📝 ${escapeHtml(r.title)}</h2>
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        依頼者: ${escapeHtml(r.requester_display_name || '?')}<br>
        📄 ${escapeHtml(r.filename)} (${((r.size_bytes|0)/1024/1024).toFixed(1)} MB)
      </div>
      ${r.message ? `<div class="hint-sm" style="margin-top:6px; padding:8px 10px; background:#f9fafb; border-radius:6px; white-space:pre-wrap; font-size:13px">${escapeHtml(r.message)}</div>` : ''}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px; font-size:14px">チェッカー (${(r.reviewers || []).length})</h3>
      <div style="display:flex; flex-direction:column; gap:6px">
        ${(r.reviewers || []).map(rv => renderReviewerRow(r, rv, meId)).join('')}
      </div>
    </div>

    ${r.is_requester && r.status === 'open' ? `
      <div class="card">
        <div class="row" style="justify-content:flex-end">
          <button id="mr-cancel" class="btn danger" style="font-size:12px">この依頼をキャンセル</button>
        </div>
      </div>` : ''}
    <div class="card">
      <a href="#/manuscript-reviews" class="hint">← 一覧に戻る</a>
    </div>
  `;

  document.getElementById('mr-cancel')?.addEventListener('click', async () => {
    if (!confirm('この依頼をキャンセルしますか?\n(既に進んでいるチェックの結果は残ります)')) return;
    try {
      await post('/api/manuscript-reviews/' + id + '/cancel', {});
      toast('キャンセルしました');
      navigate('#/manuscript-reviews');
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

function renderReviewerRow(r, rv, meId) {
  const meta = RV_LABEL[rv.status] || RV_LABEL.pending;
  const isMe = Number(rv.reviewer_user_id) === meId;
  const canReview = isMe && r.status === 'open' && rv.status !== 'done';
  // pr での校閲は 別タブで開く (fullscreen 遷移で 元 tab を維持)
  const reviewHref = `/api/manuscript-reviews/${r.id}/reviewers/${rv.id}/review`;
  const actions = [];
  if (canReview) {
    actions.push(`<a class="btn primary" href="${reviewHref}" target="_blank" rel="noopener" style="font-size:12px; padding:4px 10px; text-decoration:none">▶ pr で校閲</a>`);
  }
  if (rv.result_url) {
    actions.push(`<a class="btn" href="${escapeHtml(rv.result_url)}" target="_blank" rel="noopener" style="font-size:12px; padding:4px 10px; text-decoration:none; background:#dbeafe; color:#1e40af">📎 結果を開く ↗</a>`);
  }
  return `
    <div class="row" style="gap:8px; align-items:center; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:#fff">
      ${avatarHtml(rv.reviewer_display_name, rv.reviewer_avatar_url, 'sm')}
      <div style="flex:1; min-width:0">
        <div class="bold" style="font-size:13px">${escapeHtml(rv.reviewer_display_name || '?')}${isMe ? ' <span class="hint-sm" style="font-size:10px; color:#6b7280">(あなた)</span>' : ''}</div>
        <div class="hint-sm" style="font-size:11px">
          <span style="color:${meta.color}; font-weight:600">${meta.label}</span>
          ${rv.result_at ? ` · ${escapeHtml(fmtYmd(rv.result_at))} 完了` : ''}
        </div>
      </div>
      <div class="row" style="gap:4px; flex:none">
        ${actions.join('')}
      </div>
    </div>`;
}
