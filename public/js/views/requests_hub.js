// /#/requests-hub — 「頼む」 系 (タスク / 募集 / 投票・アンケート) の集約ランディング。
// タップで 個別のページへ。

import { escapeHtml } from '../router.js';

const ITEMS = [
  { url: '#/tasks',       title: '✅ タスク',           desc: '誰かにお願い → 引き受け → 完了報告 → 承認。 ポイント付与可、 期限・指名タスク対応。' },
  { url: '#/invitations', title: '📢 募集',             desc: 'お昼ご飯 / ビアガーデン / ポケモンGO など カジュアル招集。 参加表明型、 6h で自動 close。' },
  { url: '#/polls',       title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。 個人の票は非公開、 集計の可視タイミングは選べる。' },
];

export async function renderRequestsHub() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">依頼</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        誰かに 「頼みたい」 をまとめる場所。
      </p>
    </div>
    <div class="list">
      ${ITEMS.map(a => `
        <a class="list-item" href="${a.url}">
          <div class="grow">
            <div class="bold">${a.title} →</div>
            <div class="meta">${escapeHtml(a.desc)}</div>
          </div>
        </a>`).join('')}
    </div>
  `;
}
