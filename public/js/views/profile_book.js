// /#/profile-book — プロフ帳 (平成デザ) v1124
//   手書き風フォント + パステルグラデ背景 + 匿名質問。基本情報埋めで +50pt。

import { get, post, put } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

// 平成デザ用スタイル (手書き風フォント + パステル)
const HEISEI_STYLE = `
  <style id="pb-style">
    #pb-shell { background:linear-gradient(135deg, #ffe4f2 0%, #e4f4ff 50%, #f4e4ff 100%); min-height:100vh; padding-bottom:40px; font-family: 'Yu Mincho', 'Hiragino Mincho ProN', 'Comic Sans MS', cursive, serif }
    #pb-shell .pb-card { background:rgba(255,255,255,0.85); border:3px dashed #ff9ec7; border-radius:18px; padding:14px; margin:10px 0; box-shadow:2px 2px 8px rgba(255,158,199,0.35) }
    #pb-shell h2 { color:#c026d3; text-shadow:1px 1px 0 #fff, 2px 2px 0 #ff9ec7; font-weight:900 }
    #pb-shell .pb-title { color:#7c3aed; font-weight:900; text-shadow:1px 1px 0 #fff }
    #pb-shell .pb-tab-btn { border:2px solid #ff9ec7; background:#fff; color:#c026d3; padding:6px 12px; border-radius:16px; font-weight:700; cursor:pointer; margin:2px }
    #pb-shell .pb-tab-btn.active { background:linear-gradient(135deg,#ffe4f2,#f4e4ff); color:#7c3aed; box-shadow:0 2px 6px rgba(192,38,211,0.3) }
    #pb-shell input, #pb-shell textarea { border:2px dotted #a78bfa; border-radius:8px; padding:6px 8px; background:#fefefe; font-family:inherit; width:100%; box-sizing:border-box }
    #pb-shell button.pb-go { background:linear-gradient(135deg, #f472b6, #a78bfa); color:#fff; font-weight:800; border:none; padding:8px 18px; border-radius:20px; cursor:pointer; box-shadow:0 3px 8px rgba(167,139,250,0.4) }
    #pb-shell .pb-q-label { color:#7c3aed; font-weight:700; margin-bottom:4px; font-size:13px }
    #pb-shell .pb-answer-text { font-size:15px; color:#4a044e; padding:6px 8px; background:linear-gradient(90deg, #fff9c4 0%, #ffffff 4px, #ffffff 100%); border-left:4px solid #eab308; white-space:pre-wrap; border-radius:4px }
    #pb-shell .pb-locked { color:#9ca3af; font-style:italic; padding:8px; background:#f9fafb; border:1px dashed #d1d5db; border-radius:6px; text-align:center }
    #pb-shell .pb-badge-pt { background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700 }
  </style>
`;

export async function renderProfileBook() {
  const app = document.getElementById('app');
  app.innerHTML = HEISEI_STYLE + `
    <div id="pb-shell">
      <div class="pb-card">
        <h2 style="margin:0">🎀 プロフ帳 (平成)</h2>
        <p style="margin:6px 0 0; font-size:13px; color:#7c3aed">
          みんなでプロフ帳を埋めよう。基本情報を全部埋めると <span class="pb-badge-pt">+50pt</span> ゲット🎉<br>
          他人のプロフ閲覧 <span class="pb-badge-pt">10pt</span> ・匿名質問投稿 <span class="pb-badge-pt">10pt</span> ・質問回答 <span class="pb-badge-pt">+5pt</span>
        </p>
        <div style="margin-top:8px">
          <button class="pb-tab-btn" data-pb-tab="me">📝 私のプロフ</button>
          <button class="pb-tab-btn" data-pb-tab="list">👥 みんなのプロフ</button>
          <button class="pb-tab-btn" data-pb-tab="asks">🎀 私宛の質問 <span id="pb-asks-badge"></span></button>
        </div>
      </div>
      <div id="pb-root"></div>
    </div>
  `;
  document.querySelectorAll('[data-pb-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.pbTab));
  });
  // 未回答質問バッジ
  try {
    const p = await get('/api/profile-book/questions-for-me');
    const n = (p.items || []).length;
    if (n > 0) document.getElementById('pb-asks-badge').innerHTML = `<span style="background:#dc2626; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px">${n}</span>`;
  } catch (_) {}
  await switchTab('me');
}

async function switchTab(tab) {
  document.querySelectorAll('[data-pb-tab]').forEach(el => el.classList.toggle('active', el.dataset.pbTab === tab));
  const root = document.getElementById('pb-root');
  root.innerHTML = '<div class="pb-card">読み込み中…</div>';
  if (tab === 'me')   return renderMe(root);
  if (tab === 'list') return renderList(root);
  if (tab === 'asks') return renderAsks(root);
}

