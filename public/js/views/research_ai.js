// /#/research-ai — 研究特化 AI サブスク (v1125 → v1142 大改修)
//   ChatGPT / Claude 風の UX: 左に履歴サイドバー、右にメイン会話、
//   PDF / 画像 添付、 スレッド共有 (他者もチャット投稿可)、
//   課金は 件数 → トークン量 (チケット or 週次上限つき無制限)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

const MOBILE_QUERY = '(max-width: 899px)';

let STATE = null;
let THREADS = [];
let CURRENT = null;   // { thread, messages }
let CURRENT_TID = null;
let SELECTED_TPL = 'freetalk';
let PENDING_ATTACHMENTS = [];   // アップロード済で送信待ち

export async function renderResearchAI() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="rai-shell" style="position:fixed; top:96px; left:0; right:0; bottom:0; display:flex; background:#fff; z-index:2">
      <aside id="rai-side" style="width:260px; flex:none; border-right:1px solid var(--line); background:#faf7fc; display:flex; flex-direction:column; overflow:hidden">
        <div style="padding:10px 12px; border-bottom:1px solid var(--line); background:#4a106d; color:#fff">
          <div class="bold" style="font-size:14px">🔬 研究 AI</div>
          <div id="rai-sub-mini" style="font-size:11px; opacity:0.9; margin-top:2px">読み込み中…</div>
        </div>
        <div style="padding:8px 10px; border-bottom:1px solid var(--line); background:#fff">
          <button id="rai-new" class="btn primary" style="width:100%; font-size:13px; padding:6px 10px">＋ 新しいチャット</button>
        </div>
        <div id="rai-threads" style="flex:1; overflow-y:auto"></div>
        <div style="padding:8px 10px; border-top:1px solid var(--line); background:#f3f4f6; font-size:11px; color:#6b7280">
          <a href="#/" style="color:#4a106d; text-decoration:none">← ホームに戻る</a>
        </div>
      </aside>
      <main id="rai-main" style="flex:1; min-width:0; display:flex; flex-direction:column">
        <div id="rai-body" style="flex:1; overflow-y:auto; padding:14px; background:#fff">
          <div class="muted">読み込み中…</div>
        </div>
      </main>
    </div>
  `;
  // モバイルレイアウト
  applyMobileLayout();
  window.matchMedia(MOBILE_QUERY).addEventListener('change', applyMobileLayout);
  document.getElementById('rai-new').addEventListener('click', onNewThread);
  await refresh();
}

function applyMobileLayout() {
  const mobile = window.matchMedia(MOBILE_QUERY).matches;
  const side = document.getElementById('rai-side');
  const main = document.getElementById('rai-main');
  if (!side || !main) return;
  if (mobile) {
    // モバイルは片方だけ表示 (thread 未選択なら sidebar、選択後は main)
    if (CURRENT_TID) { side.style.display = 'none'; main.style.display = 'flex'; }
    else             { side.style.display = 'flex'; main.style.display = 'none'; }
  } else {
    side.style.display = 'flex';
    main.style.display = 'flex';
  }
}

async function refresh() {
  try {
    STATE = await get('/api/research-ai');
    const t = await get('/api/research-ai/threads');
    THREADS = t.items || [];
    // v1144 AI 結果ページから「AI と話す」で新規作成された thread があれば優先で開く
    let requestedTid = null;
    try {
      const raw = localStorage.getItem('labpay-rai-open-tid');
      if (raw) {
        requestedTid = Number(raw);
        localStorage.removeItem('labpay-rai-open-tid');
      }
    } catch (_) {}
    paintSidebar();
    if (requestedTid && THREADS.some(t => t.id === requestedTid)) {
      await openThread(requestedTid);
    } else if (!CURRENT_TID && THREADS.length) {
      await openThread(THREADS[0].id);
    } else if (CURRENT_TID) {
      await openThread(CURRENT_TID, true);
    } else {
      paintEmptyBody();
    }
  } catch (e) {
    document.getElementById('rai-body').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function paintSidebar() {
  const mini = document.getElementById('rai-sub-mini');
  if (mini) mini.innerHTML = subMiniHtml(STATE.subscription);
  const list = document.getElementById('rai-threads');
  if (!THREADS.length) {
    list.innerHTML = '<div class="hint-sm" style="padding:14px; color:#9ca3af; font-size:12px">まだチャットがありません。 上の「＋ 新しいチャット」から始めよう。</div>';
    return;
  }
  const meId = Number(state.me?.id);
  list.innerHTML = THREADS.map(t => {
    const active = t.id === CURRENT_TID;
    const sharedMark = t.is_shared ? '🔗' : '';
    const owner = t.is_mine ? '' : `<span class="hint-sm" style="font-size:10px; margin-left:4px; color:#6b7280">by ${escapeHtml(t.owner_name)}</span>`;
    const time = t.last_message_at ? String(t.last_message_at).slice(5, 16).replace('-','/') : '';
    return `<a href="#" data-rai-open="${t.id}" style="display:block; padding:8px 10px; border-bottom:1px solid #f3f4f6; text-decoration:none; color:inherit; ${active ? 'background:#ede4f3; border-left:3px solid #7b3fa0' : ''}">
      <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${active ? 'font-weight:700' : ''}">${sharedMark} ${escapeHtml(t.title || '無題')}${owner}</div>
      <div class="hint-sm" style="font-size:10.5px; color:#9ca3af">${time}</div>
    </a>`;
  }).join('');
  list.querySelectorAll('[data-rai-open]').forEach(a => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    openThread(Number(a.dataset.raiOpen));
  }));
}

function subMiniHtml(sub) {
  // v1254 新 AI サブスク (ai_subs) が 有効 なら 使い放題。
  // v1255 研究特化 サブスク は 新規購入 廃止、 既存契約者 は 残 トークン を 使い切れる (grandfather)。
  if (STATE?.ai_sub_active) {
    return '<span style="color:#a7f3d0">🤖 AIサブスクで使い放題</span>';
  }
  if (!sub) {
    return '<span style="color:#fecaca">⚠ AIサブスクが必要 → <a href="#/ai-sub" style="color:#fecaca; text-decoration:underline">契約する</a></span>';
  }
  // grandfather: 旧 研究特化 サブスク の 残 トークン 表示
  const plan = sub.plan;
  if (plan === 'unlimited_weekly') {
    const left = Math.max(0, (sub.weekly_limit || 0) - (sub.weekly_used || 0));
    return `<span>♾ 週次 ${(left/1000).toFixed(0)}k / ${(sub.weekly_limit/1000).toFixed(0)}k残 (旧サブスク、grandfather)</span>`;
  }
  if (plan === 'tokens_ticket') {
    return `<span>🎟 ${((sub.tokens_left || 0)/1000).toFixed(1)}k tokens残 (旧サブスク、grandfather)</span>`;
  }
  if (plan === 'quota60') {
    return `<span>📊 旧 quota60: 残 ${sub.quota_left || 0} 件</span>`;
  }
  if (plan === 'unlimited') return '<span>♾ 旧 unlimited</span>';
  return '<span>サブスク中</span>';
}

async function onNewThread() {
  if (!STATE?.subscription) {
    if (!confirm('サブスクに未加入です。 購入画面へ移動しますか?')) return;
    paintEmptyBody(); return;
  }
  const title = prompt('チャットのタイトル (後から変更可)', '新しいチャット');
  if (title === null) return;
  try {
    const r = await post('/api/research-ai/threads', { title: title || '新しいチャット', template_key: SELECTED_TPL });
    CURRENT_TID = r.id;
    await refresh();
    applyMobileLayout();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function openThread(tid, silent = false) {
  CURRENT_TID = tid;
  PENDING_ATTACHMENTS = [];
  applyMobileLayout();
  const body = document.getElementById('rai-body');
  if (!silent) body.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    CURRENT = await get('/api/research-ai/threads/' + tid);
    paintThread();
    paintSidebar();
  } catch (e) {
    body.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function paintEmptyBody() {
  const body = document.getElementById('rai-body');
  const sub = STATE?.subscription;
  const aiSubActive = !!STATE?.ai_sub_active;
  // v1255 研究特化 独自 サブスク の 新規購入 は 廃止 → AI サブスク への 導線 のみ
  const subscribeBanner = (aiSubActive || sub) ? '' : `
    <div class="card" style="background:#fef3c7">
      <div class="bold" style="color:#92400e; margin-bottom:6px">🤖 AIサブスクを契約して始める</div>
      <div class="hint-sm" style="margin-bottom:8px">1週間500pt。契約中は研究特化AI含むLabPay内全AI機能が使い放題。</div>
      <a href="#/ai-sub" class="btn primary" style="text-decoration:none; padding:8px 14px">🤖 AIサブスクの詳細 / 契約へ →</a>
    </div>
  `;
  body.innerHTML = `
    <div style="max-width:720px; margin:0 auto">
      <h2 style="margin:0 0 10px">🔬 研究特化 AI チャット</h2>
      <p class="hint" style="font-size:13px; line-height:1.7">
        研究に特化したプロンプトテンプレート付きチャット (📝 研究テーマ相談 / 🧪 実験デザインチェック /
        ✒️ アブスト磨き / 📚 関連研究整理 / 📮 リバッタル起草 / 💴 科研費文章 / 💬 汎用)。<br>
        ChatGPT / Claude 風の UI (左に履歴サイドバー、 PDF / 画像 添付、 スレッド共有 = 他者と共同利用)。
      </p>
      ${subscribeBanner}
      ${THREADS.length ? '' : `
        <div class="card">
          <div class="hint-sm">まだチャットがありません。 左の「＋ 新しいチャット」で始めましょう。</div>
        </div>
      `}
    </div>
  `;
}

function paintThread() {
  const body = document.getElementById('rai-body');
  if (!CURRENT) { body.innerHTML = ''; return; }
  const th = CURRENT.thread;
  const msgs = CURRENT.messages || [];
  const meId = Number(state.me?.id);
  const canDelete = th.is_mine;
  const canShare  = th.is_mine;
  const tplName = (STATE?.templates || []).find(t => t.key === th.template_key)?.title || '💬 汎用';
  const sharedPill = th.is_shared
    ? `<span style="background:#dcfce7; color:#166534; padding:1px 8px; border-radius:8px; font-size:11px">🔗 共有中 (${(th.shared_user_ids || []).length} 名)</span>`
    : '';
  // v1144 元 AI 結果からの派生スレッドはバッジ + 戻るリンク
  const seedTypeLabel = {
    paper_review: '📄 論文査読',
    resume_check: '📝 原稿チェック',
    exp_plan: '🧪 実験計画書',
    paper_summary: '📑 論文要約',
    paper_translate: '📑 論文要約',
    paper_translate_full: '📑 論文全訳',
  }[th.seed_source_type] || '';
  const seedUrlByType = {
    paper_review: '/#/paper-review/', resume_check: '/#/resume-check/', exp_plan: '/#/exp-plan/',
    paper_summary: '/#/paper-summary/', paper_translate: '/#/paper-summary/', paper_translate_full: '/#/paper-translate-full/',
  };
  const seedPill = th.seed_source_type && th.seed_source_id
    ? `<a href="${seedUrlByType[th.seed_source_type] || '/#/'}${th.seed_source_id}" style="background:#f5f3ff; color:#4a106d; padding:1px 8px; border-radius:8px; font-size:11px; text-decoration:none">← ${escapeHtml(seedTypeLabel)} #${th.seed_source_id}</a>`
    : '';
  const sub = STATE?.subscription;
  // v1254 新 AI サブスク が 有効 なら 投稿 可能。 v1255 独自 プラン は 廃止、 grandfather 用 の 旧 sub 判定 のみ 残す
  const aiSubActive = !!STATE?.ai_sub_active;
  const subOk = !!sub || aiSubActive;

  body.innerHTML = `
    <div style="max-width:900px; margin:0 auto; display:flex; flex-direction:column; min-height:100%">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap">
        <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1">
          <!-- v1150 スマホで サイドバー (履歴) に戻るボタン。 デスクトップは サイドバー常時表示なので 非表示 -->
          <button id="rai-back-sidebar" class="btn" style="flex:none; font-size:16px; padding:4px 10px; display:none" title="履歴に戻る">☰</button>
          <div style="min-width:0; flex:1">
            <div class="row" style="align-items:center; gap:6px; flex-wrap:wrap">
              <div class="bold" style="font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" id="rai-title" title="タップで編集">${escapeHtml(th.title || '無題')}</div>
              ${sharedPill}
              ${seedPill}
            </div>
            <div class="hint-sm" style="font-size:11px; color:#6b7280">${escapeHtml(tplName)} · 作成: ${escapeHtml(th.created_at)}</div>
          </div>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          ${canShare ? `<button id="rai-share" class="btn" style="font-size:12px">${th.is_shared ? '🔗 共有設定' : '👥 共有する'}</button>` : ''}
          ${canDelete ? `<button id="rai-del" class="btn danger" style="font-size:12px">🗑 削除</button>` : ''}
        </div>
      </div>

      ${!subOk ? `
        <div class="card" style="background:#fef3c7; border-left:4px solid #f59e0b">
          <div class="bold" style="color:#92400e; margin-bottom:6px">⚠ AIサブスクが必要 — 投稿するには契約してください</div>
          <div class="hint-sm" style="margin-bottom:8px">1週間500pt。契約中は研究特化AI含むLabPay内全AI機能が使い放題。</div>
          <a href="#/ai-sub" class="btn primary" style="font-size:12px; padding:6px 12px; text-decoration:none">🤖 AIサブスクの詳細 / 契約へ →</a>
        </div>
      ` : (aiSubActive ? `
        <div class="card" style="background:#d1fae5; border-left:4px solid #059669">
          <div class="bold" style="color:#065f46">🤖 AIサブスク契約中 — 研究特化AIも使い放題</div>
        </div>
      ` : '')}

      <div id="rai-messages" style="flex:1; display:flex; flex-direction:column; gap:12px">
        ${msgs.length ? msgs.map(m => renderMsg(m, th.owner_user_id, meId)).join('') :
          `<div class="muted">まだメッセージがありません。 下から質問を送ってください。</div>`}
      </div>

      <div id="rai-composer" style="position:sticky; bottom:0; background:#fff; padding-top:10px; border-top:1px solid #f3f4f6; margin-top:14px">
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px" id="rai-tpl-bar">
          ${(STATE?.templates || []).map(t => `<button class="btn" data-rai-tpl="${t.key}" style="font-size:11px; padding:2px 8px">${escapeHtml(t.title)}</button>`).join('')}
        </div>
        <div id="rai-attach-preview" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div style="display:flex; gap:6px; align-items:flex-end">
          <label class="btn" style="flex:none; font-size:12px; padding:6px 10px; cursor:pointer; margin:0" title="画像 or PDF を添付">
            📎<input type="file" id="rai-file" accept="image/*,application/pdf" hidden>
          </label>
          <textarea id="rai-msg" rows="3" maxlength="8000" placeholder="質問 / 相談を入力… (Ctrl+Enter で送信)" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; font-family:inherit; font-size:14px; resize:vertical; min-height:60px; max-height:220px"></textarea>
          <button id="rai-send" class="btn primary" style="flex:none; padding:8px 14px">${subOk ? '📮 送信' : '🔒 未加入'}</button>
        </div>
        <div class="hint-sm" style="font-size:10.5px; color:#9ca3af; margin-top:4px">
          テンプレートは選択したものが system prompt になります。 添付は画像 / PDF (30MB まで、 OpenAI Files API 経由)。
          ${sub && sub.plan === 'unlimited_weekly' ? `週次 ${((sub.weekly_limit || 0) - (sub.weekly_used || 0))/1000|0}k tokens 残` : ''}
          ${sub && sub.plan === 'tokens_ticket' ? `チケット ${((sub.tokens_left || 0)/1000).toFixed(1)}k tokens 残` : ''}
        </div>
      </div>
    </div>
  `;

  // タイトル編集
  document.getElementById('rai-title')?.addEventListener('click', async () => {
    if (!th.is_mine) return;
    const newTitle = prompt('タイトルを編集', th.title);
    if (!newTitle) return;
    try {
      await patch('/api/research-ai/threads/' + th.id + '/title', { title: newTitle });
      await openThread(th.id);
      await refresh();
    } catch (e) { toast('失敗: ' + e.message); }
  });

  document.getElementById('rai-del')?.addEventListener('click', async () => {
    if (!confirm('このチャットを削除しますか?')) return;
    try {
      await del('/api/research-ai/threads/' + th.id);
      CURRENT_TID = null;
      CURRENT = null;
      await refresh();
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // v1150 スマホで サイドバー (履歴) に戻る (デスクトップは サイドバー常時表示なので 非表示)
  const backBtn = document.getElementById('rai-back-sidebar');
  if (backBtn) {
    // 表示切替は applyMobileLayout の副次として、ここでは スマホ判定で on/off
    const updateBack = () => {
      backBtn.style.display = window.matchMedia(MOBILE_QUERY).matches ? '' : 'none';
    };
    updateBack();
    window.matchMedia(MOBILE_QUERY).addEventListener('change', updateBack);
    backBtn.addEventListener('click', () => {
      CURRENT_TID = null;   // メイン→サイドバー切替 (履歴一覧に戻る)
      applyMobileLayout();
    });
  }

  document.getElementById('rai-share')?.addEventListener('click', () => showShareModal(th));

  // テンプレート選択
  const updateTplUI = () => {
    document.querySelectorAll('[data-rai-tpl]').forEach(el => {
      el.classList.toggle('primary', el.dataset.raiTpl === SELECTED_TPL);
    });
  };
  document.querySelectorAll('[data-rai-tpl]').forEach(el =>
    el.addEventListener('click', () => { SELECTED_TPL = el.dataset.raiTpl; updateTplUI(); }));
  SELECTED_TPL = th.template_key || 'freetalk';
  updateTplUI();

  // 添付
  document.getElementById('rai-file')?.addEventListener('change', onAttachFile);
  paintAttachPreview();

  // 送信
  const inputEl = document.getElementById('rai-msg');
  const sendEl  = document.getElementById('rai-send');
  const send = async () => {
    if (!subOk) { toast('サブスク未加入 (AIサブスクが必要)'); return; }
    const msg = inputEl.value.trim();
    if (!msg) { toast('メッセージを入力'); return; }
    sendEl.disabled = true; sendEl.textContent = '⌛';
    try {
      const r = await post('/api/research-ai/threads/' + th.id + '/messages',
        { message: msg, attachment_ids: PENDING_ATTACHMENTS.map(a => a.id) });
      inputEl.value = '';
      PENDING_ATTACHMENTS = [];
      STATE.subscription = r.subscription || STATE.subscription;
      await openThread(th.id);
      await refresh();
    } catch (e) { toast('失敗: ' + e.message); }
    finally { sendEl.disabled = false; sendEl.textContent = '📮 送信'; }
  };
  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); } });

  // v1255 研究特化 独自 サブスク の 新規購入 UI は 撤去 (バックエンド も 410 gone を 返す)。
  // 未加入時 は 「AI サブスク の 詳細 / 契約 へ」 リンク で #/ai-sub へ 誘導 のみ。

  // スクロールを末尾へ
  requestAnimationFrame(() => {
    const msgsEl = document.getElementById('rai-messages');
    msgsEl?.scrollIntoView({ block: 'end' });
    document.getElementById('rai-body').scrollTop = document.getElementById('rai-body').scrollHeight;
  });
}

