// /#/feedback-admin — admin 専用: バグ報告 / 機能要望の一覧 + 返信。
// 既存の admin タブから「バグ報告 / 機能要望」カードを抜き出して専用ページに
// したもの。中身は admin.js 側の実装と同じ仕様で、トップヘッダから直接到達
// できるようにする。

import { get, post, patch } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

const KIND_LBL = { bug: '🐛 バグ報告', feature: '✨ 機能要望', other: '💬 その他' };

export async function renderFeedbackAdmin() {
  if (!state.me || state.me.role !== 'admin') {
    document.getElementById('app').innerHTML = `<div class="card"><h2>管理者専用</h2><p>権限がありません。</p></div>`;
    return;
  }
  document.getElementById('app').innerHTML = `
    <div class="card" id="fb-claude-dash">
      <h3 style="margin:0 0 6px">🤖 Claude 巡回 状況</h3>
      <div id="fb-claude-dash-body" class="hint-sm">読み込み中…</div>
    </div>
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
  // navigate 中の race で DOM が消えてる事があるので 防御的に。
  document.getElementById('fb-flt-open')?.addEventListener('click', () => setFilter('open'));
  document.getElementById('fb-flt-all') ?.addEventListener('click', () => setFilter('all'));
  await renderClaudeDashboard();
  await loadList();
}

// v453 Claude 巡回 状況 を 上部に 表示。 最終巡回時刻 / approved・working 一覧 +
// 各行 に [Claude に任せる] / [取り消す] / [対象外 (blocked)] ボタン。
async function renderClaudeDashboard() {
  const root = document.getElementById('fb-claude-dash-body');
  if (!root) return;
  try {
    const d = await get('/api/feedback/claude_dashboard');
    const lastPoll = d.last_polled_at ? new Date(d.last_polled_at) : null;
    const lastDone = d.last_done;
    const items = d.queue_items || [];
    const ago = (sec) => {
      if (sec < 60) return `${sec} 秒前`;
      if (sec < 3600) return `${Math.floor(sec/60)} 分前`;
      if (sec < 86400) return `${Math.floor(sec/3600)} 時間前`;
      return `${Math.floor(sec/86400)} 日前`;
    };
    const pollAgo = lastPoll
      ? ago(Math.floor((Date.now() - lastPoll.getTime()) / 1000))
      : '(まだ 巡回なし)';
    const pollWarn = lastPoll && (Date.now() - lastPoll.getTime() > 90 * 60 * 1000)
      ? ` <span class="tag" style="background:#ffe9c2; color:#9a4400">⚠ 1.5 時間以上 前</span>`
      : '';
    const stuckCount = items.filter(it => it.age_seconds > 3600).length;
    const stuckTag = stuckCount > 0
      ? ` <span class="tag" style="background:#fee2e2; color:#b91c1c">⏸ ${stuckCount} 件 滞留</span>`
      : '';
    const lastDoneLine = lastDone
      ? `<div>直近 完了: #${lastDone.id} — ${escapeHtml(lastDone.claude_summary || '(無題)')} <span class="muted">${escapeHtml(lastDone.claude_finished_at || '')}</span></div>`
      : '<div class="muted">直近 完了: なし</div>';
    const itemsHtml = items.length ? `
      <div class="list" style="margin-top:6px">
        ${items.map(it => {
          const statusBadge = it.claude_status === 'working'
            ? '<span class="tag" style="background:#e3f2fd; color:#1565c0">🛠 working</span>'
            : '<span class="tag" style="background:#fef3c7; color:#92400e">⏳ approved</span>';
          const stuck = it.age_seconds > 3600
            ? ` <span class="tag" style="background:#fee2e2; color:#b91c1c">⚠ 滞留 ${ago(it.age_seconds)}</span>`
            : ` <span class="hint">${ago(it.age_seconds)}</span>`;
          return `
          <div class="list-item">
            <div class="grow" style="min-width:0">
              <div class="bold">#${it.id} ${escapeHtml(KIND_LBL[it.kind] || it.kind)} ${statusBadge}${stuck}</div>
              <div class="meta" style="white-space:pre-wrap; overflow:hidden">${escapeHtml(it.body_preview)}${it.body_preview.length >= 200 ? '…' : ''}</div>
            </div>
            <div class="row" style="gap:4px; flex-direction:column">
              <button class="btn" data-dash-block-fb="${it.id}" style="font-size:11px; padding:2px 6px" title="一旦 退避 (none に 戻す)">退避</button>
              <button class="btn danger" data-dash-blocked-fb="${it.id}" style="font-size:11px; padding:2px 6px" title="Claude 対象 から 外す (blocked)">対象外</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : '<div class="muted" style="margin-top:6px">approved / working なし</div>';
    root.innerHTML = `
      <div>最終 巡回: <b>${escapeHtml(lastPoll ? lastPoll.toLocaleString() : '—')}</b> (${pollAgo})${pollWarn}${stuckTag}</div>
      ${lastDoneLine}
      ${itemsHtml}
    `;
    // 退避: approved/working → none に 戻す (再度 「Claude に任せる」 で 再投入)
    root.querySelectorAll('[data-dash-block-fb]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await patch(`/api/feedback/${b.dataset.dashBlockFb}/claude_status`, { status: 'none' });
          toast('退避しました');
          await renderClaudeDashboard();
          await loadList();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    root.querySelectorAll('[data-dash-blocked-fb]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Claude 対象 から 外しますか? (blocked)')) return;
        try {
          await patch(`/api/feedback/${b.dataset.dashBlockedFb}/claude_status`, { status: 'blocked' });
          toast('対象外にしました');
          await renderClaudeDashboard();
          await loadList();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

let currentFilter = 'open';
function setFilter(f) {
  currentFilter = f;
  document.getElementById('fb-flt-open')?.classList.toggle('primary', f === 'open');
  document.getElementById('fb-flt-all') ?.classList.toggle('primary', f === 'all');
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
    // v407 Claude に任せる 切替
    root.querySelectorAll('[data-claude-fb]').forEach(b => {
      b.addEventListener('click', async () => {
        const next = b.dataset.next;
        try {
          await patch(`/api/feedback/${b.dataset.claudeFb}/claude_status`, { status: next });
          toast(next === 'approved' ? '🤖 Claude に 任せました' : '取り消しました');
          await loadList();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function row(f) {
  const kindLbl = KIND_LBL[f.kind] || f.kind;
  const replied = !!f.replied_at;
  // v407 Claude 自動対応 ステータス badge + トグル
  const cs = f.claude_status || 'none';
  const claudeBadge = ({
    none:     '',
    approved: '<span class="tag" style="background:#fff7d6; color:#9a6700; font-size:10px">🤖 Claude 待機中</span>',
    working:  '<span class="tag" style="background:#e3f2fd; color:#1565c0; font-size:10px">🤖 Claude 作業中…</span>',
    done:     '<span class="tag ok" style="font-size:10px">✅ Claude 完了</span>',
    blocked:  '<span class="tag" style="background:#fee2e2; color:#c62828; font-size:10px">⚠ Claude 中断</span>',
  })[cs] || '';
  // ステータス変更ボタン (admin が toggleできるのは none ⇄ approved、 ブロック解除は blocked → none)
  let claudeBtn = '';
  if (cs === 'none') {
    claudeBtn = `<button data-claude-fb="${f.id}" data-next="approved" class="btn" style="padding:2px 8px; font-size:11px; color:#9a6700; border:1px solid #d4a017">🤖 Claude に任せる</button>`;
  } else if (cs === 'approved') {
    claudeBtn = `<button data-claude-fb="${f.id}" data-next="none" class="btn" style="padding:2px 8px; font-size:11px">取り消す</button>`;
  } else if (cs === 'blocked') {
    claudeBtn = `<button data-claude-fb="${f.id}" data-next="none" class="btn" style="padding:2px 8px; font-size:11px">再投入準備 (none に戻す)</button>`;
  }
  // Claude のサマリが あれば 表示
  const claudeSummary = f.claude_summary
    ? `<div style="margin-top:4px; padding:6px 8px; background:#f5f3ff; border-left:3px solid #8b5cf6; border-radius:4px; font-size:12px; white-space:pre-wrap">${escapeHtml(f.claude_summary)}</div>`
    : '';
  return `
    <div class="list-item" style="${replied ? 'opacity:.6' : 'border-left:3px solid var(--primary)'}; align-items:flex-start">
      <div style="flex:1; min-width:0">
        <div class="bold">${escapeHtml(kindLbl)} · ${escapeHtml(f.user_name)} <span class="muted" style="font-weight:normal; font-size:11px">${escapeHtml(f.created_at)}</span> ${claudeBadge}</div>
        <div class="meta" style="white-space:pre-wrap; margin-top:2px">${escapeHtml(f.body)}</div>
        ${f.url ? `<div class="meta" style="font-size:11px">📍 ${escapeHtml(f.url)}</div>` : ''}
        ${claudeSummary}
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
                 ${claudeBtn}
                 <button data-reply-fb="${f.id}" class="primary" style="padding:2px 10px; font-size:12px; margin-left:auto">返信</button>
               </div>
             </div>`}
      </div>
    </div>`;
}