async function renderMe(root) {
  const [qs, me] = await Promise.all([get('/api/profile-book/questions'), get('/api/profile-book/me')]);
  const questions = qs.items || [];
  const answers = me.answers || {};
  const basicQs = questions.filter(q => q.category === 'basic');
  const psychoQs = questions.filter(q => q.category === 'psycho');
  const filled = basicQs.filter(q => answers[q.key]).length;
  root.innerHTML = `
    <div class="pb-card">
      <div class="pb-title" style="font-size:18px">📝 私のプロフィール</div>
      <div class="pb-badge-pt" style="margin-top:4px">基本情報 ${filled}/${basicQs.length} 埋め ${me.rewarded ? '(✅ reward 済)' : `(6 個以上で +${me.reward_amount}pt reward!)`}</div>
      <div style="margin-top:10px">
        <div style="font-weight:700; color:#c026d3; margin-bottom:4px">━━ 基本情報 ━━</div>
        ${basicQs.map(q => qEditField(q, answers[q.key])).join('')}
      </div>
      <div style="margin-top:14px">
        <div style="font-weight:700; color:#c026d3; margin-bottom:4px">━━ 心理テスト ━━</div>
        ${psychoQs.map(q => qEditField(q, answers[q.key])).join('')}
      </div>
      <div style="text-align:right; margin-top:12px">
        <button class="pb-go" id="pb-save-me">💾 保存</button>
      </div>
    </div>
  `;
  document.getElementById('pb-save-me').addEventListener('click', async () => {
    const out = {};
    questions.forEach(q => {
      const el = document.getElementById('pbf-' + q.key);
      if (el) out[q.key] = el.value;
    });
    const btn = document.getElementById('pb-save-me');
    btn.disabled = true; btn.textContent = '⌛ 保存中…';
    try {
      const r = await put('/api/profile-book/me', { answers: out });
      toast(r.reward_given ? `💾 保存 & +${r.saved > 0 ? 50 : ''}pt reward!` : `💾 ${r.saved} 個保存 (基本 ${r.basic_filled} 個埋め)`);
      await renderMe(document.getElementById('pb-root'));
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '💾 保存'; }
  });
}

function qEditField(q, val) {
  const input = q.type === 'textarea'
    ? `<textarea id="pbf-${q.key}" rows="2" maxlength="2000">${escapeHtml(val || '')}</textarea>`
    : `<input type="text" id="pbf-${q.key}" maxlength="500" value="${escapeHtml(val || '')}">`;
  return `<div style="margin-bottom:8px">
    <div class="pb-q-label">${escapeHtml(q.label)}</div>
    ${input}
  </div>`;
}

