// /#/research-ai — 研究特化 AI サブスク (v1125)
//   200pt/60件 or 1000pt/無制限。テンプレート付きチャット。

import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

let STATE = null;

export async function renderResearchAI() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔬 研究特化 AI サブスク</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        研究に特化したプロンプトテンプレート付きチャット (研究テーマ相談 / 実験デザインチェック / アブスト磨き / 関連研究整理 / リバッタル起草 / 科研費文章 / 汎用)。<br>
        サブスク: <b>200pt / 60 件</b> or <b>1000pt / 無制限</b> (どちらも 30 日)
      </p>
    </div>
    <div id="rai-root"><div class="muted">読み込み中…</div></div>
  `;
  await refresh();
}

async function refresh() {
  try {
    STATE = await get('/api/research-ai');
    renderRoot();
  } catch (e) {
    document.getElementById('rai-root').innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`;
  }
}

function renderRoot() {
  const root = document.getElementById('rai-root');
  const sub = STATE.subscription;
  const subCard = sub ? `
    <div class="card" style="background:linear-gradient(135deg, #dcfce7, #bfdbfe); border:2px solid #16a34a">
      <div style="font-weight:800; color:#166534">✅ サブスク加入中 (${sub.plan === 'unlimited' ? '無制限' : `${sub.quota_left} 件残`})</div>
      <div style="font-size:12px; color:#4b5563; margin-top:4px">期限: ${escapeHtml(sub.expires_at)}</div>
      <div class="row" style="gap:6px; margin-top:8px">
        ${STATE.plans.map(p => `<button class="btn" data-rai-buy="${p.key}" style="font-size:11px">🔁 ${escapeHtml(p.label)} で延長</button>`).join('')}
      </div>
    </div>
  ` : `
    <div class="card" style="background:linear-gradient(135deg, #fef3c7, #fde68a)">
      <div style="font-weight:800; color:#92400e">⚠️ サブスク未加入</div>
      <div style="font-size:13px; margin-top:4px">下から購入してチャットを使えるようにしよう。</div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        ${STATE.plans.map(p => `<button class="btn primary" data-rai-buy="${p.key}" style="padding:8px 14px">💴 ${escapeHtml(p.label)}</button>`).join('')}
      </div>
    </div>
  `;
  root.innerHTML = `
    ${subCard}
    <div class="card">
      <div class="bold" style="margin-bottom:6px">💬 チャット</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px">
        ${STATE.templates.map(t => `<button class="btn" data-rai-tpl="${t.key}" style="font-size:12px" title="${escapeHtml(t.placeholder)}">${escapeHtml(t.title)}</button>`).join('')}
      </div>
      <div id="rai-tpl-hint" style="font-size:12px; color:#6b7280; margin-bottom:4px">テンプレートを選択してから入力してください</div>
      <textarea id="rai-msg" rows="4" maxlength="4000" placeholder="質問 / 相談を入力…" style="width:100%; padding:6px; box-sizing:border-box"></textarea>
      <div style="text-align:right; margin-top:6px">
        <button class="btn primary" id="rai-send" ${sub ? '' : 'disabled'}>${sub ? '📮 送信' : '🔒 未加入'}</button>
      </div>
      <div id="rai-response" style="margin-top:10px"></div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📚 履歴 (直近 ${STATE.recent_chats.length})</div>
      ${STATE.recent_chats.length ? STATE.recent_chats.map(c => `
        <div style="padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px">
          <div style="color:#7c3aed">Q [${escapeHtml(c.template_key || '')}]: ${escapeHtml(c.user_message_short)}${c.user_message_short.length >= 80 ? '…' : ''}</div>
          <div style="color:#4b5563; margin-top:2px">A: ${escapeHtml(c.ai_response_short)}${c.ai_response_short.length >= 200 ? '…' : ''}</div>
          <div style="color:#9ca3af; font-size:10px">${escapeHtml(c.created_at)}</div>
        </div>
      `).join('') : '<div class="muted">まだ履歴なし</div>'}
    </div>
  `;
  let selectedTpl = 'freetalk';
  const updateTplUi = () => {
    document.querySelectorAll('[data-rai-tpl]').forEach(el => {
      el.classList.toggle('primary', el.dataset.raiTpl === selectedTpl);
    });
    const t = STATE.templates.find(t => t.key === selectedTpl);
    document.getElementById('rai-tpl-hint').textContent = t ? `使用中: ${t.title} — ${t.placeholder}` : '';
    document.getElementById('rai-msg').placeholder = t?.placeholder || '';
  };
  document.querySelectorAll('[data-rai-tpl]').forEach(el => {
    el.addEventListener('click', () => { selectedTpl = el.dataset.raiTpl; updateTplUi(); });
  });
  updateTplUi();
  document.querySelectorAll('[data-rai-buy]').forEach(el => {
    el.addEventListener('click', async () => {
      const plan = el.dataset.raiBuy;
      const p = STATE.plans.find(x => x.key === plan);
      if (!confirm(`${p.label} を購入 (${p.cost}pt)。よい?`)) return;
      el.disabled = true;
      try { await post('/api/research-ai/subscribe', { plan }); toast('購入完了'); await refresh(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  document.getElementById('rai-send').addEventListener('click', async () => {
    const msg = document.getElementById('rai-msg').value.trim();
    if (!msg) { toast('質問を入れてね'); return; }
    const btn = document.getElementById('rai-send');
    btn.disabled = true; btn.textContent = '⌛ 考え中…';
    document.getElementById('rai-response').innerHTML = '<div class="muted">AI が考えています…</div>';
    try {
      const r = await post('/api/research-ai/chat', { message: msg, template_key: selectedTpl });
      document.getElementById('rai-response').innerHTML = `
        <div style="padding:10px; background:#f5f3ff; border-left:4px solid #7c3aed; border-radius:0 6px 6px 0; white-space:pre-wrap">${escapeHtml(r.response)}</div>
        <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:4px">
          ${r.quota_left !== null ? `残 ${r.quota_left} 件` : '無制限プラン'}
        </div>
      `;
      document.getElementById('rai-msg').value = '';
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '📮 送信'; }
  });
}
