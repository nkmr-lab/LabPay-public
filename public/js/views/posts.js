// /#/sns — シンプル SNS (旧 Twitter 風)。
// フォロー なし、 全員 が 全投稿 を 見る。 テキスト + 画像 + 位置 + @メンション。
// 返信 (parent_id)、 いいね (toggle) のみ。 リポスト なし。

import { get, post, del } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';

function fmtRelative(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return 'たった今';
  if (diff < 3600_000) return `${Math.floor(diff/60000)} 分前`;
  if (diff < 86400_000) return `${Math.floor(diff/3600000)} 時間前`;
  if (diff < 7*86400_000) return `${Math.floor(diff/86400_000)} 日前`;
  return dt.toLocaleDateString();
}

function renderBodyHtml(body) {
  // v467→v468 @mention は SNS 検索 / @LabPay 案内 へ リンク 化。 URL は 新タブ。
  let s = escapeHtml(body || '');
  s = s.replace(/@([\p{L}\p{N}_\-\.]{1,40})/gu, (_, name) =>
    `<a href="#/sns" class="hint" style="color:var(--primary); font-weight:600; text-decoration:none">@${escapeHtml(name)}</a>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\n/g, '<br>');
}

// v480 リアクション 3 種。 押し てる / 押し てない の 配色 だけ 変える。
const REACTIONS = [
  { kind: 'thumb', icon: '👍', activeColor: '#2563eb' },
  { kind: 'heart', icon: '❤️', activeColor: '#e11d48' },
  { kind: 'star',  icon: '⭐', activeColor: '#f59e0b' },
];

function reactionsHtml(p) {
  const mine = new Set(p.my_reactions || (p.liked_by_me ? ['heart'] : []));
  const counts = p.reaction_counts || { thumb: 0, heart: p.like_count || 0, star: 0 };
  return REACTIONS.map(r => {
    const on = mine.has(r.kind);
    const n = counts[r.kind] || 0;
    return `<a class="hint" data-react-post="${p.id}" data-react-kind="${r.kind}" style="cursor:pointer; ${on ? 'color:' + r.activeColor + '; font-weight:600' : 'opacity:0.7'}">${r.icon} ${n}</a>`;
  }).join('');
}

function postCard(p, opts = {}) {
  const meId = Number(state.me?.id);
  const isMine = p.user_id === meId;
  const canDelete = isMine || state.me?.role === 'admin';
  const replyHash = opts.skipReplyHash ? '' : `#/sns/${p.id}`;
  const loc = (p.lat !== null && p.lng !== null)
    ? `<a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank" rel="noopener" class="hint" style="font-size:11px">📍 地図</a>`
    : '';
  return `
    <div class="list-item" style="align-items:flex-start; gap:8px" data-post-id="${p.id}">
      ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
          <span class="bold">${escapeHtml(p.display_name)}</span>
          <span class="hint" style="font-size:11px">${fmtRelative(p.created_at)}</span>
          ${loc}
          ${canDelete ? `<button class="btn" data-del-post="${p.id}" style="margin-left:auto; font-size:11px; padding:2px 6px">削除</button>` : ''}
        </div>
        ${p.body ? `<div style="font-size:14px; line-height:1.5; margin-top:2px">${renderBodyHtml(p.body)}</div>` : ''}
        ${p.image_url ? `<img data-zoom-src="${escapeHtml(p.image_url)}" src="${escapeHtml(p.image_url)}" style="max-width:100%; max-height:300px; border-radius:8px; margin-top:6px; cursor:zoom-in">` : ''}
        <div class="row" style="gap:14px; margin-top:6px; font-size:12px">
          ${reactionsHtml(p)}
          ${replyHash ? `<a class="hint" href="${replyHash}">💬 ${p.reply_count}</a>` : ''}
        </div>
      </div>
    </div>`;
}

let postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
let postsPollTimer = null;
let postsKnownLatestId = 0;

// v480 SW の SWR 用 content キャッシュ から /api/posts* を 全部 抜く。
//   投稿直後 / リアクション 直後 に 呼ぶ。
async function invalidatePostsCache() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('labpay-content-v1');
    const keys = await cache.keys();
    await Promise.all(keys
      .filter(req => new URL(req.url).pathname.startsWith('/api/posts'))
      .map(req => cache.delete(req)));
  } catch (_) {}
}

