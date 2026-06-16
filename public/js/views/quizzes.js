// v635 📝 フリップ クイズ UI。 出題者 = 問題 + 採点、 参加者 = 回答 + 拡大表示。

import { get, post } from '../api.js';
import { state, toast } from '../app.js';
import { navigate, escapeHtml } from '../router.js';
import { createMemberPicker } from '../member_picker.js';

const POLL_MS = 2500;
let pollTimer = null;

export async function renderQuizzes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">📝 フリップ クイズ</h2>
        <span style="flex:1"></span>
        <a href="#/quizzes/new" class="btn primary">＋ 新規 クイズ</a>
      </div>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        出題者が 1 問 ずつ 問題を 出題 → 参加者が フリップに 回答 → 一斉開示 → 出題者が マルバツ採点 → 集計。
      </p>
    </div>
    <div id="qz-list"><div class="hint">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/quizzes');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('qz-list').innerHTML = '<div class="hint">まだ クイズが ありません。</div>';
      return;
    }
    document.getElementById('qz-list').innerHTML = items.map(it => `
      <a class="list-item" href="#/quizzes/${it.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(it.title)} ${it.status !== 'active' ? `<span class="tag muted">${escapeHtml(it.status)}</span>` : ''}</div>
          <div class="meta">${escapeHtml(it.creator_name)} 起案 ・ ${it.participant_count} 人 ${it.me_in ? '<span class="tag ok">参加中</span>' : ''}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('qz-list').innerHTML = `<div class="hint">読み込み失敗</div>`;
  }
}

export async function renderQuizNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/quizzes" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">📝 クイズ 新規作成</h2>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="qz-title" maxlength="200" placeholder="例: ラボ クイズ大会">
      </label>
      <div class="lbl" style="margin-top:8px">参加者 (自分は 自動で 含まれる)</div>
      <div class="hint-sm" style="font-size:12px; margin-bottom:4px">回答する 人。 自分も 回答可</div>
      <div id="qz-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
      <div id="qz-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:14px">
        <a href="#/quizzes" class="btn">キャンセル</a>
        <button id="qz-go" class="btn primary">📝 開始</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('qz-bulk'),
      chipsContainer: document.getElementById('qz-chips'),
      initial: [], excludeIds: [Number(state.me?.id)], showGenderBulk: false,
    });
  } catch (e) { document.getElementById('qz-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`; }

  document.getElementById('qz-go').addEventListener('click', async () => {
    const title = document.getElementById('qz-title').value.trim();
    if (!title) { toast('タイトル を 入れてください'); return; }
    const participants = picker ? [...picker.getSelected()] : [];
    if (participants.length < 1) { toast('参加者 を 1 人以上 選んでください'); return; }
    const btn = document.getElementById('qz-go');
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/quizzes', { title, participants });
      navigate('#/quizzes/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '📝 開始'; }
  });
}

