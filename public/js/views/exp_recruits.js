// v1164 実験協力者募集 (exp_recruits) — 中村さん要望
//   「どんな実験か、枠は何枠か、上限人数は何人かを書いておいて募集をかけ、
//    希望者はあいている枠を早いもの順で埋めていく」
//   + 「実施者が埋めても良い」
//   + 「本人も確認できるようにする」
//
// Routes:
//   /#/exp-recruits           一覧
//   /#/exp-recruits/new       新規募集
//   /#/exp-recruits/{id}      詳細 (枠 + 参加者)

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

function fmtDeadline(dl) {
  if (!dl) return '';
  const d = new Date(String(dl).replace(' ', 'T') + '+09:00');
  const past = d.getTime() < Date.now();
  const s = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return past ? `<span style="color:#c00">締切: ${s} (過ぎました)</span>` : `締切: ${s}`;
}

// ─── 一覧 ─────────────────────────────────────
export async function renderExpRecruitsList() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="display:flex; align-items:baseline; gap:8px">
      <h2 style="margin:0; flex:1">🧪 実験協力者募集</h2>
      <a href="#/exp-recruits/new" class="btn primary">＋新規募集</a>
    </div>
    <div id="er-list" class="muted" style="margin-top:8px">読み込み中…</div>
  `;
  try {
    const d = await get('/api/exp-recruits');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('er-list').innerHTML =
        '<div class="card muted">まだ募集はありません。右上の「＋新規募集」から作成してください。</div>';
      return;
    }
    document.getElementById('er-list').innerHTML = items.map(r => {
      const isClosed = r.status === 'closed';
      const myBadge = (r.my_slot_names && r.my_slot_names.length)
        ? `<div style="margin-top:6px; padding:4px 8px; background:#e0f2fe; border-radius:6px; font-size:12px; color:#0369a1">✓ 参加中: ${r.my_slot_names.map(escapeHtml).join(' / ')}</div>`
        : '';
      return `
        <a class="card" href="#/exp-recruits/${r.id}" style="display:block; text-decoration:none; color:inherit; ${isClosed ? 'opacity:0.55' : ''}">
          <div style="display:flex; align-items:baseline; gap:8px">
            <div style="flex:1; font-weight:700; font-size:16px">${isClosed ? '🔒 ' : ''}${escapeHtml(r.title)}</div>
            <div class="muted" style="font-size:11px">${escapeHtml(r.creator_name)} 起案</div>
          </div>
          <div class="muted" style="font-size:12px; margin-top:4px">
            枠 ${r.slot_count} 個 / 全体 ${r.filled_total}/${r.capacity_total} 人${r.deadline_at ? ' ・ ' + fmtDeadline(r.deadline_at) : ''}
          </div>
          ${myBadge}
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('er-list').textContent = '取得失敗: ' + e.message;
  }
}

