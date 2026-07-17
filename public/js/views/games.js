// /#/games — 娯楽ハブ。 LabPay 内のゲーム / ランダム系アプリを 1 箇所にまとめて表示。
// v571 #タブ追加 (v573 で「娯楽」にリネーム)。 lazy import なので普段は読み込まれない。

import { escapeHtml } from '../router.js';

const GAMES = [
  { id: 'mahjong',   icon: '🀄', name: '麻雀',         url: '#/mahjong',
    desc: '4 人 50pt 賭けプールで本格麻雀 (門前/鳴き/役判定/連荘/半荘)。終了時に順位別 payout',
    badge: '賭けプール 50pt' },
  { id: 'ito',       icon: '🎲', name: 'ito',          url: '#/ito',
    desc: '協力ゲーム。各自に 1-100 配布 → お題に沿った表現 → 全員の数字を開示',
    badge: 'プレイフィー 5pt / 人' },
  { id: 'jinrou',    icon: '🐺', name: '人狼',         url: '#/jinrou',
    desc: '4-16 人。役職配布 (人狼/占い/騎士/村人) → 夜 + 昼で勝敗',
    badge: 'プレイフィー 5pt / 人' },
  { id: 'shiritori', icon: '🎨', name: '絵しりとり',   url: '#/shiritori',
    desc: 'タイムリミット付きキャンバスで順番に絵を描く。 1 つ前の絵を当てる',
    badge: 'プレイフィー 5pt / 人' },
  { id: 'tierlists', icon: '🎯', name: 'ティア表',     url: '#/tierlists',
    desc: 'お題 + 候補リストでみんなで S/A/B/C/D/F 6 段階のティア分け' },
  { id: 'regions',   icon: '🗺', name: '制覇マップ',   url: '#/regions',
    desc: '行った国・都道府県をタップで登録 → 進捗バー (X/47都道府県やX/100+国) + ラボ内の集計' },
  { id: 'playlists', icon: '🎵', name: 'プレイリスト', url: '#/playlists',
    desc: 'YouTube/Spotify URLをまとめて紹介。⭐評価+コメント+❤️お気に入り+ジャンル+シャッフル再生' },
  { id: 'predictions', icon: '🏆', name: '優勝予想',   url: '#/predictions',
    desc: 'W 杯 / スポーツ大会 / 学会 best paper など順位を予想して参加フィーを山分け',
    badge: 'プレイフィー 10-100pt' },
  { id: 'score-predictions', icon: '🎯', name: '勝敗予測', url: '#/score-predictions',
    desc: '試合のスコアを完璧に当てた人が山分け',
    badge: 'プレイフィー 10-100pt' },
  { id: 'othello',   icon: '💣', name: '地雷オセロ',  url: '#/othello',
    desc: '通常オセロ + 各自 1 か所地雷 (踏むと 3x3 反転)',
    badge: 'プレイフィー 2pt' },
  { id: 'daifugo',   icon: '🃏', name: '大富豪',      url: '#/daifugo',
    desc: '2-4 人、単出し / ペア / N 枚出し + 革命 + 8切り',
    badge: 'プレイフィー 5pt / 人' },
  { id: 'tictactoe', icon: '⭕', name: 'マルバツ',     url: '#/tictactoe',
    desc: '3x3 マルバツ。縦/横/斜め 3 つ並べたら勝ち。自作ゲームフレームワークのサンプル',
    badge: 'プレイフィー 1pt' },
  // v603 娯楽カテゴリへ追加 (apps cat='game' と同期)
  { id: 'sns',       icon: '💬', name: 'らぼったー',  url: '#/sns',
    desc: 'シンプルなつぶやき (テキスト + 画像 + 位置 + リアクション)。フォローなし、全員見える' },
  { id: 'places',    icon: '🍴', name: '食べある記',  url: '#/places',
    desc: 'お店情報をラボメンバーで共有。口コミ・写真・⭐評価 + 地図ビュー' },
  { id: 'flight',    icon: '✈️', name: 'フライト応援', url: '#/flight',
    desc: '長いフライトの進捗 (%) / 残り時間を大きく可視化。完全オフライン' },
  // v637 lab-mgmt から娯楽へ移動
  { id: 'drafts',    icon: '⚾', name: 'ドラフト',    url: '#/drafts',
    desc: 'プロ野球風順番指名 + くじ抽選。参加者と候補 (人 or 自由入力) を揃えて 1 位、 2 位と順番指名。競合はくじで決着' },
  { id: 'quizzes',   icon: '📝', name: 'フリップクイズ', url: '#/quizzes',
    desc: '出題 → 参加者フリップ記述回答 → 一斉開示 (タップで拡大) → ⭕❌ 採点 → ランキング集計' },
  // v672 #252 占いを娯楽タブにも。 v816 #408 西洋占星術 (12 星座) を追加
  { id: 'fortune',   icon: '🔮', name: '今日の占い + ♈ 西洋占星術', url: '#/fortune',
    desc: '1 日 1 回だけ引ける運勢 + 誕生日から 12 星座占い (ラッキーカラー / アイテム / ナンバー付き)' },
  // v837 cat='game' の APPS に揃える (apps.js との同期漏れ修正)
  { id: 'cg2',       icon: '🎮', name: '自作ゲームv2 (cg2)', url: '#/cg2',
    desc: 'p5.jsベースの准リアルタイムmultiplayerフレームワーク。マルバツ/ニム/ライツアウト/すごろくのサンプル付き' },
  { id: 'bingofit',  icon: '👕', name: 'BingoFit', url: '#/bingofit/closet',
    desc: '手持ちの服を25着以上登録すると、日曜始まりの5x5ビンゴ盤が自動生成。着た服を盤面から開けてラインが揃えばビンゴ' },
  { id: 'bingo',     icon: '🎰', name: 'ビンゴ (週次)', url: '#/bingo',
    desc: '毎週5x5ビンゴカードが自動生成。平日の行動(ラボイン/らぼったー投稿/麻雀/オセロ/食べある記など)が自動カウント' },
  // v860 #445 ユーザ自由制覇リスト
  { id: 'conquest',  icon: '🏁', name: '制覇リスト',   url: '#/conquest',
    desc: '街のパン屋 / ラーメン屋 / 温泉地など自分だけの制覇対象リストを作って、達成したらチェック。公開すればみんなでアイテムを育てられる' },
  // v872 #454 早押しクイズ (リアル現場)
  { id: 'buzzer',    icon: '⚡', name: '早押しクイズ', url: '#/buzzer',
    desc: 'リアル現場 (ゼミ / 飲み会等) で出題者が口頭出題 → 参加者がスマホで早押しボタン。 1 位緑 / 他赤 + 1 位との差を ms で表示' },
];

