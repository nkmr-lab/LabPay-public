// /#/auctions — オークション MVP。 一覧 / 出品 / 詳細。
//   * 出品: タイトル + 説明 + 画像 + 最低価格 + 締切時刻
//   * 入札: 現在の最高 + 1 以上
//   * 締切: 自動で settle (lazy 集計、 lazy notify)
//   * 落札後の 円 移動は無し (LabPay pt は動かない)。 ラボ内 既知 前提で
//     連絡先は出さず、 出品者が 「請求を飛ばす」 ボタンで money_requests
//     を生成 → 落札者に通知 → 落札者は 普通の 請求 UI で 支払い済 をチェック。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';
import { fmtDateTime, tag, fmtRelative } from '../format.js';

// remainingText は 共有 fmtRelative に委譲 (取消 / 終了 ラベルは引数で指定)。
function remainingText(closes_at, settled, cancelled) {
  if (cancelled) return '取消';
  if (settled)   return '終了';
  return fmtRelative(closes_at, { expiredLabel: '締切超過' });
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
        ラボ内 オークション。 最高額入札者が落札。 落札後は 出品者の詳細画面から 「請求を飛ばす」 ボタンで 集金 (連絡先は 既知前提で 表示しません)。
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
      const wonBy = a.winner_user_id ? `落札: ${escapeHtml(a.winner_name)} (${a.winning_bid}円)` : '';
      const wonByMe = Number(a.winner_user_id) === meId;
      // v392: 旧コードは const tag = ... tag(...) で TDZ エラー (timers.js と
      // 同じ パターン)。 import の tag() ヘルパを呼べるよう ローカル名は
      // statusTag に rename。
      const statusTag = cancelled
        ? tag('muted', '取消')
        : settled
          ? (a.winner_user_id
              ? (wonByMe
                ? tag('ok', '🎉 落札済')
                : tag('muted', '終了'))
              : tag('muted', '入札0で終了'))
          : tag('ok', escapeHtml(remainingText(a.closes_at, false, false)));
      const topLine = active
        ? (a.top_bid ? `現在 ${a.top_bid}円 (${a.bid_count}件)` : `入札なし (最低 ${a.min_price}円)`)
        : (settled && a.winning_bid ? `${wonBy}` : '');
      const myBidLine = Number(a.my_bid_count) > 0 ? ' <span class="muted">·自分も入札</span>' : '';
      const img = a.image_url
        ? `<div class="cover-img" style="background-image:url('${escapeHtml(a.image_url)}')"></div>` : '';
      return `
        <a class="list-item with-cover" href="#/auctions/${a.id}">
          ${img}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(a.title)}</div>
            <div class="meta">${statusTag} · ${escapeHtml(topLine)}${myBidLine}${isMine ? ' <span class="muted">(自分の出品)</span>' : ''}</div>
            <div class="meta">出品 ${escapeHtml(a.seller_name)} · 締切 ${escapeHtml(fmtDateTime(a.closes_at))}</div>
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
        <label class="field grow"><span class="lbl">最低価格 (円)</span>
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
        <label class="field grow"><span class="lbl">金額 (円)</span>
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
    // v392: TDZ 回避 (旧名 tag を statusTag に rename。 import 済の tag() を
    // 同名 const がシャドウして 「Cannot access 'tag' before initialization」 を
    // 起こしていた)
    const statusTag = a.cancelled_at
      ? tag('muted', '取消')
      : a.settled_at
        ? (a.winner_user_id
            ? tag('ok', `🎉 落札: ${escapeHtml(a.winner_name)} (${a.winning_bid}円)`)
            : tag('muted', '入札 0 で終了'))
        : tag('ok', escapeHtml(remainingText(a.closes_at, false, false)));
    const img = a.image_url
      ? `<img src="${escapeHtml(a.image_url)}" alt="" style="display:block; max-width:100%; max-height:240px; border-radius:8px; object-fit:contain; margin:0 auto 8px">` : '';
    // v392: 連絡先表示は廃止 (ラボ内 既知前提)。 代わりに 落札後に
    //   - 出品者には 「💸 請求を飛ばす」 ボタン (落札者宛 money_request を生成)
    //   - 落札者には 「請求が届きしだい [請求] から 支払済 をマーク」 ヒント
    // を出す。
    let chargeBlock = '';
    if (a.settled_at && a.winner_user_id) {
      if (d.is_seller) {
        chargeBlock = `
          <div class="card" style="background:#fff8e6; margin-top:8px">
            <h4 style="margin:0 0 4px">💸 落札者に請求を飛ばす</h4>
            <div class="meta">${escapeHtml(a.winner_name)} さん宛に ¥${Number(a.winning_bid).toLocaleString()} 円の請求を作成 + 通知します。</div>
            <button id="aud-charge" class="primary" style="margin-top:6px">💸 ${escapeHtml(a.winner_name)} に ¥${Number(a.winning_bid).toLocaleString()} 円 請求</button>
          </div>`;
      } else if (d.is_winner) {
        chargeBlock = `
          <div class="card" style="background:#fff8e6; margin-top:8px">
            <h4 style="margin:0 0 4px">🎉 落札しました</h4>
            <div class="meta">出品者 ${escapeHtml(a.seller_name)} さんから ¥${Number(a.winning_bid).toLocaleString()} 円の請求が届きます。 届きしだい <a href="#/requests">[請求]</a> から 支払い済 をマークしてください。</div>
          </div>`;
      }
    }
    document.getElementById('aud-head').innerHTML = `
      ${img}
      <h2 style="margin:6px 0 0">${escapeHtml(a.title)} ${statusTag}</h2>
      <div class="meta" style="display:flex; gap:6px; align-items:center; margin-top:6px">
        ${avatarHtml(a.seller_name, a.seller_avatar_url, 'sm')}
        ${escapeHtml(a.seller_name)} · 締切 ${escapeHtml(fmtDateTime(a.closes_at))}
      </div>
      ${a.description ? `<div style="white-space:pre-wrap; margin-top:8px">${escapeHtml(a.description)}</div>` : ''}
      <div class="row" style="margin-top:10px; gap:14px">
        <div><span class="muted">最低</span> ${a.min_price}円</div>
        <div><span class="muted">現在最高</span> ${d.top_bid ?? '—'}円</div>
        <div><span class="muted">入札</span> ${d.bids.length}件</div>
      </div>
      ${chargeBlock}
    `;
    // 落札者宛 請求 を生成。 creator は呼び出し元 (= 出品者本人) なので
    // creator_user_id は省略。
    document.getElementById('aud-charge')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (!confirm(`${a.winner_name} さんに ¥${Number(a.winning_bid).toLocaleString()} 円の請求を作成 + 通知しますか?`)) return;
      btn.disabled = true;
      try {
        const created = await post('/api/money-requests', {
          title: `🏷 落札: ${a.title}`,
          memo: `オークション「${a.title}」の 落札 (¥${Number(a.winning_bid).toLocaleString()} 円) の集金です。`,
          recipients: [{ user_id: Number(a.winner_user_id), amount_yen: Number(a.winning_bid) }],
        });
        toast('請求を作成しました');
        navigate('#/requests/' + created.id);
      } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; }
    });
    // 入札 UI
    const bidCard = document.getElementById('aud-bid-card');
    if (active && !isMine) {
      bidCard.hidden = false;
      const min = Math.max((d.top_bid || 0) + 1, a.min_price);
      document.getElementById('aud-amt').min = min;
      document.getElementById('aud-amt').value = min;
      document.getElementById('aud-bid-hint').textContent =
        `${min}円 以上で入札可能。 入札後の取消はできません。`;
      document.getElementById('aud-bid-go').addEventListener('click', async () => {
        const amount = Number(document.getElementById('aud-amt').value);
        if (!(amount > 0)) { toast('金額を入れてください'); return; }
        if (!confirm(`${amount}円 で入札しますか? (取消不可)`)) return;
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
                <div class="bold">${escapeHtml(b.bidder_name)}${i === 0 && active ? ' ' + tag('ok', '最高') : ''}</div>
                <div class="meta">${escapeHtml(fmtDateTime(b.created_at))}</div>
              </div>
            </div>
            <div class="bold text-primary">${b.amount}円</div>
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
