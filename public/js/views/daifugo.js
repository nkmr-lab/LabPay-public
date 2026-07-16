// v590 大富豪 (MVP)。単出し / ペア / N 枚出しのみ、革命なし、シンプルルール。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { shareToSns } from '../share_to_sns.js';

const POLL_MS = 2500;
let pollTimer = null;

const SUITS = ['♣', '♦', '♥', '♠'];
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

// v1116 中村さん指摘「複数枚選択したら、数秒後に選択が消えてしまう」
//   → 2.5 秒ポーリングで innerHTML 再描画するたびにローカル Set がリセットされていた。
//   ゲーム id ごとに module スコープで選択を保持し、再描画後に復元する。
const SELECTED_BY_GID = new Map();  // gid → Set<card_index>
function getSelected(gid) {
  if (!SELECTED_BY_GID.has(gid)) SELECTED_BY_GID.set(gid, new Set());
  return SELECTED_BY_GID.get(gid);
}
function clearSelected(gid) { SELECTED_BY_GID.set(gid, new Set()); }

function cardLabel(c) {
  if (c === 52) return '🃏';
  const r = c % 13;
  const s = Math.floor(c / 13);
  return SUITS[s] + RANKS[r];
}
function cardRank(c) { return c === 52 ? 14 : c % 13; }

export async function renderDaifugo() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">🃏 大富豪</h2>
        <span style="flex:1"></span>
        <button id="df-new" class="btn primary">＋新規卓 (2pt)</button>
      </div>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        2-4 人。単出し / ペア / N枚出し。<b>プレイフィー 2pt</b>。
        ジョーカーはワイルド (単体は最強)。<b>革命 (4枚同時出しで強弱反転)</b>・
        <b>8切り (「8」出しで場流し + 同プレイヤー再開)</b> 採用。
      </p>
    </div>
    <div id="df-list"><div class="hint">読み込み中…</div></div>
  `;
  document.getElementById('df-new').addEventListener('click', async () => {
    const { showInviteModal } = await import('./invite_modal.js');
    const res = await showInviteModal({
      title: '🃏 大富豪新規卓',
      description: 'プレイフィー 2pt。「対象者で即開始」なら全員から即徴収 + 通知 + 即配牌。',
      minPick: 1, maxPick: 3,        // 自分 + 1〜3 人 = 2〜4 人
      allowPublic: true,
    });
    if (!res) return;
    try {
      const body = res.kind === 'invite' ? { member_ids: res.memberIds } : {};
      const r = await post('/api/daifugo/games', body);
      navigate('#/daifugo/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  try {
    const d = await get('/api/daifugo/games');
    const items = d.items || [];
    if (!items.length) { document.getElementById('df-list').innerHTML = '<div class="hint">対戦卓がありません。「＋新規卓」で始めましょう。</div>'; return; }
    document.getElementById('df-list').innerHTML = items.map(g => `
      <a class="list-item" href="#/daifugo/${g.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(g.creator_name)} の卓・ ${g.player_count} 人参加 ${g.me_in && g.status !== 'finished' && g.status !== 'cancelled' ? '<span class="tag ok">参加中</span>' : ''}</div>
          <div class="meta">${g.status} / pot ${g.pot_total}pt</div>
        </div>
      </a>
    `).join('');
  } catch (e) { document.getElementById('df-list').innerHTML = '<div class="hint">読み込み失敗</div>'; }
}

export async function renderDaifugoDetail({ params }) {
  if (pollTimer) clearInterval(pollTimer);
  const gid = Number(params.id);
  await paintDaifugo(gid);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-df-gid="${gid}"]`)) { clearInterval(pollTimer); pollTimer = null; return; }
    paintDaifugo(gid).catch(() => {});
  }, POLL_MS);
}

