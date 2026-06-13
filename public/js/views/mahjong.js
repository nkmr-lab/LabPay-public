// /#/mahjong — 麻雀 Phase 1: 賭けプール + 結果分配 (v553 #209)。 実ゲームは外部 (雀魂 等)。
//   lazy import で 普段は読み込まれない (apps から 開いた時だけ)。 Phase 2 で実ゲーム化時に重くなる予定。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

export async function renderMahjong() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🀄 麻雀</h2>
        <span style="flex:1"></span>
        <a class="btn" href="#/mahjong/sim" style="font-size:12px">🧪 sim</a>
        <button id="mj-ai" class="btn primary" style="font-size:13px">🤖 AI 対戦 (5pt)</button>
        <a class="btn primary" href="#/mahjong/new">＋ 新規卓</a>
      </div>
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        4 人で 50pt 預けて 1〜4 位申告で 自動分配 (50/30/15/0% + 場代 5%)。 実ゲームは 雀魂 / 紙麻雀 で。
      </div>
    </div>
    <div id="mj-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('mj-ai').addEventListener('click', async () => {
    if (!confirm('5pt を支払って AI 3 体と対戦しますか?')) return;
    const btn = document.getElementById('mj-ai');
    btn.disabled = true; btn.textContent = '起動中…';
    try {
      const r = await post('/api/mahjong/ai/new', {});
      navigate('#/mahjong/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '🤖 AI 対戦 (5pt)'; }
  });
  try {
    const d = await get('/api/mahjong/games');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('mj-list').innerHTML = '<div class="empty">卓がありません。 「＋ 新規卓」 から立てて 4 人集めましょう。</div>';
      return;
    }
    document.getElementById('mj-list').innerHTML = items.map(g => {
      const statusTag = {
        lobby: `<span class="tag warn">募集中 ${g.player_count}/4</span>`,
        playing: '<span class="tag" style="background:#fef3c7; color:#a16207">対局中</span>',
        reporting: '<span class="tag" style="background:#fde68a; color:#a16207">結果報告待ち</span>',
        finished: '<span class="tag muted">終了</span>',
        cancelled: '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>',
      }[g.status] || '';
      const meBadge = g.me_joined ? '<span class="tag ok">参加中</span>' : '';
      return `
        <a class="list-item" href="#/mahjong/${g.id}" style="gap:8px; align-items:center">
          <span style="display:inline-flex; flex:none">${avatarHtml(g.creator_name, g.creator_avatar, 'sm')}</span>
          <div class="grow">
            <div class="bold">${escapeHtml(g.title || ('卓 #' + g.id))} ${statusTag} ${meBadge}</div>
            <div class="meta">${escapeHtml(g.creator_name)} 起案 · buy-in ${g.buy_in}pt · pot ${g.pot_total}pt</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('mj-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderMahjongNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/mahjong" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🀄 麻雀 — 新規卓</h2>
      <label class="field">
        <span class="lbl">タイトル (任意)</span>
        <input type="text" id="mj-title" maxlength="200" placeholder="例: ラボ麻雀 第3回">
      </label>
      <label class="field">
        <span class="lbl">参加料 (buy-in)</span>
        <input type="number" id="mj-buyin" min="1" max="10000" value="50">
        <div class="hint-sm">4 人で 4 × buy-in = pot。 場代 5% 引いた残りを 50/30/15/0% で配ります。</div>
      </label>
      <div class="hint-sm" style="margin-top:8px; color:var(--muted)">
        起案者は自動的に参加 (buy-in は今すぐ徴収)。 残り 3 人を待ちます。
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
        <a href="#/mahjong" class="btn">キャンセル</a>
        <button id="mj-go" class="primary">卓を立てる</button>
      </div>
    </div>
  `;
  document.getElementById('mj-go').addEventListener('click', async () => {
    const title = document.getElementById('mj-title').value.trim();
    const buyIn = Number(document.getElementById('mj-buyin').value) || 50;
    const btn = document.getElementById('mj-go');
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/mahjong/games', { title: title || null, buy_in: buyIn });
      navigate('#/mahjong/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '卓を立てる';
    }
  });
}

export async function renderMahjongDetail({ params }) {
  const gid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let g;
  try { g = await get('/api/mahjong/games/' + gid); }
  catch (e) { app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`; return; }
  // v554 Phase 2: 対局中なら play view へ
  if (g.status === 'playing') {
    const mod = await import('./mahjong_play.js');
    return mod.renderMahjongPlay({ params });
  }
  paintDetail(g);
}

function paintDetail(g) {
  const app = document.getElementById('app');
  const statusLabel = {
    lobby: `<span class="tag warn">募集中 ${g.players.length}/${g.seats}</span>`,
    playing: '<span class="tag" style="background:#fef3c7; color:#a16207">対局中</span>',
    reporting: '<span class="tag" style="background:#fde68a; color:#a16207">結果報告待ち</span>',
    finished: '<span class="tag muted">終了</span>',
    cancelled: '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>',
  }[g.status] || '';

  const isLobby = g.status === 'lobby';
  const canJoin = isLobby && !g.me_joined && g.players.length < g.seats;
  const canLeave = isLobby && g.me_joined && !g.is_creator;
  const canStart = isLobby && g.is_creator && g.players.length === g.seats;
  const canCancel = g.is_creator && ['lobby','playing','reporting'].includes(g.status);
  const canReport = g.is_creator && ['playing','reporting'].includes(g.status);

  app.innerHTML = `
    <div class="card">
      <a href="#/mahjong" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🀄 ${escapeHtml(g.title || ('卓 #' + g.id))} ${statusLabel}</h2>
      <div class="meta">${escapeHtml(g.creator_name)} 起案 · buy-in ${g.buy_in}pt · pot ${g.pot_total}pt</div>
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">👥 卓 (${g.players.length} / ${g.seats})</div>
      <div class="list">
        ${g.players.map((p, i) => `
          <div class="list-item" style="gap:8px; align-items:center">
            <span style="font-size:14px; color:var(--muted); flex:none">${i + 1}.</span>
            <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</span>
            <div class="grow">
              <div class="bold">${escapeHtml(p.display_name)}${p.user_id === g.creator_user_id ? ' <span class="tag">起案</span>' : ''}</div>
              ${p.result_rank !== null ? `<div class="meta">結果: ${p.result_rank}位 · payout ${p.payout}pt (${p.payout - g.buy_in >= 0 ? '+' : ''}${p.payout - g.buy_in}pt)</div>` : ''}
            </div>
          </div>
        `).join('')}
        ${Array.from({ length: Math.max(0, g.seats - g.players.length) }).map(() => `
          <div class="list-item" style="gap:8px; align-items:center; color:var(--muted)">
            <span style="font-size:18px; flex:none">＿</span>
            <div class="grow">空席 (募集中)</div>
          </div>
        `).join('')}
      </div>

      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap; justify-content:flex-end">
        ${canJoin   ? `<button id="mj-join"   class="primary">参加する (${g.buy_in}pt)</button>` : ''}
        ${canLeave  ? `<button id="mj-leave"  class="btn">脱退 (返金)</button>` : ''}
        ${canStart  ? `<button id="mj-start"  class="primary">対局開始</button>` : ''}
        ${canReport ? `<button id="mj-report" class="primary">結果を報告</button>` : ''}
        ${canCancel ? `<button id="mj-cancel" class="btn danger">卓を取消 (全員返金)</button>` : ''}
      </div>
    </div>

    ${g.status === 'playing' ? `<div class="card">
      <div class="bold">対局中 🀄</div>
      <p class="hint">雀魂 / 紙麻雀 等で半荘終わったら 起案者が 「結果を報告」 を押して 1〜4位を入力してください。</p>
    </div>` : ''}

    ${g.status === 'finished' ? `<div class="card">
      <div class="bold">🏁 終了 · pot ${g.pot_total}pt 配分済</div>
      <div class="hint-sm">場代 ${Math.floor(g.pot_total * (g.rake_pct || 5) / 100)}pt (${g.rake_pct || 5}%) を控除</div>
    </div>` : ''}
  `;

  if (canJoin)   document.getElementById('mj-join').addEventListener('click', () => doAction(g.id, 'join'));
  if (canLeave)  document.getElementById('mj-leave').addEventListener('click', () => { if (confirm('脱退して返金しますか?')) doAction(g.id, 'leave'); });
  if (canStart)  document.getElementById('mj-start').addEventListener('click', () => { if (confirm('対局を開始しますか?')) doAction(g.id, 'start'); });
  if (canReport) document.getElementById('mj-report').addEventListener('click', () => showReportDialog(g));
  if (canCancel) document.getElementById('mj-cancel').addEventListener('click', () => { if (confirm('卓を取消して全員に返金しますか?')) doAction(g.id, 'cancel'); });
}

async function doAction(gid, action) {
  try {
    await post(`/api/mahjong/games/${gid}/${action}`, {});
    toast('完了');
    await renderMahjongDetail({ params: { id: gid } });
  } catch (e) { toast('失敗: ' + e.message); }
}

function showReportDialog(g) {
  // 簡易ダイアログ: 各 player に 1〜4 位の select
  const players = g.players;
  const root = document.getElementById('app');
  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'position:fixed; left:50%; top:50%; transform:translate(-50%, -50%); max-width:90vw; width:420px; z-index:9999; box-shadow:0 4px 30px rgba(0,0,0,0.4)';
  card.innerHTML = `
    <h3 style="margin:0 0 8px">🏁 結果報告</h3>
    <p class="hint-sm" style="font-size:12px">1〜4 位を各プレイヤーに割り当ててください (重複不可)。</p>
    <div id="mj-rep-rows" style="margin-top:8px"></div>
    <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
      <button id="mj-rep-cancel" class="btn">キャンセル</button>
      <button id="mj-rep-go" class="primary">確定</button>
    </div>
  `;
  document.body.appendChild(card);
  const rows = card.querySelector('#mj-rep-rows');
  rows.innerHTML = players.map((p, i) => `
    <div class="row" style="gap:6px; align-items:center; margin-bottom:6px">
      <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'xs')}</span>
      <div class="grow">${escapeHtml(p.display_name)}</div>
      <select data-pid="${p.user_id}" style="font-size:13px">
        <option value="">—</option>
        <option value="1">1 位</option>
        <option value="2">2 位</option>
        <option value="3">3 位</option>
        <option value="4">4 位</option>
      </select>
    </div>
  `).join('');
  card.querySelector('#mj-rep-cancel').addEventListener('click', () => card.remove());
  card.querySelector('#mj-rep-go').addEventListener('click', async () => {
    const ranks = {};
    const used = new Set();
    for (const sel of card.querySelectorAll('select[data-pid]')) {
      const pid = Number(sel.dataset.pid);
      const r = Number(sel.value);
      if (!r) { toast('全員の順位を選んでください'); return; }
      if (used.has(r)) { toast('順位が重複しています'); return; }
      used.add(r);
      ranks[pid] = r;
    }
    try {
      await post('/api/mahjong/games/' + g.id + '/report', { ranks });
      toast('結果報告完了 — payout 配分しました');
      card.remove();
      await renderMahjongDetail({ params: { id: g.id } });
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
