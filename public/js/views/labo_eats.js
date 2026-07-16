// /#/labo-eats — ラーボーイーツ (研究室版 UBER EATS) v1123
//   依頼作成 → 引受 → 引渡 (item_cost 入力) → 受取確定 (依頼者支払)

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';

export async function renderLaboEats() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🍱 ラーボーイーツ</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        研究室にいる人が、外にいる人にご飯を「<b>ついで</b>」に買ってきてもらうサービス。<br>
        料金: <b>基本料 50pt + 距離 10pt/100m</b> (例: 700m → 50+70 = 120pt) + 商品代 (実費)
      </p>
    </div>
    <div class="card">
      <details>
        <summary style="cursor:pointer; font-weight:600">➕ 新しい依頼を出す</summary>
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px">
          <label><div style="font-size:12px; color:#6b7280">🍜 食べたいもの (必須)</div>
            <input type="text" id="le-food" maxlength="400" placeholder="例: 牛丼 (並盛) つゆだく" style="width:100%; padding:6px; box-sizing:border-box"></label>
          <label><div style="font-size:12px; color:#6b7280">🏪 お店ヒント (任意)</div>
            <input type="text" id="le-shop" maxlength="200" placeholder="例: 松屋、コンビニ何でも可" style="width:100%; padding:6px; box-sizing:border-box"></label>
          <label><div style="font-size:12px; color:#6b7280">📍 受け取り場所 (任意)</div>
            <input type="text" id="le-loc" maxlength="200" placeholder="例: 研究室 123 号室" style="width:100%; padding:6px; box-sizing:border-box"></label>
          <label><div style="font-size:12px; color:#6b7280">📏 お店までの距離 (m)</div>
            <input type="number" id="le-dist" min="0" max="5000" value="500" style="width:120px; padding:6px">
            <span class="hint-sm" id="le-fee-preview" style="font-size:12px; color:#7c3aed; margin-left:8px; font-weight:700"></span>
          </label>
          <label><div style="font-size:12px; color:#6b7280">💬 メモ (任意)</div>
            <textarea id="le-memo" rows="2" maxlength="500" style="width:100%; padding:6px; box-sizing:border-box"></textarea></label>
          <div class="row" style="justify-content:flex-end">
            <button class="btn primary" id="le-create">📨 依頼を投稿</button>
          </div>
        </div>
      </details>
    </div>
    <div id="le-list"><div class="muted">読み込み中…</div></div>
  `;
  const updatePreview = () => {
    const d = parseInt(document.getElementById('le-dist').value, 10) || 0;
    const fee = 50 + Math.ceil(d / 100) * 10;
    document.getElementById('le-fee-preview').textContent = `→ サービス料 ${fee}pt (基本 50 + 距離 ${Math.ceil(d/100)*10})`;
  };
  document.getElementById('le-dist').addEventListener('input', updatePreview);
  updatePreview();
  document.getElementById('le-create').addEventListener('click', createOrder);
  await loadList();
}

async function createOrder() {
  const body = {
    food_desc: document.getElementById('le-food').value.trim(),
    shop_hint: document.getElementById('le-shop').value.trim(),
    receive_location: document.getElementById('le-loc').value.trim(),
    distance_m: parseInt(document.getElementById('le-dist').value, 10) || 0,
    memo: document.getElementById('le-memo').value.trim(),
  };
  if (!body.food_desc) { toast('食べたいものを入れてね'); return; }
  const btn = document.getElementById('le-create');
  btn.disabled = true; btn.textContent = '⌛ 送信中…';
  try {
    await post('/api/labo-eats', body);
    toast('依頼を投稿しました');
    document.getElementById('le-food').value = '';
    document.getElementById('le-shop').value = '';
    document.getElementById('le-loc').value = '';
    document.getElementById('le-memo').value = '';
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '📨 依頼を投稿'; }
}

async function loadList() {
  const root = document.getElementById('le-list');
  try {
    const d = await get('/api/labo-eats');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<div class="card muted">まだ依頼がありません。上から作ってみよう。</div>'; return; }
    // グループ分け: 未受付 / 受付済 (自分関連) / 完了・キャンセル
    const open = items.filter(o => o.status === 'open');
    const active = items.filter(o => ['accepted','delivered'].includes(o.status));
    const done = items.filter(o => ['completed','cancelled'].includes(o.status));
    root.innerHTML = `
      ${open.length ? `<div class="card"><div class="bold" style="margin-bottom:6px">🍱 引受待ち (${open.length})</div>${open.map(orderCard).join('')}</div>` : ''}
      ${active.length ? `<div class="card"><div class="bold" style="margin-bottom:6px">⏳ 進行中 (${active.length})</div>${active.map(orderCard).join('')}</div>` : ''}
      ${done.length ? `<div class="card"><div class="bold" style="margin-bottom:6px">✅ 完了 / キャンセル (${done.length})</div>${done.map(orderCard).join('')}</div>` : ''}
    `;
    wireRows(root);
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

function orderCard(o) {
  const badge = {
    open: '<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:6px; font-size:11px">🍱 募集中</span>',
    accepted: '<span style="background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:6px; font-size:11px">🛒 買い出し中</span>',
    delivered: '<span style="background:#dbeafe; color:#1e40af; padding:1px 6px; border-radius:6px; font-size:11px">📦 受取待ち</span>',
    completed: '<span style="background:#e5e7eb; color:#4b5563; padding:1px 6px; border-radius:6px; font-size:11px">✅ 完了</span>',
    cancelled: '<span style="background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:6px; font-size:11px">キャンセル</span>',
  }[o.status] || '';
  const svcFee = o.base_fee + o.distance_fee;
  const canAccept  = o.status === 'open' && !o.is_requester;
  const canDeliver = o.status === 'accepted' && o.is_acceptor;
  const canComplete = o.status === 'delivered' && o.is_requester;
  const canCancel  = ['open','accepted'].includes(o.status) && (o.is_requester || o.is_acceptor);
  const priceLine = o.status === 'delivered' || o.status === 'completed'
    ? `<span style="font-weight:700; color:#7c3aed">合計 ${o.grand_total}pt</span> <span style="color:#6b7280">(サービス料 ${svcFee}pt + 商品代 ${o.item_cost}pt)</span>`
    : `<span style="color:#7c3aed">サービス料 ${svcFee}pt (基本 ${o.base_fee} + 距離 ${o.distance_fee})</span> + 商品代 (完了時精算)`;
  return `
    <div style="border-bottom:1px solid #f3f4f6; padding:8px 0; margin-bottom:6px">
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <div style="font-weight:700; font-size:15px; flex:1; min-width:180px">🍜 ${escapeHtml(o.food_desc)}</div>
        ${badge}
      </div>
      <div style="font-size:12px; color:#4b5563; margin-top:2px">
        ${o.shop_hint ? `🏪 ${escapeHtml(o.shop_hint)}<br>` : ''}
        ${o.receive_location ? `📍 ${escapeHtml(o.receive_location)}<br>` : ''}
        📏 ${o.distance_m}m ・ ${priceLine}
        ${o.memo ? `<br>💬 ${escapeHtml(o.memo)}` : ''}
      </div>
      <div style="font-size:11px; color:#6b7280; margin-top:4px">
        依頼: ${avatarHtml(o.requester_name, o.requester_avatar, 'xs')} ${escapeHtml(o.requester_name || '')}
        ${o.acceptor_name ? ` · 引受: ${avatarHtml(o.acceptor_name, o.acceptor_avatar, 'xs')} ${escapeHtml(o.acceptor_name)}` : ''}
      </div>
      <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap">
        ${canAccept   ? `<button class="btn primary" data-le-accept="${o.id}">🙋 引き受ける</button>` : ''}
        ${canDeliver  ? `<button class="btn primary" data-le-deliver="${o.id}" style="background:#7c3aed">📦 渡した (商品代入力)</button>` : ''}
        ${canComplete ? `<button class="btn primary" data-le-complete="${o.id}" style="background:#059669">✅ 受け取った (${o.grand_total}pt 支払)</button>` : ''}
        ${canCancel   ? `<button class="btn" data-le-cancel="${o.id}" style="color:#b91c1c">取消</button>` : ''}
      </div>
    </div>
  `;
}

function wireRows(root) {
  root.querySelectorAll('[data-le-accept]').forEach(el => {
    el.addEventListener('click', async () => {
      el.disabled = true;
      try { await post(`/api/labo-eats/${el.dataset.leAccept}/accept`, {}); toast('引き受けました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  root.querySelectorAll('[data-le-deliver]').forEach(el => {
    el.addEventListener('click', async () => {
      const cost = prompt('商品代 (実費、pt)。 0 でも OK:', '0');
      if (cost === null) return;
      const c = parseInt(cost, 10);
      if (isNaN(c) || c < 0) { toast('数値で入れてね'); return; }
      el.disabled = true;
      try { await post(`/api/labo-eats/${el.dataset.leDeliver}/deliver`, { item_cost: c }); toast('引渡完了 (依頼者の受取確認を待つ)'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  root.querySelectorAll('[data-le-complete]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('受け取り確定 → 全額を引受人に支払います。よい?')) return;
      el.disabled = true;
      try { await post(`/api/labo-eats/${el.dataset.leComplete}/complete`, {}); toast('支払完了!'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  root.querySelectorAll('[data-le-cancel]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('キャンセルします。よい?')) return;
      el.disabled = true;
      try { await post(`/api/labo-eats/${el.dataset.leCancel}/cancel`, {}); toast('取消しました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
}
