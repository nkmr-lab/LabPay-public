// /#/shiritori — 絵しりとり (Phase 1)。 v540 #171。
//   メンバー選択 → ゲーム作成 → 順番に描いてタイトル + 直前の予想を入力 → 終了。
//   AI 予想 / 最終当て / アニメ再生は Phase 2 で。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

export async function renderShiritori() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🎨 絵しりとり</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/shiritori/new">＋ 新規</a>
      </div>
    </div>
    <div id="sh-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/shiritori/games');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('sh-list').innerHTML = '<div class="empty">まだゲームがありません。「＋ 新規」から作成してください。</div>';
      return;
    }
    document.getElementById('sh-list').innerHTML = items.map(g => {
      const totalTurns = g.round_count * g.player_count;
      const progress = Math.round(g.drawing_count * 100 / Math.max(1, totalTurns));
      const statusTag = g.status === 'ended'
        ? '<span class="tag muted">終了</span>'
        : `<span class="tag warn">進行中 (${progress}%)</span>`;
      return `
        <a class="list-item" href="#/shiritori/${g.id}">
          <div class="grow">
            <div class="bold">${escapeHtml(g.title)} ${statusTag}</div>
            <div class="meta">${escapeHtml(g.creator_name)} · ${g.player_count}名 · ${g.round_count}周 / 1ターン${g.time_limit_sec}秒</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('sh-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderShiritoriNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/shiritori" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎨 絵しりとり — 新規</h2>
      <div style="margin-top:8px">
        <label style="display:block; font-size:13px; margin-bottom:4px">タイトル</label>
        <input type="text" id="sh-title" maxlength="200" placeholder="例: 春のお絵かき大会" style="width:100%; box-sizing:border-box">
      </div>
      <div class="row" style="gap:10px; margin-top:8px; flex-wrap:wrap">
        <label style="flex:1; min-width:140px">
          <div style="font-size:13px; margin-bottom:2px">周回数</div>
          <input type="number" id="sh-rounds" min="1" max="10" value="2" style="width:100%; box-sizing:border-box">
        </label>
      </div>
      <div class="hint" style="font-size:12px; margin-top:6px">⏱ 1 ターン 30 秒固定・プレイフィー 1 人 2pt (初めて自分の番を投稿した時に徴収)</div>
      <div style="margin-top:10px">
        <label style="display:block; font-size:13px; margin-bottom:4px">メンバー (自分は自動で含まれます)</label>
        <div id="sh-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="sh-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="margin-top:10px; gap:6px; justify-content:flex-end">
        <a href="#/shiritori" class="btn">キャンセル</a>
        <button id="sh-go" class="primary">🎨 開始</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('sh-bulk'),
      chipsContainer: document.getElementById('sh-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('sh-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('sh-go').addEventListener('click', async () => {
    const title = document.getElementById('sh-title').value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    const time   = 30; // v580 固定 (秒数指定UI を撤去)
    const rounds = Number(document.getElementById('sh-rounds').value) || 2;
    const ids = picker ? [...picker.getSelected()] : [];
    if (ids.length < 1) { toast('1 人以上選んでください'); return; }
    const btn = document.getElementById('sh-go');
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/shiritori/games', {
        title, member_ids: ids, time_limit_sec: time, round_count: rounds,
      });
      navigate('#/shiritori/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '🎨 開始';
    }
  });
}

// 絵しりとりのゲーム本体。現在のターンが自分ならキャンバス + タイマー、他人なら
//   「○○さんが描いてます」 + 過去の絵 (直近 2 枚)。終了したら全描画一覧。
let canvasState = null;
export async function renderShiritoriDetail({ params }) {
  const gid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let g;
  try { g = await get('/api/shiritori/games/' + gid); }
  catch (e) { app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`; return; }
  app.innerHTML = `
    <div class="card">
      <a href="#/shiritori" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎨 ${escapeHtml(g.title)}
        ${g.status === 'ended' ? '<span class="tag muted">終了</span>' : '<span class="tag warn">進行中</span>'}
      </h2>
      <div class="meta">${escapeHtml(g.creator_name)} 発起 · ${g.players.length}名 · ${g.round_count}周 / 1ターン${g.time_limit_sec}秒 · ${g.drawings.length}/${g.total_turns}枚描かれた</div>
      <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
        ${g.players.map((p, i) => {
          const isCur = g.status === 'active' && g.current_player && p.user_id === g.current_player.user_id;
          return `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 6px; border-radius:6px; background:${isCur ? 'var(--primary, #4a106d)' : '#f0e6f5'}; color:${isCur ? '#fff' : '#666'}; font-size:11px">${i + 1}. ${avatarHtml(p.display_name, p.avatar_url, 'xs')} ${escapeHtml(p.display_name)}</span>`;
        }).join('')}
      </div>
      ${g.is_creator && g.status === 'active' ? `<div style="text-align:right; margin-top:6px"><button id="sh-giveup" class="btn danger" style="font-size:11px; padding:2px 8px">🏳 ギブアップ</button></div>` : ''}
    </div>
    <div id="sh-stage"></div>
  `;
  if (g.is_creator && g.status === 'active') {
    document.getElementById('sh-giveup').addEventListener('click', async () => {
      if (!confirm('ゲームを終了しますか?')) return;
      try { await post('/api/shiritori/games/' + gid + '/giveup', {}); await renderShiritoriDetail({ params: { id: gid } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
  const stage = document.getElementById('sh-stage');
  if (g.status === 'ended') {
    paintEndedList(stage, g);
  } else if (g.is_my_turn) {
    paintMyTurn(stage, g);
  } else {
    paintWaitingTurn(stage, g);
  }
}

function paintEndedList(root, g) {
  root.innerHTML = `
    <div class="card">
      <div class="bold" style="margin-bottom:6px">🎬 全描画 (順)</div>
      <div class="list">
        ${g.drawings.map((d, i) => paintDrawingRow(d, g.players)).join('') || '<div class="empty">描画なしで終了</div>'}
      </div>
    </div>`;
}

function paintWaitingTurn(root, g) {
  const cur = g.current_player;
  const last2 = g.drawings.slice(-2);
  root.innerHTML = `
    <div class="card">
      <div class="bold" style="margin-bottom:6px">⏳ ${escapeHtml(cur ? cur.display_name : '?')} さんが描いています…</div>
      <div class="hint-sm">あなたの番が来たらホームの通知が届きます。このページをリロードしてください。</div>
    </div>
    ${last2.length ? `<div class="card">
      <div class="bold" style="margin-bottom:6px">最新 ${last2.length} 枚</div>
      <div class="list">${last2.map(d => paintDrawingRow(d, g.players)).join('')}</div>
    </div>` : ''}
  `;
}

function paintDrawingRow(d, players) {
  const p = players.find(pp => pp.user_id === d.user_id);
  const name = p ? p.display_name : '?';
  const avatar = p ? avatarHtml(p.display_name, p.avatar_url, 'sm') : '';
  const imgBlock = d.image_url
    ? `<img src="${escapeHtml(d.image_url)}" alt="" loading="lazy" decoding="async" style="display:block; max-width:240px; max-height:240px; object-fit:contain; border:1px solid var(--line); border-radius:6px; background:#fff">`
    : '<div class="muted" style="font-size:12px">画像なし</div>';
  return `
    <div class="list-item" style="align-items:flex-start; gap:8px">
      <span style="display:inline-flex; flex:none">${avatar}</span>
      <div class="grow">
        <div class="bold" style="font-size:13px">${escapeHtml(name)} (Turn ${d.turn_idx + 1})</div>
        ${imgBlock}
        <div style="margin-top:4px; font-size:13px">本人: <span class="bold">${escapeHtml(d.label_self)}</span></div>
        ${d.label_prev_guess ? `<div style="font-size:12px" class="meta">前を予想: 「${escapeHtml(d.label_prev_guess)}」</div>` : ''}
      </div>
    </div>`;
}

function paintMyTurn(root, g) {
  const last2 = g.drawings.slice(-2);
  const prevDrawing = g.drawings[g.drawings.length - 1] || null;
  root.innerHTML = `
    ${last2.length ? `<div class="card">
      <div class="bold" style="margin-bottom:6px">📷 直近 ${last2.length} 枚 (これを見て次を描く)</div>
      <div class="list">${last2.map(d => paintDrawingRow(d, g.players)).join('')}</div>
    </div>` : '<div class="card"><div class="hint">あなたが最初の描き手です。自由に何か 1 つ描いてください。</div></div>'}
    <div class="card">
      <div class="bold" style="margin-bottom:6px">✏️ あなたの番 (残り <span id="sh-timer">${g.time_limit_sec}</span> 秒)</div>
      <canvas id="sh-canvas" width="500" height="500"
              style="width:100%; max-width:500px; aspect-ratio:1/1; background:#fff; border:2px solid var(--primary, #4a106d); border-radius:8px; touch-action:none; display:block; margin:0 auto"></canvas>
      <div class="row" style="gap:6px; margin-top:8px; justify-content:center">
        ${[2,3,5,8].map(w => `<button class="btn" data-pen-w="${w}" style="font-size:11px; padding:2px 8px">${w}px</button>`).join('')}
        ${['#000','#dc2626','#16a34a','#2563eb','#a16207'].map(c => `<button class="btn" data-pen-c="${c}" style="font-size:11px; padding:2px 8px; background:${c}; color:#fff">●</button>`).join('')}
      </div>
      <div class="hint-sm" style="margin-top:4px; text-align:center">消す機能はありません (一度描いたら戻せない)。</div>
      <div style="margin-top:10px">
        <label style="display:block; font-size:13px; margin-bottom:4px">自分は何を描いた? (本人だけが知る正解)</label>
        <input type="text" id="sh-label-self" maxlength="60" placeholder="例: いぬ" style="width:100%; box-sizing:border-box">
      </div>
      ${prevDrawing ? `<div style="margin-top:6px">
        <label style="display:block; font-size:13px; margin-bottom:4px">直前の絵 (${escapeHtml(prevDrawing.label_self ? '?' : '')}) は何だと思った?</label>
        <input type="text" id="sh-label-prev" maxlength="60" placeholder="例: いぬっぽい" style="width:100%; box-sizing:border-box">
      </div>` : ''}
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
        <button id="sh-submit" class="primary">提出 →</button>
      </div>
    </div>
  `;
  setupCanvas(g);
  startTimer(g.time_limit_sec, () => {
    toast('時間切れ! 自動提出します');
    submitTurn(g);
  });
  document.getElementById('sh-submit').addEventListener('click', () => submitTurn(g));
  document.querySelectorAll('[data-pen-w]').forEach(b => b.addEventListener('click', () => {
    if (canvasState) canvasState.penWidth = Number(b.dataset.penW);
  }));
  document.querySelectorAll('[data-pen-c]').forEach(b => b.addEventListener('click', () => {
    if (canvasState) canvasState.penColor = b.dataset.penC;
  }));
}

function setupCanvas(g) {
  const c = document.getElementById('sh-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  canvasState = {
    canvas: c, ctx,
    penColor: '#000', penWidth: 3,
    strokes: [], // [{c, w, points: [[x,y,t], ...]}, ...]
    drawing: false, current: null, startTime: Date.now(),
  };
  const getPos = (ev) => {
    const r = c.getBoundingClientRect();
    const e = ev.touches ? ev.touches[0] : ev;
    const x = (e.clientX - r.left) * (c.width / r.width);
    const y = (e.clientY - r.top) * (c.height / r.height);
    return [x, y];
  };
  const startStroke = (ev) => {
    ev.preventDefault();
    canvasState.drawing = true;
    const [x, y] = getPos(ev);
    canvasState.current = { c: canvasState.penColor, w: canvasState.penWidth, points: [[x, y, Date.now() - canvasState.startTime]] };
    ctx.strokeStyle = canvasState.penColor;
    ctx.lineWidth = canvasState.penWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const moveStroke = (ev) => {
    if (!canvasState.drawing) return;
    ev.preventDefault();
    const [x, y] = getPos(ev);
    canvasState.current.points.push([x, y, Date.now() - canvasState.startTime]);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const endStroke = (ev) => {
    if (!canvasState.drawing) return;
    canvasState.drawing = false;
    if (canvasState.current && canvasState.current.points.length) {
      canvasState.strokes.push(canvasState.current);
    }
    canvasState.current = null;
  };
  c.addEventListener('mousedown', startStroke);
  c.addEventListener('mousemove', moveStroke);
  window.addEventListener('mouseup', endStroke);
  c.addEventListener('touchstart', startStroke, { passive: false });
  c.addEventListener('touchmove', moveStroke, { passive: false });
  window.addEventListener('touchend', endStroke);
}

let timerTickId = null;
function startTimer(sec, onTimeout) {
  if (timerTickId) clearInterval(timerTickId);
  const startMs = Date.now();
  timerTickId = setInterval(() => {
    const remain = Math.max(0, sec - Math.floor((Date.now() - startMs) / 1000));
    const el = document.getElementById('sh-timer');
    if (!el) { clearInterval(timerTickId); timerTickId = null; return; }
    el.textContent = remain;
    if (remain <= 10) el.style.color = '#dc2626';
    if (remain <= 0) {
      clearInterval(timerTickId);
      timerTickId = null;
      onTimeout?.();
    }
  }, 200);
}

async function submitTurn(g) {
  const labelSelf = document.getElementById('sh-label-self')?.value.trim();
  if (!labelSelf) { toast('自分が何を描いたか入力してください'); return; }
  const labelPrev = document.getElementById('sh-label-prev')?.value.trim() || null;
  const c = document.getElementById('sh-canvas');
  const submitBtn = document.getElementById('sh-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提出中…'; }
  let imageUrl = null;
  try {
    // canvas → blob → upload
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (blob) {
      const fd = new FormData();
      fd.append('file', new File([blob], `shiritori_g${g.id}_t${g.current_turn_idx}.png`, { type: 'image/png' }));
      const resp = await fetch('/api/uploads/image', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) imageUrl = j.url || j.path;
    }
  } catch (_) {}
  const strokes = canvasState ? canvasState.strokes : [];
  try {
    await post('/api/shiritori/games/' + g.id + '/turn', {
      strokes_json: JSON.stringify(strokes),
      image_url: imageUrl || '',
      label_self: labelSelf,
      label_prev_guess: labelPrev,
    });
    if (timerTickId) { clearInterval(timerTickId); timerTickId = null; }
    toast('提出しました!');
    await renderShiritoriDetail({ params: { id: g.id } });
  } catch (e) {
    toast('失敗: ' + e.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提出 →'; }
  }
}
