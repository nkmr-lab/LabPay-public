// v554 #209 麻雀 Phase 2 ゲーム本体 UI。 lazy import で 普段は読み込まない。
//   polling (2 秒) で /api/mahjong/games/:id/state を取得 → 再描画。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast } from '../app.js';

let pollTimer = null;
let lastVer = -1;
let curGid = null;
let curState = null;

// 牌コード → Unicode 麻雀牌
// v564 中 (🀄 U+1F004) は default が emoji presentation (カラー絵文字) なので
//   Variation Selector-15 (U+FE0E) を付けて text presentation (モノクロ) に強制
const VS15 = '\u{FE0E}';
function tileChar(t) {
  if (t == null) return '?';
  if (t < 9)   return String.fromCodePoint(0x1F007 + t);          // 萬子 1-9
  if (t < 18)  return String.fromCodePoint(0x1F019 + (t - 9));    // 筒子 1-9
  if (t < 27)  return String.fromCodePoint(0x1F010 + (t - 18));   // 索子 1-9
  if (t < 31)  return String.fromCodePoint(0x1F000 + (t - 27));   // 東南西北
  if (t === 31) return String.fromCodePoint(0x1F006);             // 白
  if (t === 32) return String.fromCodePoint(0x1F005);             // 發
  if (t === 33) return String.fromCodePoint(0x1F004) + VS15;      // 中 (VS15 でモノクロ)
  return '?';
}

function tileBtn(t, opts = {}) {
  const dis = opts.disabled ? ' disabled' : '';
  const click = opts.onclick ? ` data-tile="${t}"` : '';
  // v561 牌 Unicode 自体に枠が内蔵されているので button の border は不要
  const cur = opts.selectable ? 'pointer' : 'default';
  const style = `font-size:${opts.size || 36}px; padding:0; border:none; background:transparent; line-height:1; cursor:${cur}`;
  return `<button class="mj-tile"${click} style="${style}"${dis}>${tileChar(t)}</button>`;
}

function windName(t) { return ['東','南','西','北'][t - 27] ?? '?'; }

