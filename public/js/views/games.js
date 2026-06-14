// /#/games — ゲームハブ。 LabPay 内の ゲーム系アプリを 1 箇所にまとめて表示。
// v571 #タブ追加。 lazy import なので 普段は読み込まれない。

import { escapeHtml } from '../router.js';

const GAMES = [
  { id: 'mahjong',   icon: '🀄', name: '麻雀',         url: '#/mahjong',
    desc: '4 人 50pt 賭けプール で 本格麻雀 (門前/鳴き/役判定/連荘/半荘)。 終了時に順位別 payout',
    badge: 'プレイ料 (賭けプール)' },
  { id: 'mahjong-ai',icon: '🤖', name: 'AI 麻雀',      url: '#/mahjong',
    desc: '人間 1 + AI 3 で 1 半荘。 1 位 +15pt / 2 位 +5pt / 3 位 -3pt / 4 位 -5pt',
    badge: 'プレイフィー 5pt' },
  { id: 'ito',       icon: '🎲', name: 'ito',          url: '#/ito',
    desc: '協力ゲーム。 各自に 1-100 配布 → お題に沿った表現 → 全員の数字を開示',
    badge: 'プレイフィー' },
  { id: 'jinrou',    icon: '🐺', name: '人狼',         url: '#/jinrou',
    desc: '4-16 人。 役職配布 (人狼/占い/騎士/村人) → 夜 + 昼 で 勝敗',
    badge: 'プレイフィー' },
  { id: 'shiritori', icon: '🎨', name: '絵しりとり',   url: '#/shiritori',
    desc: 'タイムリミット付きキャンバスで 順番に絵を描く。 1 つ前の絵を当てる',
    badge: '無料' },
  { id: 'tierlists', icon: '🎯', name: 'ティア表',     url: '#/tierlists',
    desc: 'お題 + 候補リスト で みんなで S/A/B/C/D/F 6 段階の ティア分け',
    badge: '無料' },
  { id: 'roulette',  icon: '🎰', name: 'ルーレット',   url: '#/roulette',
    desc: 'メンバーから ランダムに 1 人 選ぶ (くじ引き)',
    badge: '無料' },
  { id: 'text-roulette', icon: '🍜', name: 'どこ行く', url: '#/text-roulette',
    desc: '候補テキストから ランダムに 1 つ 選ぶ (ランチ決め等)',
    badge: '無料' },
  { id: 'orderings', icon: '📋', name: '順番決め',     url: '#/orderings',
    desc: 'メンバー or 候補を ランダムに 並び替え (発表順 / シャッフル)',
    badge: '無料' },
];

const CATEGORIES = [
  { key: 'gamble', label: '💰 賭け / フィー' },
  { key: 'party',  label: '🎉 パーティー' },
  { key: 'random', label: '🎲 ランダム選び' },
];

const GAME_CATEGORY = {
  mahjong:       'gamble',
  'mahjong-ai':  'gamble',
  ito:           'party',
  jinrou:        'party',
  shiritori:     'party',
  tierlists:     'party',
  roulette:      'random',
  'text-roulette': 'random',
  orderings:     'random',
};

export function renderGames() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎮 ゲーム</h2>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        ラボメンバーで遊べる ゲーム集。 プレイフィー / 賭け / 無料 がそれぞれ並びます。
      </p>
    </div>
    ${CATEGORIES.map(cat => {
      const inCat = GAMES.filter(g => GAME_CATEGORY[g.id] === cat.key);
      if (!inCat.length) return '';
      return `
        <div class="card">
          <div class="bold" style="margin-bottom:6px">${escapeHtml(cat.label)}</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:8px">
            ${inCat.map(g => `
              <a href="${escapeHtml(g.url)}" style="display:flex; gap:8px; padding:10px; border:1px solid var(--line); border-radius:8px; background:#fff; text-decoration:none; color:inherit">
                <div style="font-size:32px; line-height:1; flex:none">${g.icon}</div>
                <div style="min-width:0; flex:1">
                  <div class="bold">${escapeHtml(g.name)}</div>
                  <div class="meta" style="font-size:11px; margin:2px 0 4px">${escapeHtml(g.badge)}</div>
                  <div style="font-size:12px; color:var(--muted); line-height:1.4">${escapeHtml(g.desc)}</div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}