export async function renderQuizDetail({ params }) {
  if (pollTimer) clearInterval(pollTimer);
  const qid = Number(params.id);
  await paint(qid);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-qz-id="${qid}"]`)) { clearInterval(pollTimer); pollTimer = null; return; }
    paint(qid).catch(() => {});
  }, POLL_MS);
}

async function paint(qid) {
  let d;
  try { d = await get('/api/quizzes/' + qid); }
  catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a href="#/quizzes" class="hint">← 一覧</a><div class="hint">${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const me = Number(state.me?.id);
  const partName = (uid) => d.participants.find(p => p.uid === uid)?.name || String(uid);

  let body = `<div class="card" data-qz-id="${qid}">
    <a href="#/quizzes" class="hint">← 一覧</a>
    <h2 style="margin:6px 0">📝 ${escapeHtml(d.title)}</h2>
    <div class="meta" style="font-size:13px">
      ${escapeHtml(d.creator_name)} 出題 ・ 第 ${d.current_q} 問 ${phaseBadge(d.status, d.phase)}
      ${d.total_questions ? ` ・ 過去 ${d.total_questions} 問` : ''}
    </div>
  </div>`;

  if (d.status === 'cancelled') {
    body += `<div class="card"><div class="hint">キャンセル済</div></div>`;
  } else if (d.phase === 'asking') {
    body += renderAsking(d, me);
  } else if (d.phase === 'answering') {
    body += renderAnswering(d, me, partName);
  } else if (d.phase === 'reveal') {
    body += renderReveal(d, me, partName);
  } else if (d.phase === 'scored') {
    body += renderScored(d, me, partName);
  } else if (d.phase === 'finished') {
    body += renderFinished(d, partName);
  }

  // 累積 スコア (常時表示、 1 問でも 終わってれば)
  if (d.total_questions > 0) {
    const ranking = [...d.participants].sort((a, b) => (d.total_scores[b.uid] || 0) - (d.total_scores[a.uid] || 0));
    body += `<div class="card">
      <div class="bold" style="margin-bottom:6px">🏆 累積スコア (${d.total_questions} 問終了時点)</div>
      ${ranking.map((p, i) => `
        <div style="display:flex; gap:8px; padding:4px 0; ${i === 0 ? 'background:#fef3c7; padding:6px; border-radius:4px' : ''}">
          <span style="width:24px">${i + 1}.</span>
          <b>${escapeHtml(p.name)}</b>
          <span style="flex:1"></span>
          <span class="bold">${d.total_scores[p.uid] || 0} / ${d.total_questions}</span>
        </div>
      `).join('')}
    </div>`;
  }

  document.getElementById('app').innerHTML = body;
  wireActions(qid, d, me, partName);
}

function phaseBadge(status, phase) {
  if (status === 'cancelled') return '<span class="tag" style="background:#fecaca">キャンセル</span>';
  if (status === 'finished')  return '<span class="tag" style="background:#d1fae5">終了</span>';
  const labels = { asking: '出題中', answering: '回答中', reveal: '開示中', scored: '採点済', finished: '終了' };
  return `<span class="tag" style="background:#dbeafe; color:#1d4ed8">${labels[phase] || phase}</span>`;
}

function renderAsking(d, me) {
  if (d.i_am_creator) {
    return `<div class="card">
      <h3 style="margin:0 0 6px">第 ${d.current_q} 問 を 出題</h3>
      <textarea id="qz-q" rows="3" maxlength="500" placeholder="問題文 を 入力" style="width:100%; box-sizing:border-box; font-size:14px"></textarea>
      <button id="qz-ask" class="btn primary" style="margin-top:8px">出題</button>
      ${d.total_questions > 0 ? `<button id="qz-finish-now" class="btn" style="margin-top:8px; margin-left:6px">ここで 終了</button>` : ''}
    </div>`;
  }
  return `<div class="card"><div class="hint">出題者 が 問題 を 入力中… (第 ${d.current_q} 問)</div></div>`;
}

function renderAnswering(d, me, partName) {
  const myAns = d.answers?.[String(me)];
  const submittedCount = Object.keys(d.answers || {}).length;
  const total = d.participants.length;
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">第 ${d.current_q} 問</h3>
    <div style="padding:10px; background:#f9fafb; border-radius:8px; margin-bottom:8px; font-size:15px; white-space:pre-wrap">${escapeHtml(d.question || '')}</div>`;
  if (d.i_am_participant) {
    if (myAns !== undefined) {
      html += `<div class="hint">送信済: <b>${escapeHtml(myAns)}</b>。 全員 ${submittedCount}/${total} 人 回答中…</div>
        <button id="qz-edit-answer" class="btn" style="margin-top:6px; font-size:12px">回答を 変更</button>
        <div id="qz-answer-edit" style="display:none; margin-top:8px">
          <textarea id="qz-a" rows="2" maxlength="200" style="width:100%; box-sizing:border-box">${escapeHtml(myAns)}</textarea>
          <button id="qz-answer" class="btn primary" style="margin-top:6px">送信</button>
        </div>`;
    } else {
      html += `<div class="hint-sm" style="font-size:12px; margin-bottom:6px">フリップ に 回答 を 書いてください</div>
        <textarea id="qz-a" rows="2" maxlength="200" placeholder="回答" style="width:100%; box-sizing:border-box; font-size:18px"></textarea>
        <button id="qz-answer" class="btn primary" style="margin-top:6px">回答 を 送信</button>`;
    }
  } else {
    html += `<div class="hint">あなたは 観戦中。 全員 ${submittedCount}/${total} 人 回答中…</div>`;
  }
  if (d.i_am_creator) {
    html += `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--line)">
      <button id="qz-reveal" class="btn primary">📢 一斉 開示 (${submittedCount}/${total} 回答済)</button>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function renderReveal(d, me, partName) {
  const submitted = Object.keys(d.answers || {}).length;
  const total = d.participants.length;
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">📢 第 ${d.current_q} 問 開示</h3>
    <div style="padding:10px; background:#f9fafb; border-radius:8px; margin-bottom:10px; font-size:15px; white-space:pre-wrap">${escapeHtml(d.question || '')}</div>
    <div class="hint-sm" style="font-size:12px; margin-bottom:6px">タップで 拡大表示。 全員 ${submitted}/${total} 人 解答</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px">
      ${d.participants.map(p => {
        const ans = d.answers?.[String(p.uid)];
        return `<button class="qz-flip" data-uid="${p.uid}" data-ans="${escapeHtml(ans || '')}" data-name="${escapeHtml(p.name)}"
          style="padding:10px; background:#fff; border:2px solid #ddd; border-radius:8px; text-align:left; cursor:pointer">
          <div class="hint-sm" style="font-size:11px; color:#666">${escapeHtml(p.name)}</div>
          <div style="font-size:14px; font-weight:600; margin-top:4px; word-break:break-word; max-height:48px; overflow:hidden">${ans === undefined ? '<span class="muted">(未回答)</span>' : escapeHtml(ans)}</div>
        </button>`;
      }).join('')}
    </div>
  </div>`;
  if (d.i_am_creator) {
    html += `<div class="card">
      <div class="bold" style="margin-bottom:6px">マルバツ 採点 (タップで トグル)</div>
      <div id="qz-score-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:6px">
        ${d.participants.map(p => `
          <button class="qz-score-btn" data-uid="${p.uid}" data-score="0"
            style="padding:8px; background:#f3f4f6; border:2px solid #ddd; border-radius:8px; cursor:pointer; text-align:left">
            <div class="hint-sm" style="font-size:11px">${escapeHtml(p.name)}</div>
            <div style="font-size:24px; line-height:1; margin-top:4px">❌</div>
          </button>
        `).join('')}
      </div>
      <button id="qz-confirm-scores" class="btn primary" style="margin-top:10px">採点 確定</button>
    </div>`;
  } else {
    html += `<div class="card"><div class="hint">出題者の 採点 を 待っています…</div></div>`;
  }
  return html;
}

