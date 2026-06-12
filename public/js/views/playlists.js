// /#/playlists — 音楽 / 動画 プレイリスト。
//   * 作成者: タイトル + カバー + ジャンル + 公開/非公開 + アイテム N 件
//   * アイテム: URL (YouTube / Spotify / 動画ファイル / 他) + メモ + 並び替え
//   * 閲覧者: ⭐ 1-5 評価 + コメント + プレイリスト ❤️ お気に入り
//   * 再生: 内部 iframe 埋込 + 「次へ / シャッフル / オートプレイ (next 自動)」

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';
import { fmtRelative, tag } from '../format.js';

// v543 #200 「ボカロ」 を 追加
const GENRES = ['J-POP','洋楽','K-POP','アニメ','ボカロ','ジャズ','クラシック','ロック',
  'EDM','ヒップホップ','VTuber','作業用 BGM','その他'];

// ─────────────── URL → embed src 解決 ───────────────
function parseUrlMeta(url) {
  const u = String(url || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return {
    type: 'youtube', id: yt[1],
    embed: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&enablejsapi=1`,
    thumb: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`,
  };
  const sp = u.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  if (sp) return {
    type: 'spotify_' + sp[1], id: sp[2],
    embed: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`,
    thumb: null,
  };
  if (/\.(mp4|webm|m4v|ogg|mov)(\?|$)/i.test(u)) {
    return { type: 'direct_video', id: null, embed: null, thumb: null };
  }
  return { type: 'other', id: null, embed: null, thumb: null };
}

function defaultThumb(it) {
  if (it.thumbnail_url) return it.thumbnail_url;
  if (it.source_type === 'youtube' && it.source_id) {
    return `https://img.youtube.com/vi/${it.source_id}/hqdefault.jpg`;
  }
  return null;
}

// ─────────────── List view ───────────────
export async function renderPlaylists() {
  const app = document.getElementById('app');
  const savedQ = localStorage.getItem('labpay-pl-q') || '';
  const savedG = localStorage.getItem('labpay-pl-genre') || '';
  const savedMine = localStorage.getItem('labpay-pl-mine') === '1';
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">🎵 プレイリスト</h2>
        <a class="btn primary" href="#/playlists/new">＋ 作成</a>
      </div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <input type="search" id="pl-q" value="${escapeHtml(savedQ)}" placeholder="タイトル / 説明 を 検索" style="flex:1; min-width:160px">
        <select id="pl-genre" style="min-width:120px">
          <option value="">ジャンル すべて</option>
          ${GENRES.map(g => `<option value="${escapeHtml(g)}" ${savedG === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
        </select>
        <label class="muted" style="display:inline-flex; align-items:center; gap:4px; font-size:13px">
          <input type="checkbox" id="pl-mine" ${savedMine ? 'checked' : ''}> 自分の だけ
        </label>
      </div>
    </div>
    <div id="pl-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  const reload = () => {
    localStorage.setItem('labpay-pl-q', document.getElementById('pl-q').value);
    localStorage.setItem('labpay-pl-genre', document.getElementById('pl-genre').value);
    localStorage.setItem('labpay-pl-mine', document.getElementById('pl-mine').checked ? '1' : '0');
    loadPlList();
  };
  document.getElementById('pl-q').addEventListener('input', debounce(reload, 300));
  document.getElementById('pl-genre').addEventListener('change', reload);
  document.getElementById('pl-mine').addEventListener('change', reload);
  await loadPlList();
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function loadPlList() {
  const root = document.getElementById('pl-list');
  if (!root) return;
  try {
    const q     = document.getElementById('pl-q').value.trim();
    const genre = document.getElementById('pl-genre').value;
    const mine  = document.getElementById('pl-mine').checked;
    const params = {};
    if (q)     params.q = q;
    if (genre) params.genre = genre;
    if (mine)  params.mine = 1;
    const d = await get('/api/playlists', params);
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ プレイリスト は ありません</div>`;
      return;
    }
    root.innerHTML = items.map(p => {
      // v521 #157 サムネ優先
      const cBg = p.cover_image_thumb || p.cover_image_url;
      const cover = cBg
        ? `<div class="cover-img" style="background-image:url('${escapeHtml(cBg)}')"></div>`
        : `<div class="cover-img" style="background:linear-gradient(135deg, #fce4ec, #e1bee7); display:flex; align-items:center; justify-content:center; font-size:24px">🎵</div>`;
      const visTag = p.visibility === 'private' ? `<span class="tag muted" style="font-size:10px">🔒 非公開</span>` : '';
      const genreTag = p.genre_tag ? `<span class="tag" style="font-size:10px; background:#e1bee7; color:#4a106d">${escapeHtml(p.genre_tag)}</span>` : '';
      const heart = p.i_liked ? '❤️' : '🤍';
      return `
        <a class="list-item with-cover" href="#/playlists/${p.id}">
          ${cover}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)} ${visTag} ${genreTag}</div>
            <div class="meta" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
              ${avatarHtml(p.creator_name, p.creator_avatar_url, 'xs')}
              ${escapeHtml(p.creator_name)} · ${p.item_count} 曲 · 👁 ${p.view_count} · ${heart} ${p.like_count}
            </div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─────────────── New ───────────────
export async function renderPlaylistNew() {
  const app = document.getElementById('app');
  app.innerHTML = renderPlaylistForm({ mode: 'new' });
  wirePlaylistForm({ mode: 'new' });
}

export async function renderPlaylistEdit({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  try {
    const p = await get('/api/playlists/' + id);
    if (!p.is_mine) { toast('編集権限がありません'); navigate('#/playlists/' + id); return; }
    app.innerHTML = renderPlaylistForm({ mode: 'edit', p });
    wirePlaylistForm({ mode: 'edit', id, p });
  } catch (e) { toast('失敗: ' + e.message); }
}

function renderPlaylistForm({ mode, p }) {
  const isEdit = mode === 'edit';
  return `
    <div class="card">
      <a href="${isEdit ? '#/playlists/' + p.id : '#/playlists'}" class="hint">← 戻る</a>
      <h2 style="margin:6px 0 0">${isEdit ? '✏️ プレイリスト編集' : '🎵 新規 プレイリスト'}</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="pln-title" maxlength="200" placeholder="例: 朝の作業 BGM"
               value="${escapeHtml(p?.title || '')}">
      </label>
      <label class="field"><span class="lbl">説明 (任意)</span>
        <textarea id="pln-desc" rows="3" maxlength="5000" placeholder="ひと言コメント">${escapeHtml(p?.description || '')}</textarea>
      </label>
      <label class="field"><span class="lbl">カバー画像 (任意)</span>
        <input type="file" id="pln-img-file" accept="image/*">
        <input type="hidden" id="pln-img-url" value="${escapeHtml(p?.cover_image_url || '')}">
        <img id="pln-img-prev" alt="" ${p?.cover_image_url ? `src="${escapeHtml(p.cover_image_url)}"` : 'hidden'}
             style="max-width:180px; max-height:120px; margin-top:6px; border-radius:8px; object-fit:cover; display:${p?.cover_image_url ? 'block' : 'none'}">
        <span id="pln-img-st" class="hint-sm"></span>
      </label>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <label class="field grow"><span class="lbl">ジャンル</span>
          <select id="pln-genre">
            <option value="">— 未指定 —</option>
            ${GENRES.map(g => `<option value="${escapeHtml(g)}" ${p?.genre_tag === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
          </select>
        </label>
        <label class="field grow"><span class="lbl">公開設定</span>
          <select id="pln-vis">
            <option value="public" ${(p?.visibility || 'public') === 'public' ? 'selected' : ''}>🌐 公開 (ラボ全員)</option>
            <option value="private" ${p?.visibility === 'private' ? 'selected' : ''}>🔒 非公開 (自分のみ)</option>
          </select>
        </label>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; flex-wrap:wrap">
        ${isEdit ? `<button id="pln-delete" class="danger">削除</button>` : ''}
        <a href="${isEdit ? '#/playlists/' + p.id : '#/playlists'}" class="btn">キャンセル</a>
        <button id="pln-save" class="primary">${isEdit ? '保存' : '作成'}</button>
      </div>
    </div>`;
}

function wirePlaylistForm({ mode, id, p }) {
  document.getElementById('pln-img-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('pln-img-st');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('pln-img-url').value = data.url;
      const prev = document.getElementById('pln-img-prev');
      prev.src = data.url; prev.hidden = false; prev.style.display = 'block';
      st.textContent = '✓ 完了';
    } catch (e) { st.textContent = '失敗: ' + e.message; }
  });
  document.getElementById('pln-save').addEventListener('click', async () => {
    const body = {
      title:           document.getElementById('pln-title').value.trim(),
      description:     document.getElementById('pln-desc').value.trim() || null,
      cover_image_url: document.getElementById('pln-img-url').value || null,
      genre_tag:       document.getElementById('pln-genre').value || null,
      visibility:      document.getElementById('pln-vis').value,
    };
    if (!body.title) { toast('タイトル必須'); return; }
    try {
      if (mode === 'new') {
        const r = await post('/api/playlists', body);
        toast('作成しました');
        navigate('#/playlists/' + r.id);
      } else {
        await patch('/api/playlists/' + id, body);
        toast('保存しました');
        navigate('#/playlists/' + id);
      }
    } catch (e) { toast('失敗: ' + e.message); }
  });
  if (mode === 'edit') {
    document.getElementById('pln-delete')?.addEventListener('click', async () => {
      if (!confirm('このプレイリストを 削除します。 アイテム + 評価 + ❤️ もすべて消えます。 良いですか?')) return;
      try { await del('/api/playlists/' + id); toast('削除しました'); navigate('#/playlists'); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
}

// ─────────────── Detail ───────────────
let detailState = null;  // { pid, items, currentIdx, shuffle, autoNext, shuffleOrder }

export async function renderPlaylistDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/playlists" class="hint">← 一覧</a>
      <div id="pld-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card" id="pld-player-card" hidden>
      <div id="pld-player"></div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap; align-items:center">
        <button id="pld-prev" class="btn">⏮ 前</button>
        <button id="pld-next" class="btn">⏭ 次</button>
        <label class="muted" style="font-size:13px; display:inline-flex; align-items:center; gap:4px">
          <input type="checkbox" id="pld-shuffle"> 🔀 シャッフル
        </label>
        <label class="muted" style="font-size:13px; display:inline-flex; align-items:center; gap:4px">
          <input type="checkbox" id="pld-auto"> ▶ 連続再生 (YouTube)
        </label>
        <button id="pld-close" class="btn" style="margin-left:auto">✕ 閉じる</button>
      </div>
      <div id="pld-now" class="meta" style="margin-top:6px"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">アイテム (<span id="pld-cnt">0</span>)</h3>
      <div id="pld-items" class="list"></div>
      <div id="pld-add" hidden style="margin-top:8px"></div>
    </div>
  `;
  await loadPlDetail(id);
}

async function loadPlDetail(id) {
  try {
    const p = await get('/api/playlists/' + id);
    renderDetailHead(p);
    renderDetailItems(p);
    if (p.is_mine) {
      const root = document.getElementById('pld-add');
      root.hidden = false;
      root.innerHTML = `
        <details class="card collapsible-form" style="margin:0">
          <summary>＋ アイテムを追加</summary>
          <div style="margin-top:8px">
            <label class="field"><span class="lbl">URL (YouTube / Spotify / 動画 mp4 / その他)</span>
              <input type="url" id="pla-url" maxlength="2000" placeholder="https://youtu.be/...">
            </label>
            <label class="field"><span class="lbl">タイトル</span>
              <input type="text" id="pla-title" maxlength="300" placeholder="例: 米津玄師 - Lemon">
            </label>
            <label class="field"><span class="lbl">1 行メモ (任意)</span>
              <input type="text" id="pla-memo" maxlength="500" placeholder="ここがアツい!">
            </label>
            <button id="pla-add" class="primary">追加</button>
          </div>
        </details>`;
      document.getElementById('pla-add').addEventListener('click', async () => {
        const url = document.getElementById('pla-url').value.trim();
        const title = document.getElementById('pla-title').value.trim();
        const memo = document.getElementById('pla-memo').value.trim() || null;
        if (!url || !title) { toast('URL と タイトル を 入れてください'); return; }
        try {
          await post(`/api/playlists/${id}/items`, { url, title, memo });
          document.getElementById('pla-url').value = '';
          document.getElementById('pla-title').value = '';
          document.getElementById('pla-memo').value = '';
          toast('追加しました');
          await loadPlDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    }
  } catch (e) {
    document.getElementById('pld-head').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderDetailHead(p) {
  // v521 #157 詳細ヒーローもサムネ優先
  const heroSrc = p.cover_image_thumb || p.cover_image_url;
  const cover = heroSrc
    ? `<img src="${escapeHtml(heroSrc)}" alt="" loading="lazy" decoding="async"
            style="display:block; max-width:280px; max-height:200px; margin:0 auto 8px; border-radius:10px; object-fit:cover">`
    : '';
  const heart = p.i_liked ? '❤️' : '🤍';
  const visTag = p.visibility === 'private' ? '<span class="tag muted">🔒 非公開</span>' : '<span class="tag ok">🌐 公開</span>';
  const genreTag = p.genre_tag ? `<span class="tag" style="background:#e1bee7; color:#4a106d">${escapeHtml(p.genre_tag)}</span>` : '';
  document.getElementById('pld-head').innerHTML = `
    ${cover}
    <h2 style="margin:0">${escapeHtml(p.title)} ${visTag} ${genreTag}</h2>
    <div class="meta" style="display:flex; gap:6px; align-items:center; margin-top:6px; flex-wrap:wrap">
      ${avatarHtml(p.creator_name, p.creator_avatar_url, 'sm')}
      ${escapeHtml(p.creator_name)} · 👁 ${p.view_count} 回 · 🎵 ${p.items.length} 曲
    </div>
    ${p.description ? `<div style="white-space:pre-wrap; margin-top:8px">${escapeHtml(p.description)}</div>` : ''}
    <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap">
      <button id="pld-like" class="btn">${heart} ${p.like_count} お気に入り</button>
      <button id="pld-play0" class="primary" ${p.items.length ? '' : 'disabled'}>▶ 再生</button>
      <button id="pld-shuffle0" class="btn" ${p.items.length ? '' : 'disabled'}>🔀 シャッフル再生</button>
      ${p.is_mine ? `<a class="btn" href="#/playlists/${p.id}/edit">✏️ 編集</a>` : ''}
    </div>`;
  document.getElementById('pld-like').addEventListener('click', async () => {
    try {
      const r = await post(`/api/playlists/${p.id}/like`, {});
      toast(r.liked ? '❤️ お気に入りに追加' : '🤍 取消');
      await loadPlDetail(p.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('pld-play0').addEventListener('click', () => startPlayback(p, 0, false));
  document.getElementById('pld-shuffle0').addEventListener('click', () => startPlayback(p, 0, true));
}

function renderDetailItems(p) {
  const root = document.getElementById('pld-items');
  document.getElementById('pld-cnt').textContent = p.items.length;
  if (!p.items.length) {
    root.innerHTML = `<div class="empty">${p.is_mine ? '↓ 下の 「＋ アイテムを追加」 から URL を 追加してください' : 'アイテムはまだ ありません'}</div>`;
    return;
  }
  root.innerHTML = p.items.map((it, idx) => renderItemRow(it, idx, p)).join('');
  // wire each row
  p.items.forEach((it, idx) => {
    document.getElementById(`pli-play-${it.id}`)?.addEventListener('click', (ev) => {
      ev.preventDefault();
      startPlayback(p, idx, false);
    });
    if (p.is_mine) {
      document.getElementById(`pli-up-${it.id}`)?.addEventListener('click', () => moveItem(p.id, it.id, 'up'));
      document.getElementById(`pli-down-${it.id}`)?.addEventListener('click', () => moveItem(p.id, it.id, 'down'));
      document.getElementById(`pli-rm-${it.id}`)?.addEventListener('click', () => removeItem(p.id, it.id));
    }
    // rating widget
    document.querySelectorAll(`[data-rate-item="${it.id}"]`).forEach(b => {
      b.addEventListener('click', () => rateItem(p.id, it.id, Number(b.dataset.rateValue)));
    });
    document.getElementById(`pli-rate-clear-${it.id}`)?.addEventListener('click', () => clearRating(p.id, it.id));
    document.getElementById(`pli-rate-comment-${it.id}`)?.addEventListener('click', () => editRatingComment(p.id, it.id, it.my_rating, it.my_comment));
  });
}

function starsHtml(itemId, myRating) {
  return [1,2,3,4,5].map(n => {
    const on = myRating && n <= myRating;
    return `<button data-rate-item="${itemId}" data-rate-value="${n}"
      style="background:none; border:none; cursor:pointer; padding:0; font-size:18px; line-height:1; color:${on ? '#f59e0b' : '#bbb'}">
      ${on ? '★' : '☆'}
    </button>`;
  }).join('');
}

function renderItemRow(it, idx, p) {
  const thumb = defaultThumb(it);
  const thumbHtml = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="" style="width:80px; height:60px; object-fit:cover; border-radius:6px; flex-shrink:0">`
    : `<div style="width:80px; height:60px; border-radius:6px; background:#eee; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:20px">🎵</div>`;
  const sourceLabel = ({
    youtube: '▶ YouTube',
    spotify_track: '♪ Spotify (曲)',
    spotify_album: '♪ Spotify (アルバム)',
    spotify_playlist: '♪ Spotify (PL)',
    spotify_episode: '♪ Spotify (PC)',
    direct_video: '🎞 動画',
    other: '🔗',
  })[it.source_type] || '🔗';
  const avgLabel = it.avg_rating != null
    ? `平均 ${it.avg_rating.toFixed(1)} ⭐ (${it.rating_count})`
    : '評価なし';
  const myRatingArea = `
    <div style="margin-top:6px; padding-top:6px; border-top:1px solid var(--line)">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <span class="muted" style="font-size:12px">あなたの 評価:</span>
        <div>${starsHtml(it.id, it.my_rating)}</div>
        ${it.my_rating ? `<button id="pli-rate-clear-${it.id}" class="btn" style="padding:0 6px; font-size:11px">取消</button>` : ''}
        <button id="pli-rate-comment-${it.id}" class="btn" style="padding:0 6px; font-size:11px">💬 コメント</button>
      </div>
      ${it.my_comment ? `<div class="meta" style="font-size:12px; margin-top:4px">「${escapeHtml(it.my_comment)}」</div>` : ''}
    </div>`;
  const adminBtns = p.is_mine ? `
    <button id="pli-up-${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${idx === 0 ? 'disabled' : ''}>↑</button>
    <button id="pli-down-${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${idx === p.items.length - 1 ? 'disabled' : ''}>↓</button>
    <button id="pli-rm-${it.id}" class="btn" style="padding:0 6px; font-size:11px; color:var(--muted)">×</button>` : '';
  return `
    <div class="list-item" style="align-items:flex-start; gap:8px; flex-direction:column">
      <div class="row" style="gap:8px; align-items:flex-start; width:100%">
        ${thumbHtml}
        <div class="grow" style="min-width:0">
          <div class="bold" style="font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
            <a href="#" id="pli-play-${it.id}" style="color:inherit; text-decoration:none">${escapeHtml(it.title)}</a>
          </div>
          <div class="meta" style="font-size:12px">${sourceLabel} · ${avgLabel}</div>
          ${it.memo ? `<div class="meta" style="font-size:12px; color:#444">💬 ${escapeHtml(it.memo)}</div>` : ''}
        </div>
        <div class="row" style="gap:4px; flex-shrink:0">${adminBtns}</div>
      </div>
      ${myRatingArea}
    </div>`;
}

async function moveItem(pid, iid, dir) {
  try { await patch(`/api/playlists/${pid}/items/${iid}/move`, { dir }); await loadPlDetail(pid); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function removeItem(pid, iid) {
  if (!confirm('このアイテムを 削除しますか?')) return;
  try { await del(`/api/playlists/${pid}/items/${iid}`); await loadPlDetail(pid); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function rateItem(pid, iid, rating) {
  try { await post(`/api/playlists/${pid}/items/${iid}/rating`, { rating }); await loadPlDetail(pid); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function clearRating(pid, iid) {
  try { await del(`/api/playlists/${pid}/items/${iid}/rating`); await loadPlDetail(pid); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function editRatingComment(pid, iid, currentRating, currentComment) {
  const c = prompt('コメント (500 文字まで)', currentComment || '');
  if (c === null) return;
  const rating = currentRating || 5;
  try {
    await post(`/api/playlists/${pid}/items/${iid}/rating`, { rating, comment: c });
    await loadPlDetail(pid);
  } catch (e) { toast('失敗: ' + e.message); }
}

// ─────────────── Player ───────────────
let ytPlayer = null;
function startPlayback(p, startIdx, shuffle) {
  const order = shuffle
    ? shuffleArr(p.items.map((_, i) => i))
    : p.items.map((_, i) => i);
  const startInOrder = shuffle ? 0 : order.indexOf(startIdx);
  detailState = {
    pid: p.id, items: p.items,
    order, orderIdx: startInOrder,
    shuffle, autoNext: false,
  };
  document.getElementById('pld-player-card').hidden = false;
  document.getElementById('pld-shuffle').checked = shuffle;
  document.getElementById('pld-prev').onclick = () => stepPlayback(-1);
  document.getElementById('pld-next').onclick = () => stepPlayback(1);
  document.getElementById('pld-close').onclick = closePlayer;
  document.getElementById('pld-shuffle').onchange = (ev) => {
    detailState.shuffle = ev.target.checked;
    const cur = currentItemId();
    detailState.order = ev.target.checked
      ? shuffleArr(p.items.map((_, i) => i))
      : p.items.map((_, i) => i);
    detailState.orderIdx = detailState.order.indexOf(p.items.findIndex(x => x.id === cur));
    if (detailState.orderIdx < 0) detailState.orderIdx = 0;
  };
  document.getElementById('pld-auto').onchange = (ev) => { detailState.autoNext = ev.target.checked; };
  renderCurrent();
  document.getElementById('pld-player-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function currentItemId() {
  if (!detailState) return null;
  const it = detailState.items[detailState.order[detailState.orderIdx]];
  return it ? it.id : null;
}

function stepPlayback(delta) {
  if (!detailState) return;
  let next = detailState.orderIdx + delta;
  if (next < 0) next = detailState.order.length - 1;
  if (next >= detailState.order.length) next = 0;
  detailState.orderIdx = next;
  renderCurrent();
}

function closePlayer() {
  detailState = null; ytPlayer = null;
  const card = document.getElementById('pld-player-card');
  if (card) { card.hidden = true; }
  const root = document.getElementById('pld-player');
  if (root) root.innerHTML = '';
}

function renderCurrent() {
  const it = detailState.items[detailState.order[detailState.orderIdx]];
  const root = document.getElementById('pld-player');
  const now = document.getElementById('pld-now');
  if (!it) { root.innerHTML = '<div class="muted">空</div>'; return; }
  now.innerHTML = `<span class="bold">${escapeHtml(it.title)}</span>
    <span class="muted" style="font-size:12px">  ・ ${detailState.orderIdx + 1} / ${detailState.order.length}</span>`;
  const meta = parseUrlMeta(it.url);
  if (meta.type === 'youtube') {
    // YouTube IFrame API: enablejsapi=1 + listen for 'onStateChange' postMessage
    const autoNext = detailState.autoNext;
    root.innerHTML = `
      <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px; background:#000">
        <iframe id="ytframe" src="${meta.embed}${autoNext ? '&autoplay=1' : '&autoplay=1'}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen
                frameborder="0"
                style="position:absolute; inset:0; width:100%; height:100%"></iframe>
      </div>`;
  } else if (meta.type.startsWith('spotify_')) {
    root.innerHTML = `
      <iframe src="${meta.embed}" style="width:100%; height:152px; border:none; border-radius:8px"
        allow="encrypted-media; autoplay" loading="lazy"></iframe>`;
  } else if (meta.type === 'direct_video') {
    root.innerHTML = `
      <video controls autoplay src="${escapeHtml(it.url)}" style="width:100%; max-height:360px; border-radius:8px; background:#000"
        onended="window.__plOnEnded && window.__plOnEnded()"></video>`;
    window.__plOnEnded = () => { if (detailState?.autoNext) stepPlayback(1); };
  } else {
    root.innerHTML = `
      <div style="padding:18px; background:#f6f6f9; border-radius:8px; text-align:center">
        <div class="bold" style="margin-bottom:6px">${escapeHtml(it.title)}</div>
        <a class="btn primary" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">外部リンクで開く</a>
      </div>`;
  }
}

function shuffleArr(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// YouTube IFrame postMessage listener — 「video ended (state=0)」 で 自動次へ
// (autoNext ON のとき)。 YT は postMessage で {event:'onStateChange', info:0} を
// 親に投げてくれる (enablejsapi=1 設定時)。
window.addEventListener('message', (ev) => {
  if (!detailState?.autoNext) return;
  if (typeof ev.data !== 'string' && typeof ev.data !== 'object') return;
  try {
    const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
    if (data?.event === 'onStateChange' && data.info === 0) {
      stepPlayback(1);
    }
  } catch (_) { /* swallow */ }
});
