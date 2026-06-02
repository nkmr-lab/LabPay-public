// /#/feedback-admin — admin 専用: バグ報告 / 機能要望の一覧 + 返信。
// 既存の admin タブから「バグ報告 / 機能要望」カードを抜き出して専用ページに
// したもの。中身は admin.js 側の実装と同じ仕様で、トップヘッダから直接到達
// できるようにする。

import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

const KIND_LBL = { bug: '🐛 バグ報告', feature: '✨ 機能要望', other: '💬 その他' };

export async function renderFeedbackAdmin() {
  if (!state.me || state.me.role !== 'admin') {
    document.getElementById('app').innerHTML = `<div class="card"><h2>管理者専用</h2><p>権限がありません。</p></div>`;
    return;
  }
  document.getElementById('app').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">報告・要望</h2>
      <p class="muted" style="font-size:13px; margin:4px 0 8px">
        バグ報告 / 機能要望の一覧。「対応したよ！」などと返信すると投稿者に通知されます。
      </p>
      <div class="row" style="gap:6px; margin-bottom:8px">
        <button data-flt="open"  class="btn primary" id="fb-flt-open">未返信のみ</button>
        <button data-flt="all"   class="btn" id="fb-flt-all">すべて</button>
      </div>
      <div id="fb-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('fb-flt-open').addEventListener('click', () => setFilter('open'));
  document.getElementById('fb-flt-all') .addEventListener('click', () => setFilter('all'));
  await loadList();
}

let currentFilter = 'open';
function setFilter(f) {
  currentFilter = f;
  document.getElementById('fb-flt-open').classList.toggle('primary', f === 'open');
  document.getElementById('fb-flt-all') .classList.toggle('primary', f === 'all');
  loadList();
}

async function loadList() {
  const root = document.getElementById('fb-list');
  if (!root) return;
  try {
    const d = await get('/api/feedback');
    let items = d.items || [];
    if (currentFilter === 'open') items = items.filter(f => !f.replied_at);
    if (!items.length) {
      root.innerHTML = `<div class="empty">${currentFilter === 'open' ? '未返信の投稿はありません 🎉' : 'まだ投稿はありません'}</div>`;
      return;
    }
    root.innerHTML = items.map(row).join('');
    root.querySelectorAll('[data-reply-fb]').forEach(b => {
      b.addEventListener('click', async () => {
        const ta = root.querySelector(`#fb-reply-${b.dataset.replyFb}`);
        const reply = ta?.value.trim();
        if (!reply) { toast('返信内容を入れてください'); return; }
        try {
          await post(`/api/feedback/${b.dataset.replyFb}/reply`, { reply });
          toast('返信しました');
          await loadList();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    root.querySelectorAll('[data-quick-fb]').forEach(b => {
      b.addEventListener('click', () => {
        const ta = root.querySelector(`#fb-reply-${b.dataset.quickFb}`);
        if (ta) ta.value = b.dataset.text;
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function row(f) {
  const kindLbl = KIND_LBL[f.kind] || f.kind;
  const replied = !!f.replied_at;
  return `
    <div class="list-item" style="${replied ? 'opacity:.6' : 'border-left:3px solid var(--primary)'}; align-items:flex-start">
      <div style="flex:1; min-width:0">
        <div class="bold">${escapeHtml(kindLbl)} · ${escapeHtml(f.user_name)} <span class="muted" style="font-weight:normal; font-size:11px">${escapeHtml(f.created_at)}</span></div>
        <div class="meta" style="white-space:pre-wrap; margin-top:2px">${escapeHtml(f.body)}</div>
        ${f.url ? `<div class="meta" style="font-size:11px">📍 ${escapeHtml(f.url)}</div>` : ''}
        ${replied
          ? `<div style="margin-top:6px; padding:6px 8px; background:#eaf5ef; border-radius:6px; font-size:13px">
               <div class="bold" style="color:#0e7c63">✅ 返信済 (${escapeHtml(f.replied_by_name || 'admin')} · ${escapeHtml(f.replied_at)})</div>
               <div style="white-space:pre-wrap; margin-top:2px">${escapeHtml(f.reply_body)}</div>
             </div>`
          : `<div style="margin-top:6px">
               <textarea id="fb-reply-${f.id}" rows="2" maxlength="4000" placeholder="例: 対応したよ！" style="width:100%; box-sizing:border-box"></textarea>
               <div class="row" style="gap:4px; margin-top:4px; flex-wrap:wrap">
                 <button data-quick-fb="${f.id}" data-text="対応したよ！" class="btn" style="padding:2px 8px; font-size:11px">対応したよ！</button>
                 <button data-quick-fb="${f.id}" data-text="検討します！" class="btn" style="padding:2px 8px; font-size:11px">検討します！</button>
                 <button data-quick-fb="${f.id}" data-text="再現方法を教えてください" class="btn" style="padding:2px 8px; font-size:11px">再現方法?</button>
                 <button data-reply-fb="${f.id}" class="primary" style="padding:2px 10px; font-size:12px; margin-left:auto">返信</button>
               </div>
             </div>`}
      </div>
    </div>`;
}
