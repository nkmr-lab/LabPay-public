// /#/games — 娯楽ハブ。 LabPay 内の ゲーム / ランダム系アプリを 1 箇所にまとめて表示。
// v571 #タブ追加 (v573 で 「娯楽」 にリネーム)。 lazy import なので 普段は読み込まれない。

import { escapeHtml } from '../router.js';

const GAMES = [
  { id: 'mahjong',   icon: '🀄', name: '麻雀',         url: '#/mahjong',
    desc: '4 人 50pt 賭けプール で 本格麻雀 (門前/鳴き/役判定/連荘/半荘)。 終了時に順位別 payout',
    badge: 'プレイ料 (賭けプール)' },
  { id: 'mahjong-ai',icon: '🤖', name: 'AI 麻雀 (練習)', url: '#/mahjong',
    desc: '人間 1 + AI 3 で 1 半荘。 ポイント授受なしの練習モード (AI 弱めなので 純粋に 役・打牌の練習用)',
    badge: '無料 / ポイント無し' },
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
  { id: 'regions',   icon: '🗺', name: '制覇マップ',   url: '#/regions',
    desc: '行った国・都道府県をタップで登録 → 進捗バー (X/47都道府県やX/100+国) + ラボ内の集計',
    badge: '無料' },
  { id: 'playlists', icon: '🎵', name: 'プレイリスト', url: '#/playlists',
    desc: 'YouTube/Spotify URLをまとめて紹介。⭐評価+コメント+❤️お気に入り+ジャンル+シャッフル再生',
    badge: '無料' },
  { id: 'predictions', icon: '🏆', name: '優勝予想',   url: '#/predictions',
    desc: 'W 杯 / スポーツ大会 / 学会 best paper など 順位を予想して 参加フィー を山分け',
    badge: '参加フィー (10-100pt 設定可)' },
  { id: 'othello',   icon: '💣', name: '地雷オセロ',  url: '#/othello',
    desc: '通常オセロ + 各自 2 か所 地雷 (踏むと 3x3 反転)。 勝者が pot 総取り',
    badge: 'プレイ料 1pt' },
  { id: 'daifugo',   icon: '🃏', name: '大富豪',      url: '#/daifugo',
    desc: '2-4 人、 単出し / ペア / N 枚 出し。 1 位 が pot 総取り (シンプル ルール)',
    badge: 'プレイ料 1pt' },
  // v603 娯楽カテゴリへ追加 (apps cat='game' と同期)
  { id: 'sns',       icon: '💬', name: 'らぼったー',  url: '#/sns',
    desc: 'シンプルなつぶやき (テキスト + 画像 + 位置 + リアクション)。フォローなし、全員見える',
    badge: '無料' },
  { id: 'places',    icon: '🍴', name: '食べある記',  url: '#/places',
    desc: 'お店情報をラボメンバーで共有。口コミ・写真・⭐評価 + 地図ビュー',
    badge: '無料' },
  { id: 'flight',    icon: '✈️', name: 'フライト応援', url: '#/flight',
    desc: '長いフライトの進捗 (%) / 残り時間を大きく可視化。完全オフライン',
    badge: '無料' },
];

const CATEGORIES = [
  { key: 'gamble',    label: '⚔️ 対戦' },
  { key: 'predict',   label: '🏆 予想 / 当て物' },
  { key: 'party',     label: '🎉 パーティー' },
  { key: 'collect',   label: '🗺 集める / 制覇する' },
  { key: 'community', label: '💬 みんなで共有' }, // v603
  { key: 'solo',      label: '✈️ ひとり遊び' },   // v603
];

const GAME_CATEGORY = {
  mahjong:       'gamble',
  'mahjong-ai':  'gamble',
  othello:       'gamble',
  daifugo:       'gamble',
  predictions:   'predict',
  ito:           'party',
  jinrou:        'party',
  shiritori:     'party',
  tierlists:     'collect', // v600 #229 ティア表は 集める/制覇カテゴリへ (好きな物を分類する系)
  regions:       'collect',
  playlists:     'collect', // v600 #230 プレイリストは 集める/制覇 (音楽コレクション)
  sns:           'community', // v603
  places:        'community', // v603
  flight:        'solo',      // v603
};

export function renderGames() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎮 娯楽</h2>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        ラボメンバーで遊べる ゲーム。 プレイフィー / 賭け / 無料 がそれぞれ並びます。
        (ルーレット / どこ行く / 順番決め は <a href="#/apps">アプリ</a> タブから)
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
