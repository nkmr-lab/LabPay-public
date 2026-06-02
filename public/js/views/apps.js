// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).

import { escapeHtml } from '../router.js';

const APPS = [
  { url: '#/roulette',    title: 'ルーレット',         desc: 'メンバーから 1 人をくじ引きで選ぶ。賞金つき可。' },
  { url: '#/nomikai',     title: '飲み会割り勘',       desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。' },
  { url: '#/groups',      title: '暫定グループ',       desc: '出張中の臨時メンバー枠。連絡 (メモ/URL/時間) + ワリカ (Splitwise 風 立替記録 → 精算) + ルーレット/割り勘ショートカット。' },
  { url: '#/scrapbox',    title: 'Scrapbox 履歴',      desc: '#scrapbox の研究ノート編集を読みやすくまとめて表示。' },
];

export async function renderApps() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">アプリ</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        ラボ内・出張中で使える小道具集です。
      </p>
    </div>
    <div class="list">
      ${APPS.map(a => `
        <a class="list-item" href="${a.url}" style="text-decoration:none; color:inherit">
          <div style="flex:1">
            <div class="bold">${escapeHtml(a.title)} →</div>
            <div class="meta">${escapeHtml(a.desc)}</div>
          </div>
        </a>`).join('')}
    </div>
  `;
}
