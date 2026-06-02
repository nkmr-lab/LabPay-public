// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).

import { escapeHtml } from '../router.js';

const APPS = [
  { url: '#/roulette',    title: 'ルーレット',         desc: 'メンバーから 1 人をくじ引きで選ぶ。賞金つき可。' },
  { url: '#/wari',        title: 'ワリカ',             desc: '多通貨対応の割り勘計算 — 円換算でメンバー均等割り。' },
  { url: '#/nomikai',     title: '飲み会割り勘',       desc: '総額 + メンバー + 飲酒/学年傾斜で算出、支払い済みチェックまで。' },
  { url: '#/groups',      title: '暫定グループ',       desc: '出張中などの臨時メンバー枠で連絡 (メモ/URL/時間) + ルーレット/割り勘ショートカット。' },
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