function renderMsg(m, ownerUid, meId) {
  const speakerName = m.speaker_name || '?';
  const isMine = Number(m.speaker_user_id) === meId;
  const attachHtml = (m.attachments || []).map(a => {
    if (a.kind === 'image') {
      return `<a href="${escapeHtml(a.url)}" target="_blank" style="display:inline-block; margin:4px 4px 0 0"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.filename)}" style="max-width:200px; max-height:200px; border-radius:6px; border:1px solid var(--line)"></a>`;
    }
    return `<a href="${escapeHtml(a.url)}" target="_blank" style="display:inline-block; margin:4px 4px 0 0; padding:4px 8px; background:#f3f4f6; border-radius:4px; text-decoration:none; color:#4a106d; font-size:12px">📄 ${escapeHtml(a.filename)}</a>`;
  }).join('');
  const tokensBadge = m.tokens_total
    ? `<span class="hint-sm" style="font-size:10px; color:#9ca3af; margin-left:6px">${m.tokens_total} tokens</span>`
    : '';
  return `
    <div class="card" style="padding:10px 12px; background:${isMine ? '#faf7fc' : '#f8fafc'}; border-left:3px solid ${isMine ? '#7b3fa0' : '#0ea5e9'}">
      <div style="display:flex; gap:8px; align-items:flex-start">
        <div style="flex:none">${avatarHtml(speakerName, m.speaker_avatar, 'sm')}</div>
        <div style="flex:1; min-width:0">
          <div class="bold" style="font-size:12.5px">${escapeHtml(speakerName)}${tokensBadge}<span class="hint-sm" style="font-size:10px; color:#9ca3af; margin-left:6px">${escapeHtml(String(m.created_at).slice(5, 16).replace('-','/'))}</span></div>
          <div style="font-size:14px; margin-top:2px; white-space:pre-wrap; word-break:break-word">${escapeHtml(m.user_message || '')}</div>
          ${attachHtml ? `<div>${attachHtml}</div>` : ''}
        </div>
      </div>
      ${m.ai_response ? `
      <div style="margin-top:8px; padding:8px 10px; background:#fff; border-left:3px solid #16a34a; border-radius:0 6px 6px 0">
        <div class="bold" style="font-size:12px; color:#166534; margin-bottom:4px">🤖 AI 応答</div>
        <div style="font-size:14px; line-height:1.7; white-space:pre-wrap; word-break:break-word">${escapeHtml(m.ai_response)}</div>
      </div>` : ''}
    </div>`;
}

