// v634 ⚾ ドラフト UI。 起案 / 一覧 / 詳細 (state-aware polling) を 1 ファイルで。

import { get, post } from '../api.js';
import { state, toast } from '../app.js';
import { navigate, escapeHtml } from '../router.js';
import { createMemberPicker } from '../member_picker.js';

const POLL_MS = 2500;
let pollTimer = null;

export async function renderDrafts() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">⚾ ドラフト</h2>
        <span style="flex:1"></span>
        <a href="#/drafts/new" class="btn primary">＋ 新規 ドラフト</a>
      </div>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        プロ野球 ドラフト 風 の 順番指名 + くじ 抽選 ツール。 参加者 と 候補 (人 or 自由入力) を 揃えて 開始。
      </p>
    </div>
    <div id="dr-list"><div class="hint">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/drafts');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('dr-list').innerHTML = '<div class="hint">まだ ドラフトが ありません。</div>';
      return;
    }
    document.getElementById('dr-list').innerHTML = items.map(it => `
      <a class="list-item" href="#/drafts/${it.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(it.title)} ${it.status !== 'active' ? `<span class="tag muted">${escapeHtml(it.status)}</span>` : ''}</div>
          <div class="meta">${escapeHtml(it.creator_name)} 起案 ・ ${it.participant_count} 人 ${it.me_in ? '<span class="tag ok">参加中</span>' : ''}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('dr-list').innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderDraftNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/drafts" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">⚾ ドラフト 新規作成</h2>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="dr-title" maxlength="200" placeholder="例: 学園祭の出し物 担当ドラフト">
      </label>
      <label class="field">
        <span class="lbl">候補の種類</span>
        <select id="dr-type">
          <option value="user">人 (LabPay メンバー から 選ぶ)</option>
          <option value="text">自由入力 (アイテム名 を 自分で 並べる)</option>
        </select>
      </label>
      <div id="dr-cand-area">
        <div class="lbl" style="margin-top:8px">候補</div>
        <div id="dr-cand-user" style="display:block">
          <div class="hint-sm" style="font-size:12px; margin-bottom:4px">指名 されうる 人 を 選ぶ</div>
          <div id="dr-cand-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="dr-cand-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
        </div>
        <div id="dr-cand-text" style="display:none">
          <div class="hint-sm" style="font-size:12px; margin-bottom:4px">1 行 1 候補</div>
          <textarea id="dr-cand-textarea" rows="6" placeholder="寿司&#10;ピザ&#10;ラーメン" style="width:100%; box-sizing:border-box; font-family:ui-monospace, monospace"></textarea>
        </div>
      </div>
      <div class="lbl" style="margin-top:8px">参加者 (自分は 自動で 含まれる)</div>
      <div class="hint-sm" style="font-size:12px; margin-bottom:4px">指名 を 行う 人。 2 人以上</div>
      <div id="dr-part-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
      <div id="dr-part-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:14px">
        <a href="#/drafts" class="btn">キャンセル</a>
        <button id="dr-go" class="btn primary">⚾ ドラフト 開始</button>
      </div>
    </div>
  `;
  let candPicker = null, partPicker = null;
  try {
    candPicker = await createMemberPicker({
      bulkContainer: document.getElementById('dr-cand-bulk'),
      chipsContainer: document.getElementById('dr-cand-chips'),
      initial: [], excludeIds: [], showGenderBulk: false,
    });
    partPicker = await createMemberPicker({
      bulkContainer: document.getElementById('dr-part-bulk'),
      chipsContainer: document.getElementById('dr-part-chips'),
      initial: [], excludeIds: [Number(state.me?.id)], showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('dr-cand-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('dr-type').addEventListener('change', (ev) => {
    const t = ev.target.value;
    document.getElementById('dr-cand-user').style.display = t === 'user' ? '' : 'none';
    document.getElementById('dr-cand-text').style.display = t === 'text' ? '' : 'none';
  });
  document.getElementById('dr-go').addEventListener('click', async () => {
    const title = document.getElementById('dr-title').value.trim();
    if (!title) { toast('タイトル を 入れてください'); return; }
    const type = document.getElementById('dr-type').value;
    let candidates;
    if (type === 'user') {
      candidates = candPicker ? [...candPicker.getSelected()] : [];
    } else {
      candidates = document.getElementById('dr-cand-textarea').value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (!candidates.length) { toast('候補 を 1 件以上 入れてください'); return; }
    const participants = partPicker ? [...partPicker.getSelected()] : [];
    if (participants.length < 1) { toast('自分以外 を 1 人以上 選んでください'); return; }
    const btn = document.getElementById('dr-go');
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/drafts', { title, target_type: type, candidates, participants });
      navigate('#/drafts/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '⚾ ドラフト 開始';
    }
  });
}

export async function renderDraftDetail({ params }) {
  if (pollTimer) clearInterval(pollTimer);
  const did = Number(params.id);
  await paint(did);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-dr-id="${did}"]`)) { clearInterval(pollTimer); pollTimer = null; return; }
    paint(did).catch(() => {});
  }, POLL_MS);
}

async function paint(did) {
  let d;
  try { d = await get('/api/drafts/' + did); }
  catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a href="#/drafts" class="hint">← 一覧</a><div class="hint">${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const me = Number(state.me?.id);
  const candById = Object.fromEntries(d.candidates.map(c => [String(c.id), c.label]));
  const partById = Object.fromEntries(d.participants.map(p => [String(p.uid), p.name]));
  const labelOf = (v) => candById[String(v)] ?? String(v);

  // 累積 確定 まとめ (uid -> [round -> pick])
  const confirmedByUser = {};
  for (const rd of Object.keys(d.confirmed || {})) {
    for (const [u, v] of Object.entries(d.confirmed[rd] || {})) {
      if (!confirmedByUser[u]) confirmedByUser[u] = {};
      confirmedByUser[u][rd] = v;
    }
  }
  const rounds = Math.max(0, ...Object.keys(d.confirmed || {}).map(Number));

  // ── 一覧 状況 (今の round / phase) ──
  let body = `<div class="card" data-dr-id="${did}">
    <a href="#/drafts" class="hint">← 一覧</a>
    <h2 style="margin:6px 0">⚾ ${escapeHtml(d.title)}</h2>
    <div class="meta" style="font-size:13px">
      ${escapeHtml(d.creator_name)} 起案 ・ ${d.target_type === 'user' ? '人 候補' : '自由入力'} ・
      <b>第 ${d.round} 巡</b> ${statusBadge(d.status, d.phase)}
    </div>
  </div>`;

  // ── phase ごとの メイン UI ──
  if (d.status === 'cancelled') {
    body += `<div class="card"><div class="hint">キャンセル済</div></div>`;
  } else if (d.phase === 'picking') {
    body += renderPicking(d, me, labelOf, confirmedByUser);
  } else if (d.phase === 'reveal') {
    body += renderReveal(d, me, labelOf);
  } else if (d.phase === 'lottery') {
    body += renderLottery(d, me, labelOf);
  } else if (d.phase === 'lottery_reveal') {
    body += renderLotteryReveal(d, me, labelOf);
  } else if (d.phase === 'finished') {
    body += renderFinished(d, labelOf, confirmedByUser);
  }

  // ── 累積 結果 (常時 表示) ──
  if (rounds > 0) {
    body += `<div class="card">
      <div class="bold" style="margin-bottom:6px">累積 指名 (これまで)</div>
      ${d.participants.map(p => {
        const my = confirmedByUser[String(p.uid)] || {};
        const items = Object.keys(my).sort((a,b) => Number(a) - Number(b))
          .map(rd => `${rd} 位: ${escapeHtml(labelOf(my[rd]))}`).join(' / ');
        return `<div style="padding:4px 0; font-size:13px">
          <b>${escapeHtml(p.name)}</b>: ${items || '(まだ)'}
        </div>`;
      }).join('')}
    </div>`;
  }

  document.getElementById('app').innerHTML = body;

  // wire actions
  document.getElementById('dr-pick-btn')?.addEventListener('click', () => onPick(did, d));
  document.querySelectorAll('[data-dr-stick]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    onDraw(did, Number(b.dataset.drStick));
  }));
  document.getElementById('dr-advance')?.addEventListener('click', () => onAdvance(did));
  document.getElementById('dr-cancel')?.addEventListener('click', async () => {
    if (!confirm('ドラフトを キャンセル しますか?')) return;
    try { await post('/api/drafts/' + did + '/cancel', {}); paint(did); }
    catch (e) { toast('失敗: ' + e.message); }
  });
}

function statusBadge(status, phase) {
  if (status === 'cancelled') return '<span class="tag" style="background:#fecaca">キャンセル</span>';
  if (status === 'finished')  return '<span class="tag" style="background:#d1fae5">終了</span>';
  const labels = { picking: '指名中', reveal: '希望開示', lottery: 'くじ引き', lottery_reveal: 'くじ結果', finished: '終了' };
  return `<span class="tag" style="background:#dbeafe; color:#1d4ed8">${labels[phase] || phase}</span>`;
}

function renderPicking(d, me, labelOf, confirmedByUser) {
  const isPending = (d.pending || []).includes(me);
  const mySubmitted = d.submitted?.[String(me)];
  const stillCount = (d.pending || []).length - Object.keys(d.submitted || {}).length;
  // 自分が 指名済の 候補 (= 既に 取った もの) + 他人 が 確定で 取った もの は 除外
  const myConfirmed = new Set(Object.values(confirmedByUser[String(me)] || {}).map(String));
  const othersConfirmed = new Set();
  for (const u of Object.keys(confirmedByUser)) {
    if (u !== String(me)) for (const v of Object.values(confirmedByUser[u])) othersConfirmed.add(String(v));
  }
  const available = d.candidates.filter(c => !myConfirmed.has(String(c.id)) && !othersConfirmed.has(String(c.id)));

  let html = `<div class="card">
    <h3 style="margin:0 0 6px">第 ${d.round} 巡 ・ あなたの 指名</h3>`;
  if (!d.i_am_participant) {
    html += `<div class="hint">あなたは 参加者 ではありません (観戦中)。 まだ ${stillCount} 人 指名待ち</div>`;
  } else if (!isPending) {
    if (mySubmitted) {
      html += `<div class="hint">送信済: <b>${escapeHtml(labelOf(mySubmitted))}</b>。 まだ ${stillCount} 人 指名待ち</div>`;
    } else {
      html += `<div class="hint">この round は 既に 確定しました。 他の人 を 待っています</div>`;
    }
  } else if (mySubmitted) {
    html += `<div class="hint">送信済: <b>${escapeHtml(labelOf(mySubmitted))}</b>。 まだ ${stillCount} 人 指名待ち</div>`;
  } else {
    html += `<div class="hint" style="margin-bottom:8px">候補から 1 つ 選ぶ:</div>
      <div id="dr-pick-choices" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px">
        ${available.map(c => `<button class="btn dr-pick-choice" data-val="${escapeHtml(String(c.id))}" style="font-size:13px">${escapeHtml(c.label)}</button>`).join('')}
      </div>
      <div class="hint-sm" style="font-size:12px; margin-bottom:6px">選択中: <span id="dr-pick-current">(未選択)</span></div>
      <button id="dr-pick-btn" class="btn primary" disabled>指名 を 送信</button>`;
  }
  html += `</div>`;
  // creator action
  if (d.i_am_creator && d.status === 'active') {
    html += `<div class="card"><button id="dr-cancel" class="btn" style="color:#c00; font-size:12px">ドラフトを キャンセル</button></div>`;
  }
  return html;
}

function renderReveal(d, me, labelOf) {
  // 集計: 候補 → 出した人
  const byCand = {};
  for (const [u, v] of Object.entries(d.submitted || {})) {
    const k = String(v);
    (byCand[k] = byCand[k] || []).push(Number(u));
  }
  const partName = (uid) => (d.participants.find(p => p.uid === uid)?.name) || String(uid);
  const rows = Object.entries(byCand).map(([cand, uids]) => {
    const conflict = uids.length > 1;
    return `<div style="padding:6px 0; border-top:1px solid var(--line); display:flex; gap:8px; align-items:center">
      <span style="font-size:16px">${conflict ? '⚔️' : '✅'}</span>
      <b>${escapeHtml(labelOf(cand))}</b>
      <span style="flex:1"></span>
      <span class="hint-sm">${uids.map(u => escapeHtml(partName(u))).join(' / ')}</span>
    </div>`;
  }).join('');
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">第 ${d.round} 巡 ・ 希望 開示</h3>
    ${rows}
  </div>`;
  if (d.i_am_creator) {
    html += `<div class="card"><button id="dr-advance" class="btn primary">次へ (競合 → くじ、 そうでなければ 確定 + 次の 指名)</button></div>`;
  } else {
    html += `<div class="card"><div class="hint">起案者の 「次へ」 待ち…</div></div>`;
  }
  return html;
}

function renderLottery(d, me, labelOf) {
  const l = d.lottery;
  const isContender = l.contenders.includes(me);
  const myDraw = l.my_draw;
  const drawn = l.drawn_count;
  const partName = (uid) => (d.participants.find(p => p.uid === uid)?.name) || String(uid);
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">🎲 くじ 引き — 「${escapeHtml(labelOf(l.candidate))}」</h3>
    <div class="hint" style="margin-bottom:6px">競合: ${l.contenders.map(u => escapeHtml(partName(u))).join(' / ')}</div>`;
  if (isContender && myDraw === null) {
    html += `<div class="hint-sm" style="margin-bottom:6px">${l.stick_count} 本 の くじ から 1 本 引いてください (= 1 本 だけ 当たり)</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap">
      ${Array.from({ length: l.stick_count }, (_, i) =>
        `<button class="btn primary" data-dr-stick="${i}" style="font-size:24px; padding:14px 18px">🥢</button>`
      ).join('')}
      </div>`;
  } else if (isContender) {
    html += `<div class="hint">あなたは ${myDraw + 1} 番目の くじ を 引きました。 残りを 待っています…</div>`;
  } else {
    html += `<div class="hint">対象者の くじ引き を 待っています…</div>`;
  }
  html += `<div class="hint-sm" style="margin-top:8px">引き済: ${drawn} / ${l.stick_count}</div>
  </div>`;
  return html;
}

function renderLotteryReveal(d, me, labelOf) {
  const l = d.lottery;
  const partName = (uid) => (d.participants.find(p => p.uid === uid)?.name) || String(uid);
  const winningStick = l.winning_stick;
  const winnerUid = Object.entries(l.draws).find(([_, s]) => Number(s) === winningStick)?.[0];
  const winnerName = winnerUid ? partName(Number(winnerUid)) : '?';
  const rows = Object.entries(l.draws).map(([u, s]) => {
    const isWin = Number(s) === winningStick;
    return `<div style="padding:4px 0; ${isWin ? 'background:#fef3c7; padding:6px; border-radius:4px' : ''}">
      ${isWin ? '🎉' : '  '} ${escapeHtml(partName(Number(u)))}: ${Number(s) + 1} 番 ${isWin ? '<b>当たり!</b>' : ''}
    </div>`;
  }).join('');
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">🎲 くじ 結果 — 「${escapeHtml(labelOf(l.candidate))}」</h3>
    <div class="bold" style="font-size:15px; margin-bottom:8px">勝者: 🎉 ${escapeHtml(winnerName)} さん (${winningStick + 1} 番が 当たり)</div>
    ${rows}
  </div>`;
  if (d.i_am_creator) {
    html += `<div class="card"><button id="dr-advance" class="btn primary">次へ</button></div>`;
  } else {
    html += `<div class="card"><div class="hint">起案者の 「次へ」 待ち…</div></div>`;
  }
  return html;
}

function renderFinished(d, labelOf, confirmedByUser) {
  return `<div class="card">
    <h2 style="margin:0 0 6px">🏆 ドラフト 終了</h2>
    <div class="hint" style="font-size:13px; margin-bottom:8px">各自の 最終 指名 リスト:</div>
    ${d.participants.map(p => {
      const my = confirmedByUser[String(p.uid)] || {};
      const items = Object.keys(my).sort((a,b) => Number(a) - Number(b))
        .map(rd => `<li>${rd} 位: <b>${escapeHtml(labelOf(my[rd]))}</b></li>`).join('');
      return `<div style="margin:8px 0">
        <div class="bold">${escapeHtml(p.name)}</div>
        <ol style="margin:4px 0 0 20px; padding:0">${items || '<li>(なし)</li>'}</ol>
      </div>`;
    }).join('')}
  </div>`;
}

let pickSelectedVal = null;

async function onPick(did, d) {
  if (pickSelectedVal === null) return;
  const btn = document.getElementById('dr-pick-btn');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    let v = pickSelectedVal;
    if (d.target_type === 'user') v = Number(v);
    await post('/api/drafts/' + did + '/pick', { value: v });
    pickSelectedVal = null;
    paint(did);
  } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '指名 を 送信'; }
}

async function onDraw(did, stick) {
  try {
    await post('/api/drafts/' + did + '/draw', { stick });
    paint(did);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onAdvance(did) {
  const btn = document.getElementById('dr-advance');
  btn.disabled = true;
  try { await post('/api/drafts/' + did + '/advance', {}); paint(did); }
  catch (e) { toast('失敗: ' + e.message); btn.disabled = false; }
}

// 候補ボタン の クリック で 選択
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('.dr-pick-choice');
  if (!t) return;
  pickSelectedVal = t.dataset.val;
  document.querySelectorAll('.dr-pick-choice').forEach(b => b.classList.remove('primary'));
  t.classList.add('primary');
  document.getElementById('dr-pick-current').textContent = t.textContent;
  const go = document.getElementById('dr-pick-btn');
  if (go) go.disabled = false;
});
