// /#/papers-recent — v809 論文 要約 + 全訳 を 時系列 で 全件 一覧。
//   公開 中 (is_shared=1, status=done) の もの と 自分 の もの (status 問わず) を 合算。
//   20 件 ずつ ページング (offset)、 「もっと 読み込む」 ボタン で 追加 取得。
import { get } from '../api.js';
import { state } from '../app.js';
import { renderPaperRecentRow } from './home.js';

const PAGE_SIZE = 20;

export async function renderPapersRecent() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📑 論文 要約 / 全訳 (新着)</h2>
    </div>
    <div class="card">
      <p class="hint" style="font-size:13px; margin:0 0 8px">
        公開 中 の もの + 自分 の もの を 時系列 で 表示。 タップ で 各 結果 ページ へ。
      </p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; font-size:12px">
        <a href="#/paper-summary" class="btn">📑 要約 を 新規 作成</a>
        <a href="#/paper-translate-full" class="btn">📑 全訳 を 新規 作成</a>
      </div>
    </div>
    <div class="card">
      <div id="papers-recent-list" class="list"><div class="hint">読み込み 中…</div></div>
      <div id="papers-recent-more" style="margin-top:10px; text-align:center"></div>
      <div id="papers-recent-status" class="hint" style="margin-top:6px; text-align:center; font-size:12px"></div>
    </div>
  `;
  const listEl = document.getElementById('papers-recent-list');
  const moreEl = document.getElementById('papers-recent-more');
  const statusEl = document.getElementById('papers-recent-status');
  let offset = 0;
  let acc = [];

  async function loadMore() {
    moreEl.innerHTML = '<div class="hint">読み込み 中…</div>';
    try {
      const d = await get(`/api/ai/paper_recent?limit=${PAGE_SIZE}&offset=${offset}`);
      const items = d.items || [];
      if (offset === 0 && !items.length) {
        listEl.innerHTML = '<div class="hint" style="font-size:13px">まだ 1 件 も ありません</div>';
        moreEl.innerHTML = '';
        return;
      }
      acc = acc.concat(items);
      listEl.innerHTML = acc.map(it => renderPaperRecentRow(it)).join('');
      offset += items.length;
      statusEl.textContent = `${acc.length} 件 表示 中`;
      if (d.has_more) {
        moreEl.innerHTML = '<button class="btn primary" id="papers-recent-more-btn">もっと 読み込む (+20)</button>';
        document.getElementById('papers-recent-more-btn')?.addEventListener('click', loadMore);
      } else {
        moreEl.innerHTML = '<div class="hint" style="font-size:12px">— これ で 全部 —</div>';
      }
    } catch (e) {
      moreEl.innerHTML = `<div class="hint" style="color:#c00">失敗: ${e?.message || e}</div>`;
    }
  }
  await loadMore();
}