async function onAttachFile(ev) {
  const fileInput = ev.target;
  const f = fileInput.files?.[0];
  if (!f) return;
  if (f.size > 30 * 1024 * 1024) { toast('30 MB まで'); return; }
  // v1145 元々の label の innerHTML 書き換えは input を破壊してリスナが失われる
  //   問題があった。 label の textNode だけ差し替え、 <input> は保持する。
  const label = fileInput.closest('label');
  const swapLabelIcon = (icon) => {
    if (!label) return;
    // label 内の テキストノード だけを差し替え (input は残す)
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) { node.textContent = icon; return; }
    }
    // fallback: 先頭に text ノードを 追加
    label.insertBefore(document.createTextNode(icon), label.firstChild);
  };
  swapLabelIcon('⌛');
  const fd = new FormData();
  fd.append('file', f);
  try {
    const res = await fetch('/api/research-ai/uploads', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' } });
    const r = await res.json();
    if (!res.ok || r?.error) throw new Error(r?.error?.message || ('HTTP ' + res.status));
    PENDING_ATTACHMENTS.push({ id: r.id, kind: r.kind, url: r.url, filename: r.filename });
    paintAttachPreview();
  } catch (e) { toast('失敗: ' + e.message); }
  finally {
    fileInput.value = '';   // 同じファイル再選択を許可
    swapLabelIcon('📎');
  }
}

