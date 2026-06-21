// v745 #356 画像 全画面 ライトボックス (共通 化)。 元は v492 #92 で posts.js に実装した
//   もの。 同じ 「別タブ で 開くと 戻れない」 問題が places.js でも起きていたので、
//   共有 モジュール に 切り出して 両方 から 使えるように した。
//
//   使い方: import { openImageLightbox } from '../lightbox.js'; openImageLightbox(src);
//   挙動: × ボタン / 背景 タップ / 画像 タップ / Esc で 閉じる。 body スクロール ロック。
//   大きな 画像 で 体感数秒 空く ので XHR で progress 表示。

export function openImageLightbox(src) {
  const old = document.getElementById('lb-overlay');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'lb-overlay';
  box.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; cursor:zoom-out';
  box.innerHTML = `
    <button id="lb-close" aria-label="閉じる"
            style="position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; font-size:22px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center">×</button>
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
  const xhr = new XMLHttpRequest();
  xhr.open('GET', src, true);
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
        if (loadEl) loadEl.remove();
        imgEl.style.visibility = 'visible';
      };
    } else if (pctEl) { pctEl.textContent = '読み込み失敗'; }
  };
  xhr.onerror = () => { if (pctEl) pctEl.textContent = '読み込み失敗'; };
  xhr.send();

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
    if (ev.target.id !== 'lb-close') close();
  });
}
