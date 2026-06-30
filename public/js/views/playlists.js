// /#/playlists — 音楽 / 動画プレイリスト。
//   * 作成者: タイトル + カバー + ジャンル + 公開/非公開 + アイテム N 件
//   * アイテム: URL (YouTube / Spotify / 動画ファイル / 他) + メモ + 並び替え
//   * 閲覧者: ⭐ 1-5 評価 + コメント + プレイリスト ❤️ お気に入り
//   * 再生: 内部 iframe 埋込 + 「次へ / シャッフル / オートプレイ (next 自動)」

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';
import { fmtRelative, tag } from '../format.js';
// v857 #443 共有ダイアログ (タイトル + URL コピー / SNS 投稿 / ユーザへ送信) を再利用
import { shareDialog } from '../share_to_sns.js';

// v543 #200 「ボカロ」 を追加
const GENRES = ['J-POP','洋楽','K-POP','アニメ','ボカロ','ジャズ','クラシック','ロック',
  'EDM','ヒップホップ','VTuber','作業用 BGM','その他'];

// ─────────────── URL → embed src 解決 ───────────────
function parseUrlMeta(url) {
  const u = String(url || '').trim();
  // v820 #415 スマホでの自動再生確率を上げるため playsinline=1 + mute=1 を追加
  //   (iOS Safari は音付き自動再生を許可しないので、 初手は無音 + 最初の
  //   ユーザタップで音を出す戦略)。
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return {
    type: 'youtube', id: yt[1],
    embed: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&enablejsapi=1&playsinline=1&mute=1`,
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
        <input type="search" id="pl-q" value="${escapeHtml(savedQ)}" placeholder="タイトル / 説明を検索" style="flex:1; min-width:160px">
        <select id="pl-genre" style="min-width:120px">
          <option value="">ジャンルすべて</option>
          ${GENRES.map(g => `<option value="${escapeHtml(g)}" ${savedG === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
        </select>
        <label class="muted" style="display:inline-flex; align-items:center; gap:4px; font-size:13px">
          <input type="checkbox" id="pl-mine" ${savedMine ? 'checked' : ''}> 自分のだけ
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
      root.innerHTML = `<div class="empty">まだプレイリストはありません</div>`;
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
      <h2 style="margin:6px 0 0">${isEdit ? '✏️ プレイリスト編集' : '🎵 新規プレイリスト'}</h2>
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
      if (!confirm('このプレイリストを削除します。 アイテム + 評価 + ❤️ もすべて消えます。 良いですか?')) return;
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
      <!-- v880 再生中の曲タイトルをiframe直下に大きく表示。
           以前はプレイヤーカード一番下にmeta文字色で出してただけで、見落とされていた。 -->
      <div id="pld-now" style="margin-top:10px; padding:8px 10px; background:#f3e8ff; border-left:4px solid #7b3fa0; border-radius:6px; font-size:15px; line-height:1.4"></div>
      <!-- v880 再生中の曲を直接★評価できるバー。下のアイテム一覧までスクロールしなくて良いように。 -->
      <div id="pld-rate-now" style="margin-top:6px"></div>
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
    // v880 再生中なら detailState.items も差し替えて、プレイヤー側の評価バーも最新化。
    //   id をキーに in-place で置き換える (順序や order[] はそのまま) → iframe 触らず安全。
    if (detailState && detailState.pid === p.id) {
      const byId = Object.fromEntries(p.items.map(it => [it.id, it]));
      detailState.items = detailState.items.map(it => byId[it.id] || it);
      renderPlayerRating();
    }
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
        if (!url || !title) { toast('URL とタイトルを入れてください'); return; }
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
      <button id="pld-share" class="btn">📤 共有</button>
      ${p.is_mine ? `<a class="btn" href="#/playlists/${p.id}/edit">✏️ 編集</a>` : ''}
    </div>`;
  // v857 #443 共有 (タイトル+URL コピー、 SNS 投稿、 ユーザへ直接送信)
  document.getElementById('pld-share')?.addEventListener('click', () => {
    shareDialog('🎵 ' + p.title, '#/playlists/' + p.id);
  });
  document.getElementById('pld-like').addEventListener('click', async () => {
    try {
      const r = await post(`/api/playlists/${p.id}/like`, {});
      toast(r.liked ? '❤️ お気に入りに追加' : '🤍 取消');
      await loadPlDetail(p.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('pld-play0').addEventListener('click', () => startPlayback(p, 0, false));
  document.getElementById('pld-shuffle0').addEventListener('click', () => startPlayback(p, 0, true));
  // v819 #414 プレイリストを開いたタイミングでアイテムがあるなら自動で
  //   再生開始 + 連続再生 ON。 動画音声はブラウザポリシーで無音開始になる
  //   ケースがあり、 その時は再生ボタンを 1 回タップすると音が出る。
  if (p.items.length && !detailState) {
    setTimeout(() => { if (!detailState) startPlayback(p, 0, false); }, 50);
  }
}

function renderDetailItems(p) {
  const root = document.getElementById('pld-items');
  document.getElementById('pld-cnt').textContent = p.items.length;
  if (!p.items.length) {
    root.innerHTML = `<div class="empty">${p.is_mine ? '↓ 下の 「＋ アイテムを追加」 から URL を追加してください' : 'アイテムはまだありません'}</div>`;
    return;
  }
  root.innerHTML = p.items.map((it, idx) => renderItemRow(it, idx, p)).join('');
  // wire each row
  p.items.forEach((it, idx) => {
    // v882 タイトル & サムネどちらタップしても曲ジャンプ。再生中ならiframe維持で
    //   loadVideoByIdジャンプ、未再生なら新規startPlayback。シャッフル中も維持。
    const onPlayClick = (ev) => { ev.preventDefault(); jumpToItem(p, idx); };
    document.getElementById(`pli-play-${it.id}`)?.addEventListener('click', onPlayClick);
    document.getElementById(`pli-thumb-${it.id}`)?.addEventListener('click', onPlayClick);
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
        <span class="muted" style="font-size:12px">あなたの評価:</span>
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
        <a href="#" id="pli-thumb-${it.id}" style="text-decoration:none; flex-shrink:0; display:block; cursor:pointer" title="この曲を再生">${thumbHtml}</a>
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

// v882 サムネ or タイトルタップで再生中 playlist に対しては iframe を保持したまま
//   loadVideoById で曲ジャンプ。未再生 or 別 playlist なら fresh start。
function jumpToItem(p, idx) {
  if (detailState && detailState.pid === p.id) {
    const orderPos = detailState.order.indexOf(idx);
    if (orderPos >= 0) {
      detailState.orderIdx = orderPos;
      renderCurrent();
      return;
    }
  }
  startPlayback(p, idx, false);
}

async function moveItem(pid, iid, dir) {
  try { await patch(`/api/playlists/${pid}/items/${iid}/move`, { dir }); await loadPlDetail(pid); }
  catch (e) { toast('失敗: ' + e.message); }
}

async function removeItem(pid, iid) {
  if (!confirm('このアイテムを削除しますか?')) return;
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
  // v819 #414 デフォルトで連続再生 ON (= 1 曲終わったら次曲へ自動)。
  detailState = {
    pid: p.id, items: p.items,
    order, orderIdx: startInOrder,
    shuffle, autoNext: true,
  };
  document.getElementById('pld-player-card').hidden = false;
  document.getElementById('pld-shuffle').checked = shuffle;
  document.getElementById('pld-auto').checked = true;
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
    // v882 単一動画iframe方式では順序変更でiframe再構築は不要。現在曲はそのまま継続、
    //   次回ended時の遷移先だけが新orderに従う。ラベルだけ更新。
    updateNowPlayingLabel();
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
  // v882 単一動画iframe方式: 全曲YouTubeも個別動画もrenderCurrent経由で曲送り。
  //   YT batchはrenderYouTubeBatchPlayer内のiframe保持branchでloadVideoByIdを使うので
  //   iframe再生成はせず gesture chain維持。非YT/混合は従来通りiframe再構築。
  let next = detailState.orderIdx + delta;
  if (next < 0) next = detailState.order.length - 1;
  if (next >= detailState.order.length) next = 0;
  detailState.orderIdx = next;
  renderCurrent();
}

function updateNowPlayingLabel() {
  if (!detailState) return;
  renderNowPlayingLabel();
  renderPlayerRating();
}

// v880 「再生中の曲」をプレイヤー直下の紫帯に大きく表示。タイトル + N/M + 元リンク。
function renderNowPlayingLabel() {
  const now = document.getElementById('pld-now');
  if (!now || !detailState) return;
  const it = detailState.items[detailState.order[detailState.orderIdx]];
  if (!it) { now.innerHTML = ''; return; }
  const url = it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:#7b3fa0; font-size:11px; text-decoration:underline; margin-left:6px">↗ 元リンク</a>` : '';
  const memo = it.memo ? `<div style="font-size:12px; color:#555; margin-top:3px">💬 ${escapeHtml(it.memo)}</div>` : '';
  now.innerHTML = `
    <div style="font-size:11px; color:#7b3fa0; font-weight:600; letter-spacing:0.05em">🎵 NOW PLAYING ・ ${detailState.orderIdx + 1} / ${detailState.order.length}</div>
    <div style="font-weight:700; color:#2a0840; margin-top:2px; word-break:break-word">${escapeHtml(it.title)}${url}</div>
    ${memo}
  `;
}

// v880 プレイヤー直下の「再生中の曲を評価」バー。
//   ★1-5 + コメント編集を、画面下のアイテム一覧までスクロールせずその場で打てる。
//   既存の rateItem / clearRating / editRatingComment API をそのまま再利用。
function renderPlayerRating() {
  const root = document.getElementById('pld-rate-now');
  if (!root) return;
  if (!detailState) { root.innerHTML = ''; return; }
  const it = detailState.items[detailState.order[detailState.orderIdx]];
  if (!it) { root.innerHTML = ''; return; }
  const avgLabel = it.avg_rating != null
    ? `平均${Number(it.avg_rating).toFixed(1)}⭐(${it.rating_count})`
    : 'まだ評価なし';
  root.innerHTML = `
    <div class="row center" style="gap:8px; flex-wrap:wrap; padding:8px 10px; background:#faf5ff; border:1px solid #ede4f3; border-radius:8px">
      <span style="font-size:12px; color:#4a106d; font-weight:600">再生中の曲を評価:</span>
      <div data-rate-now-stars>${starsHtml(it.id, it.my_rating)}</div>
      ${it.my_rating ? `<button id="pli-rate-clear-now" class="btn" style="padding:0 6px; font-size:11px">取消</button>` : ''}
      <button id="pli-rate-comment-now" class="btn" style="padding:0 6px; font-size:11px">💬 コメント</button>
      <span class="muted" style="font-size:11px; margin-left:auto">${avgLabel}</span>
    </div>
    ${it.my_comment ? `<div class="meta" style="font-size:12px; margin-top:4px; padding:0 10px">あなたのコメント:「${escapeHtml(it.my_comment)}」</div>` : ''}
  `;
  // 同じ data-rate-item 属性が一覧側にもあるので、必ず root スコープで wire する。
  root.querySelectorAll('[data-rate-now-stars] [data-rate-item]').forEach(b => {
    b.addEventListener('click', () => rateItem(detailState.pid, it.id, Number(b.dataset.rateValue)));
  });
  document.getElementById('pli-rate-clear-now')?.addEventListener('click',
    () => clearRating(detailState.pid, it.id));
  document.getElementById('pli-rate-comment-now')?.addEventListener('click',
    () => editRatingComment(detailState.pid, it.id, it.my_rating, it.my_comment));
}

function closePlayer() {
  if (detailState) { detailState._ytIframe = null; detailState._ytPlaylistKey = null; }
  detailState = null; ytPlayer = null;
  const card = document.getElementById('pld-player-card');
  if (card) { card.hidden = true; }
  const root = document.getElementById('pld-player');
  if (root) root.innerHTML = '';
}

// v882 全曲YouTubeプレイリスト用の単一動画iframe + loadVideoById方式。
//   v863で `playlist=` URLパラメータ方式にしてiOSのジェスチャchain維持を試みていたが、
//   YT側の挙動でURL pathのfirstIdが内部playlistの先頭に来ない(2曲目から再生される)
//   /YTコントロールから1曲目に戻れないバグがあった。
//   v882で方針変更: iframe URLは単一動画のみ、曲送りは全てloadVideoById commandで
//   制御し、YT側にplaylistの存在を知らせない。これで:
//     - 1曲目から確実に再生される
//     - YT controls側にplaylist UIが出ない (代わりに我々のprev/next/サムネクリック)
//     - 曲遷移は完全に我々の管理下なのでNOW PLAYING同期も確実
//   iOSのmuteリセット問題: 同iframe内のloadVideoByIdでもiOSは新動画扱いするので
//   タップ要求は残るが、これは物理制約。非iOSではsticky unmuteで連続音付き再生OK。
function renderYouTubeBatchPlayer(root) {
  const curIdx = detailState.orderIdx;
  const curId = parseUrlMeta(detailState.items[detailState.order[curIdx]].url).id;

  // 既存iframe生存中なら、URL再ロードせずloadVideoByIdで曲ジャンプのみ
  if (detailState._ytIframe && document.body.contains(detailState._ytIframe)) {
    try {
      detailState._ytIframe.contentWindow?.postMessage(
        JSON.stringify({event:'command', func:'loadVideoById', args:[curId]}), '*');
    } catch (_) {}
    maybeReUnmuteAfterLoad();
    return;
  }

  // 新規iframe — 単一動画モード (playlist= パラメータ無し)
  const url = `https://www.youtube.com/embed/${curId}?autoplay=1&mute=1&playsinline=1&enablejsapi=1`;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const alreadyUnmuted = !isIOS && (() => {
    try { return localStorage.getItem('labpay-pl-unmuted') === '1'; } catch { return false; }
  })();

  root.innerHTML = `
    <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px; background:#000">
      <iframe id="ytframe" src="${url}"
              allow="autoplay; encrypted-media; fullscreen" allowfullscreen
              frameborder="0"
              style="position:absolute; inset:0; width:100%; height:100%"></iframe>
    </div>
    ${alreadyUnmuted ? '' : '<button id="pld-unmute" class="primary" style="margin-top:6px; padding:4px 12px; font-size:12px">🔊 タップで音を出す</button>'}
    <div class="row" style="gap:6px; margin-top:6px; font-size:12px; flex-wrap:wrap">
      <button id="pld-seek-back" class="btn" style="font-size:12px; padding:3px 8px">⏪ 10秒</button>
      <button id="pld-seek-fwd"  class="btn" style="font-size:12px; padding:3px 8px">10秒 ⏩</button>
    </div>`;

  const yt = document.getElementById('ytframe');
  detailState._ytIframe = yt;
  detailState._ytPlaylistKey = null;  // 廃止 (旧 playlist= キャッシュ判定用)
  detailState._ytLastVid = null;      // v881 初回 infoDelivery で同期 fire させる
  const ytSend = (func, args = []) => {
    try { yt?.contentWindow?.postMessage(JSON.stringify({event:'command', func, args}), '*'); } catch (_) {}
  };

  yt?.addEventListener('load', () => {
    try {
      yt.contentWindow?.postMessage(JSON.stringify({event:'listening', id:'ytframe', channel:'widget'}), '*');
      yt.contentWindow?.postMessage(JSON.stringify({event:'command', func:'addEventListener', args:['onStateChange']}), '*');
    } catch (_) {}
    if (alreadyUnmuted) setTimeout(() => { ytSend('unMute'); ytSend('setVolume', [80]); }, 800);
  });

  document.getElementById('pld-unmute')?.addEventListener('click', () => {
    ytSend('unMute');
    ytSend('setVolume', [80]);
    ytSend('playVideo');
    try { localStorage.setItem('labpay-pl-unmuted', '1'); } catch (_) {}
    // 非iOSなら以降ボタン不要、iOSでは毎曲タップ必要なので残す
    if (!isIOS) document.getElementById('pld-unmute')?.remove();
  });

  document.getElementById('pld-seek-back')?.addEventListener('click', () => {
    const cur = detailState?._ytCurSec || 0;
    ytSend('seekTo', [Math.max(0, cur - 10), true]);
  });
  document.getElementById('pld-seek-fwd')?.addEventListener('click', () => {
    const cur = detailState?._ytCurSec || 0;
    ytSend('seekTo', [cur + 10, true]);
  });
}

// v882 loadVideoByIdで曲が切り替わった直後、保存済みunmuteフラグがあれば再適用 (非iOSのみ)。
//   iOSは新動画ごとにユーザジェスチャ必須なので何もしない (button残置で対応)。
function maybeReUnmuteAfterLoad() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  if (isIOS) return;
  let flag = false;
  try { flag = localStorage.getItem('labpay-pl-unmuted') === '1'; } catch (_) {}
  if (!flag) return;
  const yt = detailState?._ytIframe;
  if (!yt) return;
  setTimeout(() => {
    try {
      yt.contentWindow?.postMessage(JSON.stringify({event:'command', func:'unMute', args:[]}), '*');
      yt.contentWindow?.postMessage(JSON.stringify({event:'command', func:'setVolume', args:[80]}), '*');
    } catch (_) {}
  }, 600);
}

function isAllYouTubePlaylist() {
  if (!detailState || !detailState.items.length) return false;
  return detailState.items.every(x => parseUrlMeta(x.url).type === 'youtube');
}

function renderCurrent() {
  const it = detailState.items[detailState.order[detailState.orderIdx]];
  const root = document.getElementById('pld-player');
  if (!it) { root.innerHTML = '<div class="muted">空</div>'; renderNowPlayingLabel(); renderPlayerRating(); return; }
  // v880 「いま流れている曲」タイトルをプレイヤー直下に大きく + 評価バー追従。
  renderNowPlayingLabel();
  renderPlayerRating();
  // v863 #444 全曲 YouTube なら 1 iframe + playlist パラメータで一括ロード →
  //   曲切替で iframe を再生成しないので user gesture chain が維持され、
  //   iOS Safari でも 1 回タップで以降全曲音付き連続再生が可能。
  if (isAllYouTubePlaylist()) {
    renderYouTubeBatchPlayer(root);
    return;
  }
  const meta = parseUrlMeta(it.url);
  if (meta.type === 'youtube') {
    // YouTube IFrame API: enablejsapi=1 + listen for 'onStateChange' postMessage
    // v820 #415 スマホでの音付き自動再生はブラウザに拒否されるため、 mute=1 で
    //   無音自動再生 → 「🔊 タップで音を出す」 ボタンで 1 回タップさせて unMute
    //   コマンドを送る。 1 回タップして以降は連続再生も音付きで続く。
    // v857 #443 一度音を出したら localStorage で記憶、 以降は自動 unmute で 「🔊 タップ」 ボタン出さない
    // v862 #444 続報 iOS Safari は autoplay 中の iframe に unMute を送るだけで
    //   「user gesture 無しの音付き再生」 とみなして停止 → 連続再生が死ぬ。
    //   sticky autoplay 許可は親 origin 単位で、 youtube-nocookie iframe には引き継が
    //   ないので、 iOS では各曲で 1 タップ必須が物理的制約。 ここでは iOS 判定で
    //   alreadyUnmuted を強制 false にして、 「毎回タップ」 と引き換えに連続再生を
    //   優先する。 PC / Android Chrome は引き続き自動 unmute。
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
      || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    const alreadyUnmuted = !isIOS && (() => {
      try { return localStorage.getItem('labpay-pl-unmuted') === '1'; } catch { return false; }
    })();
    root.innerHTML = `
      <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px; background:#000">
        <iframe id="ytframe" src="${meta.embed}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen
                frameborder="0"
                style="position:absolute; inset:0; width:100%; height:100%"></iframe>
      </div>
      ${alreadyUnmuted ? '' : '<button id="pld-unmute" class="primary" style="margin-top:6px; padding:4px 12px; font-size:12px">🔊 タップで音を出す</button>'}
      <!-- v857 #443 シーク (10 秒戻し / 進み) と音量トグルを簡単操作で提供 -->
      <div class="row" style="gap:6px; margin-top:6px; font-size:12px; flex-wrap:wrap">
        <button id="pld-seek-back"  class="btn" style="font-size:12px; padding:3px 8px">⏪ 10秒</button>
        <button id="pld-seek-fwd"   class="btn" style="font-size:12px; padding:3px 8px">10秒 ⏩</button>
        <button id="pld-mute-tgl"   class="btn" style="font-size:12px; padding:3px 8px">🔈 音量 ON / OFF</button>
      </div>`;
    const yt = document.getElementById('ytframe');
    const ytSend = (func, args = []) => {
      try { yt?.contentWindow?.postMessage(JSON.stringify({event:'command', func, args}), '*'); } catch (_) {}
    };
    // v860 #444 連続再生が止まる問題修正: autoUnmute の playVideo を削除。
    //   YouTube iframe は autoplay=1&mute=1 で自動再生を開始するが、 そこに
    //   さらに playVideo コマンドを送ると iOS Safari の autoplay state machine
    //   が 「ユーザジェスチャなしの強制再生」 とみなして停止 → ended 通知も
    //   来なくなり連続再生が切れていた。 unmute と setVolume だけ送れば
    //   既に再生中の動画が音付きに切り替わるだけで済む。
    //   タイマーは 800ms に延長、 mute autoplay が始まってから unmute する。
    const autoUnmute = () => {
      ytSend('unMute');
      ytSend('setVolume', [80]);
    };
    yt?.addEventListener('load', () => {
      try {
        yt.contentWindow?.postMessage(JSON.stringify({event:'listening', id:'ytframe', channel:'widget'}), '*');
        yt.contentWindow?.postMessage(JSON.stringify({event:'command', func:'addEventListener', args:['onStateChange']}), '*');
      } catch (_) {}
      // 既に一度音を出したことがあれば、 load 後 800ms ほど経ってから自動で unmute
      if (alreadyUnmuted) setTimeout(autoUnmute, 800);
    });
    document.getElementById('pld-unmute')?.addEventListener('click', () => {
      // ユーザタップ由来なので playVideo も安全に送れる (ジェスチャ chain あり)
      autoUnmute();
      ytSend('playVideo');
      try { localStorage.setItem('labpay-pl-unmuted', '1'); } catch (_) {}
      document.getElementById('pld-unmute')?.remove();
    });
    // 現在の再生位置を取得するのは getCurrentTime コマンド → 別 message で返ってくる
    //   ので、 ここでは単純に relative seek (seekTo (current+/-10)) ではなく、 ヒューリスティック
    //   に 「現在位置から +/-10 秒」 を実現する。 YT IFrame API の seekTo は絶対値のみなので、
    //   getCurrentTime を取れるよう addEventListener で受信する。
    let curSec = 0;
    window.__plYtCurrent = (sec) => { curSec = Number(sec) || 0; };
    document.getElementById('pld-seek-back')?.addEventListener('click', () => {
      ytSend('getCurrentTime'); // doesn't return; we use last cached curSec
      ytSend('seekTo', [Math.max(0, curSec - 10), true]);
    });
    document.getElementById('pld-seek-fwd')?.addEventListener('click', () => {
      ytSend('seekTo', [curSec + 10, true]);
    });
    document.getElementById('pld-mute-tgl')?.addEventListener('click', () => {
      // 音量トグル: 簡易 (mute / unmute 切替)
      ytSend('unMute'); ytSend('setVolume', [80]); ytSend('playVideo');
      try { localStorage.setItem('labpay-pl-unmuted', '1'); } catch (_) {}
      document.getElementById('pld-unmute')?.remove();
    });
  } else if (meta.type.startsWith('spotify_')) {
    root.innerHTML = `
      <iframe src="${meta.embed}" style="width:100%; height:152px; border:none; border-radius:8px"
        allow="encrypted-media; autoplay" loading="lazy"></iframe>`;
  } else if (meta.type === 'direct_video') {
    // v820 #415 スマホでの自動再生確率を上げるため muted + playsinline を追加
    root.innerHTML = `
      <video controls autoplay muted playsinline src="${escapeHtml(it.url)}" style="width:100%; max-height:360px; border-radius:8px; background:#000"
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

// YouTube IFrame postMessage listener — ended → 自動次へ、 infoDelivery → curSec キャッシュ
//   v863 #444 全曲 YouTube モードでは YT 内部が次動画へ自動進むので、 親は
//   orderIdx + UI ラベルだけ更新 (iframe は再生成しない = ジェスチャ chain 保持)。
//   v881 シャッフル時のNOW PLAYINGずれ対策: YTが実際に再生中の video_id を信頼源にして
//     orderIdx を逆引き同期する。endedカウンタ依存だと削除動画スキップやended抜けで
//     ズレるため、infoDelivery.info.videoData.video_id が変わった瞬間に詰める。
window.addEventListener('message', (ev) => {
  if (!detailState) return;
  if (typeof ev.data !== 'string' && typeof ev.data !== 'object') return;
  try {
    const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
    if (data?.event === 'infoDelivery' && data.info) {
      if (typeof data.info.currentTime === 'number') {
        detailState._ytCurSec = data.info.currentTime;
      }
      // v881 YT実機が再生中の video_id を取得 → items から逆引き → orderIdx 同期。
      const vid = data.info.videoData?.video_id;
      if (vid && detailState._ytLastVid !== vid) {
        detailState._ytLastVid = vid;
        const itemsIdx = detailState.items.findIndex(it => parseUrlMeta(it.url).id === vid);
        if (itemsIdx >= 0) {
          const orderPos = detailState.order.indexOf(itemsIdx);
          if (orderPos >= 0 && orderPos !== detailState.orderIdx) {
            detailState.orderIdx = orderPos;
            renderNowPlayingLabel();
            renderPlayerRating();
          }
        }
      }
    }
    if (data?.event === 'onStateChange' && data.info === 0) {
      if (!detailState.autoNext) return;
      if (detailState._ytIframe && document.body.contains(detailState._ytIframe)) {
        // YT 内部で次曲へ自動進行 → 親は orderIdx とラベルだけ同期。
        // v881 infoDelivery 経路で詰め直されるが、ended時点でも一旦+1して反応性を保つ。
        let next = detailState.orderIdx + 1;
        if (next >= detailState.order.length) next = 0;
        detailState.orderIdx = next;
        detailState._ytCurSec = 0;
        updateNowPlayingLabel();
      } else {
        stepPlayback(1);
      }
    }
  } catch (_) { /* swallow */ }
});