function renderScored(d, me, partName) {
  let html = `<div class="card">
    <h3 style="margin:0 0 6px">第 ${d.current_q} 問 採点結果</h3>
    <div style="padding:10px; background:#f9fafb; border-radius:8px; margin-bottom:10px; white-space:pre-wrap">${escapeHtml(d.question || '')}</div>
    ${d.participants.map(p => {
      const ans = d.answers?.[String(p.uid)];
      const sc = d.scores?.[String(p.uid)];
      return `<div style="display:flex; gap:8px; padding:6px 0; border-top:1px solid var(--line); align-items:center">
        <span style="font-size:24px">${sc === 1 ? '⭕' : '❌'}</span>
        <span class="bold" style="min-width:80px">${escapeHtml(p.name)}</span>
        <span style="font-size:14px; flex:1">${ans === undefined ? '<span class="muted">(未回答)</span>' : escapeHtml(ans)}</span>
      </div>`;
    }).join('')}
  </div>`;
  if (d.i_am_creator) {
    html += `<div class="card">
      <button id="qz-next" class="btn primary">次の 問へ</button>
      <button id="qz-finish" class="btn" style="margin-left:6px">クイズ 終了</button>
    </div>`;
  } else {
    html += `<div class="card"><div class="hint">出題者の 次へ 待ち…</div></div>`;
  }
  return html;
}

