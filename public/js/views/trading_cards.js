// /#/trading-cards — ゼミ人トレカ + ガチャ (v1121)
//   誰でも作成 → 本人承認 → 公開 pool 入り → ガチャで配布 (1連 30pt / 10連 250pt)

import { get, post, patch } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

let MEMBERS_CACHE = null;
const RARITY_STYLE = {
  SSR: { color:'linear-gradient(135deg, #fbbf24, #f97316, #dc2626)', text:'#7c2d12', ring:'#f59e0b', label:'SSR' },
  SR:  { color:'linear-gradient(135deg, #a78bfa, #7c3aed)',         text:'#fff',    ring:'#6d28d9', label:'SR'  },
  R:   { color:'linear-gradient(135deg, #67e8f9, #0891b2)',         text:'#164e63', ring:'#0e7490', label:'R'   },
  N:   { color:'linear-gradient(135deg, #e5e7eb, #9ca3af)',         text:'#111827', ring:'#6b7280', label:'N'   },
};

export async function renderTradingCards() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎴 ゼミ人トレカ</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        誰でもラボメンのカードを作成 → <b>本人が承認</b>すると公開 pool に入る。<br>
        ガチャは <b>1連 30pt / 10連 250pt (R以上確定)</b>。集めよう。
      </p>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" data-tc-tab="gacha">🎁 ガチャ</button>
        <button class="btn"         data-tc-tab="collection">📚 マイコレクション</button>
        <button class="btn"         data-tc-tab="create">✏️ 作成</button>
        <button class="btn"         data-tc-tab="pending">🔔 承認待ち <span id="tc-pending-badge"></span></button>
        <button class="btn"         data-tc-tab="mine">🗂 私の関連カード</button>
      </div>
    </div>
    <div id="tc-tab-root"><div class="muted">読み込み中…</div></div>
  `;
  document.querySelectorAll('[data-tc-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tcTab));
  });
  // pending バッジ
  try {
    const p = await get('/api/trading-cards/pending-for-me');
    const n = (p.items || []).length;
    if (n > 0) document.getElementById('tc-pending-badge').innerHTML = `<span style="background:#dc2626; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px">${n}</span>`;
  } catch (_) {}
  await switchTab('gacha');
}

async function switchTab(tab) {
  document.querySelectorAll('[data-tc-tab]').forEach(el => {
    el.classList.toggle('primary', el.dataset.tcTab === tab);
  });
  const root = document.getElementById('tc-tab-root');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  if (tab === 'gacha')      return renderGachaTab(root);
  if (tab === 'collection') return renderCollectionTab(root);
  if (tab === 'create')     return renderCreateTab(root);
  if (tab === 'pending')    return renderPendingTab(root);
  if (tab === 'mine')       return renderMineTab(root);
}

function cardHtml(c, opts = {}) {
  const s = RARITY_STYLE[c.rarity] || RARITY_STYLE.N;
  const bg = c.background_color || '';
  const bgStyle = bg ? `background:${bg};` : `background:${s.color};`;
  const countLabel = c.count > 0 ? `<span style="position:absolute; top:6px; right:6px; background:rgba(255,255,255,0.9); color:#000; font-weight:700; padding:2px 8px; border-radius:12px; font-size:12px">×${c.count}</span>` : '';
  const rarityBadge = `<span style="position:absolute; top:6px; left:6px; background:${s.ring}; color:#fff; font-weight:800; padding:2px 8px; border-radius:8px; font-size:11px; letter-spacing:0.1em">${s.label}</span>`;
  const img = c.image_url ? `<img src="${escapeHtml(c.image_url)}" style="width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:6px" alt="">` : `<div style="width:100%; height:120px; display:flex; align-items:center; justify-content:center; font-size:48px; margin-bottom:6px">${avatarHtml(c.target_name, c.target_avatar, 'lg')}</div>`;
  const catch2 = c.catchphrase ? `<div style="font-size:11px; margin-top:2px; opacity:0.9; font-style:italic">「${escapeHtml(c.catchphrase)}」</div>` : '';
  const reaction = c.reaction_text ? `<div style="font-size:12px; font-weight:700; margin-top:4px">💬 ${escapeHtml(c.reaction_text)}</div>` : '';
  const meta = `<div style="font-size:10px; opacity:0.75; margin-top:4px">作: ${escapeHtml(c.creator_name || '')}</div>`;
  return `
    <div class="tc-card" style="position:relative; padding:8px; border-radius:12px; border:3px solid ${s.ring}; ${bgStyle} color:${s.text}; box-shadow:0 4px 12px rgba(0,0,0,0.15); min-height:220px; display:flex; flex-direction:column">
      ${rarityBadge}
      ${countLabel}
      ${img}
      <div style="font-weight:800; font-size:13px; text-align:center">${escapeHtml(c.target_name || '')}</div>
      ${catch2}
      ${reaction}
      <div style="margin-top:auto">${meta}</div>
    </div>
  `;
}

async function renderGachaTab(root) {
  try {
    const d = await get('/api/trading-cards');
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🎁 ガチャを回す</div>
        <p class="hint" style="font-size:12px; color:#6b7280">公開カード ${d.items.length} 種 / 10 連は R 以上確定 / 1 連 30pt · 10 連 250pt</p>
        <div class="row" style="gap:8px; margin-top:8px; flex-wrap:wrap">
          <button class="btn primary" id="tc-pull-1" style="padding:10px 18px; font-size:14px">🎲 1 連 (30pt)</button>
          <button class="btn primary" id="tc-pull-10" style="padding:10px 18px; font-size:14px; background:linear-gradient(135deg,#7c3aed,#dc2626)">🎲🎲 10 連 (250pt · R 確定)</button>
        </div>
        <div id="tc-pull-result" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🎴 公開カード一覧 (${d.items.length} 種)</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:10px">
          ${d.items.map(c => cardHtml(c)).join('')}
        </div>
      </div>
    `;
    document.getElementById('tc-pull-1').onclick  = () => pullGacha(1);
    document.getElementById('tc-pull-10').onclick = () => pullGacha(10);
  } catch (e) {
    root.innerHTML = `<div class="card muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

async function pullGacha(pulls) {
  const btn = document.getElementById('tc-pull-' + pulls);
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⌛ 回してます…';
  try {
    const r = await post('/api/trading-cards/gacha', { pulls });
    const box = document.getElementById('tc-pull-result');
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px">✨ ${r.pulled.length} 枚出ました! (${r.cost}pt 消費)</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:10px">
        ${r.pulled.map(c => cardHtml(c)).join('')}
      </div>
    `;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { toast('失敗: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

async function renderCollectionTab(root) {
  try {
    const d = await get('/api/trading-cards/collection');
    if (!d.items.length) {
      root.innerHTML = `<div class="card muted">まだカードを持っていません。 🎁 ガチャから引いてみよう!</div>`;
      return;
    }
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">📚 マイコレクション: ${d.unique_count} / ${d.pool_count} 種 (${Math.round(d.unique_count * 100 / Math.max(1, d.pool_count))}%)</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:10px">
          ${d.items.map(c => cardHtml(c)).join('')}
        </div>
      </div>
    `;
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderPendingTab(root) {
  try {
    const d = await get('/api/trading-cards/pending-for-me');
    if (!d.items.length) {
      root.innerHTML = `<div class="card muted">承認待ちのカードはありません。</div>`;
      return;
    }
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🔔 あなた宛の承認待ち (${d.items.length})</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px">
          ${d.items.map(c => `
            <div style="display:flex; flex-direction:column; gap:6px">
              ${cardHtml(c)}
              <div class="row" style="gap:4px">
                <button class="btn primary" data-tc-approve="${c.id}" style="flex:1">✅ 承認</button>
                <button class="btn" data-tc-reject="${c.id}" style="color:#b91c1c">❌ 却下</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.querySelectorAll('[data-tc-approve]').forEach(el => {
      el.addEventListener('click', async () => {
        el.disabled = true;
        try { await post(`/api/trading-cards/${el.dataset.tcApprove}/approve`, {}); toast('承認しました'); await renderPendingTab(root); }
        catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
      });
    });
    document.querySelectorAll('[data-tc-reject]').forEach(el => {
      el.addEventListener('click', async () => {
        const reason = prompt('却下理由 (任意):', '');
        if (reason === null) return;
        el.disabled = true;
        try { await post(`/api/trading-cards/${el.dataset.tcReject}/reject`, { reject_reason: reason }); toast('却下しました'); await renderPendingTab(root); }
        catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
      });
    });
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderMineTab(root) {
  try {
    const d = await get('/api/trading-cards/mine');
    if (!d.items.length) {
      root.innerHTML = `<div class="card muted">関連カードなし (自分が作った or 自分が対象)</div>`;
      return;
    }
    const badgeFor = (s) => ({
      pending:  '<span style="background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:6px; font-size:10px">承認待ち</span>',
      approved: '<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:6px; font-size:10px">公開中</span>',
      rejected: '<span style="background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:6px; font-size:10px">却下</span>',
      archived: '<span style="background:#e5e7eb; color:#4b5563; padding:1px 6px; border-radius:6px; font-size:10px">Archived</span>',
    })[s] || '';
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🗂 私の関連カード (${d.items.length})</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px">
          ${d.items.map(c => `
            <div>
              ${cardHtml(c)}
              <div style="margin-top:4px; font-size:11px; text-align:center">
                ${badgeFor(c.status)} ${c.is_target && c.status === 'pending' ? '(承認待ち→🔔 タブで承認)' : ''}
                ${c.reject_reason ? `<div style="color:#b91c1c">却下理由: ${escapeHtml(c.reject_reason)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderCreateTab(root) {
  // メンバー一覧を取得
  if (!MEMBERS_CACHE) {
    try { const d = await get('/api/users'); MEMBERS_CACHE = (d.items || []).filter(u => u.kind === 'human'); }
    catch (_) { MEMBERS_CACHE = []; }
  }
  root.innerHTML = `
    <div class="card">
      <div class="bold" style="margin-bottom:6px">✏️ 新しいトレカを作成</div>
      <p class="hint-sm" style="font-size:12px; color:#6b7280">作成 → 本人に承認申請 → 承認されたらガチャの pool に入る。自分のカードは自動承認。</p>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">🎯 誰のカード?</div>
        <select id="tc-target" style="width:100%; padding:6px">
          ${MEMBERS_CACHE.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('')}
        </select>
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">💬 キャッチフレーズ (120 字まで)</div>
        <input type="text" id="tc-catch" maxlength="120" placeholder="例: 徹夜の帝王" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">💥 リアクション (60 字まで、決め台詞・掛け声)</div>
        <input type="text" id="tc-react" maxlength="60" placeholder="例: よっしゃ実験じゃい!" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">✨ レアリティ</div>
        <select id="tc-rarity" style="padding:6px">
          <option value="N">N  (よく出る)</option>
          <option value="R" selected>R  (普通)</option>
          <option value="SR">SR (激レア)</option>
          <option value="SSR">SSR (超激レア)</option>
        </select>
        <span class="hint-sm" style="font-size:11px; color:#6b7280">確率は N:60 / R:30 / SR:8 / SSR:2</span>
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">🖼 画像 URL (任意)</div>
        <input type="text" id="tc-img" maxlength="500" placeholder="/uploads/... または https://..." style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">🎨 背景色 (任意)</div>
        <input type="color" id="tc-bg" value="#67e8f9" style="width:80px; height:36px; padding:2px">
      </label>
      <div class="row" style="justify-content:flex-end; margin-top:8px">
        <button class="btn primary" id="tc-create-btn">📮 承認申請 (自分のカードは即公開)</button>
      </div>
      <div id="tc-create-preview" style="margin-top:12px"></div>
    </div>
  `;
  const refresh = () => {
    const targetId = parseInt(document.getElementById('tc-target').value, 10);
    const target = MEMBERS_CACHE.find(u => u.id === targetId);
    const preview = {
      rarity: document.getElementById('tc-rarity').value,
      catchphrase: document.getElementById('tc-catch').value,
      reaction_text: document.getElementById('tc-react').value,
      image_url: document.getElementById('tc-img').value || null,
      background_color: document.getElementById('tc-bg').value,
      target_name: target?.display_name || '',
      target_avatar: target?.avatar_url || null,
      creator_name: state.me?.display_name || '',
    };
    document.getElementById('tc-create-preview').innerHTML =
      `<div style="font-size:12px; color:#6b7280; margin-bottom:4px">プレビュー</div>
       <div style="max-width:200px">${cardHtml(preview)}</div>`;
  };
  ['tc-target','tc-catch','tc-react','tc-rarity','tc-img','tc-bg'].forEach(id => {
    document.getElementById(id).addEventListener('input', refresh);
    document.getElementById(id).addEventListener('change', refresh);
  });
  refresh();
  document.getElementById('tc-create-btn').addEventListener('click', async () => {
    const body = {
      target_user_id: parseInt(document.getElementById('tc-target').value, 10),
      catchphrase: document.getElementById('tc-catch').value.trim(),
      reaction_text: document.getElementById('tc-react').value.trim(),
      rarity: document.getElementById('tc-rarity').value,
      image_url: document.getElementById('tc-img').value.trim() || null,
      background_color: document.getElementById('tc-bg').value,
    };
    if (!body.target_user_id) { toast('対象を選んでね'); return; }
    const btn = document.getElementById('tc-create-btn');
    btn.disabled = true; btn.textContent = '⌛ 送信中…';
    try {
      const r = await post('/api/trading-cards', body);
      toast(r.card.status === 'approved' ? '自動承認され公開されました' : '本人へ承認申請を送りました');
      await switchTab('mine');
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '📮 承認申請 (自分のカードは即公開)'; }
  });
}
