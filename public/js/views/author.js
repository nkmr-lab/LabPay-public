// v1004 著者ページ /#/authors/{name} (中村さん指摘「著者で選択したら、
//   著者ページに移動して、 その著者の情報が見えつつ、 辿れるようにして欲しい」
//   「名前の表記揺れがあることがあるので、 複数の表記を受け付ける仕組みも
//   必要かもしれない」)。
// v1006 プロフィール画像 を 明示 アップロード 可能に。

import { escapeHtml } from '../router.js';
import { get, post, del } from '../api.js';
import { renderAuthorAvatar, mountAuthorAvatars, initLabUsersCache } from '../author_avatar.js';
import { toast } from '../app.js';
import { openModal } from '../modal.js';

export async function renderAuthor({ params }) {
  const app = document.getElementById('app');
  const name = decodeURIComponent(params.name || '');
  if (!name) { app.innerHTML = `<div class="card">著者名がありません</div>`; return; }
  app.innerHTML = `<div class="card">🔍 「${escapeHtml(name)}」 の 論文 を 検索中…</div>`;
  await initLabUsersCache();
  let d;
  try {
    d = await get('/api/authors/' + encodeURIComponent(name));
  } catch (e) {
    app.innerHTML = `<div class="card">⚠ ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  paint(app, name, d);
}

function paint(app, name, d) {
  const papers = d.papers || [];
  const variants = (d.name_variants || []).filter(v => v && v !== name);
  const affil = (d.affiliations || [])[0] || null;
  const email = (d.emails || [])[0] || null;
  const photoUrl = d.photo_url || null;
  const scholarUrl  = 'https://scholar.google.com/scholar?q=' + encodeURIComponent('author:"' + name + '"');
  const dblpUrl     = 'https://dblp.org/search?q=' + encodeURIComponent(name);
  const semanticUrl = 'https://www.semanticscholar.org/search?q=' + encodeURIComponent(name) + '&sort=relevance';

  // v1006 表示アバターは photo_url があれば それを 優先、 無ければ 既存の
  //   ラボメンバー/Gravatar/initials fallback (renderAuthorAvatar) に流す。
  const avatarHtml = photoUrl
    ? `<img class="avatar-au" src="${escapeHtml(photoUrl)}" alt="" style="width:72px; height:72px; border-radius:50%; flex:none; object-fit:cover; border:2px solid #f3e8ff">`
    : renderAuthorAvatar({ name, email }, { size: 72 });

  app.innerHTML = `
    <div class="card page-header">
      <div style="display:flex; gap:14px; align-items:center">
        <div id="au-avatar-slot" style="flex:none">${avatarHtml}</div>
        <div style="flex:1; min-width:0">
          <h2 style="margin:0; font-size:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(name)}</h2>
          ${affil ? `<div class="meta" style="font-size:12.5px; margin-top:2px; color:#6b7280">${escapeHtml(affil)}</div>` : ''}
          ${email ? `<div class="meta" style="font-size:12px; margin-top:2px"><a href="mailto:${escapeHtml(email)}" style="color:#7b3fa0; text-decoration:none">✉ ${escapeHtml(email)}</a></div>` : ''}
          <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
            <button id="au-photo-upload" class="btn" style="font-size:11px; padding:2px 10px">📷 プロフィール画像 を ${photoUrl ? '差し替え' : '設定'}</button>
            ${photoUrl ? `<button id="au-photo-delete" class="btn danger" style="font-size:11px; padding:2px 10px">🗑 画像 を 削除</button>` : ''}
            <input type="file" id="au-photo-file" accept="image/jpeg,image/png,image/webp" hidden>
          </div>
        </div>
      </div>
      ${variants.length ? `
        <div class="hint-sm" style="margin-top:8px">
          別表記: ${variants.map(v => `<span style="background:#faf5ff; padding:1px 6px; border-radius:8px; margin-right:4px">${escapeHtml(v)}</span>`).join('')}
        </div>` : ''}
      <div class="row no-print" style="gap:6px; margin-top:10px; flex-wrap:wrap">
        <a class="btn" href="${escapeHtml(scholarUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">🎓 Google Scholar</a>
        <a class="btn" href="${escapeHtml(dblpUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📚 DBLP</a>
        <a class="btn" href="${escapeHtml(semanticUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">🔬 Semantic Scholar</a>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px; font-size:14px">📄 LabPay 内 の 論文 (${papers.length} 件)</h3>
      ${papers.length ? `
        <div style="display:flex; flex-direction:column; gap:6px">
          ${papers.map(renderPaperRow).join('')}
        </div>` : `
        <div class="hint-sm">LabPay 内 で この 著者 の 要約 / 全訳 は 見つかり ませ ん でした。
          上 の Google Scholar / DBLP から 探せます。</div>`}
    </div>
  `;
  mountAuthorAvatars(app);
  bindPhotoUI(app, name);
}

function bindPhotoUI(app, name) {
  const btn = document.getElementById('au-photo-upload');
  const file = document.getElementById('au-photo-file');
  const delBtn = document.getElementById('au-photo-delete');
  if (btn && file) {
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      // v1014 中村さん要望「矩形選択 (正方形) で 切り抜けるように」→ アップロード前に
      //   クロッパー モーダルを 開いて 正方形 領域を 選択させ、 400×400 に レンダーして 送る。
      if (f.size > 20 * 1024 * 1024) { toast('元画像は 20MB まで'); return; }
      openCropperAndUpload(f, name);
      // 同じ画像を選び直せるように input.value をリセット
      file.value = '';
    });
  }
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('プロフィール画像を削除しますか?')) return;
      try {
        await del('/api/authors/' + encodeURIComponent(name) + '/photo');
        toast('削除しました');
      } catch (e) { toast('失敗: ' + e.message); }
      renderAuthor({ params: { name: encodeURIComponent(name) } });
    });
  }
}

// v1014 正方形 クロッパー モーダル。 画像を fit-inside で 表示し、 白枠 の 正方形 セレクタ
//   を ドラッグ で 移動、 4 隅 の ハンドル で 拡大縮小 (正方形固定)。 決定で 400×400 JPEG に
//   レンダーして 送信。
async function openCropperAndUpload(file, name) {
  let img;
  try {
    const dataUrl = await fileToDataUrl(file);
    img = await loadImage(dataUrl);
  } catch (e) {
    toast('画像を読めませんでした');
    return;
  }
  const imgW = img.naturalWidth, imgH = img.naturalHeight;
  if (!imgW || !imgH) { toast('画像サイズが取れません'); return; }
  const maxDisplay = 380;
  const scale = Math.min(1, maxDisplay / Math.max(imgW, imgH));
  const dispW = Math.round(imgW * scale), dispH = Math.round(imgH * scale);

  const initialSide = Math.round(Math.min(imgW, imgH) * 0.9);
  let cx = Math.round((imgW - initialSide) / 2);
  let cy = Math.round((imgH - initialSide) / 2);
  let cs = initialSide;

  const modal = openModal({
    title: '✂ プロフィール画像 の 切り抜き (正方形)',
    bodyHtml: `
      <div id="au-crop-container" style="position:relative; width:${dispW}px; height:${dispH}px; margin:0 auto; touch-action:none; user-select:none; -webkit-user-select:none">
        <img id="au-crop-img" alt="" style="width:100%; height:100%; display:block; -webkit-user-drag:none; pointer-events:none">
        <div id="au-crop-box" style="position:absolute; border:2px solid #fff; box-shadow:0 0 0 9999px rgba(0,0,0,0.55); box-sizing:border-box; cursor:move">
          <div data-au-corner="nw" style="position:absolute; left:-8px; top:-8px;    width:16px; height:16px; background:#fff; border:1px solid #333; cursor:nwse-resize"></div>
          <div data-au-corner="ne" style="position:absolute; right:-8px; top:-8px;   width:16px; height:16px; background:#fff; border:1px solid #333; cursor:nesw-resize"></div>
          <div data-au-corner="sw" style="position:absolute; left:-8px; bottom:-8px; width:16px; height:16px; background:#fff; border:1px solid #333; cursor:nesw-resize"></div>
          <div data-au-corner="se" style="position:absolute; right:-8px; bottom:-8px; width:16px; height:16px; background:#fff; border:1px solid #333; cursor:nwse-resize"></div>
        </div>
      </div>
      <div class="hint-sm" style="margin-top:8px; text-align:center">中をドラッグで移動、四隅で拡大縮小 (正方形固定)</div>
    `,
    maxWidth: Math.max(360, dispW + 40),
    buttons: [
      { label: 'キャンセル',        kind: 'btn',     onClick: () => modal.close() },
      { label: '✂ 切り抜いて保存', kind: 'primary', onClick: async () => { await confirmCrop(); } },
    ],
  });

  const root = modal.root;
  root.querySelector('#au-crop-img').src = img.src;
  const container = root.querySelector('#au-crop-container');
  const box = root.querySelector('#au-crop-box');

  function paintBox() {
    box.style.left   = (cx * scale) + 'px';
    box.style.top    = (cy * scale) + 'px';
    box.style.width  = (cs * scale) + 'px';
    box.style.height = (cs * scale) + 'px';
  }
  paintBox();

  let drag = null;
  container.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const target = ev.target;
    const corner = target?.getAttribute?.('data-au-corner') || null;
    const rect = container.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    if (corner) {
      drag = { mode: 'resize', corner, startX: px, startY: py, sx: cx, sy: cy, ss: cs };
    } else {
      const bx = cx * scale, by = cy * scale, bw = cs * scale, bh = cs * scale;
      if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) {
        drag = { mode: 'move', startX: px, startY: py, sx: cx, sy: cy };
      }
    }
    if (drag) container.setPointerCapture(ev.pointerId);
  });
  container.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const rect = container.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const dx = (px - drag.startX) / scale;
    const dy = (py - drag.startY) / scale;
    if (drag.mode === 'move') {
      cx = clamp(drag.sx + dx, 0, imgW - cs);
      cy = clamp(drag.sy + dy, 0, imgH - cs);
    } else {
      const c = drag.corner;
      if (c === 'se') {
        const ds = Math.max(dx, dy);
        cs = clamp(drag.ss + ds, 20, Math.min(imgW - drag.sx, imgH - drag.sy));
      } else if (c === 'nw') {
        const ds = Math.max(-dx, -dy);
        const newSs = clamp(drag.ss + ds, 20, Math.min(drag.sx + drag.ss, drag.sy + drag.ss));
        cx = drag.sx + drag.ss - newSs;
        cy = drag.sy + drag.ss - newSs;
        cs = newSs;
      } else if (c === 'ne') {
        const ds = Math.max(dx, -dy);
        const maxSs = Math.min(imgW - drag.sx, drag.sy + drag.ss);
        const newSs = clamp(drag.ss + ds, 20, maxSs);
        cy = drag.sy + drag.ss - newSs;
        cs = newSs;
      } else if (c === 'sw') {
        const ds = Math.max(-dx, dy);
        const maxSs = Math.min(drag.sx + drag.ss, imgH - drag.sy);
        const newSs = clamp(drag.ss + ds, 20, maxSs);
        cx = drag.sx + drag.ss - newSs;
        cs = newSs;
      }
    }
    paintBox();
  });
  container.addEventListener('pointerup',     () => { drag = null; });
  container.addEventListener('pointercancel', () => { drag = null; });

  async function confirmCrop() {
    modal.setBusy(true);
    try {
      const outSide = Math.min(400, cs);
      const canvas = document.createElement('canvas');
      canvas.width = outSide; canvas.height = outSide;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, cx, cy, cs, cs, 0, 0, outSide, outSide);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('canvas.toBlob 失敗');
      const fd = new FormData();
      fd.append('image', blob, 'author.jpg');
      const resp = await fetch('/api/authors/' + encodeURIComponent(name) + '/photo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
        body: fd,
      });
      const d = await resp.json();
      if (!resp.ok || !d.ok) throw new Error(d?.error?.message || 'HTTP ' + resp.status);
      toast('プロフィール画像を設定しました');
      modal.close();
      renderAuthor({ params: { name: encodeURIComponent(name) } });
    } catch (e) {
      toast('失敗: ' + e.message);
      modal.setBusy(false);
    }
  }
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function renderPaperRow(p) {
  const url = p.kind === 'summary'
    ? '#/paper-summary/r/' + encodeURIComponent(p.share_token)
    : '#/paper-translate-full/r/' + encodeURIComponent(p.share_token);
  const kindLabel = p.kind === 'summary' ? '📑 要約' : '📑 全訳';
  const kindColor = p.kind === 'summary' ? '#7b3fa0' : '#4a106d';
  const date = (p.date || '').slice(0, 10);
  return `
    <a href="${escapeHtml(url)}" style="display:block; padding:8px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; text-decoration:none; color:inherit">
      <div style="display:flex; gap:6px; align-items:baseline; flex-wrap:wrap">
        <span style="font-size:10.5px; padding:1px 6px; border-radius:4px; background:${kindColor}; color:#fff">${kindLabel}</span>
        <div style="flex:1; min-width:0; font-size:13.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title || '(タイトル 不明)')}</div>
        <span class="hint-sm" style="font-size:10.5px">${escapeHtml(date)}</span>
      </div>
      ${p.venue    ? `<div style="margin-top:2px; font-size:11.5px; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">📍 ${escapeHtml(p.venue)}</div>` : ''}
      ${p.matched_name && p.matched_name !== '' ? `<div style="margin-top:2px; font-size:10.5px; color:#9ca3af">この論文での表記: ${escapeHtml(p.matched_name)}</div>` : ''}
    </a>`;
}