function renderFinished(d, partName) {
  let html = `<div class="card">
    <h2 style="margin:0 0 6px">🏆 クイズ 終了 — 全 ${d.total_questions} 問</h2>
    <div class="hint" style="font-size:13px">最終 ランキング:</div>
  </div>`;
  if (d.history && d.history.length) {
    html += `<div class="card">
      <div class="bold" style="margin-bottom:6px">📜 全 ${d.history.length} 問 振り返り</div>
      ${d.history.map((h, idx) => `
        <details style="margin:6px 0; border:1px solid #eee; border-radius:6px">
          <summary style="padding:8px; cursor:pointer; font-weight:600">第 ${idx + 1} 問: ${escapeHtml(h.q || '')}</summary>
          <div style="padding:8px 12px">
            ${d.participants.map(p => {
              const ans = h.answers?.[String(p.uid)];
              const sc = h.scores?.[String(p.uid)];
              return `<div style="display:flex; gap:8px; padding:3px 0; font-size:13px">
                <span style="font-size:18px">${sc === 1 ? '⭕' : '❌'}</span>
                <span style="min-width:80px">${escapeHtml(p.name)}</span>
                <span style="flex:1">${ans === undefined ? '<span class="muted">(未回答)</span>' : escapeHtml(ans)}</span>
              </div>`;
            }).join('')}
          </div>
        </details>
      `).join('')}
    </div>`;
  }
  return html;
}

function wireActions(qid, d, me, partName) {
  document.getElementById('qz-ask')?.addEventListener('click', async () => {
    const q = document.getElementById('qz-q').value.trim();
    if (!q) { toast('問題文 を 入れてください'); return; }
    try { await post('/api/quizzes/' + qid + '/ask', { question: q }); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-answer')?.addEventListener('click', async () => {
    const a = document.getElementById('qz-a').value.trim();
    if (!a) { toast('回答 を 入れてください'); return; }
    try { await post('/api/quizzes/' + qid + '/answer', { answer: a }); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-edit-answer')?.addEventListener('click', () => {
    document.getElementById('qz-answer-edit').style.display = '';
  });
  document.getElementById('qz-reveal')?.addEventListener('click', async () => {
    if (!confirm('一斉開示しますか? まだ 未回答 の 人 も いますが OK ?')) return;
    try { await post('/api/quizzes/' + qid + '/reveal', {}); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-confirm-scores')?.addEventListener('click', async () => {
    const scores = {};
    document.querySelectorAll('.qz-score-btn').forEach(b => {
      scores[b.dataset.uid] = Number(b.dataset.score);
    });
    try { await post('/api/quizzes/' + qid + '/score', { scores }); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-next')?.addEventListener('click', async () => {
    try { await post('/api/quizzes/' + qid + '/next', {}); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-finish')?.addEventListener('click', async () => {
    if (!confirm('クイズ を 終了 しますか?')) return;
    try { await post('/api/quizzes/' + qid + '/finish', {}); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('qz-finish-now')?.addEventListener('click', async () => {
    if (!confirm('ここで クイズ を 終了 しますか?')) return;
    try { await post('/api/quizzes/' + qid + '/finish', {}); paint(qid); }
    catch (e) { toast('失敗: ' + e.message); }
  });

  // フリップ タップで 拡大表示
  document.querySelectorAll('.qz-flip').forEach(b => b.addEventListener('click', () => {
    const name = b.dataset.name; const ans = b.dataset.ans;
    showFlipModal(name, ans);
  }));

  // 採点 ボタン トグル
  document.querySelectorAll('.qz-score-btn').forEach(b => b.addEventListener('click', () => {
    const cur = Number(b.dataset.score);
    const next = cur === 1 ? 0 : 1;
    b.dataset.score = next;
    b.querySelector('div:nth-child(2)').textContent = next === 1 ? '⭕' : '❌';
    b.style.background = next === 1 ? '#d1fae5' : '#f3f4f6';
    b.style.borderColor = next === 1 ? '#10b981' : '#ddd';
  }));
}

function showFlipModal(name, ans) {
  document.getElementById('qz-flip-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'qz-flip-modal';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; padding:20px; cursor:pointer';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; max-width:560px; width:100%; padding:24px; text-align:center">
      <div style="font-size:13px; color:#666; margin-bottom:12px">${escapeHtml(name)} さんの 回答</div>
      <div style="font-size:36px; font-weight:700; word-break:break-word; line-height:1.4">${escapeHtml(ans) || '<span style="color:#999">(未回答)</span>'}</div>
      <div class="hint-sm" style="margin-top:16px; font-size:11px; color:#888">タップで 閉じる</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => overlay.remove());
}