// v480 自動 更新: 10 秒 ごと に /api/posts/latest_id だけ 叩いて、 値 が
//   大きくなって たら 一覧 を 取り直す。 タブ 非アクティブ 時 は 停止。
function startPostsPolling() {
  stopPostsPolling();
  postsPollTimer = setInterval(async () => {
    if (document.hidden) return;
    if (!document.getElementById('po-list')) { stopPostsPolling(); return; }
    try {
      const r = await get('/api/posts/latest_id');
      const lid = Number(r.latest_id || 0);
      if (lid > postsKnownLatestId && postsKnownLatestId > 0) {
        postsKnownLatestId = lid;
        await invalidatePostsCache();
        postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
        await loadMore(true);
      } else if (postsKnownLatestId === 0) {
        postsKnownLatestId = lid;
      }
    } catch (_) {}
  }, 10000);
}
function stopPostsPolling() {
  if (postsPollTimer) { clearInterval(postsPollTimer); postsPollTimer = null; }
}
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/sns')) stopPostsPolling();
});

export async function renderPosts() {
  postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
  const app = document.getElementById('app');
  app.innerHTML = `
    ${composerHtml(null)}
    <div id="po-list" class="list"></div>
    <div id="po-more" class="row center" style="gap:6px; margin-top:12px"></div>
  `;
  bindComposer(null);
  await loadMore();
  document.getElementById('po-more').addEventListener('click', loadMore);
  // v480 ポーリング 開始 (タイムライン に いる 間 だけ)。
  postsKnownLatestId = postsState.items[0]?.id || 0;
  startPostsPolling();
}