// ─── 新規募集 ─────────────────────────────────
export async function renderExpRecruitNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">🧪 実験協力者募集 — 新規</h2>
      <div class="form-row"><label>タイトル (どんな実験か一行で)</label>
        <input id="er-title" type="text" maxlength="200" placeholder="例: 平均文字の視認性実験"></div>
      <div class="form-row"><label>説明 (任意、何をするか / 所要時間 / 場所など)</label>
        <textarea id="er-desc" rows="4" maxlength="4000" placeholder="例: 30 分の被験者実験。眉間の平均画像を見て気になる度合いを回答"></textarea></div>
      <div class="form-row"><label>締切 (任意)</label>
        <input id="er-deadline" type="datetime-local"></div>
      <div class="form-row">
        <label>枠 (時間帯 or ラベル名 + 定員)</label>
        <div id="er-slots"></div>
        <div style="margin-top:4px; display:flex; gap:6px">
          <button type="button" id="er-slot-add" class="btn">＋枠を追加</button>
          <button type="button" id="er-slot-preset" class="btn">📅 時間枠一括生成</button>
        </div>
      </div>
      <div class="form-row" style="display:flex; gap:6px">
        <button type="button" id="er-submit" class="btn primary" style="flex:1">募集開始</button>
        <a href="#/exp-recruits" class="btn">キャンセル</a>
      </div>
    </div>
  `;
  const slotsEl = document.getElementById('er-slots');
  let seq = 0;
  // v1164 中村さん要望「1 枠に参加できる人数も指定したい。 1 人、5 人、無制限」
  //   → capacity=0 を「無制限」の sentinel に。数値入力 (min=0) + 0 の時は"∞"表示。
  const addSlot = (name = '', capacity = 1) => {
    const id = ++seq;
    slotsEl.insertAdjacentHTML('beforeend', `
      <div class="row center" data-slot-id="${id}" style="gap:6px; margin-bottom:4px">
        <input class="er-slot-name" type="text" value="${escapeHtml(name)}" maxlength="100" placeholder="枠 ${id}" style="flex:1">
        <input class="er-slot-cap" type="number" min="0" max="100" value="${capacity}" style="width:70px" title="0 = 無制限">
        <span class="er-slot-cap-unit muted" style="font-size:12px">人</span>
        <button type="button" class="er-slot-del" style="background:none; border:none; color:#c00; cursor:pointer">✕</button>
      </div>`);
    const row = slotsEl.querySelector(`[data-slot-id="${id}"]`);
    const capInput = row.querySelector('.er-slot-cap');
    const unit = row.querySelector('.er-slot-cap-unit');
    const upd = () => { unit.textContent = Number(capInput.value) === 0 ? '人 (∞)' : '人'; };
    capInput.addEventListener('input', upd); upd();
    row.querySelector('.er-slot-del').addEventListener('click', () => row.remove());
  };
  addSlot('枠 1', 1);
  addSlot('枠 2', 1);
  addSlot('枠 3', 1);
  document.getElementById('er-slot-add').addEventListener('click', () => addSlot('', 1));
  document.getElementById('er-slot-preset').addEventListener('click', () => {
    const spec = prompt('時間枠を一括生成します。例: 2026-07-25 10:00-16:00 30分 → 30 分刻みで枠を生成。開始 - 終了と刻み分を入れて下さい (定員は各 1 人で仮置き、後で個別調整可)', '2026-07-25 10:00-16:00 30分');
    if (!spec) return;
    const m = spec.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\s+(\d+)\s*分/);
    if (!m) { alert('形式: YYYY-MM-DD HH:MM-HH:MM 30分'); return; }
    const day = m[1], sh = +m[2], sm = +m[3], eh = +m[4], em = +m[5], step = +m[6];
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    slotsEl.innerHTML = '';
    while (cur + step <= end) {
      const h1 = String(Math.floor(cur / 60)).padStart(2, '0');
      const m1 = String(cur % 60).padStart(2, '0');
      const h2 = String(Math.floor((cur + step) / 60)).padStart(2, '0');
      const m2 = String((cur + step) % 60).padStart(2, '0');
      addSlot(`${day} ${h1}:${m1}-${h2}:${m2}`, 1);
      cur += step;
    }
  });

  document.getElementById('er-submit').addEventListener('click', async () => {
    const title = document.getElementById('er-title').value.trim();
    if (!title) { toast('タイトルを入れて下さい'); return; }
    const desc = document.getElementById('er-desc').value.trim();
    const dlRaw = document.getElementById('er-deadline').value;
    const dl = dlRaw ? dlRaw.replace('T', ' ') : '';
    const slotRows = slotsEl.querySelectorAll('[data-slot-id]');
    if (!slotRows.length) { toast('少なくとも 1 枠は必要です'); return; }
    const slots = [...slotRows].map((row, i) => {
      const capRaw = Number(row.querySelector('.er-slot-cap').value);
      // 0 = 無制限、それ以外は 1..100 に clamp。 NaN や負値は 1 扱い。
      const cap = capRaw === 0 ? 0 : Math.max(1, Math.min(100, capRaw || 1));
      return { name: row.querySelector('.er-slot-name').value.trim() || `枠 ${i + 1}`, capacity: cap };
    });
    const btn = document.getElementById('er-submit');
    btn.disabled = true; btn.textContent = '⌛ 作成中…';
    try {
      const r = await post('/api/exp-recruits', { title, description: desc, deadline_at: dl, slots });
      toast('募集を開始しました');
      navigate(`#/exp-recruits/${r.id}`);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '募集開始';
    }
  });
}

