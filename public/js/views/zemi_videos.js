// /#/zemi-videos — ゼミ動画 (URL限定公開のYouTube) を一覧 + 検索 + 視聴。 v843 #426
//   一覧画面: 検索ボックス + 「+ 動画を追加」 (折りたたみ) + タイルグリッド (サムネ + タイトル + 説明)
//   詳細画面 /#/zemi-videos/<id>: 上部に YouTube embed を 大きく + 詳細メタ + 削除/編集 (本人)

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let lastQuery = '';

export async function renderZemiVideos() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎥 ゼミ動画</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        ラボの YouTube (URL限定公開) に上げてあるゼミ動画を キーワードで検索 + ここから直接視聴。
      </p>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; align-items:center; margin-bottom:8px">
        <input type="search" id="zv-q" placeholder="🔍 タイトル / 説明 で検索 (空欄で最新60件)" maxlength="100"
               style="flex:1; font-size:14px; padding:4px 8px; border:1px solid #d1d5db; border-radius:4px">
        <button id="zv-q-go">検索</button>
      </div>
      ${state.me?.role === 'admin' ? `
        <div class="row" style="gap:6px; align-items:center; font-size:12px">
          <button id="zv-import" class="btn" style="padding:3px 10px; font-size:12px" title="Cosense (nkmr-lab) の 「全体ゼミ」 タグページから YouTube URL を一括取り込み (admin のみ)">🔄 Scrapbox 「全体ゼミ」 タグから取り込み</button>
          <span id="zv-import-status" class="hint-sm" style="font-size:11px"></span>
        </div>` : ''}
    </div>
    <details class="card" id="zv-form">
      <summary style="cursor:pointer; font-weight:600; padding:4px 0; user-select:none">➕ 新しい動画を登録</summary>
      <div style="margin-top:8px">
        <label class="field">
          <span class="lbl">📺 YouTube URL (限定公開でOK)</span>
          <input type="text" id="zv-url" placeholder="https://www.youtube.com/watch?v=XXXXXXXXXXX または youtu.be/XXX">
        </label>
        <label class="field">
          <span class="lbl">📝 タイトル</span>
          <input type="text" id="zv-title" maxlength="300" placeholder="例: 2026.06.20 ゼミ / 〇〇 さん 中間発表">
        </label>
        <label class="field">
          <span class="lbl">📅 開催日 (任意)</span>
          <input type="date" id="zv-date">
        </label>
        <label class="field">
          <span class="lbl">説明 (任意、 検索対象になる)</span>
          <textarea id="zv-desc" rows="3" maxlength="5000" placeholder="発表者・テーマ・キーワードなど (例: 中村 / 視線追跡 / CHI rebuttal)"></textarea>
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="zv-save" class="primary">登録</button>
        </div>
      </div>
    </details>
    <div id="zv-list" class="card"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('zv-q-go').addEventListener('click', () => {
    lastQuery = (document.getElementById('zv-q').value || '').trim();
    loadList();
  });
  document.getElementById('zv-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      lastQuery = (document.getElementById('zv-q').value || '').trim();
      loadList();
    }
  });
  document.getElementById('zv-save').addEventListener('click', onSave);
  document.getElementById('zv-import')?.addEventListener('click', onImportFromCosense);
  await loadList();
}

