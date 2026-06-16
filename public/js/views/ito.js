// /#/ito — ito ゲーム Phase 1。 v568 #223。
//   2 人以上で プレイフィー 1pt、 各自に 1-100 の数字、 お題に沿って 表現を入力、
//   起案者が公開ボタンで 全員の数字 + 表現を 開示、 pot は全員に等分配。
//   実プレイは 「数字を直接言わずに 表現で 大小を推測してもらう」 協力ゲーム。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

const PRESET_THEMES = [
  '強い動物の強さ', '怖い妖怪の怖さ', '値段が高そうな食べ物', '飲み会で頼みたい料理人気度',
  '長生きする生き物', '高い山の高さ', '日本で人気のスポーツ', '行きたい旅行先', '集中して読みたい本',
  '集合住宅の音がうるさい度', '満員電車のキツさ', '修学旅行の思い出度', '美味しいラーメン', '研究室の人気アイテム',
];

export async function renderIto() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🎲 ito</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/ito/new">＋ 新規卓</a>
      </div>
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        2 人以上で プレイフィー 1pt → 各自に 1-100 の数字 → お題に沿って表現を入力 → 全員の数字を開示。
        数字を直接言わずに 「強い動物の強さ」 などのお題で 表現の妙を楽しむ協力ゲーム。
      </div>
    </div>
    <div id="ito-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/ito/games');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('ito-list').innerHTML = '<div class="empty">卓がありません。 「＋ 新規卓」 から立てて メンバーを集めましょう。</div>';
      return;
    }
    document.getElementById('ito-list').innerHTML = items.map(g => {
      const statusTag = {
        lobby: `<span class="tag warn">募集中 ${g.player_count}名</span>`,
        input: '<span class="tag" style="background:#fef3c7; color:#a16207">入力中</span>',
        reveal: '<span class="tag" style="background:#fde68a; color:#a16207">公開準備</span>',
        finished: '<span class="tag muted">終了</span>',
        cancelled: '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>',
      }[g.status] || '';
      const meBadge = g.me_joined ? '<span class="tag ok">参加中</span>' : '';
      return `
        <a class="list-item" href="#/ito/${g.id}" style="gap:8px; align-items:center">
          <span style="display:inline-flex; flex:none">${avatarHtml(g.creator_name, g.creator_avatar, 'sm')}</span>
          <div class="grow">
            <div class="bold">🎲 ${escapeHtml(g.theme)} ${statusTag} ${meBadge}</div>
            <div class="meta">${escapeHtml(g.creator_name)} 起案 · プレイフィー ${g.buy_in}pt × ${g.player_count}人</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('ito-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderItoNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/ito" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎲 ito — 新規卓</h2>
      <label class="field">
        <span class="lbl">お題</span>
        <input type="text" id="ito-theme" maxlength="200" placeholder="例: 強い動物の強さ">
        <div class="row" style="gap:4px; flex-wrap:wrap; margin-top:4px">
          ${PRESET_THEMES.map(t => `<button class="btn" data-theme="${escapeHtml(t)}" style="font-size:11px; padding:2px 8px">${escapeHtml(t)}</button>`).join('')}
        </div>
      </label>
      <label class="field">
        <span class="lbl">プレイフィー (pt 1 人あたり、 戻ってきません)</span>
        <input type="number" id="ito-buyin" min="1" max="100" value="1">
      </label>
      <div style="margin-top:10px">
        <span class="lbl">招待するメンバー (任意、 後から自由に参加もできる)</span>
        <div id="ito-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="ito-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:13px">
        <input type="checkbox" id="ito-instant" checked>
        対象者で 即開始 (全員から 一括徴収 + 数字配布 + 即 input phase)
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
        <a href="#/ito" class="btn">キャンセル</a>
        <button id="ito-go" class="primary">卓を立てる</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('ito-bulk'),
      chipsContainer: document.getElementById('ito-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('ito-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.querySelectorAll('[data-theme]').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById('ito-theme').value = b.dataset.theme;
    });
  });
  document.getElementById('ito-go').addEventListener('click', async () => {
    const theme = document.getElementById('ito-theme').value.trim();
    if (!theme) { toast('お題を入れてください'); return; }
    const buyIn = Number(document.getElementById('ito-buyin').value) || 1;
    const memberIds = picker ? [...picker.getSelected()] : [];
    const btn = document.getElementById('ito-go');
    btn.disabled = true; btn.textContent = '作成中…';
    const instant = document.getElementById('ito-instant')?.checked && memberIds.length > 0;
    try {
      const r = await post('/api/ito/games', { theme, buy_in: buyIn, member_ids: memberIds, instant_start: instant });
      navigate('#/ito/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '卓を立てる'; }
  });
}

export async function renderItoDetail({ params }) {
  const gid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let g;
  try { g = await get('/api/ito/games/' + gid); }
  catch (e) { app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`; return; }
  paintItoDetail(g);
}

