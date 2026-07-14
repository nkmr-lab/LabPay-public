// /#/requests-hub — 「頼む」系 (タスク / 募集 / 投票・アンケート) の集約ランディング。
// タップで個別のページへ。

import { escapeHtml } from '../router.js';

const ITEMS = [
  { url: '#/tasks',         title: '✅ タスク',           desc: '誰かにお願い → 引き受け → 完了報告 → 承認。ポイント付与可、期限・指名タスク対応。' },
  { url: '#/invitations',   title: '📢 募集',             desc: 'お昼ご飯 / ビアガーデン / ポケモンGO などカジュアル招集。参加表明型、 6h で自動 close。' },
  { url: '#/polls',         title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。個人の票は非公開、集計の可視タイミングは選べる。' },
  { url: '#/rollcalls',     title: '📣 点呼',             desc: '「いる？」「起きてる？」をワンタップで集める。締切タイマー + 未応答者に催促 push 通知。' },
  { url: '#/requests',      title: '💸 請求 (集金)',      desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。' },
  // v1081 中村さん指示「依頼タブの中にも入れて」
  { url: '#/buy-requests',  title: '🛒 購入依頼',         desc: '「これ買ってほしい」を中村さんに投げる (URL + 商品名 + 数量 + 理由)。中村さんが「買った / 却下」を返す。従来 #want_to_buy Slack の後継。LabPay 台帳のお金は動かない、現物受渡しだけ。' },
];

export async function renderRequestsHub() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">依頼</h2>
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