const CATEGORIES = [
  { key: 'community', label: '💬 みんなで共有' }, // v604 最上段に
  { key: 'gamble',    label: '⚔️ 対戦' },
  { key: 'predict',   label: '🏆 予想 / 当て物' },
  { key: 'party',     label: '🎉 パーティー' },
  { key: 'collect',   label: '🗺 集める / 制覇する' },
  { key: 'solo',      label: '✈️ ひとり遊び' },
];

const GAME_CATEGORY = {
  mahjong:       'gamble',
  othello:       'gamble',
  daifugo:       'gamble',
  tictactoe:     'gamble',
  predictions:        'predict',
  'score-predictions': 'predict',
  ito:           'party',
  jinrou:        'party',
  shiritori:     'party',
  tierlists:     'collect', // v600 #229 ティア表は集める/制覇カテゴリへ (好きな物を分類する系)
  regions:       'collect',
  playlists:     'collect', // v600 #230 プレイリストは集める/制覇 (音楽コレクション)
  sns:           'community', // v603
  places:        'community', // v603
  flight:        'solo',      // v603
  drafts:        'party',     // v637
  quizzes:       'party',     // v637
  fortune:       'solo',      // v672 #252
  cg2:           'gamble',    // v837
  bingofit:      'collect',   // v837
  bingo:         'collect',   // v837
  conquest:      'collect',   // v873 #445 ユーザ自由制覇リストも「集める / 制覇する」へ
  buzzer:        'party',     // v873 #454 早押しクイズはパーティーへ
};

export function renderGames() {
  const app = document.getElementById('app');
  app.innerHTML = `
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
                  ${g.badge ? `<div class="meta" style="font-size:11px; margin:2px 0 4px">${escapeHtml(g.badge)}</div>` : ''}
                  <div style="font-size:12px; color:var(--muted); line-height:1.4">${escapeHtml(g.desc)}</div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}
