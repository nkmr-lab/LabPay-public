// 共有 モーダル ヘルパ。 各 view で 「position:fixed; inset:0; background:rgba(0,0,0,0.5);
// z-index:9999; display:flex; ...」 の オーバーレイ + 「白い カード + × ボタン + 中身」 を
// 書いていたが、 13 箇所くらいで コピペ されていた。 ここに集約。
//
// 使い方:
//   import { openModal } from '../modal.js';
//   const m = openModal({
//     title: '✏️ 編集',
//     bodyHtml: `<label>...</label><input id="..." />...`,
//     buttons: [
//       { label: 'キャンセル', kind: 'btn',     onClick: () => m.close() },
//       { label: '保存',       kind: 'primary', onClick: async () => { ...; m.close(); } },
//     ],
//     maxWidth: 480,    // 任意
//     onClose: () => {} // 任意
//   });
//   m.root          // 中身の DOM (= 中の白カード)。 querySelector で 中身を取り出せる
//   m.close()        // 閉じる
//   m.setBusy(true)  // 保存中の disabled
//
// content か bodyHtml の どちらかを 指定 (content は DOM element、 bodyHtml は string)。
// buttons を 省略すれば 右上 × だけ。

let zCounter = 9990;

export function openModal(opts = {}) {
  const {
    title = '',
    bodyHtml = '',
    content = null,
    buttons = [],
    maxWidth = 480,
    onClose = null,
    closeOnBackdrop = true,
  } = opts;

  zCounter++;
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.5);
    z-index:${zCounter}; display:flex; align-items:flex-start;
    padding:20px; overflow-y:auto; justify-content:center
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:#fff; border-radius:12px; padding:14px;
    max-width:${maxWidth}px; width:100%; box-sizing:border-box
  `;

  const header = document.createElement('div');
  header.className = 'row center';
  header.style.cssText = 'margin-bottom:8px';
  header.innerHTML = `
    <h3 style="margin:0; flex:1">${title}</h3>
    <button data-mclose class="btn" aria-label="閉じる">×</button>
  `;
  card.appendChild(header);

  const bodyWrap = document.createElement('div');
  if (content) bodyWrap.appendChild(content);
  else bodyWrap.innerHTML = bodyHtml;
  card.appendChild(bodyWrap);

  let buttonRow = null;
  if (buttons && buttons.length) {
    buttonRow = document.createElement('div');
    buttonRow.className = 'row';
    buttonRow.style.cssText = 'gap:6px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap';
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.kind === 'primary') btn.className = 'primary';
      else if (b.kind === 'danger') btn.className = 'danger';
      else btn.className = 'btn';
      btn.addEventListener('click', async () => {
        if (b.onClick) await b.onClick(api);
      });
      buttonRow.appendChild(btn);
    });
    card.appendChild(buttonRow);
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() {
    if (!overlay.isConnected) return;
    overlay.remove();
    if (onClose) try { onClose(); } catch (_) {}
  }
  overlay.querySelector('[data-mclose]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && closeOnBackdrop) close();
  });

  function setBusy(busy) {
    if (!buttonRow) return;
    buttonRow.querySelectorAll('button').forEach(b => { b.disabled = !!busy; });
  }

  const api = {
    root: bodyWrap,
    overlay,
    close,
    setBusy,
    setTitle: (t) => { const h = header.querySelector('h3'); if (h) h.textContent = t; },
  };
  return api;
}

// 「キャンセル + 確定」 の 2 ボタン モーダルの 薄いラッパ。
// async function 内で `const ok = await confirmModal({...}); if (!ok) return;`
export function confirmModal({ title, message, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise(resolve => {
    let resolved = false;
    const m = openModal({
      title: title || '確認',
      bodyHtml: `<div style="white-space:pre-wrap; padding:6px 0">${message || ''}</div>`,
      buttons: [
        { label: cancelLabel, kind: 'btn',                    onClick: () => { if (!resolved) { resolved = true; resolve(false); } m.close(); } },
        { label: okLabel,     kind: danger ? 'danger' : 'primary', onClick: () => { if (!resolved) { resolved = true; resolve(true); }  m.close(); } },
      ],
      onClose: () => { if (!resolved) { resolved = true; resolve(false); } },
    });
  });
}
