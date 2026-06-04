// /#/auctions — オークション MVP。 一覧 / 出品 / 詳細。
//   * 出品: タイトル + 説明 + 画像 + 最低価格 + 締切時刻
//   * 入札: 現在の最高 + 1 以上
//   * 締切: 自動で settle (lazy 集計、 lazy notify)
//   * 落札後の pt 移動は無し。 落札者/出品者 同士で連絡先を見せて 本人同士 やり取り

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';

function fmtJP(s) {
  return s ? String(s).replace(' ', ' ').slice(0, 16) : '';
}
function remainingText(closes_at, settled, cancelled) {
  if (cancelled) return '取消';
  if (settled)   return '終了';
  const t = new Date(String(closes_at).replace(' ', 'T'));
  const diff = t - new Date();
  if (diff <= 0) return '締切超過';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `あと ${min} 分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと ${h}時間${min % 60}分`;
  return `あと ${Math.floor(h / 24)} 日`;
}

export async function renderAuctions() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">🏷 オークション</h2>
        <a class="btn primary" href="#/auctions/new">＋ 出品</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        ラボ内 オークション。 最高額入札者が落札。 落札後は連絡先を交換して 本人同士でやり取り。
      </p>
    </div>
    <div id="au-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/auctions');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('au-list').innerHTML = '<div class="empty">出品はまだありません</div>';
      return;
    }
    document.getElementById('au-list').innerHTML = items.map(a => {
      const settled = !!a.settled_at;
      const cancelled = !!a.cancelled_at;
      const active = !settled && !cancelled;
      const meId = Number(state.me?.id);
      const isMine = Number(a.seller_user_id) === meId;
      const wonBy = a.winner_user_id ? `落札: ${escapeHtml(a.winner_name)} (${a.winning_bid}pt)` : '';
      const wonByMe = Number(a.winner_user_id) === meId;
      const tag = cancelled
        ? '<span class="tag" style="background:#eee">取消</span>'
        : settled
          ? (a.winner_user_id
              ? (wonByMe
                ? '<span class="tag ok">🎉 落札済</span>'
                : '<span class="tag" style="background:#eee">終了</span>')
              : '<span class="tag" style="background:#eee">入札0で終了</span>')
          : `<span class="tag" style="background:#e8f5e9; color:#2e7d32">${escapeHtml(remainingText(a.closes_at, false, false))}</span>`;
      const topLine = active
        ? (a.top_bid ? `現在 ${a.top_bid}pt (${a.bid_count}件)` : `入札なし (最低 ${a.min_price}pt)`)
        : (settled && a.winning_bid ? `${wonBy}` : '');
      const myBidLine = Number(a.my_bid_count) > 0 ? ' <span class="muted">·自分も入札</span>' : '';
      const img = a.image_url
        ? `<div class="cover-img" style="background-image:url('${escapeHtml(a.image_url)}')"></div>` : '';
      return `
        <a class="list-item with-cover" href="#/auctions/${a.id}">
          ${img}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.title)}</div>
            <div class="meta">${tag} · ${escapeHtml(topLine)}${myBidLine}${isMine ? ' <span class="muted">(自分の出品)</span>' : ''}</div>
            <div class="meta">出品 ${escapeHtml(a.seller_name)} · 締切 ${escapeHtml(fmtJP(a.closes_at))}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('au-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderAuctionNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/auctions" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">🏷 出品</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="aun-title" maxlength="200" placeholder="例: 使わなくなったキーボード">
      </label>
      <label class="field"><span class="lbl">説明 (任意)</span>
        <textarea id="aun-desc" rows="4" maxlength="5000" placeholder="状態・受渡し方法など"></textarea>
      </label>
      <label class="field"><span class="lbl">画像 (任意)</span>
        <input type="file" id="aun-img-file" accept="image/*">
        <input type="hidden" id="aun-img-url" value="">
        <img id="aun-img-prev" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
        <span id="aun-img-st" class="hint-sm"></span>
      </label>
      <div class="row" style="gap:6px">
        <label class="field grow"><span class="lbl">最低価格 (pt)</span>
          <input type="number" id="aun-min" min="1" step="1" value="100">
        </label>
        <label class="field grow"><span class="lbl">締切時刻 (1分後〜14日以内)</span>
          <input type="datetime-local" id="aun-when">
        </label>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <a href="#/auctions" class="btn">キャンセル</a>
        <button id="aun-save" class="primary">出品する</button>
      </div>
    </div>
  `;
  // デフォ 締切: 3 日後 18:00
  const def = new Date(Date.now() + 3 * 24 * 3600_000);
  def.setHours(18, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('aun-when').value =
    `${def.getFullYear()}-${pad(def.getMonth()+1)}-${pad(def.getDate())}T${pad(def.getHours())}:${pad(def.getMinutes())}`;
  document.getElementById('aun-img-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('aun-img-st');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('aun-img-url').value = data.url;
      const prev = document.getElementById('aun-img-prev');
      prev.src = data.url; prev.hidden = false;
      st.textContent = '✓ 完了';
    } catch (e) { st.textContent = '失敗: ' + e.message; }
  });
  document.getElementById('aun-save').addEventListener('click', async () => {
    const title = document.getElementById('aun-title').value.trim();
    const description = document.getElementById('aun-desc').value.trim() || null;
    const image_url = document.getElementById('aun-img-url').value || null;
    const min_price = Number(document.getElementById('aun-min').value) || 1;
    const closes_at = document.getElementById('aun-when').value;
    if (!title) { toast('タイトル必須'); return; }
    if (!closes_at) { toast('締切時刻必須'); return; }
    try {
      const r = await post('/api/auctions', { title, description, image_url, min_price, closes_at });
      toast('出品しました');
      navigate('#/auctions/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderAuctionDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/auctions" class="hint">← 一覧</a>
      <div id="aud-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card" id="aud-bid-card" hidden>
      <h3 style="margin:0">入札</h3>
      <div id="aud-bid-hint" class="hint" style="margin:4px 0"></div>
      <div class="row" style="gap:6px; align-items:flex-end">
        <label class="field grow"><span class="lbl">金額 (pt)</span>
          <input type="number" id="aud-amt" min="1" step="1">
        </label>
        <button id="aud-bid-go" class="primary">入札する</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">入札履歴 (<span id="aud-bn">0</span>)</h3>
      <div id="aud-bids" class="list"></div>
    </div>
    <div class="card" id="aud-admin" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="aud-cancel" class="btn">❌ 取消</button>
        <button id="aud-del" class="danger">削除</button>
      </div>
    </div>
  `;
  try {
    const d = await get('/api/auctions/' + id);
    const a = d.auction;
    const active = !a.settled_at && !a.cancelled_at;
    const meId = Number(state.me?.id);
    const isMine = Number(a.seller_user_id) === meId;
    const tag = a.cancelled_at
      ? '<span class="tag" style="background:#eee">取消</span>'
      : a.settled_at
        ? (a.winner_user_id
            ? `<span class="tag ok">🎉 落札: ${escapeHtml(a.winner_name)} (${a.winning_bid}pt)</span>`
            : '<span class="tag" style="background:#eee">入札 0 で終了</span>')
        : `<span class="tag" style="background:#e8f5e9; color:#2e7d32">${escapeHtml(remainingText(a.closes_at, false, false))}</span>`;
    const img = a.image_url
      ? `<img src="${escapeHtml(a.image_url)}" alt="" style="display:block; max-width:100%; max-height:240px; border-radius:8px; object-fit:contain; margin:0 auto 8px">` : '';
    // 連絡先 (出品者 ↔ 落札者 のみ)
    let contactBlock = '';
    if (a.settled_at && a.winner_user_id) {
      const sl = a.winner_slack ? `Slack: <span class="mono">${escapeHtml(a.winner_slack)}</span>` : '';
      const ph = a.winner_phone ? `📞 <a href="tel:${escapeHtml(a.winner_phone)}">${escapeHtml(a.winner_phone)}</a>` : '';
      const sl2 = a.seller_slack ? `Slack: <span class="mono">${escapeHtml(a.seller_slack)}</span>` : '';
      const ph2 = a.seller_phone ? `📞 <a href="tel:${escapeHtml(a.seller_phone)}">${escapeHtml(a.seller_phone)}</a>` : '';
      if (d.is_seller && (sl || ph)) {
        contactBlock = `<div class="card" style="background:#fff8e6; margin-top:8px"><h4 style="margin:0">落札者 連絡先</h4><div>${escapeHtml(a.winner_name)} ${[sl, ph].filter(Boolean).join(' / ')}</div></div>`;
      } else if (d.is_winner && (sl2 || ph2)) {
        contactBlock = `<div class="card" style="background:#fff8e6; margin-top:8px"><h4 style="margin:0">出品者 連絡先</h4><div>${escapeHtml(a.seller_name)} ${[sl2, ph2].filter(Boolean).join(' / ')}</div></div>`;
      } else if (d.is_seller || d.is_winner) {
        contactBlock = `<div class="hint" style="margin-top:6px">相手の連絡先 (Slack / 電話) は 「設定」 → プロフィール 欄に登録があれば自動表示されます。</div>`;
      }
    }
    document.getElementById('aud-head').innerHTML = `
      ${img}
      <h2 style="margin:6px 0 0">${escapeHtml(a.title)} ${tag}</h2>
      <div class="meta" style="display:flex; gap:6px; align-items:center; margin-top:6px">
        ${avatarHtml(a.seller_name, a.seller_avatar_url, 'sm')}
        ${escapeHtml(a.seller_name)} · 締切 ${escapeHtml(fmtJP(a.closes_at))}
      </div>
      ${a.description ? `<div style="white-space:pre-wrap; margin-top:8px">${escapeHtml(a.description)}</div>` : ''}
      <div class="row" style="margin-top:10px; gap:14px">
        <div><span class="muted">最低</span> ${a.min_price}pt</div>
        <div><span class="muted">現在最高</span> ${d.top_bid ?? '—'}pt</div>
        <div><span class="muted">入札</span> ${d.bids.length}件</div>
      </div>
      ${contactBlock}
    `;
    // 入札 UI
    const bidCard = document.getElementById('aud-bid-card');
    if (active && !isMine) {
      bidCard.hidden = false;
      const min = Math.max((d.top_bid || 0) + 1, a.min_price);
      document.getElementById('aud-amt').min = min;
      document.getElementById('aud-amt').value = min;
      document.getElementById('aud-bid-hint').textContent =
        `${min}pt 以上で入札可能。 入札後の取消はできません。`;
      document.getElementById('aud-bid-go').addEventListener('click', async () => {
        const amount = Number(document.getElementById('aud-amt').value);
        if (!(amount > 0)) { toast('金額を入れてください'); return; }
        if (!confirm(`${amount}pt で入札しますか? (取消不可)`)) return;
        try { await post(`/api/auctions/${id}/bids`, { amount }); toast('入札しました'); await renderAuctionDetail({ params: { id } }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    } else if (active && isMine) {
      bidCard.hidden = false;
      document.getElementById('aud-bid-hint').textContent = '自分の出品には入札できません';
      document.getElementById('aud-bid-go').disabled = true;
      document.getElementById('aud-amt').disabled = true;
    }
    document.getElementById('aud-bn').textContent = d.bids.length;
    document.getElementById('aud-bids').innerHTML = d.bids.length
      ? d.bids.map((b, i) => `
          <div class="list-item">
            <div class="grow" style="display:flex; gap:8px; align-items:center">
              ${avatarHtml(b.bidder_name, b.bidder_avatar_url, 'sm')}
              <div>
                <div class="bold">${escapeHtml(b.bidder_name)}${i === 0 && active ? ' <span class="tag" style="background:#e8f5e9; color:#2e7d32">最高</span>' : ''}</div>
                <div class="meta">${escapeHtml(fmtJP(b.created_at))}</div>
              </div>
            </div>
            <div class="bold text-primary">${b.amount}pt</div>
          </div>`).join('')
      : '<div class="empty">まだ入札はありません</div>';
    // 管理操作
    if (isMine || state.me?.role === 'admin') {
      const admin = document.getElementById('aud-admin');
      admin.hidden = false;
      const cBtn = document.getElementById('aud-cancel');
      cBtn.disabled = !active;
      cBtn.addEventListener('click', async () => {
        if (!confirm('出品を取消します。 入札者全員に通知が飛びます。')) return;
        try { await patch(`/api/auctions/${id}/cancel`, {}); toast('取消しました'); await renderAuctionDetail({ params: { id } }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('aud-del').addEventListener('click', async () => {
        if (!confirm('完全に削除します (入札履歴も)。 戻せません。 良いですか?')) return;
        try { await del('/api/auctions/' + id); toast('削除しました'); navigate('#/auctions'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('aud-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