async function renderList(root) {
  // /api/users から人一覧を取ってきて、各人へのリンク
  try {
    const d = await get('/api/users');
    const users = (d.items || []).filter(u => u.kind === 'human' && u.id !== state.me?.id);
    if (!users.length) { root.innerHTML = '<div class="pb-card">他のメンバーがいません</div>'; return; }
    root.innerHTML = `
      <div class="pb-card">
        <div class="pb-title" style="font-size:16px">👥 みんなのプロフ帳 (タップで開く、閲覧 10pt)</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px; margin-top:10px">
          ${users.map(u => `
            <button class="pb-tab-btn" data-pb-open="${u.id}" style="display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px">
              ${avatarHtml(u.display_name, u.avatar_url, 'md')}
              <span style="font-size:12px">${escapeHtml(u.display_name)}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div id="pb-user-detail"></div>
    `;
    root.querySelectorAll('[data-pb-open]').forEach(el => {
      el.addEventListener('click', () => renderUserDetail(parseInt(el.dataset.pbOpen, 10), document.getElementById('pb-user-detail')));
    });
  } catch (e) { root.innerHTML = `<div class="pb-card">${escapeHtml(e.message)}</div>`; }
}

async function renderUserDetail(uid, root) {
  root.innerHTML = '<div class="pb-card">読み込み中…</div>';
  try {
    const [qs, d] = await Promise.all([get('/api/profile-book/questions'), get('/api/profile-book/' + uid)]);
    const p = d.profile;
    const questions = qs.items || [];
    root.innerHTML = `
      <div class="pb-card">
        <div class="row" style="gap:8px; align-items:center">
          ${avatarHtml(p.display_name, p.avatar_url, 'md')}
          <div class="pb-title" style="font-size:20px; flex:1">${escapeHtml(p.display_name)} のプロフ帳</div>
        </div>
        ${p.unlocked ? '' : `
          <div class="pb-locked">
            🔒 まだアンロックしていません<br>
            (${p.preview.filled_count}/${p.preview.total} 個埋まっています)<br>
            <button class="pb-go" style="margin-top:6px" id="pb-unlock-btn">🎀 ${p.view_fee}pt でアンロック</button>
          </div>
        `}
        ${p.unlocked ? questions.map(q => `
          <div style="margin-top:10px">
            <div class="pb-q-label">${escapeHtml(q.label)}</div>
            <div class="pb-answer-text">${escapeHtml((p.answers && p.answers[q.key]) || '(未回答)')}</div>
          </div>
        `).join('') : ''}
      </div>
      <div class="pb-card">
        <div class="pb-title" style="font-size:15px">💌 追加質問を投げる (${10}pt、匿名可)</div>
        <div style="margin-top:6px">
          <input type="text" id="pb-ask-text" maxlength="400" placeholder="例: 好きな漫画は?">
          <label style="display:inline-flex; align-items:center; gap:4px; margin-top:4px; font-size:12px"><input type="checkbox" id="pb-ask-anon" checked> 匿名で送る</label>
          <div style="text-align:right; margin-top:6px"><button class="pb-go" id="pb-ask-btn">💌 送信 (10pt)</button></div>
        </div>
      </div>
      ${p.answered_questions.length ? `
        <div class="pb-card">
          <div class="pb-title" style="font-size:15px">📝 回答済みの質問 (${p.answered_questions.length})</div>
          ${p.answered_questions.map(q => `
            <div style="margin-top:8px; padding:6px 8px; background:#fff9c4; border-radius:6px">
              <div style="font-size:12px; color:#7c3aed; font-weight:700">Q: ${escapeHtml(q.question_text)} ${q.is_anonymous ? '<span style="font-size:10px; color:#9ca3af">(匿名)</span>' : ''}</div>
              <div style="margin-top:4px; font-size:14px; white-space:pre-wrap">A: ${escapeHtml(q.answer_text)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
    document.getElementById('pb-unlock-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('pb-unlock-btn');
      btn.disabled = true; btn.textContent = '⌛ …';
      try { await post(`/api/profile-book/${uid}/unlock`, {}); toast('🎀 アンロック!'); await renderUserDetail(uid, root); }
      catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = `🎀 ${p.view_fee}pt でアンロック`; }
    });
    document.getElementById('pb-ask-btn')?.addEventListener('click', async () => {
      const txt = document.getElementById('pb-ask-text').value.trim();
      const anon = document.getElementById('pb-ask-anon').checked;
      if (!txt) { toast('質問を書いてね'); return; }
      const btn = document.getElementById('pb-ask-btn');
      btn.disabled = true; btn.textContent = '⌛ …';
      try {
        await post(`/api/profile-book/${uid}/questions`, { question_text: txt, is_anonymous: anon });
        toast('💌 質問を送りました (-10pt)');
        document.getElementById('pb-ask-text').value = '';
        await renderUserDetail(uid, root);
      } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '💌 送信 (10pt)'; }
    });
  } catch (e) { root.innerHTML = `<div class="pb-card">${escapeHtml(e.message)}</div>`; }
}

async function renderAsks(root) {
  try {
    const d = await get('/api/profile-book/questions-for-me');
    if (!d.items.length) { root.innerHTML = '<div class="pb-card">未回答の質問はありません 🎀</div>'; return; }
    root.innerHTML = `
      <div class="pb-card">
        <div class="pb-title" style="font-size:16px">🎀 私宛の質問 (${d.items.length}) — 回答で <span class="pb-badge-pt">+${d.answer_reward}pt</span></div>
        ${d.items.map(q => `
          <div style="margin-top:10px; padding:8px; background:#fff9c4; border-radius:8px; border-left:4px solid #f472b6">
            <div class="pb-q-label">Q: ${escapeHtml(q.question_text)} ${q.is_anonymous ? '<span style="font-size:10px; color:#9ca3af">(匿名)</span>' : ''}</div>
            <textarea id="pb-ans-${q.id}" rows="2" maxlength="2000" placeholder="回答を書く…" style="margin-top:4px"></textarea>
            <div style="text-align:right; margin-top:4px">
              <button class="pb-go" data-pb-answer="${q.id}">✏️ 回答して +${d.answer_reward}pt</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    root.querySelectorAll('[data-pb-answer]').forEach(el => {
      el.addEventListener('click', async () => {
        const qid = el.dataset.pbAnswer;
        const txt = document.getElementById('pb-ans-' + qid).value.trim();
        if (!txt) { toast('回答を書いてね'); return; }
        el.disabled = true; el.textContent = '⌛ …';
        try { await post(`/api/profile-book/questions/${qid}/answer`, { answer_text: txt }); toast(`✏️ 回答完了 (+${d.answer_reward}pt)`); await renderAsks(root); }
        catch (e) { toast('失敗: ' + e.message); el.disabled = false; el.textContent = `✏️ 回答して +${d.answer_reward}pt`; }
      });
    });
  } catch (e) { root.innerHTML = `<div class="pb-card">${escapeHtml(e.message)}</div>`; }
}