// ─── 詳細 ─────────────────────────────────
export async function renderExpRecruitDetail({ params }) {
  const rid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card muted">読み込み中…</div>`;
  let data;
  try {
    data = await get(`/api/exp-recruits/${rid}`);
  } catch (e) {
    app.innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
    return;
  }
  const r = data.recruit;
  const slots = data.slots || [];
  const meId = Number(state.me?.id);
  const isMine = r.is_mine || (state.me?.role === 'admin');
  const isClosed = r.status === 'closed';
  const deadlinePassed = r.deadline_at && new Date(String(r.deadline_at).replace(' ', 'T') + '+09:00').getTime() < Date.now();
  const locked = isClosed || deadlinePassed;

  // 所属枠 (本人確認導線)
  const myEntries = [];
  for (const s of slots) for (const p of s.participants) if (p.is_me) myEntries.push({ slot: s, p });
  const mySelf = myEntries.length
    ? `<div style="padding:8px 12px; background:#e0f2fe; border-radius:8px; font-size:13px; color:#0369a1; margin-bottom:10px">
        ✅ あなたはこの募集に参加しています: ${myEntries.map(x => `<strong>${escapeHtml(x.slot.name)}</strong>`).join(' / ')}
       </div>`
    : '';

  app.innerHTML = `
    <div class="card">
      <a href="#/exp-recruits" class="muted" style="font-size:12px; text-decoration:none">← 一覧</a>
      <div style="display:flex; align-items:baseline; gap:8px; margin-top:4px">
        <h2 style="margin:0; flex:1">${isClosed ? '🔒 ' : '🧪 '}${escapeHtml(r.title)}</h2>
        <div class="muted" style="font-size:12px">${escapeHtml(r.creator_name)} 起案</div>
      </div>
      ${r.description ? `<div style="white-space:pre-wrap; margin-top:6px; color:#333">${escapeHtml(r.description)}</div>` : ''}
      ${r.deadline_at ? `<div class="muted" style="font-size:12px; margin-top:6px">${fmtDeadline(r.deadline_at)}</div>` : ''}
      ${mySelf}
      ${isMine ? `
        <div style="margin-top:10px; display:flex; gap:6px">
          ${!isClosed ? `<button id="er-close" class="btn">📕 募集終了</button>` : ''}
          <button id="er-del" class="btn" style="color:#c00">🗑 募集を削除</button>
        </div>` : ''}
    </div>
    <div id="er-slots-view" style="margin-top:8px"></div>
    ${isMine && !locked ? `
      <div class="card">
        <h3 style="margin-top:0">代理で入れる</h3>
        <div class="row center" style="gap:6px">
          <select id="er-assign-slot" style="flex:1"></select>
          <select id="er-assign-user" style="flex:1"><option value="">ユーザ選択…</option></select>
          <button id="er-assign-go" class="btn primary">追加</button>
        </div>
        <div class="hint-sm" style="margin-top:4px">満員の枠には追加できません。代理追加した人にも通知は飛びません (口頭で伝えて下さい)。</div>
      </div>` : ''}
  `;

  const slotsView = document.getElementById('er-slots-view');
  // v1167 中村さん指示「日程の一覧性が低いのでもう少し小さく表示して」
  //   → 1 枠 = 1 行 (grid: name / 定員 / 参加者 chip / action)。 padding 大幅減、
  //     行区切りは薄い border だけ、参加者は 20px アバター + 名前で極小化。
  const slotsHtml = slots.map(s => {
    const unlimited = s.capacity === 0;
    const full = !unlimited && (s.filled >= s.capacity);
    const joinable = !locked && !s.is_me_in && !full;
    const capText = unlimited ? `${s.filled}/∞` : `${s.filled}/${s.capacity}`;
    const capColor = full ? '#c00' : (s.is_me_in ? '#0369a1' : '#666');
    const parts = s.participants.map(p => `
      <span style="display:inline-flex; align-items:center; gap:3px; padding:1px 6px 1px 2px; background:${p.is_me ? '#fef3c7' : '#f3f4f6'}; border-radius:10px; font-size:11px; line-height:1.4">
        ${avatarHtml(p.user_name, p.user_avatar, 'xs')}
        <span>${escapeHtml(p.user_name)}${p.source === 'assigned_by_creator' ? '＊' : ''}</span>
        ${(isMine || p.is_me) && !locked ? `<button class="er-remove" data-slot-id="${s.id}" data-user-id="${p.user_id}" data-is-me="${p.is_me ? 1 : 0}" style="border:none; background:none; color:#c00; cursor:pointer; padding:0 2px; font-size:11px">✕</button>` : ''}
      </span>`).join('');
    const action = joinable
      ? `<button class="er-join btn primary" data-slot-id="${s.id}" style="padding:3px 10px; font-size:12px">＋入る</button>`
      : (s.is_me_in && !locked ? `<span style="color:#0369a1; font-size:11px; font-weight:600">✓ 参加中</span>` : '');
    return `
      <div class="er-slot-row" data-slot="${s.id}" style="display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid #eee; flex-wrap:wrap">
        <div style="flex:1 1 180px; min-width:0; font-weight:600; font-size:13px; ${s.is_me_in ? 'color:#0369a1' : ''}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
          ${escapeHtml(s.name)}
        </div>
        <div style="flex:none; font-size:12px; color:${capColor}; font-variant-numeric:tabular-nums; min-width:40px; text-align:right">
          ${capText}${full ? ' 満' : ''}
        </div>
        <div style="flex:2 1 200px; display:flex; flex-wrap:wrap; gap:3px; min-width:0">
          ${parts || '<span class="muted" style="font-size:11px">—</span>'}
        </div>
        ${action ? `<div style="flex:none">${action}</div>` : ''}
      </div>`;
  }).join('');
  slotsView.innerHTML = slots.length
    ? `<div class="card" style="padding:0; overflow:hidden">${slotsHtml}</div>
       <div class="hint-sm" style="margin-top:4px; font-size:11px; padding:0 4px">＊=実施者による代理追加</div>`
    : '<div class="card muted">枠がありません</div>';

  // wire join
  slotsView.querySelectorAll('.er-join').forEach(b => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await post(`/api/exp-recruits/${rid}/join`, { slot_id: Number(b.dataset.slotId) });
        renderExpRecruitDetail({ params: { id: String(rid) } });
      } catch (e) {
        toast('失敗: ' + e.message);
        b.disabled = false;
      }
    });
  });
  // wire remove (leave / kick)
  slotsView.querySelectorAll('.er-remove').forEach(b => {
    b.addEventListener('click', async () => {
      const isMe = b.dataset.isMe === '1';
      if (!confirm(isMe ? 'この枠から抜けますか?' : 'この参加者を外しますか?')) return;
      try {
        await del(`/api/exp-recruits/${rid}/${isMe ? 'leave' : 'kick'}`, {
          slot_id: Number(b.dataset.slotId),
          user_id: Number(b.dataset.userId),
        });
        renderExpRecruitDetail({ params: { id: String(rid) } });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });

  if (isMine && !locked) {
    document.getElementById('er-close')?.addEventListener('click', async () => {
      if (!confirm('募集を終了しますか? (以降参加は締切)')) return;
      try { await post(`/api/exp-recruits/${rid}/close`, {}); renderExpRecruitDetail({ params: { id: String(rid) } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    // 代理追加ドロップダウン
    const assignSlot = document.getElementById('er-assign-slot');
    if (assignSlot) {
      assignSlot.innerHTML = '<option value="">枠…</option>' + slots.map(s => {
        const unlimited = s.capacity === 0;
        const isFull = !unlimited && s.filled >= s.capacity;
        const capText = unlimited ? `${s.filled}/∞` : `${s.filled}/${s.capacity}`;
        return `<option value="${s.id}" ${isFull ? 'disabled' : ''}>${escapeHtml(s.name)} (${capText})</option>`;
      }).join('');
    }
    try {
      const u = await get('/api/users');
      const assignUser = document.getElementById('er-assign-user');
      if (assignUser) {
        assignUser.innerHTML = '<option value="">ユーザ選択…</option>' +
          (u.items || []).map(x => `<option value="${x.id}">${escapeHtml(x.display_name)}${x.grade ? ' [' + escapeHtml(x.grade) + ']' : ''}</option>`).join('');
      }
    } catch (_) {}
    document.getElementById('er-assign-go')?.addEventListener('click', async () => {
      const sid = Number(document.getElementById('er-assign-slot').value);
      const uid = Number(document.getElementById('er-assign-user').value);
      if (!sid || !uid) { toast('枠とユーザを選んで下さい'); return; }
      try {
        await post(`/api/exp-recruits/${rid}/assign`, { slot_id: sid, user_id: uid });
        renderExpRecruitDetail({ params: { id: String(rid) } });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  }
  if (isMine) {
    document.getElementById('er-del')?.addEventListener('click', async () => {
      if (!confirm('この募集を削除しますか? (参加者リストも消えます、元に戻せません)')) return;
      try { await del(`/api/exp-recruits/${rid}`, {}); navigate('#/exp-recruits'); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
}