export async function renderPostDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/sns" class="hint">← タイムライン</a>
    </div>
    <div id="po-parent"><div class="muted">読み込み中…</div></div>
    ${composerHtml(id)}
    <div class="card" style="margin-top:12px">
      <h3 style="margin:0 0 6px">💬 返信 (<span id="po-reply-count">0</span>)</h3>
      <div id="po-replies" class="list"></div>
    </div>
  `;
  bindComposer(id);
  try {
    const d = await get('/api/posts/' + id);
    const parent = d.post;
    document.getElementById('po-parent').innerHTML = `
      <div class="card">${postCard(parent, { skipReplyHash: true })}</div>`;
    document.getElementById('po-reply-count').textContent = d.replies.length;
    document.getElementById('po-replies').innerHTML = d.replies.map(r => postCard(r, { skipReplyHash: true })).join('') || '<div class="empty">まだ 返信 なし</div>';
    bindRowHandlers();
  } catch (e) {
    document.getElementById('po-parent').innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function composerHtml(parentId) {
  const placeholder = parentId ? '返信を 書く…' : 'いま どうしてる?  @ で メンション (補完あり)。 LabPay へ 機能要望 / バグ報告 する 時は @LabPay 付けてね';
  return `
    <div class="card" style="position:relative">
      <textarea id="po-body" maxlength="2000" rows="3" placeholder="${escapeHtml(placeholder)}"></textarea>
      <div id="po-mention-pop" style="display:none; position:absolute; left:14px; right:14px; top:auto; z-index:50; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.12); max-height:240px; overflow:auto"></div>
      <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">
        <input type="file" id="po-img" accept="image/*" style="flex:1; min-width:140px">
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
          <input type="checkbox" id="po-loc"> 📍 現在地 を 添付
        </label>
        <button id="po-submit" class="primary" style="margin-left:auto" data-parent="${parentId || ''}">投稿</button>
      </div>
      <div class="hint-sm" id="po-img-status"></div>
    </div>`;
}

// v467 @ 補完 用 メンバー キャッシュ (タブ ライフタイム)。
let mentionCandidates = null;
async function loadMentionCandidates() {
  if (mentionCandidates) return mentionCandidates;
  try {
    const d = await get('/api/users');
    const users = (d.items || d) || [];
    mentionCandidates = users
      .filter(u => u.display_name)
      .map(u => ({ id: u.id, name: u.display_name, avatar: u.avatar_url }));
    // LabPay 公式 アカウント が API 上に いない 場合 でも 候補 に 出す
    if (!mentionCandidates.some(u => u.name === 'LabPay')) {
      mentionCandidates.unshift({ id: 0, name: 'LabPay', avatar: null });
    }
  } catch (_) { mentionCandidates = [{ id: 0, name: 'LabPay', avatar: null }]; }
  return mentionCandidates;
}

function bindMentionAutocomplete() {
  const ta  = document.getElementById('po-body');
  const pop = document.getElementById('po-mention-pop');
  if (!ta || !pop) return;
  let candidates = [];
  loadMentionCandidates().then(c => candidates = c);
  let selected = 0, matched = [];
  const close = () => { pop.style.display = 'none'; matched = []; };
  const refresh = () => {
    const v = ta.value;
    const pos = ta.selectionStart;
    // カーソル 前 の 直近 「@xxx」 を 拾う (空白 で 区切られる)
    const head = v.slice(0, pos);
    const m = head.match(/(?:^|\s)@([\p{L}\p{N}_\-\.]{0,40})$/u);
    if (!m) { close(); return; }
    if (!candidates.length) { close(); return; }
    const q = m[1].toLowerCase();
    matched = candidates.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
    if (!matched.length) { close(); return; }
    selected = Math.min(selected, matched.length - 1);
    pop.innerHTML = matched.map((c, i) => `
      <div data-mi="${i}" style="padding:8px 10px; cursor:pointer; ${i === selected ? 'background:#f5f3f7' : ''}; display:flex; align-items:center; gap:8px">
        ${c.avatar
          ? `<img src="${escapeHtml(c.avatar)}" alt="" style="flex:none; width:20px; height:20px; border-radius:50%; object-fit:cover">`
          : `<div style="flex:none; width:20px; height:20px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>`}
        <span style="font-size:13px">@${escapeHtml(c.name)}</span>
      </div>`).join('');
    // v468 textarea の 直下 に 出す。 height を 動的 に。
    pop.style.top = (ta.offsetTop + ta.offsetHeight + 2) + 'px';
    pop.style.display = 'block';
    pop.querySelectorAll('[data-mi]').forEach(el => {
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); commit(Number(el.dataset.mi)); });
    });
  };
  const commit = (idx) => {
    const c = matched[idx];
    if (!c) return;
    const v = ta.value;
    const pos = ta.selectionStart;
    const head = v.slice(0, pos);
    const tail = v.slice(pos);
    const newHead = head.replace(/(^|\s)@[\p{L}\p{N}_\-\.]*$/u, (_, pre) => `${pre}@${c.name} `);
    ta.value = newHead + tail;
    const newPos = newHead.length;
    ta.setSelectionRange(newPos, newPos);
    close();
    ta.focus();
  };
  ta.addEventListener('input', refresh);
  ta.addEventListener('keydown', (ev) => {
    if (pop.style.display !== 'block' || !matched.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); selected = (selected + 1) % matched.length; refresh(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); selected = (selected - 1 + matched.length) % matched.length; refresh(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      commit(selected);
    } else if (ev.key === 'Escape') { close(); }
  });
  document.addEventListener('click', (ev) => {
    if (!pop.contains(ev.target) && ev.target !== ta) close();
  }, { capture: true });
}

let composerImageUrl = null;
let composerCoords = null;
// v482 #69 位置情報 ON/OFF を 永続化 (一度 ON にしたら 以降 ON、 OFF にしたら 以降 OFF)。
const PO_LOC_PREF_KEY = 'labpay-sns-loc-pref';
function readLocPref() {
  try { return localStorage.getItem(PO_LOC_PREF_KEY) === 'on'; } catch { return false; }
}
function writeLocPref(on) {
  try { localStorage.setItem(PO_LOC_PREF_KEY, on ? 'on' : 'off'); } catch {}
}
function bindComposer(parentId) {
  composerImageUrl = null;
  composerCoords = null;
  bindMentionAutocomplete();  // v467 @ 補完
  const imgInput = document.getElementById('po-img');
  const imgStatus = document.getElementById('po-img-status');
  // v485 #79 アップロード 中 は 投稿 ボタン を disable する (待たず 押すと 画像 が
  //   付与 されない 問題 を 防ぐ)。 完了 か 失敗 で 元に 戻す。
  const submitBtn = document.getElementById('po-submit');
  imgInput?.addEventListener('change', async () => {
    const f = imgInput.files[0];
    if (!f) { composerImageUrl = null; imgStatus.textContent = ''; return; }
    imgStatus.textContent = '⏳ アップロード 中…';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.uploading = '1'; }
    const fd = new FormData();
    fd.append('file', f);
    try {
      const resp = await fetch('/api/uploads/image', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // server's error 形式 = {error:{code, message}}。 message を 取り出す。
        const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      composerImageUrl = j.url || j.path;
      imgStatus.innerHTML = `<span style="color:#0e7c63">✓ アップロード 完了</span>`;
    } catch (e) {
      imgStatus.textContent = '失敗: ' + (e?.message || e);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; delete submitBtn.dataset.uploading; }
    }
  });
  // v482 #69 起動時 に 前回 の 設定 を 復元。 ON だった なら 自動 で 位置 取得。
  const locChk = document.getElementById('po-loc');
  if (locChk && readLocPref()) {
    locChk.checked = true;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => { composerCoords = null; },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    }
  }
  document.getElementById('po-loc')?.addEventListener('change', (ev) => {
    writeLocPref(ev.target.checked);
    if (!ev.target.checked) { composerCoords = null; return; }
    if (!navigator.geolocation) { toast('位置情報 未対応'); ev.target.checked = false; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude };
               toast(`📍 位置 を 添付 (±${Math.round(p.coords.accuracy)}m)`); },
      (e) => { toast('位置 取得 失敗'); ev.target.checked = false; composerCoords = null; },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });
  document.getElementById('po-submit')?.addEventListener('click', async () => {
    const body = document.getElementById('po-body').value.trim();
    if (!body && !composerImageUrl) { toast('本文 か 画像 が 必要 です'); return; }
    const payload = {
      body,
      image_url: composerImageUrl || '',
      parent_id: parentId || null,
      lat: composerCoords?.lat ?? null,
      lng: composerCoords?.lng ?? null,
    };
    try {
      const r = await post('/api/posts', payload);
      toast('投稿しました');
      // v480 SW の SWR キャッシュ に 古い /api/posts が 残ってる と 次回 ホーム 等で
      //   1 拍 遅れる ので、 自分 が 投稿した タイミング で 強制 削除。
      await invalidatePostsCache();
      document.getElementById('po-body').value = '';
      document.getElementById('po-img').value = '';
      // v482 #69 位置情報 ON/OFF は 永続 設定 なので、 投稿後 も リセット しない。
      //   ただし 添付 された 座標 は 新しい 投稿 では 取り直し たい ので、 ON なら
      //   再 取得 する。
      composerImageUrl = null; composerCoords = null;
      const locChk = document.getElementById('po-loc');
      if (locChk && locChk.checked && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; },
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      }
      if (parentId) navigate(`#/sns/${parentId}`);
      else { postsState = { items: [], beforeId: 0, loading: false, atEnd: false }; await loadMore(true); }
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadMore(reset = false) {
  if (postsState.loading || (postsState.atEnd && !reset)) return;
  postsState.loading = true;
  if (reset) postsState.beforeId = 0;
  try {
    const q = postsState.beforeId > 0 ? { before_id: postsState.beforeId, limit: 30 } : { limit: 30 };
    const d = await get('/api/posts', q);
    const items = d.items || [];
    if (reset) {
      postsState.items = items;
      document.getElementById('po-list').innerHTML = items.map(p => postCard(p)).join('') || '<div class="empty">まだ 投稿 なし</div>';
    } else {
      postsState.items.push(...items);
      const html = items.map(p => postCard(p)).join('');
      document.getElementById('po-list').insertAdjacentHTML('beforeend', html);
    }
    if (items.length) postsState.beforeId = items[items.length - 1].id;
    if (items.length < 30) {
      postsState.atEnd = true;
      document.getElementById('po-more').innerHTML = '<span class="muted">これ で 全部 です</span>';
    } else {
      document.getElementById('po-more').innerHTML = '<button class="btn" id="po-load-next">もっと 見る</button>';
      document.getElementById('po-load-next').addEventListener('click', () => loadMore());
    }
    bindRowHandlers();
  } catch (e) { document.getElementById('po-list').insertAdjacentHTML('beforeend', `<div class="muted">${escapeHtml(e.message)}</div>`); }
  postsState.loading = false;
}