async function onImportFromCosense() {
  const btn = document.getElementById('zv-import');
  const status = document.getElementById('zv-import-status');
  if (!confirm('Cosense の 「全体ゼミ」 タグページから YouTube URL を取り込みます。 数分かかる場合があります。 よろしいですか?')) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 取り込み中…';
  status.textContent = '';
  try {
    const r = await post('/api/zemi-videos/import-from-cosense', {});
    const s = r.stats || {};
    const msg = `✅ ${s.pages_scanned || 0} ページ走査、 URL ${s.urls_found || 0} 件発見、 新規 ${s.inserted || 0} 件追加 (重複 ${s.skipped_existing || 0} / エラー ${s.errors || 0})`;
    status.innerHTML = `<span style="color:#15803d">${msg}</span>`;
    toast(msg, 8000);
    await loadList();
  } catch (e) {
    status.innerHTML = `<span style="color:#dc2626">失敗: ${e.message}</span>`;
    toast('取り込み失敗: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function loadList() {
  const root = document.getElementById('zv-list');
  if (!root) return;
  try {
    const url = '/api/zemi-videos' + (lastQuery ? '?q=' + encodeURIComponent(lastQuery) : '');
    const d = await get(url);
    const items = d.items || [];
    // 登録ゼロなら form 開く
    if (!lastQuery) {
      const fEl = document.getElementById('zv-form');
      if (fEl) fEl.open = items.length === 0;
    }
    if (!items.length) {
      root.innerHTML = lastQuery
        ? `<div class="muted">「${escapeHtml(lastQuery)}」 に一致するゼミ動画はありませんでした</div>`
        : '<div class="muted">まだ動画が登録されていません。 上のフォームから登録してください。</div>';
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">${items.map(renderTile).join('')}</div>`;
  } catch (e) {
    root.innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTile(it) {
  // v849 #436 YouTube タイトル を優先 (登録時 oEmbed で 取得した正式タイトル)
  const display = it.youtube_title || it.title;
  const sub = it.youtube_title && it.title && it.youtube_title !== it.title ? it.title : '';
  return `
    <a class="ai-tile" href="#/zemi-videos/${it.id}">
      <div style="aspect-ratio:16/9; background:#000 url(${escapeHtml(it.thumbnail_url)}) center/cover no-repeat; border-radius:6px; margin:-2px -4px 6px; position:relative">
        <div style="position:absolute; right:6px; bottom:6px; background:rgba(0,0,0,0.7); color:#fff; font-size:11px; padding:1px 6px; border-radius:3px">▶ 再生</div>
      </div>
      <div class="ai-tile-head">
        ${avatarHtml(it.author_name, it.author_avatar, 'xs')}
        <span style="font-size:11px">${escapeHtml(it.author_name || '')}</span>
        ${it.occurred_on ? `<span style="margin-left:auto; font-size:11px">${escapeHtml(it.occurred_on)}</span>` : ''}
      </div>
      <div class="ai-tile-title">${escapeHtml(display)}</div>
      ${sub ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(sub)}</div>` : ''}
      ${it.description ? `<div class="ai-tile-snippet">${escapeHtml(it.description)}</div>` : ''}
    </a>`;
}

async function onSave() {
  const btn = document.getElementById('zv-save');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const body = {
      title: (document.getElementById('zv-title').value || '').trim(),
      description: (document.getElementById('zv-desc').value || '').trim(),
      youtube_url: (document.getElementById('zv-url').value || '').trim(),
      occurred_on: (document.getElementById('zv-date').value || '').trim(),
    };
    if (!body.title) { toast('タイトルを入れてください'); return; }
    if (!body.youtube_url) { toast('YouTube URL を入れてください'); return; }
    const r = await post('/api/zemi-videos', body);
    toast('✅ 登録しました');
    document.getElementById('zv-title').value = '';
    document.getElementById('zv-desc').value = '';
    document.getElementById('zv-url').value = '';
    document.getElementById('zv-date').value = '';
    const fEl = document.getElementById('zv-form');
    if (fEl) fEl.open = false;
    await loadList();
    // 登録直後の動画ページに移動するなら下行
    if (r && r.id) location.hash = '#/zemi-videos/' + r.id;
  } catch (e) {
    toast('失敗: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
}

// /#/zemi-videos/<id>  視聴ページ
export async function renderZemiVideoDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = '<div class="card"><div class="muted">読み込み中…</div></div>';
  let d;
  try {
    d = await get('/api/zemi-videos/' + id);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const myUid = Number(state.me?.id || 0);
  const isOwner = myUid > 0 && Number(d.user_id) === myUid;
  const isAdmin = (state.me?.role === 'admin');
  // v849 #436 YouTube タイトル優先 表示
  const displayTitle = d.youtube_title || d.title;
  const subTitle = d.youtube_title && d.title && d.youtube_title !== d.title ? d.title : '';
  app.innerHTML = `
    <div class="card">
      <a href="#/zemi-videos" class="hint">← ゼミ動画一覧</a>
      <h2 style="margin:6px 0">🎥 ${escapeHtml(displayTitle)}</h2>
      ${subTitle ? `<div class="hint" style="font-size:12px; margin-top:-4px">登録時タイトル: ${escapeHtml(subTitle)}</div>` : ''}
      ${d.youtube_author ? `<div class="hint" style="font-size:12px">YouTube: ${escapeHtml(d.youtube_author)}</div>` : ''}
      <div class="meta" style="font-size:13px">
        ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name || '')}
        ${d.occurred_on ? ' ・ 📅 ' + escapeHtml(d.occurred_on) : ''}
        ・ 登録 ${escapeHtml(d.created_at || '')}
      </div>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div style="position:relative; padding-top:56.25%">
        <iframe src="${escapeHtml(d.embed_url)}" title="${escapeHtml(d.title)}"
                style="position:absolute; inset:0; width:100%; height:100%; border:0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen></iframe>
      </div>
    </div>
    ${d.description ? `
    <div class="card">
      <div class="bold" style="font-size:14px; margin-bottom:4px">📝 説明</div>
      <div style="font-size:13.5px; line-height:1.7; white-space:pre-wrap">${escapeHtml(d.description)}</div>
    </div>` : ''}
    <div class="card">
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <a class="btn" href="${escapeHtml(d.youtube_url)}" target="_blank" rel="noopener">↗ YouTube で開く</a>
        ${(isOwner || isAdmin) ? '<button class="btn" id="zv-del" style="margin-left:auto">🗑 削除</button>' : ''}
      </div>
    </div>
  `;
  document.getElementById('zv-del')?.addEventListener('click', async () => {
    if (!confirm('この動画を一覧から削除しますか? (YouTube側の動画は消えません)')) return;
    try {
      await del('/api/zemi-videos/' + id);
      toast('削除しました');
      location.hash = '#/zemi-videos';
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
