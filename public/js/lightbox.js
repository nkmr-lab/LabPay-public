// v745 #356 画像 全画面 ライトボックス (共通 化)。 元は v492 #92 で posts.js に実装した
//   もの。 同じ 「別タブ で 開くと 戻れない」 問題が places.js でも起きていたので、
//   共有 モジュール に 切り出して 両方 から 使えるように した。
//
//   使い方: import { openImageLightbox } from '../lightbox.js'; openImageLightbox(src);
//   挙動: × ボタン / 背景 タップ / 画像 タップ / Esc で 閉じる。 body スクロール ロック。
//   大きな 画像 で 体感数秒 空く ので XHR で progress 表示。

export function openImageLightbox(src, opts = {}) {
  // v754 #370 opts.onRotate: async (degrees) => void がある と
  //   オーバーレイ 内に「🔄 回転」 ボタンを表示。 タップ で onRotate(90) を呼んで、
  //   解決後 cache-bust で 再ロードして 表示し直す。
  const onRotate = typeof opts.onRotate === 'function' ? opts.onRotate : null;
  const old = document.getElementById('lb-overlay');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'lb-overlay';
  box.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; cursor:zoom-out';
  box.innerHTML = `
    <button id="lb-close" aria-label="閉じる"
            style="position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; font-size:22px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center">×</button>
    ${onRotate ? `<button id="lb-rotate" title="90° 回転"
            style="position:absolute; top:12px; right:64px; height:44px; padding:0 14px; border-radius:22px; background:rgba(255,255,255,0.92); border:none; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; gap:4px">🔄 回転</button>` : ''}
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
  // 同じ src を 何度 cache-bust しても 同じ URL で fetch する ように、 現在 表示中 の URL を 持つ
  let currentSrc = src;
  function loadImage(url) {
    if (loadEl && !loadEl.parentNode) box.insertBefore(loadEl, imgEl);
    if (imgEl.src && imgEl.src.startsWith('blob:')) URL.revokeObjectURL(imgEl.src);
    imgEl.style.visibility = 'hidden';
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
  loadImage(currentSrc);

  if (onRotate) {
    box.querySelector('#lb-rotate').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const btn = ev.currentTarget;
      btn.disabled = true;
      const old = btn.textContent; btn.textContent = '処理中…';
      try {
        await onRotate(90);
        // cache-bust で 再ロード
        const base = currentSrc.replace(/[?&]v=\d+(&|$)/, '').replace(/\?$/, '');
        const sep = base.includes('?') ? '&' : '?';
        currentSrc = base + sep + 'v=' + Date.now();
        loadImage(currentSrc);
      } catch (e) {
        alert('回転 失敗: ' + (e?.message || e));
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    });
  }

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  // popstate を 拾って 閉じる: スマホ の 戻る ボタンや スワイプ で 「戻る」 と
  //   思った 時 に SPA ナビゲーション せず ライトボックス だけ 閉じる ように。
  history.pushState({ lb: 1 }, '');
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    box.remove();
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    // 自分 が push した state の 場合 だけ pop 戻す (popstate 経由の close では skip)
    if (history.state && history.state.lb) history.back();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const onPop = () => { closing = true; box.remove(); document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  document.getElementById('lb-close').addEventListener('click', (ev) => { ev.stopPropagation(); close(); });
  box.addEventListener('click', (ev) => {
    // ライトボックス 内 の ボタン (× / 🔄) は タップ で 閉じない、 それ以外 タップ で 閉じる
    if (ev.target.closest('#lb-close, #lb-rotate')) return;
    close();
  });
}