async function paintDaifugo(gid) {
  let d;
  try { d = await get(`/api/daifugo/games/${gid}`); }
  catch (e) { document.getElementById('app').innerHTML = `<div class="card"><a href="#/daifugo" class="hint">← 一覧</a><div class="hint">${escapeHtml(e.message)}</div></div>`; return; }
  const app = document.getElementById('app');

  if (d.status === 'lobby') {
    const isCreator = (state.me?.id === d.creator_user_id);
    const meIn = d.players.some(p => p.user_id === state.me?.id);
    app.innerHTML = `
      <div class="card" data-df-gid="${gid}">
        <a href="#/daifugo" class="hint">← 一覧</a>
        <h2 style="margin:6px 0">🃏 大富豪 #${gid} (ロビー)</h2>
        <p class="hint">参加者: ${d.players.length} / 4 (2 人以上で開始可)</p>
        ${d.players.map(p => `<div class="list-item"><div class="grow"><div class="bold">座 ${p.seat + 1}: ${escapeHtml(p.display_name)}</div></div></div>`).join('')}
        <div style="display:flex; gap:6px; margin-top:8px">
          ${meIn ? '' : `<button id="df-join" class="btn primary">参加 (2pt)</button>`}
          ${isCreator && d.players.length >= 2 ? `<button id="df-start" class="btn primary">開始</button>` : ''}
          ${isCreator ? `<button id="df-cancel" class="btn" style="color:#c00">キャンセル</button>` : ''}
          <button id="df-share" class="btn" style="font-size:12px">💬 共有</button>
        </div>
      </div>
    `;
    document.getElementById('df-share')?.addEventListener('click', () => {
      shareToSns(`🃏 大富豪卓 #${gid} 募集中 (${d.players.length}/4、プレイフィー 2pt)`, `#/daifugo/${gid}`);
    });
    document.getElementById('df-join')?.addEventListener('click', async () => {
      try { await post(`/api/daifugo/games/${gid}/join`, {}); paintDaifugo(gid); } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('df-start')?.addEventListener('click', async () => {
      try { await post(`/api/daifugo/games/${gid}/start`, {}); paintDaifugo(gid); } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('df-cancel')?.addEventListener('click', async () => {
      if (!confirm('キャンセルしますか? (全員返金)')) return;
      try { await post(`/api/daifugo/games/${gid}/cancel`, {}); navigate('#/daifugo'); } catch (e) { toast('失敗: ' + e.message); }
    });
    return;
  }

  if (d.status === 'cancelled') {
    app.innerHTML = `<div class="card" data-df-gid="${gid}"><a href="#/daifugo" class="hint">← 一覧</a><h2>キャンセル済</h2></div>`;
    return;
  }

  const myHand = (d.players.find(p => p.seat === d.my_seat) || {}).my_hand || [];
  const myRank = (d.players.find(p => p.seat === d.my_seat) || {}).rank;

  app.innerHTML = `
    <div class="card" data-df-gid="${gid}">
      <a href="#/daifugo" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🃏 大富豪 #${gid}</h2>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        ${d.players.map(p => `
          <div style="flex:1; min-width:120px; padding:8px; background:${p.seat === d.turn ? '#fef3c7' : '#fafafa'}; border:1px solid ${p.seat === d.turn ? '#f59e0b' : '#ddd'}; border-radius:8px">
            <div class="bold" style="font-size:13px">${escapeHtml(p.display_name)} ${p.seat === d.turn ? '← 番' : ''}</div>
            <div class="hint-sm">手札 ${p.hand_count} 枚 ${p.passed ? '・パス' : ''} ${p.rank ? `・<b>${p.rank} 位</b>` : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <div style="display:flex; align-items:center; gap:8px">
        <h3 style="margin:0; flex:1">場</h3>
        ${d.revolution ? '<span style="background:linear-gradient(90deg, #dc2626, #f59e0b); color:#fff; padding:2px 10px; border-radius:10px; font-size:12px; font-weight:700">🔄 革命中 (強弱反転)</span>' : ''}
      </div>
      ${d.last_play ? `
        <div style="display:flex; gap:6px; flex-wrap:wrap; padding:8px; background:#dbeafe; border-radius:6px">
          ${d.last_play.cards.map(c => `<div style="padding:8px 12px; background:#fff; border-radius:6px; font-size:20px; min-width:48px; text-align:center">${cardLabel(c)}</div>`).join('')}
        </div>
        <div class="hint-sm" style="margin-top:4px">座 ${d.last_play.by + 1} が ${d.last_play.count} 枚出した</div>
      ` : '<div class="hint">場は空です (好きな枚数で出せる)</div>'}
    </div>

    ${d.status === 'finished' ? `
      <div class="card" style="background:linear-gradient(135deg, #fbbf24, #ef4444); color:#fff; text-align:center">
        <h3 style="margin:0">🎉 ゲーム終了</h3>
        <div style="margin-top:6px; text-align:left; max-width:280px; margin-left:auto; margin-right:auto">
          ${(d.finished_ranks || []).map((seat, idx) => {
            const p = d.players.find(pp => pp.seat === seat);
            const name = p ? p.display_name : `座 ${seat + 1}`;
            const emoji = ['🥇','🥈','🥉','🎖'][idx] || '·';
            return `<div style="padding:2px 8px">${emoji} ${idx + 1} 位: <b>${escapeHtml(name)}</b></div>`;
          }).join('')}
        </div>
      </div>` : ''}

    ${d.status === 'playing' && d.my_seat !== null && myRank === null ? `
    <div class="card">
      <h3 style="margin:0 0 6px">あなたの手札 (タップで選択)</h3>
      <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-bottom:4px">
        ${d.last_play
          ? (d.revolution
              ? `場: ${cardLabel(d.last_play.cards[0])}${d.last_play.cards.length>1?` × ${d.last_play.cards.length}`:''} · <b>革命中</b> → 同枚数で <b>より弱い</b> 数字を出す (青枠 = 出せる候補)`
              : `場: ${cardLabel(d.last_play.cards[0])}${d.last_play.cards.length>1?` × ${d.last_play.cards.length}`:''} → 同枚数で <b>より強い</b> 数字を出す (青枠 = 出せる候補)`)
          : '場は空。好きな枚数で始められる (青枠 = すべて候補)'}
      </div>
      <div id="df-hand" style="display:flex; gap:4px; flex-wrap:wrap; padding:6px">
        ${myHand.map(c => {
          const isJoker = c === 52;
          const legal = isPlayableHint(c, d);
          const bg = legal ? '#eff6ff' : '#f3f4f6';
          const border = legal ? '#3b82f6' : '#d1d5db';
          const opacity = legal ? '1' : '0.55';
          return `<button class="df-card" data-c="${c}" data-legal="${legal ? 1 : 0}" style="padding:8px 10px; border:2px solid ${border}; background:${bg}; border-radius:6px; font-size:18px; min-width:48px; cursor:pointer; opacity:${opacity}; font-weight:${legal?700:400}">${cardLabel(c)}</button>`;
        }).join('')}
      </div>
      ${d.my_turn ? `
        <div style="display:flex; gap:6px; margin-top:10px">
          <button id="df-play" class="btn primary">選んだカードを出す</button>
          ${d.last_play ? `<button id="df-pass" class="btn">パス</button>` : ''}
        </div>
        <div class="hint-sm" style="margin-top:4px">場と同じ枚数 + ${d.revolution ? 'より弱い' : 'より強い'} rank で出す。同じ数字を揃えて複数枚出せる。</div>
      ` : '<div class="hint" style="margin-top:8px">相手の番を待っています…</div>'}
      <button id="df-resign" class="btn" style="margin-top:8px; font-size:11px; color:#c00">🏳 投了 (ポイント戻りません)</button>
    </div>` : ''}

    ${d.log && d.log.length ? `
    <div class="card">
      <h3 style="margin:0 0 6px">ログ</h3>
      ${d.log.map(l => `<div class="hint-sm" style="font-size:12px">${escapeHtml(l)}</div>`).join('')}
    </div>` : ''}
  `;

  if (d.status === 'playing' && d.my_seat !== null && myRank === null) {
    // v1116 選択は module スコープで永続化 (再描画で失われない)
    const selected = getSelected(gid);
    // 現在の手札に無いカードは選択集合から除去 (前ターンの残骸を掃除)
    const inHand = new Set(myHand);
    for (const c of [...selected]) if (!inHand.has(c)) selected.delete(c);
    // 復元: 既に選択されているカードを強調
    document.querySelectorAll('.df-card').forEach(b => {
      const c = Number(b.dataset.c);
      if (selected.has(c)) { b.style.background = '#dbeafe'; b.style.borderColor = '#3b82f6'; b.style.outline = '2px solid #4a106d'; b.style.transform = 'translateY(-3px)'; }
    });
    document.querySelectorAll('.df-card').forEach(b => {
      b.addEventListener('click', () => {
        const c = Number(b.dataset.c);
        const legal = b.dataset.legal === '1';
        if (selected.has(c)) {
          selected.delete(c);
          b.style.background = legal ? '#eff6ff' : '#f3f4f6';
          b.style.borderColor = legal ? '#3b82f6' : '#d1d5db';
          b.style.outline = 'none';
          b.style.transform = 'none';
        } else {
          selected.add(c);
          b.style.background = '#dbeafe'; b.style.borderColor = '#3b82f6';
          b.style.outline = '2px solid #4a106d'; b.style.transform = 'translateY(-3px)';
        }
      });
    });
    document.getElementById('df-play')?.addEventListener('click', async () => {
      if (!selected.size) { toast('カードを選んでください'); return; }
      try { await post(`/api/daifugo/games/${gid}/play`, { cards: [...selected] }); clearSelected(gid); paintDaifugo(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('df-pass')?.addEventListener('click', async () => {
      try { await post(`/api/daifugo/games/${gid}/pass`, {}); clearSelected(gid); paintDaifugo(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('df-resign')?.addEventListener('click', async () => {
      if (!confirm('🏳 投了しますか? (= ゲーム終了、ポイント戻りません)')) return;
      try { await post(`/api/daifugo/games/${gid}/resign`, {}); clearSelected(gid); paintDaifugo(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
}

// v1116 出せるカードのヒント: 場が空 or 自分の番でない時は全部 legal 扱い、
//   場があれば同枚数の候補 (rank が strict に上/下、革命なら下) を持ちうるカードだけ「候補」に。
//   厳密判定はサーバ側、これはあくまで見え方のヒント。
function isPlayableHint(c, d) {
  if (!d.my_turn) return true;                // 自分の番でなければ全部 dim にしない
  if (c === 52) return true;                  // ジョーカーは常に候補
  if (!d.last_play) return true;              // 場空なら何でも
  const lastRank = d.last_play.rank;
  const rank = cardRank(c);
  const rev = !!d.revolution;
  // 同枚数の N-of-a-kind を組めるか、はカード集合次第なので、rank だけで判定
  //   (「同ランクのカードを選んで枚数を合わせられる」かは選択時に自然に絞られる)
  return rev ? (rank < lastRank) : (rank > lastRank);
}