function paintItoDetail(g) {
  const app = document.getElementById('app');
  const statusLabel = {
    lobby: `<span class="tag warn">募集中 ${g.players.length}名</span>`,
    input: '<span class="tag" style="background:#fef3c7; color:#a16207">入力中</span>',
    reveal: '<span class="tag" style="background:#fde68a; color:#a16207">公開準備</span>',
    finished: '<span class="tag muted">終了</span>',
    cancelled: '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>',
  }[g.status] || '';

  const canJoin = g.status === 'lobby' && !g.me_joined;
  const canLeave = g.status === 'lobby' && g.me_joined && !g.is_creator;
  const canStart = g.status === 'lobby' && g.is_creator && g.players.length >= 2;
  const canCancel = g.is_creator && ['lobby','input','reveal'].includes(g.status);
  const canExpress = g.status === 'input' && g.me_joined;
  const canReveal = g.is_creator && g.status === 'input' && g.all_expressed;
  const showSorted = g.status === 'finished' || g.status === 'reveal';

  // 数字公開ありなら 小さい順に並び替えて表示
  let playersForDisplay = [...g.players];
  if (showSorted) {
    playersForDisplay.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  }

  app.innerHTML = `
    <div class="card">
      <a href="#/ito" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎲 ${escapeHtml(g.theme)} ${statusLabel}</h2>
      <div class="meta">${escapeHtml(g.creator_name)} 起案 · プレイフィー ${g.buy_in}pt × ${g.players.length}人</div>
    </div>

    ${g.status === 'input' && g.me_joined && g.my_number != null ? `
      <div class="card" style="background:linear-gradient(135deg, #4a106d, #b3a0e0); color:#fff; text-align:center">
        <div style="font-size:12px; opacity:0.9">あなたの数字 (他の人には見えません)</div>
        <div style="font-size:60px; font-weight:700; line-height:1">${g.my_number}</div>
        <div style="font-size:12px; opacity:0.9; margin-top:4px">これを 「${escapeHtml(g.theme)}」 で表現してください</div>
      </div>` : ''}

    ${canExpress ? `<div class="card">
      <label class="field">
        <span class="lbl">あなたの表現 (数字を直接言わない! 例: 「象くらい」「赤ちゃんくらい」)</span>
        <input type="text" id="ito-expr" maxlength="500" value="${escapeHtml(g.players.find(p => p.is_me)?.expression || '')}">
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="ito-express" class="primary">提出 / 更新</button>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="bold" style="margin-bottom:6px">👥 参加者 (${g.players.length}名)</div>
      <div class="list">
        ${playersForDisplay.map((p, i) => {
          const rank = showSorted ? `<span style="display:inline-block; width:28px; text-align:center; font-weight:700; color:var(--primary)">${i + 1}位</span>` : '';
          const num = p.number != null ? `<span style="font-size:18px; font-weight:700; color:var(--primary); margin-right:6px">${p.number}</span>` : '';
          return `
            <div class="list-item" style="gap:8px; align-items:center">
              ${rank}
              <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</span>
              <div class="grow">
                <div class="bold">${escapeHtml(p.display_name)}${p.is_me ? ' (あなた)' : ''}${num}</div>
                <div class="meta">${p.has_expressed ? `「${escapeHtml(p.expression || '')}」` : '<span style="color:#a16207">未提出</span>'}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap; justify-content:flex-end">
        ${canJoin   ? `<button id="ito-join"   class="primary">参加する (フィー ${g.buy_in}pt)</button>` : ''}
        ${canLeave  ? `<button id="ito-leave"  class="btn">脱退 (lobby のみ返金)</button>` : ''}
        ${canStart  ? `<button id="ito-start"  class="primary">数字を配って開始</button>` : ''}
        ${canReveal ? `<button id="ito-reveal" class="primary">📣 全員の数字を公開</button>` : ''}
        ${canCancel ? `<button id="ito-cancel" class="btn danger">卓を取消 (全員返金)</button>` : ''}
      </div>
    </div>
  `;

  if (canJoin)    document.getElementById('ito-join').addEventListener('click', () => doIto(g.id, 'join'));
  if (canLeave)   document.getElementById('ito-leave').addEventListener('click', () => { if (confirm('脱退して返金しますか?')) doIto(g.id, 'leave'); });
  if (canStart)   document.getElementById('ito-start').addEventListener('click', () => { if (confirm('数字を配って開始しますか?')) doIto(g.id, 'start'); });
  if (canReveal)  document.getElementById('ito-reveal').addEventListener('click', () => { if (confirm('全員の数字を公開しますか?')) doIto(g.id, 'reveal'); });
  if (canCancel)  document.getElementById('ito-cancel').addEventListener('click', () => { if (confirm('卓を取消して全員に返金しますか?')) doIto(g.id, 'cancel'); });
  if (canExpress) {
    document.getElementById('ito-express').addEventListener('click', async () => {
      const text = document.getElementById('ito-expr').value.trim();
      if (!text) { toast('表現を入れてください'); return; }
      try {
        await post(`/api/ito/games/${g.id}/express`, { text });
        toast('提出しました');
        await renderItoDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  }
}

async function doIto(gid, action) {
  try {
    await post(`/api/ito/games/${gid}/${action}`, {});
    toast('完了');
    await renderItoDetail({ params: { id: gid } });
  } catch (e) { toast('失敗: ' + e.message); }
}
