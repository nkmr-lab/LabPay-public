// v933 印刷 / PDF 出力 の 共通 ヘルパ。
//   AI 結果ページ (要約 / 全訳 / 査読 / Deep Research) で 「📥 PDF に する」 ボタン を 押すと、
//   一時的 に document.title を いい 感じ の ファイル名 に 変えて window.print() を 呼ぶ。
//   ブラウザ の 「PDF として 保存」 で 保存 可能。 印刷CSS (.no-print) は style.css 側 に 定義。

// title は ブラウザ の 印刷ダイアログ で default ファイル名 に なる。 記号 は だいたい 通す が 一部 セーフ化。
function safeFilename(s) {
  return (s || 'labpay').replace(/[/\\:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// 使い方:
//   import { printAsPdf } from '/js/print_helpers.js';
//   <button onclick="printAsPdf('要約 - 論文タイトル')">📥 PDF に する</button>
export function printAsPdf(pdfTitle) {
  const origTitle = document.title;
  const newTitle = safeFilename(pdfTitle) + ' - LabPay';
  document.title = newTitle;
  document.body.classList.add('printing');
  const restore = () => {
    document.title = origTitle;
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  // 少し 遅延 (title 反映 + DOM 描画 待ち)
  setTimeout(() => {
    try { window.print(); }
    catch (e) { restore(); }
  }, 100);
}

// 汎用 「📥 PDF に する」 button HTML (btn クラス、 no-print 付き で 印刷時 は 消える)。
export function pdfButtonHtml(id = 'pdf-export-btn') {
  return `<button id="${id}" class="btn no-print" style="font-size:12px; padding:3px 10px" title="ブラウザ の 印刷 ダイアログ で 「PDF として 保存」 を 選ぶ">📥 PDF に する</button>`;
}

// ボタン 押下 に printAsPdf を wire up する 便利 関数。
export function wirePdfButton(buttonId, getTitle) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const title = typeof getTitle === 'function' ? getTitle() : String(getTitle || 'labpay');
    printAsPdf(title);
  });
}
