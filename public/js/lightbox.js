// v745 #356 画像全画面ライトボックス (共通化)。元は v492 #92 で posts.js に実装した
//   もの。同じ「別タブで開くと戻れない」問題が places.js でも起きていたので、
//   共有モジュールに切り出して両方から使えるようにした。
//
// 使い方:
//   単発:   openImageLightbox(src)
//   複数:   openImageLightbox(src, { images: [url1, url2, ...], index: 0 }) — v1149
//     - 左右矢印 ← → ボタン + キーボード ArrowLeft/ArrowRight + タッチ swipe で次/前の画像
//     - カウンター「3 / 7」を右下に表示
//   閉じる: × ボタン / 背景タップ / 画像タップ / Esc / ブラウザ戻る
//   回転:   opts.onRotate: (degrees, index) => Promise を渡すと 🔄 ボタン表示
//           (複数画像時は 1 枚目 index=0 のときだけ回転可、それ以外では非表示)

export function openImageLightbox(src, opts = {}) {
  const onRotate = typeof opts.onRotate === 'function' ? opts.onRotate : null;
  const onClose  = typeof opts.onClose  === 'function' ? opts.onClose  : null;
  // v1149 複数画像対応 (images 配列 + index)。 opts.images が無ければ src 単発。
  const images = Array.isArray(opts.images) && opts.images.length ? opts.images.slice(0, 100) : [src];
  let index = Math.max(0, Math.min(images.length - 1, Number(opts.index) || 0));
  if (!images[index]) index = 0;
  const isMulti = images.length > 1;

  const old = document.getElementById('lb-overlay');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'lb-overlay';
  box.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; cursor:zoom-out; touch-action:pan-y';
  box.innerHTML = `
    <button id="lb-close" aria-label="閉じる"
            style="position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; font-size:22px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:2">×</button>
    ${onRotate ? `<button id="lb-rotate" title="90° 回転"
            style="position:absolute; top:12px; right:64px; height:44px; padding:0 14px; border-radius:22px; background:rgba(255,255,255,0.92); border:none; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; gap:4px; z-index:2">🔄 回転</button>` : ''}
    ${isMulti ? `
      <button id="lb-prev" aria-label="前の画像"
              style="position:absolute; left:12px; top:50%; transform:translateY(-50%); width:52px; height:52px; border-radius:50%; background:rgba(255,255,255,0.85); border:none; font-size:24px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:2">‹</button>
      <button id="lb-next" aria-label="次の画像"
              style="position:absolute; right:12px; top:50%; transform:translateY(-50%); width:52px; height:52px; border-radius:50%; background:rgba(255,255,255,0.85); border:none; font-size:24px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:2">›</button>
      <div id="lb-counter" style="position:absolute; bottom:16px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.6); color:#fff; padding:4px 12px; border-radius:12px; font-size:13px; font-weight:600; z-index:2">${index + 1} / ${images.length}</div>
    ` : ''}
    <div id="lb-loading" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:#fff; font-size:14px">
      <div style="width:36px; height:36px; border:3px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:lb-spin 1s linear infinite"></div>
      <div id="lb-pct">読み込み中…</div>
    </div>
    <img id="lb-img" alt="" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:6px; visibility:hidden">
    <style>@keyframes lb-spin { to { transform: rotate(360deg); } }</style>`;
  document.body.appendChild(box);

  const imgEl = box.querySelector('#lb-img');
  const loadEl = box.querySelector('#lb-loading');
  const pctEl = box.querySelector('#lb-pct');
  const counterEl = box.querySelector('#lb-counter');
  const rotateBtn = box.querySelector('#lb-rotate');
  let currentSrc = images[index];
  function loadImage(url) {
    if (loadEl && !loadEl.parentNode) box.insertBefore(loadEl, imgEl);
    if (imgEl.src && imgEl.src.startsWith('blob:')) URL.revokeObjectURL(imgEl.src);
    imgEl.style.visibility = 'hidden';
    if (pctEl) pctEl.textContent = '読み込み中…';
    // v1349 fb 中村さん報告「今日のラボフォトから写真を選択して表示しようとすると読み込み失敗」。
    //   原因: 別 origin (photo.nkmr.io) の画像を XHR で blob 取得すると withCredentials=false の
    //   ため SSO cookie が送られず、認証切れ画面 HTML が返って画像として表示できない (blob は
    //   200 で来るが img.onload しないので表示されず「読み込み失敗」表示)。 img タグ経由なら
    //   cross-origin でも SameSite=Lax cookie が送られて認証は通る。 progress は諦める代わりに
    //   確実に表示できる方を取る。
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) {
        imgEl.onload = () => {
          if (loadEl?.parentNode) loadEl.parentNode.removeChild(loadEl);
          imgEl.style.visibility = 'visible';
          if (pctEl) pctEl.textContent = '';
        };
        imgEl.onerror = () => { if (pctEl) pctEl.textContent = '読み込み失敗'; };
        imgEl.src = url;
        return;
      }
    } catch (_) {}
    // 同 origin は従来通り XHR で progress を出しつつ blob 化
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.floor(e.loaded * 100 / e.total);
        const mb = (e.total / 1048576).toFixed(1);
        if (pctEl) pctEl.textContent = `${pct}%  (${mb} MB)`;
      } else if (pctEl) {
        pctEl.textContent = `${(e.loaded / 1048576).toFixed(1)} MB 読込中…`;
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response) {
        const objUrl = URL.createObjectURL(xhr.response);
        imgEl.src = objUrl;
        imgEl.onload = () => {
          if (loadEl?.parentNode) loadEl.parentNode.removeChild(loadEl);
          imgEl.style.visibility = 'visible';
        };
      } else if (pctEl) { pctEl.textContent = '読み込み失敗'; }
    };
    xhr.onerror = () => { if (pctEl) pctEl.textContent = '読み込み失敗'; };
    xhr.send();
  }
  function updateRotateVisibility() {
    // 複数画像時は 1 枚目 (index=0) のみ回転可
    if (rotateBtn) rotateBtn.style.display = (isMulti && index !== 0) ? 'none' : '';
  }
  function go(newIndex) {
    if (!isMulti) return;
    if (newIndex < 0) newIndex = images.length - 1;
    if (newIndex >= images.length) newIndex = 0;
    if (newIndex === index) return;
    index = newIndex;
    currentSrc = images[index];
    if (counterEl) counterEl.textContent = `${index + 1} / ${images.length}`;
    updateRotateVisibility();
    loadImage(currentSrc);
  }
  updateRotateVisibility();
  loadImage(currentSrc);

  if (onRotate && rotateBtn) {
    rotateBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const btn = ev.currentTarget;
      btn.disabled = true;
      const oldText = btn.textContent; btn.textContent = '処理中…';
      try {
        await onRotate(90, index);
        // cache-bust で再ロード + images 配列も更新
        const base = currentSrc.replace(/[?&]v=\d+(&|$)/, '').replace(/\?$/, '');
        const sep = base.includes('?') ? '&' : '?';
        currentSrc = base + sep + 'v=' + Date.now();
        images[index] = currentSrc;
        loadImage(currentSrc);
      } catch (e) {
        alert('回転失敗: ' + (e?.message || e));
      } finally {
        btn.disabled = false; btn.textContent = oldText;
      }
    });
  }

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  history.pushState({ lb: 1 }, '');
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    box.remove();
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    if (history.state && history.state.lb) history.back();
    if (onClose) { try { onClose(); } catch (_) {} }
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { close(); return; }
    if (isMulti && ev.key === 'ArrowLeft')  { ev.preventDefault(); go(index - 1); }
    if (isMulti && ev.key === 'ArrowRight') { ev.preventDefault(); go(index + 1); }
  };
  const onPop = () => { closing = true; box.remove(); document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); if (onClose) { try { onClose(); } catch (_) {} } };
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  box.querySelector('#lb-close').addEventListener('click', (ev) => { ev.stopPropagation(); close(); });
  const prevBtn = box.querySelector('#lb-prev');
  const nextBtn = box.querySelector('#lb-next');
  if (prevBtn) prevBtn.addEventListener('click', (ev) => { ev.stopPropagation(); go(index - 1); });
  if (nextBtn) nextBtn.addEventListener('click', (ev) => { ev.stopPropagation(); go(index + 1); });

  // v1149 touch swipe (左右 40px 以上で ±1、縦スワイプは閉じない)
  if (isMulti) {
    let sx = 0, sy = 0, swiping = false;
    box.addEventListener('touchstart', (ev) => {
      if (ev.touches.length !== 1) return;
      sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; swiping = true;
    }, { passive: true });
    box.addEventListener('touchend', (ev) => {
      if (!swiping) return;
      swiping = false;
      const t = ev.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // 横スワイプ → 前 / 次
        ev.preventDefault();
        ev.stopPropagation();   // タップ判定を潰してオーバーレイの close を止める
        if (dx > 0) go(index - 1); else go(index + 1);
        // 直後の click で close されないようにフラグ
        box.dataset.swiped = '1';
        setTimeout(() => { delete box.dataset.swiped; }, 300);
      }
    }, { passive: false });
  }

  box.addEventListener('click', (ev) => {
    // ライトボックス内のボタン (× / 🔄 / ← / →) はタップで閉じない
    if (ev.target.closest('#lb-close, #lb-rotate, #lb-prev, #lb-next, #lb-counter')) return;
    // 直前が swipe だった場合は閉じない (v1149)
    if (box.dataset.swiped) return;
    close();
  });
}