// v492 #92 画像 タップ で 全画面 ライトボックス を 開く。 別タブ で 開いて 戻れない
//   問題 を 回避。 × ボタン / 背景 タップ / Esc で 閉じる。 body スクロール ロック。
function openImageLightbox(src) {
  const old = document.getElementById('po-lightbox');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'po-lightbox';
  box.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; cursor:zoom-out';
  box.innerHTML = `
    <button id="po-lb-close" aria-label="閉じる"
            style="position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; font-size:22px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center">×</button>
    <img src="${src}" alt="" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:6px">`;
  document.body.appendChild(box);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    box.remove();
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.getElementById('po-lb-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    close();
  });
  box.addEventListener('click', (ev) => {
    // 画像 自体 を タップ し ても 閉じる (拡大 オーバーレイ の 通例)。
    if (ev.target.id !== 'po-lb-close') close();
  });
}

function bindRowHandlers() {
  document.querySelectorAll('[data-zoom-src]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      openImageLightbox(el.dataset.zoomSrc);
    });
  });
  document.querySelectorAll('[data-react-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      const id = el.dataset.reactPost;
      const kind = el.dataset.reactKind;
      const on = parseFloat(el.style.fontWeight || '0') >= 600;
      const method = on ? 'del' : 'post';
      try {
        const r = method === 'post'
          ? await post(`/api/posts/${id}/reaction?kind=${kind}`, {})
          : await del(`/api/posts/${id}/reaction?kind=${kind}`);
        // 押し てる kind の セット を 受け取って 該当 行 の 3 ボタン を 全部 再描画。
        const row = el.closest('[data-post-id]');
        if (!row) return;
        const mine = new Set(r.my_reactions || []);
        const counts = r.reaction_counts || {};
        row.querySelectorAll('[data-react-post="' + id + '"]').forEach(b => {
          const k = b.dataset.reactKind;
          const def = REACTIONS.find(x => x.kind === k);
          const isOn = mine.has(k);
          const n = counts[k] || 0;
          b.textContent = `${def.icon} ${n}`;
          b.style.cssText = `cursor:pointer; ${isOn ? 'color:' + def.activeColor + '; font-weight:600' : 'opacity:0.7'}`;
        });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  document.querySelectorAll('[data-del-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      if (!confirm('この 投稿 を 削除 しますか?')) return;
      try {
        await del(`/api/posts/${el.dataset.delPost}`);
        toast('削除しました');
        const row = el.closest('[data-post-id]');
        if (row) row.remove();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}
