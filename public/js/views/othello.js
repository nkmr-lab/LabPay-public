// v587 地雷オセロ ビュー。
//   /#/othello           一覧 + 新規
//   /#/othello/:id       対戦盤面

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { shareToSns } from '../share_to_sns.js';

const POLL_MS = 2500;
let pollTimer = null;

function statusBadge(s) {
  switch (s) {
    case 'waiting':    return '<span class="tag warn">対戦相手 募集中</span>';
    case 'mine_setup': return '<span class="tag" style="background:#fef3c7; color:#946d00">地雷 設定中</span>';
    case 'playing':    return '<span class="tag" style="background:#dbeafe; color:#1d4ed8">対戦中</span>';
    case 'finished':   return '<span class="tag muted">終了</span>';
    case 'cancelled':  return '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>';
    default: return '';
  }
}

export async function renderOthello() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">💣 地雷オセロ</h2>
        <span style="flex:1"></span>
        <button id="ot-ai" class="btn" style="font-size:13px">🤖 AI 対戦 (2pt)</button>
        <button id="ot-new" class="btn primary">＋ 新規卓 (2pt)</button>
      </div>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        通常のオセロ + <b>各プレイヤー1か所地雷</b>。そのマスに自分 or 相手が置くと
        <b>周囲 3x3 (9 マス) が反転</b>。地雷の場所は終局まで互いに不明。
      </p>
    </div>
    <div id="ot-list"><div class="hint">読み込み中…</div></div>
  `;
  document.getElementById('ot-new').addEventListener('click', async () => {
    try {
      const r = await post('/api/othello/games', {});
      navigate('#/othello/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('ot-ai').addEventListener('click', async () => {
    if (!confirm('🤖 AI と 1 局 始めますか? (プレイフィー 2pt、 払戻なし)')) return;
    try {
      const r = await post('/api/othello/ai/new', {});
      navigate('#/othello/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  try {
    const d = await get('/api/othello/games');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('ot-list').innerHTML = '<div class="hint">対戦卓 がありません。 「＋ 新規卓」 で 始めましょう。</div>';
      return;
    }
    document.getElementById('ot-list').innerHTML = items.map(g => `
      <a class="list-item" href="#/othello/${g.id}" style="gap:8px; align-items:center">
        <div class="grow">
          <div class="bold">
            ${escapeHtml(g.creator_name)} (黒) vs ${g.opponent_name ? escapeHtml(g.opponent_name) + ' (白)' : '<span class="muted">対戦相手 募集中</span>'}
            ${statusBadge(g.status)}
            ${g.me_in ? '<span class="tag ok">参加中</span>' : ''}
          </div>
          <div class="meta">${g.winner ? `勝者: ${g.winner === 'draw' ? '引分' : (g.winner === 'creator' ? '黒' : '白')}` : ''}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('ot-list').innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderOthelloDetail({ params }) {
  const gid = Number(params.id);
  if (pollTimer) clearInterval(pollTimer);
  await paintBoard(gid);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-othello-gid="${gid}"]`)) {
      clearInterval(pollTimer); pollTimer = null; return;
    }
    paintBoard(gid).catch(() => {});
  }, POLL_MS);
}

async function paintBoard(gid) {
  let d;
  try { d = await get(`/api/othello/games/${gid}`); }
  catch (e) {
    document.getElementById('app').innerHTML = `<div class="card"><a class="hint" href="#/othello">← 一覧</a><div class="hint">${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const app = document.getElementById('app');
  const myColor = d.me_side === 'creator' ? '⚫' : (d.me_side === 'opponent' ? '⚪' : '');
  const myTurn = d.status === 'playing' && d.me_side && d.turn_side === d.me_side;
  const triggeredMap = {};
  for (const t of (d.triggered_mines || [])) triggeredMap[t.cell] = t.owner;

  let actionArea = '';
  if (d.status === 'waiting') {
    if (d.me_side === 'creator') {
      actionArea = `
        <div class="card">
          <div class="hint">対戦相手 を 待っています。 1 人 参加すると 地雷設定 へ。</div>
          <button id="ot-cancel" class="btn" style="margin-top:8px">キャンセル (2pt 返金)</button>
        </div>`;
    } else {
      actionArea = `
        <div class="card">
          <div class="hint">対戦相手として 参加 しますか? (2pt)</div>
          <button id="ot-join" class="btn primary" style="margin-top:8px">参加する (2pt)</button>
        </div>`;
    }
  } else if (d.status === 'mine_setup') {
    if (d.me_side && !d.i_setup_mines) {
      actionArea = `
        <div class="card">
          <h3 style="margin:0 0 4px">💣 地雷を 1 か所 配置</h3>
          <p class="hint" style="margin:0 0 8px; font-size:12px">
            盤面のマスを 1 つタップ (初期 4 マスは不可)。「確定」 で設定。
            ${d.is_ai
              ? '<b>🤖 AI は すでに 地雷を 1 か所 配置済み</b> (場所は 秘密)。 あなたが 配置すれば 開戦。'
              : '相手も同じく 1 か所設定したら対戦開始。'} 地雷は 終局まで 互いに 不可視。
          </p>
          <div id="ot-mine-pick" class="hint-sm">選択中: <span id="ot-mine-sel">0</span> / 1</div>
          <button id="ot-mine-set" class="btn primary" style="margin-top:8px" disabled>確定</button>
        </div>`;
    } else if (d.me_side && d.i_setup_mines) {
      actionArea = `<div class="card"><div class="hint">設定完了。 相手の設定を 待っています…</div></div>`;
    }
  } else if (d.status === 'playing') {
    if (myTurn) {
      const canPass = (d.legal_moves || []).length === 0;
      actionArea = `<div class="card">
        <div class="bold">あなたの番 (${myColor})</div>
        <div class="hint-sm">置けるマスは 緑で表示。 タップで 着手。</div>
        ${canPass ? `<button id="ot-pass" class="btn" style="margin-top:8px">置けない → パス</button>` : ''}
      </div>`;
    } else {
      actionArea = `<div class="card"><div class="hint">相手の番 を 待っています…</div></div>`;
    }
  } else if (d.status === 'finished') {
    let result;
    if (d.winner === 'draw') result = '🤝 引分';
    else if (d.winner === 'creator') result = d.me_side === 'creator' ? '🎉 あなたの勝ち!' : '😢 あなたの負け';
    else result = d.me_side === 'opponent' ? '🎉 あなたの勝ち!' : '😢 あなたの負け';
    actionArea = `
      <div class="card">
        <h3 style="margin:0 0 6px">${result}</h3>
        <div>⚫ 黒 ${d.count_black} : ⚪ 白 ${d.count_white}</div>
      </div>`;
  }

  app.innerHTML = `
    <div class="card" data-othello-gid="${gid}">
      <div style="display:flex; align-items:center; gap:10px">
        <a href="#/othello" class="hint">← 一覧</a>
        <span style="flex:1"></span>
        ${d.status === 'waiting' ? `<button id="ot-share" class="btn" style="font-size:12px; padding:4px 8px">💬 共有</button>` : ''}
        ${statusBadge(d.status)}
      </div>
      <div class="row" style="gap:8px; margin-top:6px">
        <div style="flex:1">
          <div class="bold">⚫ ${escapeHtml(d.creator_name)} ${d.turn_side === 'creator' && d.status === 'playing' ? '<span style="color:#f59e0b">← 番</span>' : ''}</div>
          <div class="hint-sm">${d.count_black} 石</div>
        </div>
        <div style="flex:1">
          <div class="bold">⚪ ${escapeHtml(d.opponent_name || '— 募集中 —')} ${d.turn_side === 'opponent' && d.status === 'playing' ? '<span style="color:#f59e0b">← 番</span>' : ''}</div>
          <div class="hint-sm">${d.count_white} 石</div>
        </div>
      </div>
    </div>
    <div class="card" style="padding:8px">
      <div id="ot-board" style="display:grid; grid-template-columns:repeat(8, 1fr); gap:2px; max-width:480px; margin:0 auto; aspect-ratio:1/1; background:#2d6a4f; padding:4px; border-radius:8px">
        ${Array.from({length: 64}, (_, i) => {
          const r = Math.floor(i / 8);
          const c = i % 8;
          const cellKey = `${r}${c}`;
          const cell = d.board[i];
          const isLegal = (d.legal_moves || []).includes(cellKey);
          const myMine = (d.my_mines || []).includes(cellKey);
          const triggered = triggeredMap[cellKey];
          let inner = '';
          if (cell === 1) inner = '<div style="width:88%; height:88%; border-radius:50%; background:linear-gradient(145deg, #1a1a1a, #000); box-shadow:inset -3px -3px 8px rgba(255,255,255,0.1)"></div>';
          else if (cell === 2) inner = '<div style="width:88%; height:88%; border-radius:50%; background:linear-gradient(145deg, #fff, #d0d0d0); box-shadow:inset -3px -3px 8px rgba(0,0,0,0.1)"></div>';
          else if (isLegal) inner = '<div style="width:25%; height:25%; border-radius:50%; background:rgba(255,255,255,0.4)"></div>';
          let bg = '#3d8b6b';
          if (myMine) bg = '#a16207'; // 自分の地雷 は 茶色 (自分にだけ 見える)
          if (triggered) bg = '#dc2626'; // 起爆済は 赤
          return `<button data-cell="${cellKey}" data-r="${r}" data-c="${c}"
                    style="aspect-ratio:1/1; background:${bg}; border:1px solid #1b4332; padding:0; display:flex; align-items:center; justify-content:center; cursor:${isLegal || d.status === 'mine_setup' ? 'pointer' : 'default'}; min-width:0; min-height:0">
                    ${inner}
                  </button>`;
        }).join('')}
      </div>
    </div>
    ${actionArea}
  `;

  // ピン留めワイヤリング
  document.getElementById('ot-share')?.addEventListener('click', () => {
    shareToSns(`💣 地雷オセロ ${escapeHtml(d.creator_name)} 対戦相手 募集中 (プレイフィー 2pt)`, `#/othello/${gid}`);
  });
  document.getElementById('ot-join')?.addEventListener('click', async () => {
    try { await post(`/api/othello/games/${gid}/join`, {}); paintBoard(gid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('ot-cancel')?.addEventListener('click', async () => {
    if (!confirm('キャンセルしますか? (2pt 返金)')) return;
    try { await post(`/api/othello/games/${gid}/cancel`, {}); navigate('#/othello'); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('ot-pass')?.addEventListener('click', async () => {
    try { await post(`/api/othello/games/${gid}/pass`, {}); paintBoard(gid); }
    catch (e) { toast('失敗: ' + e.message); }
  });

  // 通常着手 / 地雷設置
  const board = document.getElementById('ot-board');
  if (d.status === 'mine_setup' && d.me_side && !d.i_setup_mines) {
    const picked = [];
    board.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-cell]');
      if (!b) return;
      const cellKey = b.dataset.cell;
      // 初期 4 マス禁止
      if (['33','34','43','44'].includes(cellKey)) { toast('初期 4 マス には 設置 できません'); return; }
      const i = picked.indexOf(cellKey);
      if (i >= 0) { picked.splice(i, 1); b.style.background = '#3d8b6b'; }
      else if (picked.length < 1) { picked.push(cellKey); b.style.background = '#a16207'; }
      else { toast('地雷は 1 か所のみ'); return; }
      const sel = document.getElementById('ot-mine-sel');
      if (sel) sel.textContent = picked.length;
      const btn = document.getElementById('ot-mine-set');
      if (btn) btn.disabled = picked.length !== 1;
    });
    document.getElementById('ot-mine-set')?.addEventListener('click', async () => {
      try {
        await post(`/api/othello/games/${gid}/mines`, { cells: picked });
        paintBoard(gid);
      } catch (e) { toast('失敗: ' + e.message); }
    });
  } else if (d.status === 'playing' && myTurn) {
    board.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-cell]');
      if (!b) return;
      if (!d.legal_moves.includes(b.dataset.cell)) return;
      try {
        await post(`/api/othello/games/${gid}/move`, { row: Number(b.dataset.r), col: Number(b.dataset.c) });
        paintBoard(gid);
      } catch (e) { toast('失敗: ' + e.message); }
    });
  }
}