export async function renderMahjongPlay({ params }) {
  const gid = Number(params.id);
  curGid = gid;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/mahjong/${gid}" class="hint">← 卓詳細</a>
      <h2 style="margin:6px 0">🀄 対局中</h2>
      <div id="mj-meta" class="meta"></div>
    </div>
    <div class="card" id="mj-board">
      <div class="muted">読み込み中…</div>
    </div>
    <div class="card" id="mj-hand">
      <div class="muted">…</div>
    </div>
    <div class="card" id="mj-log"></div>
  `;
  await refresh();
  // polling 開始
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 2000);
  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/mahjong/' + gid)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  }, { once: true });
}

async function refresh() {
  try {
    const d = await get(`/api/mahjong/games/${curGid}/state`);
    if (d.state_ver === lastVer) return;
    lastVer = d.state_ver;
    curState = d;
    paint();
    if (d.status === 'finished') {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  } catch (e) { /* silently retry */ }
}

function paint() {
  const d = curState;
  const s = d.state;
  if (!s) {
    document.getElementById('mj-board').innerHTML = `<div class="muted">対局未開始</div>`;
    return;
  }
  const isMyTurn = (d.my_seat !== null) && (s.turn === d.my_seat);
  const inDiscardPhase = s.awaiting === 'discard';
  const inNakiPhase = s.awaiting === 'naki_window' || s.awaiting === 'ron_chance';
  const canRon = inNakiPhase && d.my_seat !== null && s.last_discarded && s.last_discarded.by !== d.my_seat;
  const canPass = inNakiPhase && d.my_seat !== null && s.last_discarded && s.last_discarded.by !== d.my_seat;
  const myNakiChances = (s.naki_chances || []).filter(c => c.seat === d.my_seat);

  // 場風と局番号: 東1-4 (round_index 0-3) / 南1-4 (round_index 4-7)
  const kyokuNo = (s.round_index % 4) + 1;
  document.getElementById('mj-meta').innerHTML = `
    場: <span class="bold">${windName(s.round_wind)}${kyokuNo}局 ${s.honba}本場</span> ·
    親: ${escapeHtml(d.players[s.oya]?.display_name || '?')} ·
    山残り ${s.wall_remaining} ·
    ドラ表示 ${(s.dora_indicators || []).map(t => tileChar(t)).join(' ')} ·
    リーチ棒 ${s.riichi_pot || 0}
  `;

  // 4 卓の表示 (自分は下、 上家/対面/下家を画面上/右/左)
  const seats = d.players;
  const me = d.my_seat;
  function seatBox(seatIdx) {
    const p = seats[seatIdx];
    const sp = s.players[seatIdx];
    const isTurn = seatIdx === s.turn;
    const isOya = seatIdx === s.oya;
    // 副露表示
    const meldsHtml = (sp.melds || []).map(m => {
      const tag = m.type === 'pon' ? 'ポン' : m.type === 'chi' ? 'チー' : m.type === 'minkan' ? '明カン' : m.type === 'ankan' ? '暗カン' : m.type === 'kakan' ? '加カン' : '';
      const tilesStr = m.tiles.map(t => m.type === 'ankan' ? '🀫' : tileChar(t)).join(' ');
      return `<span style="display:inline-block; padding:2px 6px; background:#fef3c7; border-radius:4px; margin-right:4px; font-size:14px"><span style="font-size:10px; color:#a16207">${tag}</span> ${tilesStr}</span>`;
    }).join('');
    return `
      <div style="padding:4px 8px; border:1px solid ${isTurn ? 'var(--primary, #4a106d)' : 'var(--line)'}; border-radius:6px; background:${isTurn ? '#f7eefa' : '#fff'}; margin-bottom:6px">
        <div class="row" style="gap:6px; align-items:center">
          <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</span>
          <div class="grow">
            <div class="bold" style="font-size:13px">${isOya ? '🏵 ' : ''}${escapeHtml(p.display_name)} ${sp.riichi ? '<span style="color:#dc2626; font-weight:700">リーチ!</span>' : ''}</div>
            <div class="meta" style="font-size:11px">${sp.score.toLocaleString()} 点 · 手 ${sp.hand_size} 枚 · 河 ${sp.discards.length} 枚</div>
          </div>
        </div>
        ${meldsHtml ? `<div style="margin-top:4px">${meldsHtml}</div>` : ''}
        <div style="margin-top:4px; word-break:break-all; line-height:1.4; font-size:18px">
          ${sp.discards.map(t => tileChar(t)).join(' ')}
        </div>
      </div>`;
  }

  const board = document.getElementById('mj-board');
  let othersHtml = '';
  for (let off = 1; off < 4; off++) {
    const idx = (me + off) % 4;
    othersHtml += seatBox(idx);
  }
  board.innerHTML = othersHtml || '<div class="muted">…</div>';

  // 自分の手牌
  const handBox = document.getElementById('mj-hand');
  if (me === null) {
    handBox.innerHTML = '<div class="muted">観戦中 (この卓の参加者ではありません)</div>';
  } else {
    const myP = s.players[me];
    const myHand = myP.hand || [];
    const sortedTiles = [...myHand].sort((a, b) => a - b);
    // 自摸牌 (もし 14 枚あれば 最後 = 自摸)
    const tsumoTile = (sortedTiles.length === 14 && isMyTurn && inDiscardPhase) ? sortedTiles[sortedTiles.length - 1] : null;
    // 自分の副露
    const myMeldsHtml = (myP.melds || []).map(m => {
      const tag = m.type === 'pon' ? 'ポン' : m.type === 'chi' ? 'チー' : m.type === 'minkan' ? '明カン' : m.type === 'ankan' ? '暗カン' : m.type === 'kakan' ? '加カン' : '';
      const tilesStr = m.tiles.map(t => tileChar(t)).join(' ');
      return `<span style="display:inline-block; padding:2px 6px; background:#fef3c7; border-radius:4px; margin-right:4px; font-size:14px"><span style="font-size:10px; color:#a16207">${tag}</span> ${tilesStr}</span>`;
    }).join('');
    // 鳴き可能候補ボタン
    const nakiBtns = myNakiChances.map((c, i) => {
      if (c.type === 'pon') return `<button data-naki="pon" data-tile="${c.tile}" class="primary" style="font-size:12px">ポン ${tileChar(c.tile)}</button>`;
      if (c.type === 'minkan') return `<button data-naki="minkan" data-tile="${c.tile}" class="primary" style="font-size:12px">明カン ${tileChar(c.tile)}</button>`;
      if (c.type === 'chi') return `<button data-naki="chi" data-tile="${c.tile}" data-with="${c.with.join(',')}" class="primary" style="font-size:12px">チー ${tileChar(c.with[0])}${tileChar(c.with[1])}${tileChar(c.tile)}</button>`;
      return '';
    }).join('');
    // 自分の手で 4 枚揃ってる暗カン候補
    const handCounts = {};
    for (const t of sortedTiles) handCounts[t] = (handCounts[t] || 0) + 1;
    const ankanBtns = isMyTurn && inDiscardPhase ?
      Object.entries(handCounts).filter(([t, c]) => c === 4).map(([t]) => `<button data-ankan="${t}" class="btn" style="font-size:12px">暗カン ${tileChar(Number(t))}</button>`).join('') : '';
    // 加カン候補 (既存ポンと同種の牌が手にある)
    const kakanBtns = isMyTurn && inDiscardPhase ?
      (myP.melds || []).filter(m => m.type === 'pon').map(m => sortedTiles.includes(m.tile) ? `<button data-kakan="${m.tile}" class="btn" style="font-size:12px">加カン ${tileChar(m.tile)}</button>` : '').join('') : '';
    handBox.innerHTML = `
      <div class="bold" style="margin-bottom:4px">${seats[me].display_name} ${myP.riichi ? '(リーチ)' : ''} — 点数 ${myP.score.toLocaleString()}</div>
      ${myMeldsHtml ? `<div style="margin-bottom:6px">${myMeldsHtml}</div>` : ''}
      <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px">
        ${sortedTiles.map((t, i) => tileBtn(t, { selectable: isMyTurn && inDiscardPhase, onclick: true, size: 28 })).join('')}
      </div>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:8px">
        ${isMyTurn && inDiscardPhase ? `<button id="mj-tsumo" class="primary" style="font-size:12px">ツモ宣言</button>` : ''}
        ${isMyTurn && inDiscardPhase && !myP.riichi ? `<button id="mj-riichi" class="btn" style="font-size:12px">リーチ宣言</button>` : ''}
        ${canRon ? `<button id="mj-ron" class="primary" style="font-size:12px">ロン!</button>` : ''}
        ${nakiBtns}
        ${ankanBtns}
        ${kakanBtns}
        ${canPass ? `<button id="mj-pass" class="btn" style="font-size:12px">${
          canRon && myNakiChances.length > 0 ? '鳴かない / ロンしない' :
          canRon ? 'ロンしない' :
          myNakiChances.length > 0 ? '鳴かない' :
          '見送る'
        }</button>` : ''}
      </div>
      <div class="hint-sm" style="font-size:12px; margin-top:6px">
        ${isMyTurn && inDiscardPhase ? '✏️ 牌をタップで打牌' :
          inNakiPhase ? `⚠️ ${seats[s.last_discarded.by]?.display_name} の打牌 ${tileChar(s.last_discarded.tile)} — 鳴き / ロン / パスを選択` :
          '⌛ ' + (seats[s.turn]?.display_name || '?') + ' の手番'}
      </div>
    `;
    // タイル click ハンドラ (打牌)
    handBox.querySelectorAll('button[data-tile]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!isMyTurn || !inDiscardPhase) return;
        const t = Number(b.dataset.tile);
        try {
          await post(`/api/mahjong/games/${curGid}/action`, { type: 'discard', tile: t });
          await refresh();
        } catch (e) {
          if (/番ではありません|今は.*できません/.test(e.message)) { await refresh(); return; }
          toast('失敗: ' + e.message);
        }
      });
    });
    document.getElementById('mj-tsumo')?.addEventListener('click', () => doAction('tsumo'));
    document.getElementById('mj-riichi')?.addEventListener('click', () => doAction('riichi'));
    document.getElementById('mj-ron')?.addEventListener('click', () => doAction('ron'));
    document.getElementById('mj-pass')?.addEventListener('click', () => doAction('pass'));
    // 鳴きボタン
    handBox.querySelectorAll('button[data-naki]').forEach(b => {
      b.addEventListener('click', async () => {
        const type = b.dataset.naki;
        const tile = Number(b.dataset.tile);
        const body = { type, tile };
        if (type === 'chi') body.with = b.dataset.with.split(',').map(Number);
        try {
          await post(`/api/mahjong/games/${curGid}/action`, body);
          await refresh();
        } catch (e) {
          if (/番ではありません|今は.*できません/.test(e.message)) { await refresh(); return; }
          toast('失敗: ' + e.message);
        }
      });
    });
    handBox.querySelectorAll('button[data-ankan]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await post(`/api/mahjong/games/${curGid}/action`, { type: 'ankan', tile: Number(b.dataset.ankan) });
          await refresh();
        } catch (e) {
          if (/番ではありません|今は.*できません/.test(e.message)) { await refresh(); return; }
          toast('失敗: ' + e.message);
        }
      });
    });
    handBox.querySelectorAll('button[data-kakan]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await post(`/api/mahjong/games/${curGid}/action`, { type: 'kakan', tile: Number(b.dataset.kakan) });
          await refresh();
        } catch (e) {
          if (/番ではありません|今は.*できません/.test(e.message)) { await refresh(); return; }
          toast('失敗: ' + e.message);
        }
      });
    });
  }

  // ログ
  const logBox = document.getElementById('mj-log');
  logBox.innerHTML = `<div class="bold" style="margin-bottom:4px">📜 ログ</div>` + (s.log || []).slice(-15).reverse().map(e => {
    if (e.type === 'discard') return `<div class="meta">${escapeHtml(seats[e.by]?.display_name || '?')} 打 ${tileChar(e.tile)}</div>`;
    if (e.type === 'riichi')  return `<div class="meta" style="color:#dc2626">${escapeHtml(seats[e.by]?.display_name || '?')} リーチ!</div>`;
    if (e.type === 'tsumo')   return `<div class="meta" style="color:#15803d">${escapeHtml(seats[e.by]?.display_name || '?')} ツモ! 役: ${(e.yaku.list || []).join(', ')} ${e.yaku.han}翻 / ${e.score.total}点</div>`;
    if (e.type === 'ron')     return `<div class="meta" style="color:#15803d">${escapeHtml(seats[e.by]?.display_name || '?')} ロン! 役: ${(e.yaku.list || []).join(', ')} ${e.yaku.han}翻 / ${e.score.total}点</div>`;
    if (e.type === 'ryukyoku') return `<div class="meta" style="color:#6b7280">流局</div>`;
    return '';
  }).join('');
}

async function doAction(type) {
  try {
    const r = await post(`/api/mahjong/games/${curGid}/action`, { type });
    if (r.yaku) toast(`和了! 役: ${(r.yaku.list || []).join(', ')} ${r.yaku.han}翻 / ${r.score.total}点`);
    await refresh();
  } catch (e) {
    // v564 polling と AI 自動進行のレースで 「あなたの番ではありません」 が出るが、
    //   ユーザーには表示せず 黙って state を再取得する (UI が古かっただけ)
    if (/番ではありません|今は.*できません/.test(e.message)) {
      await refresh();
      return;
    }
    toast('失敗: ' + e.message);
  }
}