function paintAttachPreview() {
  const el = document.getElementById('rai-attach-preview');
  if (!el) return;
  el.innerHTML = PENDING_ATTACHMENTS.map((a, i) => {
    if (a.kind === 'image') {
      return `<div style="position:relative; display:inline-block; margin-right:4px"><img src="${escapeHtml(a.url)}" style="width:60px; height:60px; object-fit:cover; border-radius:4px; border:1px solid var(--line)"><button data-rai-att-rm="${i}" style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; border-radius:9px; background:#dc2626; color:#fff; border:none; font-size:10px; cursor:pointer">×</button></div>`;
    }
    return `<div style="display:inline-flex; align-items:center; gap:4px; padding:4px 8px; background:#f3f4f6; border-radius:4px; font-size:11px">📄 ${escapeHtml(a.filename)}<button data-rai-att-rm="${i}" style="border:none; background:none; cursor:pointer; color:#dc2626">×</button></div>`;
  }).join('');
  el.querySelectorAll('[data-rai-att-rm]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.raiAttRm);
    PENDING_ATTACHMENTS.splice(i, 1);
    paintAttachPreview();
  }));
}

function showShareModal(th) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:1000; display:flex; align-items:center; justify-content:center; padding:14px';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:10px; max-width:520px; width:100%; padding:16px; max-height:80vh; overflow-y:auto">
      <h3 style="margin:0 0 8px">🔗 チャットを共有</h3>
      <p class="hint-sm" style="font-size:12px">共有された人はこのチャットを閲覧でき、 <b>自分のサブスクを使って</b> 追加投稿もできます (投稿者のサブスクトークンが消費されます)。</p>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px">
        <input type="checkbox" id="rai-share-on" ${th.is_shared ? 'checked' : ''}>
        <span>このチャットを共有する</span>
      </label>
      <div style="margin-top:10px">
        <div class="bold" style="font-size:12px; margin-bottom:4px">共有先メンバー</div>
        <div id="rai-share-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="rai-share-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:12px">
        <button id="rai-share-cancel" class="btn">キャンセル</button>
        <button id="rai-share-save" class="btn primary">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  let picker = null;
  createMemberPicker({
    bulkContainer:  modal.querySelector('#rai-share-bulk'),
    chipsContainer: modal.querySelector('#rai-share-chips'),
    initial: th.shared_user_ids || [],
    excludeIds: [Number(state.me?.id)],
    showGenderBulk: false,
  }).then(p => picker = p);
  modal.querySelector('#rai-share-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#rai-share-save').addEventListener('click', async () => {
    const isShared = modal.querySelector('#rai-share-on').checked;
    const ids = picker ? [...picker.getSelected()] : [];
    try {
      await patch('/api/research-ai/threads/' + th.id + '/share', { is_shared: isShared, shared_user_ids: ids });
      toast('共有設定を保存しました');
      modal.remove();
      await openThread(th.id);
      await refresh();
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
