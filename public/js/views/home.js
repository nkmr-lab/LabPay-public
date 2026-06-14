import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, state, toast } from '../app.js';
import { ledgerTypeLabel } from '../labels.js';
import { coverListItem } from './groups.js';
import { fmtDate, fmtDateTime, participantChipRow } from '../format.js';

// v445 復活: 端末の今いる場所 (実 OS タイムゾーン) を取り出す ヘルパ。
// iana   = "Asia/Tokyo" 等。 サーバ に 「自分の今日」 を計算してもらう用。
// suffix = "+09:00" 等。 datetime-local の文字列に 付けて 正しい ISO に する用。
// 海外滞在中も そのまま動く (端末 OS の TZ を 拾う)。
function localTzInfo() {
  let iana = 'Asia/Tokyo';
  try {
    const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (t) iana = t;
  } catch (_) {}
  const off = -new Date().getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return { iana, suffix: `${sign}${hh}:${mm}` };
}

// 残高ヒーロー以外のホームカード一覧 (上から下の表示既定順)。設定の
// 「ホームのカスタマイズ」 でユーザーごとに並び順・非表示を変えられる。
// データは localStorage に保存し、サーバ側には送らない。
// v419 ホーム上部 残高 直下の クイック アクション 列。 v421 アイコン主体に。
// 表示 ON/OFF は localStorage に 保存。 デフォルト ON は 「お金 回り」 4 つ。
// (icon, label) は 設定で 区別表示。 ホーム は icon のみ、 設定では 両方。
export const HOME_ACTIONS = [
  // 経済 系 (デフォ ON)
  { id: 'buy',          url: '#/buy',                title: '買う',         icon: '🛒', defaultVisible: true },
  { id: 'sell',         url: '#/sell',               title: '売る',         icon: '🏷', defaultVisible: true },
  { id: 'request',      url: '#/tasks?new=request',  title: '頼む',         icon: '🙋', defaultVisible: true },
  { id: 'send',         url: '#/send',               title: '送る',         icon: '💸', defaultVisible: true },
  // アプリ 系 (デフォ OFF)
  { id: 'translate',    url: '#/translate',          title: '画像 翻訳',     icon: '🌐', defaultVisible: false },
  { id: 'rollcalls',    url: '#/rollcalls',          title: '点呼',         icon: '📣', defaultVisible: false },
  { id: 'timers',       url: '#/timers',             title: 'タイマー',     icon: '🛎',  defaultVisible: false },
  { id: 'stopwatches',  url: '#/stopwatches',        title: 'ストップウォッチ', icon: '🕒', defaultVisible: false },
  { id: 'meetups',      url: '#/meetups',            title: '待ち合わせ',    icon: '🤝', defaultVisible: false },
  { id: 'wishlist',     url: '#/wishlist',           title: '欲しい',       icon: '✨', defaultVisible: false },
  { id: 'roulette',     url: '#/roulette',           title: 'ルーレット',    icon: '🎰', defaultVisible: false },
  { id: 'text-roulette', url: '#/text-roulette',     title: 'どこ行く',      icon: '🍜', defaultVisible: false },
  { id: 'polls',        url: '#/polls',              title: '投票',         icon: '📊', defaultVisible: false },
  { id: 'nomikai',      url: '#/nomikai',            title: '飲み会割り勘',  icon: '🍶', defaultVisible: false },
  { id: 'wari',         url: '#/wari',               title: 'ワリカ電卓',    icon: '🧮', defaultVisible: false },
  { id: 'requests',     url: '#/requests',           title: '請求 (集金)',   icon: '💴', defaultVisible: false },
  { id: 'random-groups', url: '#/random-groups',     title: 'ランダム分け',  icon: '🎲', defaultVisible: false },
  { id: 'orderings',    url: '#/orderings',          title: '順番決め',      icon: '📋', defaultVisible: false }, // v526 #170 v523 で追加した新アプリも アイコン候補に
  { id: 'regions',      url: '#/regions',            title: '制覇マップ',    icon: '🗺', defaultVisible: false }, // v531 #163
  { id: 'health',       url: '#/health',             title: '体重/BMI',      icon: '⚖️', defaultVisible: false }, // v532 #161
  { id: 'workouts',     url: '#/workouts',           title: '筋トレ',        icon: '💪', defaultVisible: false }, // v533 #162
  { id: 'walk',         url: '#/walk',               title: '散歩',          icon: '🚶', defaultVisible: false }, // v538 #169
  { id: 'shiritori',    url: '#/shiritori',          title: '絵しりとり',    icon: '🎨', defaultVisible: false }, // v540 #171
  { id: 'tierlists',    url: '#/tierlists',          title: 'ティア表',      icon: '🎯', defaultVisible: false }, // v549 #210
  { id: 'paper-review', url: '#/paper-review',       title: '論文査読',      icon: '📄', defaultVisible: false }, // v550 #206
  { id: 'mahjong',      url: '#/mahjong',            title: '麻雀',          icon: '🀄', defaultVisible: false }, // v553 #209
  { id: 'auctions',     url: '#/auctions',           title: 'オークション',  icon: '🏷', defaultVisible: false },
  { id: 'playlists',    url: '#/playlists',          title: 'プレイリスト',  icon: '🎵', defaultVisible: false },
  { id: 'groups',       url: '#/groups',             title: 'グループ',      icon: '👥', defaultVisible: false },
  { id: 'invitations',  url: '#/invitations',        title: '募集',         icon: '🍻', defaultVisible: false },
  { id: 'tasks',        url: '#/tasks',              title: 'タスク',       icon: '📋', defaultVisible: false },
  { id: 'achievements', url: '#/achievements',       title: '実績',         icon: '🏅', defaultVisible: false },
  { id: 'network',      url: '#/network',            title: '関係性グラフ',  icon: '🕸', defaultVisible: false },
  { id: 'contacts',     url: '#/contacts',           title: '連絡先',       icon: '📞', defaultVisible: false },
  { id: 'notices',      url: '#/notices',            title: '重要連絡',     icon: '📌', defaultVisible: false },
  { id: 'scrapbox',     url: '#/scrapbox',           title: 'Scrapbox',    icon: '📚', defaultVisible: false },
  { id: 'exercise',     url: '#/exercise',           title: '運動 (歩数)',   icon: '🏃', defaultVisible: false },
  { id: 'activity',     url: '#/activity',           title: 'ラボ滞在マップ', icon: '🗓', defaultVisible: false },
  { id: 'help',         url: '#/help',               title: '操作ガイド AI', icon: '🤖', defaultVisible: true },
  { id: 'chat',         url: '#/chat',               title: 'AI 対話 / 翻訳', icon: '💬', defaultVisible: true },
  // v580 新規追加アプリも アイコン候補に
  { id: 'todos',        url: '#/todos',              title: 'TODO',         icon: '📝', defaultVisible: false },
  { id: 'places',       url: '#/places',             title: '食べある記',    icon: '🍴', defaultVisible: false },
  { id: 'sns',          url: '#/sns',                title: 'らぼったー',    icon: '💬', defaultVisible: false },
  { id: 'games',        url: '#/games',              title: '娯楽',         icon: '🎮', defaultVisible: false },
  { id: 'ito',          url: '#/ito',                title: 'ito',          icon: '🎲', defaultVisible: false },
  { id: 'jinrou',       url: '#/jinrou',             title: '人狼',         icon: '🐺', defaultVisible: false },
  { id: 'predictions',  url: '#/predictions',        title: '優勝予想',      icon: '🏆', defaultVisible: false },
  { id: 'deadlines',    url: '#/meetups?kind=deadline', title: '〆切',      icon: '📌', defaultVisible: false },
  { id: 'feedback',     url: '#/feedback',           title: 'フィードバック', icon: '📝', defaultVisible: false },
  // 設定 ボタン自身も HOME_ACTIONS 経由で 表示制御。 これを 隠したら 上部ナビの
  // 「設定」 から 同じ 場所に 辿れる ので 詰まらない。
  { id: 'settings',     url: '#/settings?focus=home-actions', title: '設定 (このボタン列)', icon: '⚙', defaultVisible: true },
];
const HOME_ACTIONS_KEY = 'labpay-home-actions';
export function isHomeActionVisible(id) {
  try {
    const j = JSON.parse(localStorage.getItem(HOME_ACTIONS_KEY) || '{}');
    if (id in j) return !!j[id];
  } catch (_) {}
  const a = HOME_ACTIONS.find(x => x.id === id);
  return a ? !!a.defaultVisible : false;
}
export function setHomeActionVisible(id, v) {
  let j = {};
  try { j = JSON.parse(localStorage.getItem(HOME_ACTIONS_KEY) || '{}'); } catch (_) {}
  j[id] = !!v;
  try { localStorage.setItem(HOME_ACTIONS_KEY, JSON.stringify(j)); } catch (_) {}
}

// v580 ショートカット ウィジェット 定義。 全アプリへの 簡単なリンクカードを
//   ホームに 置けるように。 ロジックは持たず、 タイトル + 説明 + 「→ 開く」 だけ。
//   設定 → ホーム ウィジェット から ON にすると 並びに 現れる。
const SHORTCUT_CARDS_DEFS = [
  { id: 'sc-predictions',  title: '🏆 優勝予想',         url: '#/predictions',  desc: 'W 杯 / スポーツ大会 の 順位を予想して 山分け' },
  { id: 'sc-mahjong',      title: '🀄 麻雀',            url: '#/mahjong',      desc: '4 人で 50pt 賭けの 本格麻雀 / AI 練習対戦' },
  { id: 'sc-ito',          title: '🎲 ito',             url: '#/ito',          desc: '1-100 の数字を お題で表現する 協力ゲーム' },
  { id: 'sc-jinrou',       title: '🐺 人狼',            url: '#/jinrou',       desc: '4-16 人で 役職配布 → 夜 + 昼 で 勝敗' },
  { id: 'sc-shiritori',    title: '🎨 絵しりとり',      url: '#/shiritori',    desc: 'タイムリミット付きキャンバスで 順番に絵を描く' },
  { id: 'sc-tierlists',    title: '🎯 ティア表',        url: '#/tierlists',    desc: 'みんなで S/A/B/C/D/F の ティア分け' },
  { id: 'sc-paper-review', title: '📄 論文 査読',       url: '#/paper-review', desc: '論文 PDF を AI で 章立て要約 + 査読コメント' },
  { id: 'sc-regions',      title: '🗺 制覇マップ',       url: '#/regions',      desc: '行った国・都道府県 を タップで 登録' },
  { id: 'sc-walk',         title: '🚶 散歩',            url: '#/walk',         desc: '現在地周辺の 食べある記 から 散歩先 おすすめ' },
  { id: 'sc-workouts',     title: '💪 筋トレ',          url: '#/workouts',     desc: '腕立て / 腹筋 / プランクなど を 1 タップ記録' },
  { id: 'sc-health',       title: '⚖️ 体重 / BMI',     url: '#/health',       desc: '体重・身長 を 記録、 BMI 自動計算 + グラフ' },
  { id: 'sc-exercise',     title: '🏃 運動 (歩数)',     url: '#/exercise',     desc: 'ラボ内 歩数 ランキング' },
  { id: 'sc-chat',         title: '💬 AI 対話 / 翻訳',  url: '#/chat',         desc: '多言語 チャット (出張・旅行 翻訳補助)' },
  { id: 'sc-help',         title: '🤖 操作ガイド AI',   url: '#/help',         desc: 'LabPay の 使い方を AI に 聞ける' },
  { id: 'sc-translate',    title: '🌐 画像 和訳',       url: '#/translate',    desc: 'メニュー / 看板 を AI で 和訳' },
  { id: 'sc-polls',        title: '📊 投票・アンケート', url: '#/polls',        desc: '対象者・締切・選択肢 を 指定して 投票' },
  { id: 'sc-rollcalls',    title: '📣 点呼',            url: '#/rollcalls',    desc: '「いる?」「起きてる?」 を ワンタップ集計' },
  { id: 'sc-timers',       title: '🛎 タイマー',        url: '#/timers',       desc: '参加者全員で カウントダウン 共有' },
  { id: 'sc-stopwatches',  title: '⏱ ストップウォッチ', url: '#/stopwatches',  desc: 'メンバー共有 カウントアップ' },
  { id: 'sc-meetups',      title: '🤝 待ち合わせ',      url: '#/meetups',      desc: '集合 時刻 + 場所 + メンバー を 一括通知' },
  { id: 'sc-deadlines',    title: '📌 〆切',            url: '#/meetups?kind=deadline', desc: '〆切 時刻 + 対象者 を 一括通知 (365 日先 まで)' },
  { id: 'sc-activity',     title: '🗓 ラボ滞在マップ',   url: '#/activity',     desc: '誰が いつ ラボに 居たか の 滞在ログ + ヒートマップ' },
  { id: 'sc-auctions',     title: '🏷 オークション',    url: '#/auctions',     desc: '出品 + 入札 + 締切で 落札' },
  { id: 'sc-nomikai',      title: '🍶 飲み会割り勘',    url: '#/nomikai',      desc: '学年 + ドリンク 種別 で 自動 割り勘' },
  { id: 'sc-wari',         title: '🧮 ワリカ電卓',      url: '#/wari',         desc: '人数 + 金額 で 端数こみ 割り勘' },
  { id: 'sc-money-requests', title: '💴 請求 (集金)',   url: '#/requests',     desc: '同額 or 人別 で 集金 + 支払い 確認' },
  { id: 'sc-random-groups', title: '🎲 ランダム分け',   url: '#/random-groups', desc: 'メンバー を N チーム に ランダム分け' },
  { id: 'sc-orderings',    title: '📋 順番決め',        url: '#/orderings',    desc: 'メンバー を 1 列 に 並べ替え (発表順 / 当番)' },
  { id: 'sc-roulette',     title: '🎰 ルーレット',      url: '#/roulette',     desc: 'メンバー から 1 人 くじ引き (賞金つき可)' },
  { id: 'sc-text-roulette', title: '🍜 どこ行く',       url: '#/text-roulette', desc: '昼飯 / 何食べる など テキスト候補から 1 つ' },
  { id: 'sc-wishlist',     title: '✨ 欲しい',          url: '#/wishlist',     desc: 'ほしい物 を 登録、 誰かが 売ってくれる かも' },
  { id: 'sc-contacts',     title: '📞 連絡先',          url: '#/contacts',     desc: 'ラボメンバー 緊急 連絡先 (タップで通話)' },
  { id: 'sc-scrapbox',     title: '📚 Scrapbox 履歴',   url: '#/scrapbox',     desc: '#scrapbox の 研究ノート 編集ログ' },
  { id: 'sc-network',      title: '🕸 関係性グラフ',    url: '#/network',      desc: '売買・タスク・送金 などの つながり 可視化' },
  { id: 'sc-achievements', title: '🏅 実績',           url: '#/achievements',  desc: 'バッジ / 称号 / 統計' },
  { id: 'sc-games',        title: '🎮 娯楽 ハブ',       url: '#/games',        desc: 'ラボメンバーで 遊べる ゲーム 一覧' },
  { id: 'sc-apps',         title: '📦 アプリ ハブ',     url: '#/apps',         desc: '全アプリ 一覧 (カテゴリ別)' },
];

// v497 #103 ホームに置く要素は 「ウィジェット」 と呼ぶ。 設定画面の表示名も変更。
//   初期表示は 「進行中 / タスク / いる人 + 残高ヒーロー (常時)」 に絞る。
//   他は 設定 → ホーム ウィジェット から個別ON可能。
//   v580 SHORTCUT_CARDS_DEFS を 全部 HOME_CARDS に 注入。 ON にすると リンクカードが ホームに 出る。
export const HOME_CARDS = [
  { id: 'my-timers',      title: '⏱ 進行中' },
  { id: 'pending',        title: '未対応 (投票・点呼・未払い請求)' },
  { id: 'groups',         title: 'あなたのグループ' },
  { id: 'sns',            title: '💬 らぼったー 最新' },
  { id: 'asking',         title: '依頼中 (自分が起案した未完了のもの)' },
  { id: 'fresh-listings', title: '新規入荷' },
  { id: 'invitations',    title: '募集' },
  { id: 'places',         title: '🍴 食べある記 (新着)' },
  { id: 'notices',        title: '📢 重要連絡 / 学会情報' }, // v514 #139 新規
  { id: 'presence',       title: '今ラボにいる人' },
  { id: 'calendar',       title: '今日の予定' },
  { id: 'my-claims',      title: 'あなたが引き受け中のタスク' },
  { id: 'fresh-tasks',    title: '新規タスク' },
  { id: 'playlists',      title: '新着 プレイリスト' },
  { id: 'todos',          title: '📝 自分の TODO' },
  { id: 'history',        title: '履歴' },
  // v580 ショートカット ウィジェット (リンクのみ。 全アプリを ホームに 置けるように)。
  ...SHORTCUT_CARDS_DEFS.map(c => ({ id: c.id, title: c.title })),
];

// v514 #131 デフォルト表示 (ユーザ要望に基づく):
//   進行中 / 未対応 / [ヒーロー = balance, 常時表示] / あなたのグループ / らぼったー /
//   依頼中 / 新規入荷 / 募集 / 食べある記 (新着) / 重要連絡 (新規 #139)。
//   他は デフォルト hidden、 設定 → ホーム から個別 ON 可能。
// v522 #159 「今ラボにいる人」 (presence) を デフォルト表示に追加
const DEFAULT_VISIBLE_HOME_CARDS = [
  'my-timers', 'pending', 'groups', 'sns', 'asking',
  'fresh-listings', 'invitations', 'places', 'notices', 'presence',
];
export const DEFAULT_HIDDEN_HOME_CARDS = HOME_CARDS
  .map(c => c.id)
  .filter(id => !DEFAULT_VISIBLE_HOME_CARDS.includes(id));

// v514 #131 全員のホーム設定を新デフォルトに戻すため key を v2 に上げる。
const HOME_LAYOUT_KEY = 'labpay-home-layout-v2';
// v514 デフォルト並び順 (DOM 順ではなく applyHomeLayout が後付けで揃える)。 残りの
//   hidden カードは末尾に。
const DEFAULT_ORDER = [
  'my-timers', 'pending', 'balance', 'groups', 'sns', 'asking',
  'fresh-listings', 'invitations', 'places', 'notices', 'presence',
];
export function readHomeLayout() {
  try {
    const raw = localStorage.getItem(HOME_LAYOUT_KEY);
    if (raw === null) return { order: [...DEFAULT_ORDER], hidden: [...DEFAULT_HIDDEN_HOME_CARDS] };
    const j = JSON.parse(raw || '{}');
    return {
      order:  Array.isArray(j.order)  ? j.order  : [...DEFAULT_ORDER],
      hidden: Array.isArray(j.hidden) ? j.hidden : [...DEFAULT_HIDDEN_HOME_CARDS],
    };
  } catch { return { order: [...DEFAULT_ORDER], hidden: [...DEFAULT_HIDDEN_HOME_CARDS] }; }
}
export function writeHomeLayout(layout) {
  try {
    localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify({
      order:  Array.isArray(layout.order)  ? layout.order  : [],
      hidden: Array.isArray(layout.hidden) ? layout.hidden : [],
    }));
  } catch {}
}

// 初期 render 後に呼ぶ。 #home-cards-region の中の data-card-id 持ち要素を
// 保存された order に並び替え + hidden 指定のものに .home-card-user-hidden を付与。
function applyHomeLayout() {
  const region = document.getElementById('home-cards-region');
  if (!region) return;
  const layout = readHomeLayout();
  const cards = Array.from(region.querySelectorAll(':scope > [data-card-id]'));
  const knownIds = cards.map(c => c.dataset.cardId);
  // v520 #155 balance はユーザの 設定 UI で 並び替え対象に出していないため、 ユーザが
  //   並びをいじると order に含まれず 末尾に行ってしまう問題があった。 balance が
  //   order に含まれない場合は、 必ず 'pending' or 'my-timers' の直後 (= 上位) に強制
  //   挿入する。 また balance は隠せない (= hidden 指定があっても無視) ようにする。
  const fixedOrder = [...layout.order];
  if (knownIds.includes('balance') && !fixedOrder.includes('balance')) {
    const pendingIdx = fixedOrder.indexOf('pending');
    const myTimersIdx = fixedOrder.indexOf('my-timers');
    const insertAt = pendingIdx >= 0 ? pendingIdx + 1
                   : myTimersIdx >= 0 ? myTimersIdx + 1
                   : 0;
    fixedOrder.splice(insertAt, 0, 'balance');
  }
  const orderedKnown = [
    ...fixedOrder.filter(id => knownIds.includes(id)),
    ...knownIds.filter(id => !fixedOrder.includes(id)),
  ];
  for (const id of orderedKnown) {
    const el = cards.find(c => c.dataset.cardId === id);
    if (el) region.appendChild(el);
  }
  for (const card of cards) {
    // balance は 常時 表示 (hidden 指定があっても無視)
    const isHidden = card.dataset.cardId !== 'balance' && layout.hidden.includes(card.dataset.cardId);
    card.classList.toggle('home-card-user-hidden', isHidden);
  }
}

export async function renderHome() {
  if (!state.me) await refreshMe();
  if (!state.me) { navigate('#/login'); return; }

  const app = document.getElementById('app');
  // v514 #131 ホームの並びを再編。 my-timers / pending を balance hero より上に出すため
  //   balance hero を #home-cards-region 内の data-card-id="balance" カードに昇格。
  //   並び順 = my-timers → pending → balance → groups → sns → asking → fresh-listings →
  //   invitations → places → notices → (デフォルト hidden: presence / calendar /
  //   my-claims / fresh-tasks / playlists / todos / history)
  app.innerHTML = `
    <div id="home-cards-region">
    <div class="card" id="home-mytm-card" data-card-id="my-timers" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">⏱ 進行中</h2>
        <a href="#/timers" class="hint">タイマー →</a>
      </div>
      <div id="home-mytm" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" data-card-id="presence">
      <div class="row center">
        <h2 class="row-title">今ラボにいる人</h2>
        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px" class="muted">
          名前を表示
          <span class="switch">
            <input type="checkbox" id="presence-names-toggle">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div id="presence" style="margin-top:8px"><div class="home-skel-bars"></div></div>
      <div style="text-align:right; margin-top:8px">
        <a href="#/activity" class="hint">ラボ滞在・活動マップ →</a>
      </div>
    </div>

    <div class="card" id="home-pending-card" data-card-id="pending" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">未対応</h2>
        <span id="home-pending-count" class="hint-sm"></span>
      </div>
      <div id="home-pending" class="list"></div>
    </div>

    <div class="card balance-hero" data-card-id="balance">
      <!-- v527 #168 ポイントの上に 現地時刻 (年月日 + 曜日 + 時分秒)。 定期的に
           日 / 時 / 分 / 秒 のどれか 1 つが 2 倍フォントサイズに切り替わる演出。 -->
      <div id="home-clock" style="text-align:center; font-variant-numeric:tabular-nums; font-family:system-ui, -apple-system, sans-serif; margin-bottom:6px; line-height:1.2; color:#4a106d"></div>
      <a href="#/history" class="balance-line" id="home-balance-link"
         style="display:block; text-decoration:none; color:inherit; cursor:pointer">
        <span class="lbl">残高</span>
        <span class="num" id="home-balance">— pt</span>
      </a>
      <div class="muted" id="streak-line">連続ラボイン — 日 (最長 — 日)</div>
      <a id="home-medals" href="#/achievements" class="home-medals" title="実績"></a>
      <div id="checkin-area" style="margin-top:10px"></div>
      <div style="margin-top:14px; display:flex; gap:6px; justify-content:center; flex-wrap:wrap; align-items:center">
        ${HOME_ACTIONS.filter(a => isHomeActionVisible(a.id)).map(a => `
          <a class="btn home-quick" href="${escapeHtml(a.url)}" title="${escapeHtml(a.title)}" aria-label="${escapeHtml(a.title)}"
             style="font-size:20px; line-height:1; padding:6px 10px; min-width:38px; text-align:center">${escapeHtml(a.icon || a.title)}</a>
        `).join('')}
      </div>
    </div>

    <div class="card" id="home-asking-card" data-card-id="asking" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">依頼中</h2>
        <span id="home-asking-count" class="hint-sm"></span>
      </div>
      <div id="home-asking" class="list"></div>
    </div>

    <div class="card" id="home-calendar-card" data-card-id="calendar" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">今日の予定</h2>
        <a href="#" id="home-cal-refresh" class="hint" style="margin-left:auto" title="cache を 捨てて GCal を 強制再取得">🔄 再取得</a>
      </div>
      <div id="home-calendar" class="list"></div>
    </div>
    <div id="home-mtg-modal" hidden></div>

    <div class="card" id="home-groups-card" data-card-id="groups" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">あなたのグループ</h2>
        <a href="#/groups" class="hint">グループ一覧 →</a>
      </div>
      <div id="home-groups" class="list"></div>
    </div>

    <div class="card" data-card-id="fresh-listings">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">新規入荷</h2>
        <a href="#/buy" class="hint">商品一覧 →</a>
      </div>
      <div id="home-fresh-listings" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-my-claims-card" data-card-id="my-claims" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">あなたが引き受け中のタスク</h2>
      </div>
      <div id="home-my-claims" class="list"></div>
    </div>

    <div class="card" data-card-id="fresh-tasks">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">新規タスク</h2>
        <a href="#/tasks" class="hint">一覧 →</a>
      </div>
      <div id="home-fresh-tasks" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-invs-card" data-card-id="invitations">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">募集</h2>
        <a href="#/invitations" class="hint">一覧 →</a>
      </div>
      <div id="home-invs" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-pl-card" data-card-id="playlists" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">🎵 新着 プレイリスト</h2>
        <a href="#/playlists" class="hint">一覧 →</a>
      </div>
      <div id="home-pl" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-notices-card" data-card-id="notices" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">📢 重要連絡 / 学会情報</h2>
        <a href="#/notices" class="hint">一覧 →</a>
      </div>
      <div id="home-notices" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-places-card" data-card-id="places" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">🍴 食べある記 (新着)</h2>
        <a href="#/places" class="hint">一覧 →</a>
      </div>
      <div id="home-places" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-todos-card" data-card-id="todos" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">📝 自分の TODO</h2>
        <a href="#/todos" class="hint">TODO →</a>
      </div>
      <div id="home-todos" class="list"><div class="home-skel-bars"></div></div>
    </div>

    <div class="card" id="home-sns-card" data-card-id="sns" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">💬 らぼったー 最新</h2>
        <a href="#/sns" class="hint">タイムライン →</a>
      </div>
      <div id="home-sns" class="list"><div class="home-skel-bars"></div></div>
      <!-- v581 投稿 欄 (ウィジェット 末尾)。 シンプル: テキスト のみ。 画像 / 位置 /
           メンション 補完 が 要る ときは タイムライン → を 開く。 -->
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--line)">
        <textarea id="home-sns-body" maxlength="2000" rows="2" placeholder="いま どうしてる?"
                  style="width:100%; box-sizing:border-box; resize:vertical; min-height:48px"></textarea>
        <div class="row" style="gap:6px; margin-top:6px; align-items:center; justify-content:flex-end">
          <span id="home-sns-status" class="hint-sm" style="margin-right:auto"></span>
          <button id="home-sns-post" class="btn primary" style="padding:6px 14px">投稿</button>
        </div>
      </div>
    </div>

    <details class="card" data-card-id="history">
      <summary style="cursor:pointer; font-weight:700; font-size:var(--text-lg); list-style:none">
        履歴 <a href="#/history" class="hint" style="font-weight:400; margin-left:6px" onclick="event.stopPropagation()">すべて見る →</a>
      </summary>
      <div id="recent" class="list" style="margin-top:8px"><div class="home-skel-bars"></div></div>
    </details>

    ${SHORTCUT_CARDS_DEFS.map(c => `
    <div class="card" data-card-id="${escapeHtml(c.id)}" hidden>
      <div class="row center" style="margin-bottom:4px">
        <h2 class="row-title" style="margin:0">${escapeHtml(c.title)}</h2>
        <a href="${escapeHtml(c.url)}" class="hint" style="margin-left:auto">開く →</a>
      </div>
      <div class="hint" style="font-size:12px; line-height:1.4">${escapeHtml(c.desc)}</div>
    </div>`).join('')}
    </div>
  `;
  applyHomeLayout();
  // v527 #168 現地時刻表示を始動 (1 秒更新 + 5 秒ごとに big highlight をローテ)
  startHomeClock();

  // v503 #121 #129 hidden なカードのレンダー処理はそもそも動かさない (表示しないものを
  //   API で叩いて時間を浪費しない)。 cardId → render 関数の対応表で hidden だけ skip。
  //   無料サブセット (balance / checkin / medals) はホーム冒頭の hero に直接出るので
  //   常に動かす。
  const layout = readHomeLayout();
  const hiddenSet = new Set(layout.hidden || []);
  const cardsToRender = [
    { cardId: 'my-timers',      fn: renderMyActiveTimers,  label: 'mytimers' },
    { cardId: 'presence',       fn: renderPresence,        label: 'presence' },
    { cardId: 'pending',        fn: renderPendingItems,    label: 'pending' },
    { cardId: 'asking',         fn: renderAskingItems,     label: 'asking' },
    { cardId: 'calendar',       fn: renderCalendarEvents,  label: 'calendar' },
    { cardId: 'groups',         fn: renderMyGroups,        label: 'mygroups' },
    { cardId: 'invitations',    fn: renderFreshInvitations, label: 'invitations' },
    { cardId: 'playlists',      fn: renderFreshPlaylists,  label: 'playlists' },
    { cardId: 'fresh-listings', fn: renderFreshListings,   label: 'freshlistings' },
    { cardId: 'fresh-tasks',    fn: renderFreshTasks,      label: 'freshtasks' },
    { cardId: 'places',         fn: renderFreshPlaces,     label: 'freshplaces' },
    { cardId: 'sns',            fn: renderFreshSns,        label: 'freshsns' },
    { cardId: 'notices',        fn: renderHomeNotices,     label: 'notices' }, // v514 #139
    { cardId: 'todos',          fn: renderHomeTodos,       label: 'hometodos' },
    { cardId: 'history',        fn: renderRecentTx,        label: 'recenttx' },
  ];

  // v501 #115 各カードの所要時間を計測 + console グループにダンプ。 admin に対しては
  //   右下に小さく出す。
  const perfStart = performance.now();
  const perfEntries = [];
  const timed = async (name, fn) => {
    const t0 = performance.now();
    try { await fn(); }
    finally {
      const dt = performance.now() - t0;
      perfEntries.push({ name, ms: Math.round(dt) });
    }
  };
  // v509 ユーザ報告: 「実績が表示されるまで グループ / らぼったー が表示されない」
  //   原因は 残高 → チェックイン → 実績 を直列 await した後でカードを順番に
  //   呼んでいたため。 ヒーロー 3 つは fire-and-forget (キャッシュから即出るので
  //   ブロック不要)、 各カードは Promise.all で 並列実行する。 計測のため timed は
  //   そのまま噛ませる (resolved 順に perfEntries に追加される)。
  const heroPromise = Promise.all([
    timed('balance', () => refreshFinancials({ silent: false })),
    timed('checkin', () => renderCheckinArea()),
    timed('medals',  () => renderMedalsStrip()),
  ]);
  const cardPromises = cardsToRender
    .filter(c => !hiddenSet.has(c.cardId))
    .map(c => timed(c.label, c.fn));
  await Promise.all([heroPromise, ...cardPromises]);
  const totalMs = Math.round(performance.now() - perfStart);

  // console.group 化 (admin/dev だけが普段見る場所、 邪魔にならない)
  perfEntries.sort((a, b) => b.ms - a.ms);
  try {
    console.groupCollapsed(`🏠 Home load ${totalMs} ms`);
    for (const e of perfEntries) console.log(`${e.name.padEnd(14)} ${e.ms} ms`);
    console.groupEnd();
  } catch (_) {}
  // 画面下に admin だけ見える 簡易タイマー (タップで詳細トグル)
  if (state.me?.role === 'admin') renderHomePerfPill(totalMs, perfEntries);

  // Home polling: 1 分ごとに各カードを 「静かに」 リロード。
  // - 「読み込み中…」 placeholder は出さない (各 render は初期 HTML を持つ
  //   ので、再 fetch 中は前回の値を見せたまま、結果が届いたら DOM 差し替え)
  // - ページが非表示 (タブ裏 / 画面ロック) のときは skip
  // - 戻ってきた瞬間 (visibilitychange → visible) に即 1 回ポーリング
  // - home から離れたら timer 停止 (#home-balance 消失で検知)
  startHomePolling();
}

// v501 #115 admin だけが画面右下で見られる Home パフォーマンスピル。 タップで
//   セクション別の所要時間を展開表示。 navigation 等でホームから離れたら消す。
function renderHomePerfPill(totalMs, entries) {
  document.getElementById('home-perf-pill')?.remove();
  const box = document.createElement('div');
  box.id = 'home-perf-pill';
  box.style.cssText = 'position:fixed; bottom:12px; right:12px; z-index:9999; background:#222; color:#fff; padding:4px 10px; border-radius:14px; font-size:11px; font-family:ui-monospace, monospace; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.3); user-select:none';
  box.title = 'admin: ホームのロード所要時間';
  const sum = `🏠 ${totalMs} ms`;
  box.innerHTML = `<span>${sum}</span>`;
  let expanded = false;
  box.addEventListener('click', () => {
    expanded = !expanded;
    if (expanded) {
      const list = entries.map(e => `<div>${e.name.padEnd(14)} ${e.ms} ms</div>`).join('');
      box.innerHTML = `<div><b>${sum}</b><br><span class="muted" style="opacity:0.7">タップで閉じる</span></div><pre style="margin:6px 0 0; font-size:10px; line-height:1.3; max-height:240px; overflow:auto">${list}</pre>`;
      box.style.cssText += '; max-width:260px';
    } else {
      box.innerHTML = `<span>${sum}</span>`;
    }
  });
  document.body.appendChild(box);
  // ホームから離れたら自動削除
  const observer = new MutationObserver(() => {
    if (!document.getElementById('home-balance')) {
      box.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('app'), { childList: true, subtree: false });
}

// Module-scoped: 単一の home polling 用 timer + visibilitychange handler。
// renderHome() が再度呼ばれたら start で reset、home から離れたら次の tick で
// stop する。
let homePollTimer = null;
let homeVisHandler = null;

// v527 #168 → v528 #185 ホームの 現地時刻表示。 1 秒更新は そのまま。
//   ただし 「大きく見せる演出」 は 10 分ごとに 1 分間だけ ON にする (= 普段は静か)。
//   ON 期間中だけ 5 秒ごとに 時 / 分 / 秒 のどれか 1 つを 1.6em に切替。
let homeClockTimer = null;
let homeClockBigIdx = 0; // 0:hour 1:min 2:sec
let homeClockBigSwitchAt = 0;
const HOME_CLOCK_WEEK = ['日','月','火','水','木','金','土'];
function isHomeClockPerformanceOn() {
  // 10 分ごと (= each :00, :10, :20, :30, :40, :50) の 直後 1 分間だけ ON
  const now = new Date();
  const min = now.getMinutes();
  return (min % 10) === 0;
}
function paintHomeClock() {
  const el = document.getElementById('home-clock');
  if (!el) { if (homeClockTimer) { clearInterval(homeClockTimer); homeClockTimer = null; } return; }
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dayName = HOME_CLOCK_WEEK[now.getDay()];
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  // 演出 ON 期間中だけ big highlight をローテ
  const performing = isHomeClockPerformanceOn();
  let szH = '1em', szM = '1em', szS = '1em';
  if (performing) {
    if (Date.now() - homeClockBigSwitchAt > 5000) {
      homeClockBigIdx = (homeClockBigIdx + 1) % 3;
      homeClockBigSwitchAt = Date.now();
    }
    if (homeClockBigIdx === 0) szH = '1.6em';
    if (homeClockBigIdx === 1) szM = '1.6em';
    if (homeClockBigIdx === 2) szS = '1.6em';
  }
  el.innerHTML =
    `<span style="font-size:13px">${ymd} <span style="font-weight:600">(${dayName})</span></span>` +
    `<br>` +
    `<span style="font-size:20px; font-weight:700; letter-spacing:0.04em">` +
    `<span style="font-size:${szH}; transition:font-size 0.3s">${hh}</span>:` +
    `<span style="font-size:${szM}; transition:font-size 0.3s">${mm}</span>:` +
    `<span style="font-size:${szS}; transition:font-size 0.3s">${ss}</span>` +
    `</span>`;
}
function startHomeClock() {
  if (homeClockTimer) clearInterval(homeClockTimer);
  homeClockBigIdx = 0; homeClockBigSwitchAt = Date.now();
  paintHomeClock();
  homeClockTimer = setInterval(paintHomeClock, 1000);
}

function stopHomePolling() {
  if (homePollTimer) { clearInterval(homePollTimer); homePollTimer = null; }
  if (homeVisHandler) {
    document.removeEventListener('visibilitychange', homeVisHandler);
    homeVisHandler = null;
  }
  if (typeof stopHomeSnsFastPoll === 'function') stopHomeSnsFastPoll();
}

async function doHomePoll() {
  // home が unmount されたら停止 (router が他の view に差し替えた目印)。
  if (!document.getElementById('home-balance')) {
    stopHomePolling();
    return;
  }
  if (document.hidden) return;
  // v503 #130 hidden なカードは polling 対象からも外す (どうせ見えない)。
  const hiddenSet = new Set((readHomeLayout().hidden) || []);
  const skip = id => hiddenSet.has(id);
  const tasks = [
    refreshFinancials({ silent: true }),
    skip('presence')       ? null : fetchAndRenderPresence(),
    skip('pending')        ? null : renderPendingItems(),
    skip('asking')         ? null : renderAskingItems(),
    skip('calendar')       ? null : renderCalendarEvents(),
    skip('groups')         ? null : renderMyGroups(),
    skip('invitations')    ? null : renderFreshInvitations(),
    skip('playlists')      ? null : renderFreshPlaylists(),
    skip('my-timers')      ? null : renderMyActiveTimers(),
    skip('fresh-listings') ? null : renderFreshListings(),
    skip('fresh-tasks')    ? null : renderFreshTasks(),
    skip('places')         ? null : renderFreshPlaces(),
    skip('sns')            ? null : renderFreshSns(),
    skip('notices')        ? null : renderHomeNotices(), // v514 #139
    skip('todos')          ? null : renderHomeTodos(),
    skip('history')        ? null : renderRecentTx(),
  ].filter(Boolean);
  await Promise.allSettled(tasks);
}

function startHomePolling() {
  stopHomePolling();
  homePollTimer = setInterval(doHomePoll, 60_000);
  homeVisHandler = () => { if (!document.hidden) doHomePoll(); };
  document.addEventListener('visibilitychange', homeVisHandler);
  // v480 SNS ヒーロー だけ 10 秒 ごと に latest_id で 差分 確認 → 変更時 のみ 取り直す。
  startHomeSnsFastPoll();
}

let homeSnsFastTimer = null;
let homeSnsKnownLatestId = 0;
function stopHomeSnsFastPoll() {
  if (homeSnsFastTimer) { clearInterval(homeSnsFastTimer); homeSnsFastTimer = null; }
}
function startHomeSnsFastPoll() {
  stopHomeSnsFastPoll();
  homeSnsKnownLatestId = 0;
  homeSnsFastTimer = setInterval(async () => {
    if (document.hidden) return;
    if (!document.getElementById('home-sns-card')) { stopHomeSnsFastPoll(); return; }
    try {
      const r = await get('/api/posts/latest_id');
      const lid = Number(r.latest_id || 0);
      if (homeSnsKnownLatestId === 0) { homeSnsKnownLatestId = lid; return; }
      if (lid > homeSnsKnownLatestId) {
        homeSnsKnownLatestId = lid;
        if ('caches' in window) {
          try {
            const cache = await caches.open('labpay-content-v1');
            const keys = await cache.keys();
            await Promise.all(keys
              .filter(req => new URL(req.url).pathname.startsWith('/api/posts'))
              .map(req => cache.delete(req)));
          } catch (_) {}
        }
        await renderFreshSns();
      }
    } catch (_) {}
  }, 10_000);
}

// v508 残高 / 連続ラボイン も localStorage 経由の SWR キャッシュ。 1) 既に持ってる値で
//   即描画 (state.balance や前回保存の streak)、 2) 裏で /api/me を取り直して更新。
const FIN_CACHE_KEY = 'labpay-fin-cache';
function paintFinancials(me) {
  const bal = document.getElementById('home-balance');
  if (bal) bal.innerHTML = `${(me.balance ?? 0).toLocaleString()}<span class="num-unit">pt</span>`;
  const sl = document.getElementById('streak-line');
  if (sl) {
    const s = me.streak || {};
    sl.textContent = `連続ラボイン ${s.current_streak ?? 0} 日 (最長 ${s.longest_streak ?? 0} 日)`;
  }
}
async function refreshFinancials({ silent }) {
  // 1) キャッシュから即描画 (state.balance が hydrate されてればそれも併用)
  try {
    const cached = localStorage.getItem(FIN_CACHE_KEY);
    if (cached) paintFinancials(JSON.parse(cached));
    else if (state.balance != null) paintFinancials({ balance: state.balance });
  } catch (_) {}
  // 2) 裏で最新を取って差し替え + キャッシュ更新
  try {
    const me = await get('/api/me');
    paintFinancials(me);
    state.balance = me.balance;
    try { localStorage.setItem(FIN_CACHE_KEY, JSON.stringify({ balance: me.balance, streak: me.streak })); } catch (_) {}
  } catch (e) {
    if (!silent) toast('情報の取得に失敗: ' + e.message);
  }
}

// Compact medals strip rendered inside the balance-hero. Each earned achievement is a
// solid emoji, unearned ones are dimmed. Tapping the strip opens /achievements.
// v508 ヒーロー部分 (実績・チェックイン) も me と同じく localStorage 経由の SWR
//   キャッシュ化。 前回のメダル列を即出して、 裏で /api/me/achievements を取り直す。
const ACH_CACHE_KEY = 'labpay-ach-cache';
function paintMedals(items) {
  const root = document.getElementById('home-medals');
  if (!root) return;
  const earned = (items || []).filter(a => a.earned);
  if (!earned.length) { root.innerHTML = ''; return; }
  earned.sort((a, b) => b.earned_tier - a.earned_tier);
  const medals = earned.map(a => {
    const icon = a.icon || '🏅';
    const tierMedal = a.earned.medal;
    return `
      <span title="${escapeHtml(a.title)}: ${escapeHtml(a.earned.label)}"
            style="position:relative; display:inline-block; width:32px; height:32px; line-height:32px; text-align:center; border-radius:50%; background:#fff; font-size:18px; border:1px solid var(--line)">
        ${icon}
        <span style="position:absolute; right:-4px; bottom:-4px; font-size:11px; background:#fff; border-radius:50%; padding:1px; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.2)">${tierMedal}</span>
      </span>`;
  }).join(' ');
  root.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:8px 6px; align-items:center">${medals}</div>`;
}
async function renderMedalsStrip() {
  const root = document.getElementById('home-medals');
  if (!root) return;
  // 1) キャッシュがあれば即描画
  try {
    const cached = localStorage.getItem(ACH_CACHE_KEY);
    if (cached) paintMedals(JSON.parse(cached));
  } catch (_) {}
  // 2) 裏で最新を取って差し替え + キャッシュ更新
  try {
    const ach = await get('/api/me/achievements');
    const items = ach.items || [];
    paintMedals(items);
    try { localStorage.setItem(ACH_CACHE_KEY, JSON.stringify(items)); } catch (_) {}
  } catch (_) { /* キャッシュ表示のままにしておく */ }
}

async function fetchAndRenderPresence() {
  const presenceRoot = document.getElementById('presence');
  if (!presenceRoot) return;

  // If the user hasn't claimed a MAC, the in-lab list is hidden entirely and
  // replaced with the onboarding instructions. This works as a stronger nudge
  // than a banner above the list — they can't peek at who's in the lab
  // until they register, which gives them a concrete reason to do it.
  if (!state.hasMac) {
    // Entire card is a tappable link straight to 設定 so a one-tap onboarding
    // path exists from the home page.
    presenceRoot.innerHTML = `
      <a href="#/settings" style="display:block; text-decoration:none; color:inherit;
              background:#fff8e6; border:1px solid #f5d089; border-radius:10px;
              padding:12px 14px; -webkit-tap-highlight-color:rgba(245,208,137,0.3)">
        <div class="bold" style="color:#b54708; margin-bottom:6px">📱 スマホの MAC アドレスを登録すると、ここに表示されるようになります</div>
        <div style="font-size:13px; line-height:1.7">
          1. 無線 LAN を <b>nkmr-lab-wifi</b> に接続する<br>
          2. スマホのネットワーク設定から自身の IP アドレスをチェック<br>
          3. このカードをタップ → 設定でそれに該当するものを見つけて <b>「これは私」</b> を押す
        </div>
        <div class="muted" style="font-size:11px; margin-top:8px">
          登録するまで在室検知・ラボインボーナス・購入が動きません。タップで設定へ →
        </div>
      </a>`;
    return;
  }

  try {
    const pres = await get('/api/presence');
    if (!pres.rooms.length) {
      presenceRoot.innerHTML = `<div class="empty">部屋が登録されていません</div>`;
    } else {
      // Pass window_minutes through so each pill can fade based on its
      // last_seen_at age relative to the cutoff window.
      const win = Number(pres.window_minutes) || 3;
      presenceRoot.innerHTML = pres.rooms.map(r => renderRoom(r, win)).join('');
    }
  } catch (e) {
    presenceRoot.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderPresence() {
  const toggle = document.getElementById('presence-names-toggle');
  if (!toggle) return;
  const SHOW_NAMES_KEY = 'labpay-presence-show-names';
  const showNames = localStorage.getItem(SHOW_NAMES_KEY) !== '0';
  toggle.checked = showNames;
  applyPresenceMode(showNames);
  toggle.addEventListener('change', () => {
    localStorage.setItem(SHOW_NAMES_KEY, toggle.checked ? '1' : '0');
    applyPresenceMode(toggle.checked);
  });

  await fetchAndRenderPresence();
  // 定期 refresh は startHomePolling() に集約 (旧 presenceTimer は撤去)。
}

// Google Calendar 予定。連携してない人にはカード自体を隠す。連携済みで
// 「今日 0:00 〜 明日 24:00」 に予定があれば 5 件まで表示。Zoom/Meet URL
// が拾えればその場でタップして join できるようリンクボタンを出す。
//
// 1 分ごとの auto-refresh で毎回 Google API を叩くと重いので
// localStorage に { items, etags, timestamp } を 5 分 TTL で保存:
//   - TTL 内 → サーバ問合せ skip、cache をそのまま使う
//   - TTL 切れ → サーバへ /events?etags=<JSON> を投げ、サーバが
//     Google に If-None-Match で revalidate。 全 cal 変更なしなら
//     {not_modified:true} で返り cache を続投、変更あれば新 items + 新 etags。
const CAL_CACHE_KEY = 'labpay-cal-events-cache';
const CAL_CACHE_TTL_MS = 5 * 60 * 1000;
function readCalCache() {
  try {
    const raw = localStorage.getItem(CAL_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.items)) return null;
    // 滞在 TZ が変わったら 「今日」 の意味が変わるので cache 無効化。
    if (c.tz && c.tz !== localTzInfo().iana) return null;
    return c;
  } catch { return null; }
}
function writeCalCache(items, etags) {
  try {
    localStorage.setItem(CAL_CACHE_KEY, JSON.stringify({
      items, etags: etags || {}, timestamp: Date.now(), tz: localTzInfo().iana
    }));
  } catch {}
}

// 「未対応 / 依頼中」 カード: 自分が応答すべき / 自分が起案した で 未完了の
// item を kind 横断で集約。 通知を既読にしても消えないよう、 ソースの状態を
// そのまま見る。 1 分ごとの home polling で再 fetch。
function fmtDeadlineColored(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = dt - new Date();
  if (diff <= 0) return '<span style="color:#888">締切</span>';
  const min = Math.floor(diff / 60000);
  if (min < 10) return `<span style="color:#c62828">あと ${min} 分</span>`;
  if (min < 60) return `<span style="color:#e65100">あと ${min} 分</span>`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `あと ${hr} 時間`;
  const day = Math.floor(hr / 24);
  return `あと ${day} 日`;
}

function renderPendingLikeItems(items, root) {
  const now = Date.now();
  root.innerHTML = items.map(it => {
    // kind 別の色付きタグで 「投票 / 点呼 / 請求 / タスク」 を 一目で区別。
    const tagBg = {
      poll:          '#e3f2fd',
      rollcall:      '#fff3e0',
      money_request: '#fce4ec',
      task:          '#e8f5e9',
    }[it.kind] || '#eee';
    const tagFg = {
      poll:          '#1565c0',
      rollcall:      '#e65100',
      money_request: '#ad1457',
      task:          '#2e7d32',
    }[it.kind] || '#555';
    const label = it.kind_label || it.kind;
    // v567 #216 24h 以内のものは 🔥 + 背景強調
    let urgent = false;
    if (it.deadline_at) {
      const t = new Date(String(it.deadline_at).replace(' ', 'T')).getTime();
      if (Number.isFinite(t) && Math.abs(t - now) < 24 * 3600 * 1000) urgent = true;
    }
    const urgentStyle = urgent ? 'background:#fff7e6; border-left:4px solid #ff6b35;' : '';
    const urgentBadge = urgent ? '<span style="display:inline-block; background:#ff6b35; color:#fff; font-size:9px; font-weight:700; padding:1px 5px; border-radius:6px; margin-right:4px">🔥 24h</span>' : '';
    return `
      <a class="list-item" href="${escapeHtml(it.url)}" style="overflow:hidden; ${urgentStyle}">
        <span style="font-size:20px; width:28px; text-align:center; flex-shrink:0">${it.icon}</span>
        <div class="grow" style="min-width:0; overflow:hidden">
          <div class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
            ${urgentBadge}<span style="display:inline-block; background:${tagBg}; color:${tagFg}; font-size:10px; font-weight:700; padding:1px 6px; border-radius:6px; margin-right:6px; vertical-align:1px">${escapeHtml(label)}</span>${escapeHtml(it.title)}
          </div>
          <div class="meta" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.subtitle)}${it.deadline_at ? ' · ' + fmtDeadlineColored(it.deadline_at) : ''}</div>
        </div>
      </a>`;
  }).join('');
}

// 「N 件未対応」 / 「N 件依頼中」 カード。 5 件ずつ + 「更に読み込み」 で展開。
// 表示件数は module-level で保持 (polling で再描画されても状態が残る)。
const HOME_PENDING_STEP = 5;
let pendingShownN = HOME_PENDING_STEP;
let askingShownN  = HOME_PENDING_STEP;

async function renderPendingItems() {
  await renderPendingKindCard({
    endpoint: '/api/me/pending',
    cardId: 'home-pending-card',
    listId: 'home-pending',
    countId: 'home-pending-count',
    label: '未対応',
    getShown: () => pendingShownN,
    setShown: (n) => { pendingShownN = n; },
  });
}
async function renderAskingItems() {
  await renderPendingKindCard({
    endpoint: '/api/me/asking',
    cardId: 'home-asking-card',
    listId: 'home-asking',
    countId: 'home-asking-count',
    label: '依頼中',
    getShown: () => askingShownN,
    setShown: (n) => { askingShownN = n; },
  });
}

async function renderPendingKindCard(opts) {
  const card = document.getElementById(opts.cardId);
  const root = document.getElementById(opts.listId);
  const countEl = document.getElementById(opts.countId);
  if (!card || !root) return;
  let items = [];
  try {
    const d = await get(opts.endpoint);
    items = d.items || [];
  } catch (_) { card.hidden = true; return; }
  if (!items.length) { card.hidden = true; return; }
  card.hidden = false;
  // v567 #216 24 時間以内に締切のものは 「🔥 もうすぐ」 タグ付きで 必ず一番上に。
  //   それ以外は 締切順 (締切なし は末尾)。
  const now = Date.now();
  const isUrgent = (it) => {
    if (!it.deadline_at) return false;
    const t = new Date(String(it.deadline_at).replace(' ', 'T')).getTime();
    if (!Number.isFinite(t)) return false;
    return (t - now) < 24 * 3600 * 1000 && (t - now) > -24 * 3600 * 1000; // 24h 以内 (過去 24h まで含めて、 既に過ぎたが対応必要なものも)
  };
  const dlTime = (it) => {
    if (!it.deadline_at) return Number.POSITIVE_INFINITY;
    const t = new Date(String(it.deadline_at).replace(' ', 'T')).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  items.sort((a, b) => {
    const ua = isUrgent(a), ub = isUrgent(b);
    if (ua !== ub) return ua ? -1 : 1;
    return dlTime(a) - dlTime(b);
  });
  // urgent count をヘッダーに付加
  const urgentCount = items.filter(isUrgent).length;
  if (countEl) {
    countEl.textContent = urgentCount > 0
      ? `${urgentCount} 件🔥 / ${items.length} 件${opts.label}`
      : `${items.length} 件${opts.label}`;
  }
  // urgent (24h 以内) の件数だけは デフォルト表示数 を 上回っても 全部出す
  if (urgentCount > opts.getShown()) opts.setShown(urgentCount);
  // 5 件ずつ + 「更に読み込み」 で 全件表示まで。
  const shown = Math.min(opts.getShown(), items.length);
  const slice = items.slice(0, shown);
  renderPendingLikeItems(slice, root);
  if (items.length > shown) {
    const moreRow = document.createElement('a');
    moreRow.className = 'list-item add-row';
    moreRow.style.cursor = 'pointer';
    moreRow.innerHTML = `<div class="grow bold" style="color:var(--primary)">▼ 更に読み込み (残り ${items.length - shown} 件)</div>`;
    moreRow.addEventListener('click', () => {
      opts.setShown(shown + HOME_PENDING_STEP);
      renderPendingKindCard(opts);
    });
    root.appendChild(moreRow);
  }
}

// 「今日の予定」 カードを 全件 / 5 件 に切替えるトグル状態 (セッション内)。
// home polling で再描画されても状態が保たれるよう module-level に置く。
let calExpanded = false;
const CAL_DEFAULT_LIMIT = 5;

// 終了後 N 分経過した予定を 「今日の予定」 から消すための設定 (1..1440)。
// 「2 時間経ったら消したい」 が default。 設定 → Google Calendar 連携 から変更可。
const CAL_HIDE_KEY = 'labpay-cal-hide-after-min';
export function readCalHideAfterMin() {
  const v = Number(localStorage.getItem(CAL_HIDE_KEY));
  if (!Number.isFinite(v) || v < 0) return 120;
  return Math.min(1440, Math.max(0, Math.floor(v)));
}
export function writeCalHideAfterMin(min) {
  const v = Math.min(1440, Math.max(0, Math.floor(Number(min) || 0)));
  try { localStorage.setItem(CAL_HIDE_KEY, String(v)); } catch {}
}

async function renderCalendarEvents({ force = false } = {}) {
  const card = document.getElementById('home-calendar-card');
  const root = document.getElementById('home-calendar');
  if (!card || !root) return;
  // v440 カード自体は 必ず 表示 (上位 try/catch で 想定外の throw でも 隠さない)。
  // 旧仕様だと 早期 throw で 「カレンダーが 消える」 ように 見える 不具合があった。
  card.hidden = false;
  // v449 🔄 再取得 ボタン (1 回 だけ bind)。 cache を 捨てて etag なし で 再 fetch。
  const refreshBtn = document.getElementById('home-cal-refresh');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      try { localStorage.removeItem(CAL_CACHE_KEY); } catch {}
      renderCalendarEvents({ force: true });
    });
  }
  let items = null;
  try {
    const cache = force ? null : readCalCache();
    const fresh = cache && (Date.now() - cache.timestamp < CAL_CACHE_TTL_MS);
    if (fresh) {
      items = cache.items;
    } else {
      const etagsQuery = (!force && cache && cache.etags && Object.keys(cache.etags).length)
        ? JSON.stringify(cache.etags) : undefined;
      // 滞在 TZ をサーバに伝え、 「今日」 をその TZ で計算してもらう。
      const params = { tz: localTzInfo().iana };
      if (etagsQuery) params.etags = etagsQuery;
      const data = await get('/api/me/calendar/events', params);
      if (data && data.not_modified && cache) {
        writeCalCache(cache.items, cache.etags); // bump timestamp
        items = cache.items;
      } else {
        const fresh_items = (data && data.items) || [];
        // v449 「予定が 消える」 対策: cache に あった id が 新応答に 1 件も 居ない
        // 場合 だけ かなり怪しい (= GCal 側 1 カレンダー の re-fetch 失敗 で 落ちた
        // 可能性)。 件数が "0 になった" 時 限定で 旧 cache を 維持 (5 分 後 に
        // もう一度 試す)。 本当に 全部 消えた (= GCal 側 で 削除) ケースは
        // 🔄 再取得 を 押せば cache を 飛ばして 反映。
        if (cache && Array.isArray(cache.items) && cache.items.length > 0 && fresh_items.length === 0) {
          // keep old items, bump timestamp to avoid hammering
          items = cache.items;
          writeCalCache(items, cache.etags || {});
        } else {
          items = fresh_items;
          writeCalCache(items, (data && data.etags) || {});
        }
      }
    }
  } catch (e) {
    // 未連携 / fetch 失敗 / offline などはここに来る。
    // cache が残ってればそれを使う、 無ければプレースホルダ表示で カードは出す。
    const cache = readCalCache();
    if (cache && cache.items && cache.items.length) {
      items = cache.items;
    } else {
      root.innerHTML = `<div class="empty">予定を取得できませんでした (${escapeHtml(e.message || String(e))})。 <a href="#/settings" class="hint">設定 → Google Calendar 連携</a> を 確認するか、 一度 解除して 連携 し直してみてください。</div>`;
      return;
    }
  }
  // 終了後 N 分経過した予定を消す (設定: localStorage labpay-cal-hide-after-min、
  // デフォルト 120)。 すべての枝の前にここで一度だけフィルタする。
  {
    const nowMs0 = Date.now();
    const hideAfterMin = readCalHideAfterMin();
    items = items.filter(ev => {
      const endMs = ev.end ? Date.parse(ev.end)
                  : (ev.start ? Date.parse(ev.start) + 3600000 : NaN);
      if (isNaN(endMs)) return true;
      return endMs + hideAfterMin * 60000 >= nowMs0;
    });
  }
  const totalCount = items.length;
  const truncated = !calExpanded && totalCount > CAL_DEFAULT_LIMIT;
  if (truncated) items = items.slice(0, CAL_DEFAULT_LIMIT);
  try {
    card.hidden = false;
    // タスク/募集と同じノリで、 カード末尾に 「＋ MTG を立てる」 行を常設。
    // 件数オーバー時は 「あと N 件」 / 「上位 N 件に戻す」 トグル行も追加。
    const expandRow = truncated
      ? `<div class="list-item add-row" id="home-cal-expand" style="cursor:pointer">
           <div class="grow bold" style="color:var(--primary)">▼ あと ${totalCount - CAL_DEFAULT_LIMIT} 件を表示</div>
         </div>`
      : (calExpanded && totalCount > CAL_DEFAULT_LIMIT
          ? `<div class="list-item add-row" id="home-cal-collapse" style="cursor:pointer">
               <div class="grow" style="color:var(--muted)">▲ 上位 ${CAL_DEFAULT_LIMIT} 件に戻す</div>
             </div>`
          : '');
    const addRow = `
      <div class="list-item add-row" id="home-mtg-add" style="cursor:pointer">
        <div class="grow bold" style="color:var(--primary)">＋ MTG を立てる</div>
        <div class="hint">→</div>
      </div>`;
    const fmtTime = (s, allDay) => {
      if (allDay) return '終日';
      const d = new Date(s);
      const h = d.getHours(), m = d.getMinutes();
      const today = new Date().toDateString() === d.toDateString();
      const prefix = today ? '' : '明日 ';
      return `${prefix}${h}:${String(m).padStart(2,'0')}`;
    };
    // 各予定の状態を 4 つに分類:
    //   過去 (終了済み)       → 半透明 + grayscale
    //   進行中 (start ≤ now < end) → 強い primary 色 + 左バー
    //   次の予定 (今日未来の最初) → 薄い黄色 + amber 左バー
    //   翌日                  → 薄い青 + blue 左バー
    const nowMs = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStartMs = todayStart.getTime() + 86400000;
    const withFlags = items.map(ev => {
      const startMs = ev.start ? Date.parse(ev.start) : NaN;
      const endMs   = ev.end   ? Date.parse(ev.end)   : (isNaN(startMs) ? NaN : startMs + 3600000);
      const isPast       = !isNaN(endMs) && endMs < nowMs;
      const isInProgress = !isPast && !isNaN(startMs) && startMs <= nowMs && nowMs < endMs;
      const isTomorrow   = !isNaN(startMs) && startMs >= tomorrowStartMs;
      return { ...ev, _isPast: isPast, _isInProgress: isInProgress, _isTomorrow: isTomorrow };
    });
    // 「次の予定」 は 今日の未来で 進行中じゃない最初。 翌日は別扱い。
    const nextIdx = withFlags.findIndex(e => !e._isPast && !e._isInProgress && !e._isTomorrow);
    const eventsHtml = !items.length
      ? `<div class="empty">今日は予定なし</div>`
      : withFlags.map((ev, idx) => {
      const locIsUrl = ev.location && /^https?:\/\//i.test(ev.location.trim());
      const loc = (ev.location && !locIsUrl) ? `<div class="meta">📍 ${escapeHtml(ev.location)}</div>` : '';
      const titleHtml = ev.html_url
        ? `<a class="bold" href="${escapeHtml(ev.html_url)}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit">${escapeHtml(ev.title)}</a>`
        : `<span class="bold">${escapeHtml(ev.title)}</span>`;
      // 既に MTG URL がある: 参加ボタン。 無い + 終日でない: Zoom 追加ボタン。
      let zoomBtn = '';
      if (ev.url) {
        zoomBtn = `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" class="btn primary" style="padding:4px 10px; font-size:12px; margin-top:6px; align-self:flex-start">📹 参加する</a>`;
      } else if (!ev.all_day) {
        zoomBtn = `<button class="btn" data-add-zoom="${escapeHtml(ev.id)}" data-cal="${escapeHtml(ev.calendar || 'primary')}" style="padding:4px 10px; font-size:12px; margin-top:6px; align-self:flex-start; color:var(--primary)">＋ Zoom を追加</button>`;
      }
      const isNext = idx === nextIdx;
      // box-shadow:inset で左バーを描く (border-left を使うと content が右に
      // ずれて他の行と縦が揃わなくなるので)。 優先順位は 過去 → 進行中 → 次 → 翌日。
      const styles = [
        'align-items:flex-start',
        'gap:8px',
      ];
      if (ev._isPast) {
        styles.push('opacity:0.5', 'filter:grayscale(60%)');
      } else if (ev._isInProgress) {
        styles.push('background:var(--primary-soft)', 'box-shadow:inset 4px 0 0 var(--primary)');
      } else if (isNext) {
        styles.push('background:#fff7d6', 'box-shadow:inset 4px 0 0 #d4a017');
      } else if (ev._isTomorrow) {
        styles.push('background:#e8f0fd', 'box-shadow:inset 4px 0 0 #4a8ce5');
      }
      return `
        <div class="list-item" style="${styles.join('; ')}">
          <div style="min-width:64px; font-weight:700; color:var(--primary); padding-top:1px">${fmtTime(ev.start, ev.all_day)}</div>
          <div class="grow" style="display:flex; flex-direction:column">
            ${titleHtml}
            ${loc}
            ${zoomBtn}
          </div>
        </div>`;
    }).join('');
    root.innerHTML = eventsHtml + expandRow + addRow;
    document.getElementById('home-mtg-add')?.addEventListener('click', openMtgModal);
    document.getElementById('home-cal-expand')?.addEventListener('click', () => {
      calExpanded = true;
      renderCalendarEvents();
    });
    document.getElementById('home-cal-collapse')?.addEventListener('click', () => {
      calExpanded = false;
      renderCalendarEvents();
    });
    // 「＋ Zoom を追加」 ボタンの click ハンドラ。 押下中はラベル変更 + disable。
    root.querySelectorAll('[data-add-zoom]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const eventId = btn.dataset.addZoom;
        const calId   = btn.dataset.cal || 'primary';
        if (!eventId) return;
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '作成中…';
        try {
          const r = await post(
            `/api/me/calendar/events/${encodeURIComponent(eventId)}/zoom`,
            { calendar_id: calId });
          if (r?.invalidate_calendar_cache) {
            try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
          }
          toast('Zoom MTG を追加しました');
          await renderCalendarEvents();
        } catch (e) {
          toast('失敗: ' + (e.message || String(e)));
          btn.disabled = false; btn.textContent = original;
        }
      });
    });
  } catch (e) {
    // render 中の例外 (DOM 破壊 etc) は無視して隠す。
    card.hidden = true;
  }
}

// ──── 「＋ MTG」 modal ─────────────────────────────────────────────────
// 出先で 「今 30 分後に 30 分の MTG やろう」 を 1 タップで作るための簡易フォーム。
// 今 / +15 / +30 / +60 分後 のショートカット + タイトル + 長さ + 登録先カレンダー
// + 「Zoom も付ける」 toggle。 Zoom OFF にすれば 普通の Google Calendar 予定だけ作成。
let CACHED_CALENDARS = null;
async function getCalendarsCached() {
  if (CACHED_CALENDARS) return CACHED_CALENDARS;
  try {
    const d = await get('/api/me/calendar/calendars');
    CACHED_CALENDARS = Array.isArray(d.items) ? d.items : [];
  } catch { CACHED_CALENDARS = []; }
  return CACHED_CALENDARS;
}
function openMtgModal() {
  const root = document.getElementById('home-mtg-modal');
  if (!root) return;
  const now = new Date();
  const round5 = new Date(Math.ceil(now.getTime() / (5 * 60 * 1000)) * 5 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto"
         id="mtg-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">MTG を立てる</h3>
          <button id="mtg-close">×</button>
        </div>
        <label class="field" style="margin-top:8px">
          <span class="lbl">タイトル</span>
          <input type="text" id="mtg-topic" maxlength="200" placeholder="例: 中村と打合せ" autofocus>
        </label>
        <label class="field">
          <span class="lbl">開始</span>
          <div class="row" style="gap:4px; flex-wrap:wrap">
            <button class="btn" data-quick="0">今すぐ</button>
            <button class="btn" data-quick="15">+15分</button>
            <button class="btn" data-quick="30">+30分</button>
            <button class="btn" data-quick="60">+1時間</button>
          </div>
          <input type="datetime-local" id="mtg-start" value="${fmtLocal(round5)}" style="margin-top:6px">
        </label>
        <label class="field">
          <span class="lbl">長さ</span>
          <select id="mtg-duration">
            <option value="15">15 分</option>
            <option value="30" selected>30 分</option>
            <option value="45">45 分</option>
            <option value="60">1 時間</option>
            <option value="90">1.5 時間</option>
            <option value="120">2 時間</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">登録先カレンダー</span>
          <select id="mtg-calendar">
            <option value="primary">(読み込み中…)</option>
          </select>
        </label>
        <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
          <span class="switch">
            <input type="checkbox" id="mtg-zoom" checked>
            <span class="slider"></span>
          </span>
          <span>📹 Zoom MTG を含める <span class="hint-sm">— OFF なら予定だけ作成</span></span>
        </label>
        <div id="mtg-error" class="muted" style="color:var(--danger); margin:6px 0; min-height:18px"></div>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <button id="mtg-cancel">キャンセル</button>
          <button id="mtg-create" class="primary">作成</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('mtg-close').addEventListener('click', close);
  document.getElementById('mtg-cancel').addEventListener('click', close);
  document.getElementById('mtg-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'mtg-overlay') close();
  });
  root.querySelectorAll('[data-quick]').forEach(b => {
    b.addEventListener('click', () => {
      const add = Number(b.dataset.quick) || 0;
      const t = new Date(Date.now() + add * 60 * 1000);
      // 5 分単位に丸める。
      t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
      document.getElementById('mtg-start').value = fmtLocal(t);
    });
  });
  // カレンダー一覧を非同期で埋める。 modal はすぐ出して 「読み込み中…」 を後で
  // 置換する流れにし、 ネットワーク遅延でフォーム操作が止まらないように。
  (async () => {
    const cals = await getCalendarsCached();
    const sel = document.getElementById('mtg-calendar');
    if (!sel) return; // modal 閉じられた
    if (!cals.length) {
      sel.innerHTML = `<option value="primary">primary</option>`;
      return;
    }
    // primary を先頭、 残りは name 順。
    const sorted = [...cals].sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return (a.summary || '').localeCompare(b.summary || '', 'ja');
    });
    sel.innerHTML = sorted.map(c => {
      const label = (c.summary || c.id) + (c.primary ? ' (メイン)' : '');
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }).join('');
  })();
  document.getElementById('mtg-create').addEventListener('click', async () => {
    const btn   = document.getElementById('mtg-create');
    const errEl = document.getElementById('mtg-error');
    errEl.textContent = '';
    const topic       = document.getElementById('mtg-topic').value.trim();
    const startRaw    = document.getElementById('mtg-start').value;
    const duration    = Number(document.getElementById('mtg-duration').value);
    const calendar_id = document.getElementById('mtg-calendar').value || 'primary';
    const with_zoom   = document.getElementById('mtg-zoom').checked;
    if (!topic)    { errEl.textContent = 'タイトルを入れてください'; return; }
    if (!startRaw) { errEl.textContent = '開始時刻を入れてください'; return; }
    // datetime-local の値はブラウザ ローカル時刻。 そのまま 「自分の今いる場所」
    // の時刻として扱い、 ISO suffix も実 offset から計算 (海外滞在対応)。
    const tzInfo = localTzInfo();
    const start = startRaw + ':00' + tzInfo.suffix;
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/me/calendar/events',
        { topic, start, duration_minutes: duration, calendar_id, with_zoom, timezone: tzInfo.iana });
      if (r.invalidate_calendar_cache) {
        try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
      }
      toast(with_zoom ? 'Zoom MTG を作成しました' : '予定を作成しました');
      close();
      await renderCalendarEvents();
    } catch (e) {
      errEl.textContent = e.message || String(e);
      btn.disabled = false; btn.textContent = '作成';
    }
  });
}

// Newest listings (top 5 by created_at). Server returns sorted by price ASC + created_at ASC
// for /api/listings — we re-sort by created_at DESC client-side for "新規入荷".
async function renderMyGroups() {
  const card = document.getElementById('home-groups-card');
  const root = document.getElementById('home-groups');
  if (!card || !root) return;
  try {
    const d = await get('/api/groups');
    const items = d.items || [];
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    // groups.js の coverListItem を共有 (avatar 行 + 表紙画像のオン/オフが
    // 同じロジックでまとまる)。 closed は [終了] バッジ付きで同じカードに混ぜる。
    root.innerHTML = items.slice(0, 5).map(g => coverListItem({
      href:            '#/groups/' + escapeHtml(g.slug || g.id),
      image_url:       g.image_url,
      image_thumb_url: g.image_thumb_url, // v511 サーバ側サムネ実在チェック済み
      title:           escapeHtml(g.title) + (g.closed_at ? ' <span class="tag muted">終了</span>' : ''),
      members:         g.members || [],
      chipSize:        'xs',  // v412 上下が あふれる 報告 → 元の xs (18px) に 戻し
    })).join('');
  } catch (_) {
    card.hidden = true;
  }
}

async function renderFreshInvitations() {
  const card = document.getElementById('home-invs-card');
  const root = document.getElementById('home-invs');
  if (!card || !root) return;
  try {
    const d = await get('/api/invitations', { status: 'open' });
    const open = d.items || [];
    // v513 #135 「＋ 新しく募集する」 はあまり使われないので削除。 ゼロ件ならカードごと
    //   隠す (募集機能は #/invitations や #/apps から行ける)。
    if (!open.length) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;
    root.innerHTML = open.slice(0, 5).map(i => {
      // v391 ホーム募集リスト: 写真 + タイトル + 🕒実施日時 + ⏰締切 + 📍場所 + 発起人｜参加者
      const when = i.starts_at
        ? `🕒 ${escapeHtml(Number(i.starts_at_has_time) === 0 ? fmtDate(i.starts_at) : fmtDateTime(i.starts_at))}`
        : '';
      const deadline = i.signup_closes_at ? `⏰ 締切 ${escapeHtml(fmtDateTime(i.signup_closes_at))}` : '';
      const where = i.location ? `📍 ${escapeHtml(i.location)}` : '';
      const meta = [when, deadline, where].filter(Boolean).join(' ・ ');
      const joined = Number(i.i_joined) === 1 ? ' <span class="tag ok">✓参加</span>' : '';
      const title = `${escapeHtml(i.title)}${joined}`;
      // 発起人アイコン | 参加者アイコン (発起人除く)
      // v412 上下に あふれる ので 元の xs に 戻す。
      const creatorChip = `<span title="${escapeHtml(i.creator_name)} (発起人)" style="display:inline-flex">${avatarHtml(i.creator_name, i.creator_avatar_url, 'xs')}</span>`;
      const others = (Array.isArray(i.joins) ? i.joins : [])
        .filter(j => Number(j.id) !== Number(i.creator_user_id));
      const othersHtml = others.slice(0, 7).map(j =>
        `<span title="${escapeHtml(j.display_name)}" style="display:inline-flex">${avatarHtml(j.display_name, j.avatar_url, 'xs')}</span>`
      ).join('');
      const moreNum = others.length > 7 ? `<span class="muted" style="font-size:11px">+${others.length - 7}</span>` : '';
      const sep = others.length ? `<span class="muted" style="font-size:14px; line-height:1; padding:0 2px">｜</span>` : '';
      const peopleRow = `<div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px; align-items:center">${creatorChip}${sep}${othersHtml}${moreNum}</div>`;
      const href = '#/invitations/' + i.id;
      const iCover = i.image_thumb_url || i.image_url; // v511 サムネ優先
      if (iCover) {
        return `
          <a class="list-item with-cover hero" href="${href}">
            <div class="cover-img" style="background-image:url('${escapeHtml(iCover)}')"></div>
            <div class="grow">
              <div class="bold">${title}</div>
              <div class="meta">${meta}</div>
              ${peopleRow}
            </div>
          </a>`;
      }
      return `
        <a class="list-item" href="${href}">
          <div class="grow">
            <div class="bold">${title}</div>
            <div class="meta">${meta}</div>
            ${peopleRow}
          </div>
          <div class="hint">→</div>
        </a>`;
    }).join(''); // v513 #135 「＋ 新しく募集する」 撤去に伴い addLink 連結も削除
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v471 → v480 新着 食べある記 (ホーム カード)。 新規入荷 と 同じ with-cover
// レイアウト (左 110px の カバー画像 + バッジ) で 3 件 を 大きく 表示。
async function renderFreshPlaces() {
  const card = document.getElementById('home-places-card');
  const root = document.getElementById('home-places');
  if (!card || !root) return;
  try {
    const d = await get('/api/places');
    const items = (d.items || []).slice(0, 3);
    card.hidden = false;
    if (!items.length) {
      root.innerHTML = '<div class="empty" style="padding:6px; font-size:12px">まだ お店 なし</div>';
      return;
    }
    root.innerHTML = items.map(p => {
      const cat = p.category ? (CAT_LBL_HOME[p.category] || p.category) : '';
      const rating = p.avg_rating !== null
        ? `⭐${p.avg_rating.toFixed(1)}`
        : '';
      const ratingBadge = rating
        ? `<div class="price-badge" style="color:#f59e0b">${rating}</div>`
        : '';
      // v486 #80 / v487 #82 いいね 数 を 0 件 でも 常時 表示。
      const likeBit = ` · ${p.liked_by_me ? '❤️' : '🤍'}${p.like_count || 0}`;
      const meta = `${cat ? escapeHtml(cat) + ' · ' : ''}💬 ${p.comment_count}${p.avg_rating !== null ? ' · ' + ratingStars(p.avg_rating) : ''}${likeBit}`;
      const href = `#/places/${p.id}`;
      // v503 #127 サムネを優先
      const coverBg = p.cover_image_thumb || p.cover_image;
      if (coverBg) {
        return `
          <a class="list-item with-cover" href="${href}">
            <div class="cover-img" style="background-image:url('${escapeHtml(coverBg)}')">${ratingBadge}</div>
            <div class="grow">
              <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)}</div>
              <div class="meta">${meta}</div>
            </div>
          </a>`;
      }
      return `
        <a class="list-item with-cover" href="${href}">
          <div class="cover-img cover-img-fallback" style="background:linear-gradient(135deg, #f5e9d6, #fff); font-size:42px">🍴${ratingBadge}</div>
          <div class="grow">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)}</div>
            <div class="meta">${meta}</div>
          </div>
        </a>`;
    }).join('');
  } catch (_) { card.hidden = true; }
}
// places カテゴリ ラベル (renderFreshPlaces で使う 短縮版)
const CAT_LBL_HOME = { cafe:'☕', lunch:'🍱', dinner:'🍣', bar:'🍺', sweets:'🍰', other:'🍴' };
function ratingStars(r) {
  if (r === null || r === undefined) return '';
  const full = Math.round(r);
  return '⭐'.repeat(full);
}

// v400 新着 プレイリスト カード。 直近 5 件を「カバー画像 + タイトル + 作者
// + 曲数 / 👁 / ❤️」 で表示。 ゼロなら カードごと 非表示。
async function renderFreshSns() {
  const card = document.getElementById('home-sns-card');
  const root = document.getElementById('home-sns');
  if (!card || !root) return;
  try {
    const d = await get('/api/posts', { limit: 5 });
    const items = d.items || [];
    card.hidden = false;
    bindHomeSnsComposer(); // composer は 投稿件数 に関わらず 1 回だけ wire
    if (!items.length) {
      root.innerHTML = '<div class="empty" style="padding:6px; font-size:12px">まだ 投稿 なし</div>';
      return;
    }
    root.innerHTML = items.map(p => {
      const snipBase = p.body || (p.image_url ? '' : '(無題)');
      const snip = snipBase.length > 120 ? snipBase.slice(0, 120) + '…' : snipBase;
      // v481 #68 ホーム でも 👍 ❤ ⭐ 3 種 表示 + 縦幅 1.2x。 1.35→1.5 行高、
      //   min-height 96→116、 padding を 少し 増やし リアクション 見切れ 防止。
      // v482 #69 画像 有 / 無 で 同じ 高さ (116px) + 上 マージン を 詰める + 時刻 を
      //   投稿者名 の 横 に。
      // v493 #94 ホームから直接押せるリアクション。 ボタンに data-home-react-* を持たせて、
      //   bindHomeSnsReactions で クリックハンドラを後から付ける。
      const counts = p.reaction_counts || { thumb: 0, heart: p.like_count || 0, star: 0 };
      const mine = new Set(p.my_reactions || (p.liked_by_me ? ['heart'] : []));
      const reactBadges = [
        { k: 'thumb', icon: '👍', color: '#2563eb' },
        { k: 'heart', icon: '❤️', color: '#e11d48' },
        { k: 'star',  icon: '⭐', color: '#f59e0b' },
      ].map(r => {
        const on = mine.has(r.k);
        return `<span data-home-react-post="${p.id}" data-home-react-kind="${r.k}" style="cursor:pointer; padding:1px 4px; border-radius:6px; ${on ? 'color:' + r.color + '; font-weight:600' : 'opacity:0.6'}">${r.icon} <span data-home-react-n>${counts[r.k] || 0}</span></span>`;
      }).join(' · ');
      const reactionsLine = `${reactBadges} · 💬 ${p.reply_count}`;
      // v497 #104 端末がJST以外 (旅行中など) でも正しい時刻差が出るように、
      //   サーバ側で TZ付きISO (created_at_iso) を返している。 旧キャッシュからの
      //   フォールバック として created_at もそのまま見る。
      const timeAgo = (s) => {
        if (!s) return '';
        const dt = new Date(String(s).replace(' ', 'T'));
        const diff = Date.now() - dt.getTime();
        if (diff < 60_000) return 'たった今';
        if (diff < 3600_000) return `${Math.floor(diff/60000)}分前`;
        if (diff < 86400_000) return `${Math.floor(diff/3600000)}時間前`;
        if (diff < 7 * 86400_000) return `${Math.floor(diff/86400_000)}日前`;
        return `${dt.getMonth()+1}/${dt.getDate()}`;
      };
      const tAgo = timeAgo(p.created_at_iso || p.created_at);
      // v465 ヒーロー: テキスト が メイン (左) + 画像 が 右端 から 中央 まで
      // 斜めに 浮き出す。 画像 の 左端 を polygon で 斜め カット (右肩上がり)。
      // 縦幅 は 通常 行 と 同じ ぐらい (= text-content の 高さ で 決まる、 minHeight)。
      // アバター は 別途 <img> で 正方形 固定 (avatarHtml が flexbox 内で 横長化
      // していた のを 回避)。
      if (p.image_url) {
        // v468 .row > * の flex:1 1 auto を 上書き しないと 横長 に 引き伸ばされる
        const avatar = p.avatar_url
          ? `<img src="${escapeHtml(p.avatar_url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" style="flex:none !important; width:22px; height:22px; border-radius:50%; object-fit:cover; aspect-ratio:1/1">`
          : `<div style="flex:none !important; width:22px; height:22px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px; aspect-ratio:1/1">${escapeHtml((p.display_name || '?').trim().charAt(0).toUpperCase())}</div>`;
        return `
          <a href="#/sns/${p.id}" style="display:block; text-decoration:none; color:inherit; margin:4px 0; border-radius:10px; overflow:hidden; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.06); position:relative; min-height:100px">
            <div style="position:absolute; left:0; top:0; bottom:0; width:50%; background:#222 center/cover no-repeat; background-image:url('${escapeHtml(p.image_thumb_url || p.image_url)}'); clip-path:polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%)"></div>
            <div style="position:relative; margin-left:45%; padding:3px 10px 4px 12px; box-sizing:border-box; display:flex; flex-direction:column; gap:2px; justify-content:flex-start">
              <div class="row" style="gap:6px; align-items:baseline; margin:0">
                ${avatar}
                <span style="font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.display_name)}</span>
                <span class="hint" style="font-size:10px; flex:none">${escapeHtml(tAgo)}</span>
              </div>
              ${snip ? `<div style="font-size:12.5px; line-height:1.4; white-space:pre-wrap; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical">${escapeHtml(snip)}</div>` : ''}
              <div class="hint" style="font-size:11px">${reactionsLine}</div>
            </div>
          </a>`;
      }
      // v482 #69 / v483 #74 文字 のみ も 画像 あり と 同じ 100px 高さ + 投稿者 右横 に 時刻。
      return `
        <a class="list-item" href="#/sns/${p.id}" style="align-items:flex-start; gap:6px; min-height:100px; padding:4px 6px">
          ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
          <div class="grow" style="min-width:0; display:flex; flex-direction:column; gap:2px">
            <div class="row" style="gap:6px; align-items:baseline; margin:0">
              <span class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.display_name)}</span>
              <span class="hint" style="font-size:10px; flex:none">${escapeHtml(tAgo)}</span>
            </div>
            <div class="meta" style="font-size:13px; line-height:1.4; white-space:pre-wrap; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical">${escapeHtml(snip)}</div>
            <div class="hint" style="font-size:11px">${reactionsLine}</div>
          </div>
        </a>`;
    }).join('');
    bindHomeSnsReactions();
    bindHomeSnsComposer();
  } catch (_) { card.hidden = true; }
}

// v581 ホーム らぼったー ウィジェット の 投稿欄。 シンプル: テキスト のみ POST。
//   投稿後は その場で 一覧を 再フェッチ。
function bindHomeSnsComposer() {
  const btn  = document.getElementById('home-sns-post');
  const body = document.getElementById('home-sns-body');
  const status = document.getElementById('home-sns-status');
  if (!btn || !body || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    const text = body.value.trim();
    if (!text) { toast('本文を入力してください'); return; }
    btn.disabled = true; btn.textContent = '送信中…';
    if (status) status.textContent = '';
    try {
      await post('/api/posts', { body: text });
      body.value = '';
      toast('投稿しました');
      // すぐ 一覧を 更新 (キャッシュ無視で再フェッチ)
      try { await renderFreshSns(); } catch (_) {}
    } catch (e) {
      if (status) status.textContent = '送信失敗: ' + (e?.message || e);
      else toast('送信失敗: ' + (e?.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '投稿';
    }
  });
  // Ctrl+Enter / Cmd+Enter で 投稿
  body.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      btn.click();
    }
  });
}

// v493 #94 ホーム らぼったー の リアクション ボタン を 押した 瞬間 サーバに 反映し、
//   その場で カウントと 色を 更新。 リンク (a 要素) 内の <span> なので
//   stopPropagation で 親 a のクリック (詳細遷移) を 抑止。
function bindHomeSnsReactions() {
  document.querySelectorAll('[data-home-react-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = el.dataset.homeReactPost;
      const kind = el.dataset.homeReactKind;
      const on = parseFloat(el.style.fontWeight || '0') >= 600;
      try {
        const r = on
          ? await fetch(`/api/posts/${id}/reaction?kind=${kind}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' } }).then(x => x.json())
          : await post(`/api/posts/${id}/reaction?kind=${kind}`, {});
        const mine = new Set(r.my_reactions || []);
        const counts = r.reaction_counts || {};
        const colors = { thumb: '#2563eb', heart: '#e11d48', star: '#f59e0b' };
        document.querySelectorAll(`[data-home-react-post="${id}"]`).forEach(b => {
          const k = b.dataset.homeReactKind;
          const isOn = mine.has(k);
          b.style.cssText = `cursor:pointer; padding:1px 4px; border-radius:6px; ${isOn ? 'color:' + colors[k] + '; font-weight:600' : 'opacity:0.6'}`;
          const nEl = b.querySelector('[data-home-react-n]');
          if (nEl) nEl.textContent = counts[k] || 0;
        });
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
  });
}

// v482 #72 ホーム TODO カード。 未完了 で 締切 が 近い 順 (締切 なし は 末尾)。
//   最大 5 件。
// v514 #139 重要連絡 / 学会情報 をホームウィジェットとして表示。 デフォルトは ON。
async function renderHomeNotices() {
  const card = document.getElementById('home-notices-card');
  const root = document.getElementById('home-notices');
  if (!card || !root) return;
  try {
    const d = await get('/api/notices');
    const items = (d.items || []).slice(0, 5);
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    root.innerHTML = items.map(n => {
      const cat = n.category === 'conference' ? '📚 学会' : '📌 連絡';
      const url = n.url ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="hint" onclick="event.stopPropagation()">🔗</a>` : '';
      return `
        <a class="list-item" href="#/notices" style="gap:8px; align-items:flex-start">
          <div style="flex:1; min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(n.title)}</div>
            <div class="meta">${cat} · ${escapeHtml(n.creator_name || '')} · ${escapeHtml(n.created_at || '')}</div>
          </div>
          ${url}
        </a>`;
    }).join('');
  } catch (_) { card.hidden = true; }
}

async function renderHomeTodos() {
  const card = document.getElementById('home-todos-card');
  const root = document.getElementById('home-todos');
  if (!card || !root) return;
  try {
    const d = await get('/api/todos');
    const all = d.items || [];
    const open = all.filter(t => !t.done).slice(0, 5);
    if (!open.length) { card.hidden = true; return; }
    card.hidden = false;
    const fmt = (s) => {
      if (!s) return '';
      const dt = new Date(String(s).replace(' ', 'T'));
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      if (now.toDateString() === dt.toDateString()) return `今日 ${time}`;
      const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
      if (tomorrow.toDateString() === dt.toDateString()) return `明日 ${time}`;
      return `${dt.getMonth()+1}/${dt.getDate()} ${time}`;
    };
    const dueColor = (s) => {
      if (!s) return '#6b6b6b';
      const ms = new Date(String(s).replace(' ', 'T')) - new Date();
      if (ms < 0) return '#c62828';
      if (ms < 3600_000) return '#c62828';
      if (ms < 24 * 3600_000) return '#e65100';
      return '#6b6b6b';
    };
    root.innerHTML = open.map(t => {
      const dueBadge = t.due_at
        ? `<span style="font-size:11px; color:${dueColor(t.due_at)}; font-weight:600; flex:none">⏰ ${escapeHtml(fmt(t.due_at))}</span>`
        : '';
      return `
        <a class="list-item" href="#/todos" style="gap:8px; align-items:center">
          <span style="flex:none; font-size:14px">▫</span>
          <span class="grow" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(t.body)}</span>
          ${dueBadge}
        </a>`;
    }).join('');
  } catch (_) { card.hidden = true; }
}

async function renderFreshPlaylists() {
  const card = document.getElementById('home-pl-card');
  const root = document.getElementById('home-pl');
  if (!card || !root) return;
  try {
    const d = await get('/api/playlists', { limit: 5 });
    const items = d.items || [];
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    root.innerHTML = items.slice(0, 5).map(p => {
      const cover = p.cover_image_url
        ? `<div class="cover-img" style="background-image:url('${escapeHtml(p.cover_image_url)}')"></div>`
        : `<div class="cover-img" style="background:linear-gradient(135deg, #fce4ec, #e1bee7); display:flex; align-items:center; justify-content:center; font-size:24px">🎵</div>`;
      const heart = p.i_liked ? '❤️' : '🤍';
      const genre = p.genre_tag ? ` · 🏷 ${escapeHtml(p.genre_tag)}` : '';
      return `
        <a class="list-item with-cover" href="#/playlists/${p.id}">
          ${cover}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)}</div>
            <div class="meta" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
              ${avatarHtml(p.creator_name, p.creator_avatar_url, 'xs')}
              ${escapeHtml(p.creator_name)} · 🎵 ${p.item_count} · 👁 ${p.view_count} · ${heart} ${p.like_count}${genre}
            </div>
          </div>
        </a>`;
    }).join('');
  } catch (_) {
    card.hidden = true;
  }
}

// v405 自分が 参加中 (作成 or 招待) の タイマー + ストップウォッチ で 進行中 or
// 一時停止中 のものを ホームに 強調表示。 ベルが鳴る前に スクリーン off してて
// 「気づかなかった」 を防ぐ + 共有 ストップウォッチに 戻りやすく。
// fmtTmDur: タイマー/SW/点呼 用 (秒精度 MM:SS)。
function fmtTmDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
// v451 待ち合わせ / 〆切 用 (秒は 表示 しない、 分単位 で 切り上げ ぽく扱う)。
//  < 60 秒  → 「まもなく」
//  < 60 分  → 「N 分」
//  < 24 時間 → 「H 時間 M 分」 (分が 0 なら 省略)
//  >= 24 時間 → 「D 日 H 時間」
function fmtHumanLong(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return 'まもなく';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  const mRem = min % 60;
  if (h < 24) return mRem ? `${h} 時間 ${mRem} 分` : `${h} 時間`;
  const d = Math.floor(h / 24);
  const hRem = h % 24;
  return hRem ? `${d} 日 ${hRem} 時間` : `${d} 日`;
}

// v445 進行中 カード を 1 秒 ごと に ローカル で 進める。 API 再フェッチ せず
// data-tick-* 属性 から 残り / 経過 を 計算。 ナビ で カードが DOM から
// 消えたら interval を 解除 (root.isConnected を 監視)。
let myActiveTimersTickId = null;
function updateMyActiveTimersTicks(root) {
  if (!root || !root.isConnected) {
    if (myActiveTimersTickId) { clearInterval(myActiveTimersTickId); myActiveTimersTickId = null; }
    return;
  }
  const now = Date.now();
  root.querySelectorAll('[data-tick-mode]').forEach(el => {
    const mode = el.dataset.tickMode;
    let secs;
    if (mode === 'countdown') {
      const target = Number(el.dataset.tickTargetMs);
      secs = Math.max(0, Math.floor((target - now) / 1000));
    } else if (mode === 'countup') {
      const base = Number(el.dataset.tickBaseSec) || 0;
      const anchor = Number(el.dataset.tickAnchorMs) || now;
      secs = Math.max(0, base + Math.floor((now - anchor) / 1000));
    } else {
      return;
    }
    const fmt = el.dataset.tickFmt === 'human' ? fmtHumanLong : fmtTmDur;
    el.textContent = fmt(secs) + (el.dataset.tickSuffix || '');
    const red = el.dataset.tickRedBelow;
    if (red) {
      const threshold = Number(red);
      el.style.color = secs < threshold
        ? (el.dataset.tickColorRed  || '#c62828')
        : (el.dataset.tickColorNorm || '#1565c0');
    }
  });
}

async function renderMyActiveTimers() {
  const card = document.getElementById('home-mytm-card');
  const root = document.getElementById('home-mytm');
  if (!card || !root) return;
  try {
    const meId = Number(state.me?.id);
    // v406 点呼 (rollcall) も 「時間制限あり」 なので 合流。 pending API 経由で
    // 自分が 対応していない 締切付き 点呼を 拾う。
    // v482 #73 点呼 は /api/me/pending では 「未応答」 だけ なので、 自分 が
    //   起案者 / 既に 応答済 の 点呼 も ホーム の 進行中 に 出す ため /api/rollcalls
    //   を 別途 取得。
    const [tm, sw, rc, mu] = await Promise.allSettled([
      get('/api/timers'),
      get('/api/stopwatches'),
      get('/api/rollcalls'),
      get('/api/meetups'),
    ]);
    const rows = [];
    // v442 待ち合わせ も 「時間制限あり」 に 合流。 cancelled なし + 未来 (meetup_at > now)
    // のもの だけ。 v445 tick: countdown、 10 分 切ったら 赤。
    // v450 kind = 'deadline' は 📌 〆切、 'meetup' は 🤝 待ち合わせ。
    if (mu.status === 'fulfilled') {
      const nowMs = Date.now();
      for (const m of (mu.value.items || [])) {
        if (m.cancelled_at) continue;
        const ts = Date.parse(String(m.meetup_at).replace(' ', 'T'));
        if (!ts || ts <= nowMs) continue;
        const remaining = Math.max(0, Math.floor((ts - nowMs) / 1000));
        const isDeadline = m.kind === 'deadline';
        rows.push({
          href: '#/meetups/' + m.id,
          kind: isDeadline ? '📌 〆切' : '🤝 待ち合わせ',
          title: m.title || (isDeadline ? '〆切' : '待ち合わせ'),
          // v451 ホーム の 待ち合わせ / 〆切 は 「X 時間 Y 分」 表示 (秒なし)。
          time: `${fmtHumanLong(remaining)} ${isDeadline ? '残' : '後'}`,
          tick: { mode: 'countdown', targetMs: ts,
                  suffix: isDeadline ? ' 残' : ' 後',
                  fmt: 'human',
                  redBelow: 600,
                  colorRed: '#c62828',
                  colorNorm: isDeadline ? '#b91c1c' : '#7c3aed' },
          sort: remaining,
          color: remaining < 600 ? '#c62828' : (isDeadline ? '#b91c1c' : '#7c3aed'),
          bg: isDeadline ? '#fee2e2' : '#ede9fe',
          participants: m.participants || [],   // v466
        });
      }
    }
    // v482 #70 #73 点呼: 自分 が 起案 した もの + 自分 が 対象 (応答済 含む) の
    //   open な もの を 表示。 起算点 = 「点呼 を 押した 時刻」 (created_at) で
    //   countup。 応答済 は 「✅」 マーク付き で 区別。
    if (rc.status === 'fulfilled') {
      const nowMs = Date.now();
      for (const r of (rc.value.items || [])) {
        if (r.status !== 'open') continue;
        const isCreator = Number(r.creator_user_id) === meId;
        const isTarget = Number(r.is_target) === 1 || r.is_target === true;
        if (!isCreator && !isTarget) continue;
        const hasResponded = Number(r.has_responded) === 1 || r.has_responded === true;
        const startedMs = r.created_at ? Date.parse(String(r.created_at).replace(' ', 'T')) : null;
        const elapsed = startedMs ? Math.max(0, Math.floor((nowMs - startedMs) / 1000)) : 0;
        const dlShort = r.deadline_at ? String(r.deadline_at).slice(11, 16) : '';
        const suffix = dlShort ? ` 経過 (締切 ${dlShort})` : ' 経過';
        const kind = hasResponded ? '✅ 点呼 (応答済)' : '📣 点呼';
        rows.push({
          href: '#/rollcalls/' + r.id,
          kind,
          title: r.title + (isCreator ? ' [起案]' : ''),
          time: `${fmtTmDur(elapsed)}${suffix}`,
          tick: startedMs ? { mode: 'countup', baseSec: elapsed, anchorMs: nowMs, suffix } : null,
          sort: -elapsed,
          color: hasResponded ? '#0e7c63' : '#e65100',
          bg: hasResponded ? '#e0f7f1' : '#fff3e0',
        });
      }
    }
    // タイマー。 v445 running は tick countdown (target は サーバ-クライアント 時刻差を
    // 引いた client 時間 軸)、 60 秒 切ったら 赤。 v446 paused は tick なし で
    // 「⏸ 残り MM:SS」 を 静的 表示。
    if (tm.status === 'fulfilled') {
      const tNow = Date.parse(String(tm.value.server_now).replace(' ', 'T'));
      const tOff = tNow - Date.now();
      for (const t of (tm.value.items || [])) {
        const isPart = Number(t.is_participant) === 1 || Number(t.creator_user_id) === meId;
        if (!isPart) continue;
        if (t.status === 'running') {
          const ends = Date.parse(String(t.ends_at).replace(' ', 'T'));
          const targetClient = ends - tOff;
          const remaining = Math.max(0, Math.floor((targetClient - Date.now()) / 1000));
          rows.push({
            href: '#/timers/' + t.id,
            kind: '⏱ タイマー',
            title: t.title,
            time: `${fmtTmDur(remaining)} 残`,
            tick: { mode: 'countdown', targetMs: targetClient, suffix: ' 残', redBelow: 60, colorRed: '#c62828', colorNorm: '#1565c0' },
            sort: remaining,
            color: remaining < 60 ? '#c62828' : '#1565c0',
            bg: '#e3f2fd',
            participants: t.participants || [],  // v466
          });
        } else if (t.status === 'paused') {
          const remaining = Math.max(0, Number(t.remaining_seconds) || 0);
          rows.push({
            href: '#/timers/' + t.id,
            kind: '⏸ タイマー 一時停止',
            title: t.title,
            time: `${fmtTmDur(remaining)} 残`,
            tick: null,
            sort: 888888 + remaining,  // paused は running の 後 / SW 一時停止 の 前
            color: '#e65100',
            bg: '#fff3e0',
            participants: t.participants || [],  // v466
          });
        }
      }
    }
    // ストップウォッチ。 running は 1 秒 ごと 経過秒 +1、 paused は 固定表示。
    if (sw.status === 'fulfilled') {
      for (const s of (sw.value.items || [])) {
        if (s.status === 'stopped') continue;  // リセット済は出さない
        const running = s.status === 'running';
        rows.push({
          href: '#/stopwatches/' + s.id,
          kind: running ? '🟢 SW 計測中' : '⏸ SW 一時停止',
          title: s.title,
          time: fmtTmDur(s.elapsed_seconds),
          tick: running ? { mode: 'countup', baseSec: Number(s.elapsed_seconds) || 0, anchorMs: Date.now() } : null,
          sort: 999999,
          color: running ? '#0e7c63' : '#e65100',
          bg: running ? '#e0f7f1' : '#fff3e0',
        });
      }
    }
    // v440 空でも カード自体は 表示 (「進行中なし」 placeholder)。 旧仕様 だと
    // 「表示されない = 壊れた?」 と 誤認 されやすかった。
    card.hidden = false;
    // 前回 の tick interval は 解除。 空でも 解除する。
    if (myActiveTimersTickId) { clearInterval(myActiveTimersTickId); myActiveTimersTickId = null; }
    // v514 #132 中身が無いときはカードごと非表示 (ユーザがチェック ON にしていても、
    //   空ならホームに領域を取らない。 polling で 1 件でも出てきたら card.hidden=false)。
    if (!rows.length) { card.hidden = true; root.innerHTML = ''; return; }
    card.hidden = false;
    rows.sort((a, b) => a.sort - b.sort);  // 締切 / 残り少ない順
    root.innerHTML = rows.map(r => {
      const t = r.tick;
      const tickAttrs = t ? (
        t.mode === 'countdown'
          ? ` data-tick-mode="countdown" data-tick-target-ms="${t.targetMs}" data-tick-suffix="${escapeHtml(t.suffix || '')}"${t.fmt ? ` data-tick-fmt="${escapeHtml(t.fmt)}"` : ''} data-tick-red-below="${t.redBelow || 0}" data-tick-color-red="${t.colorRed || '#c62828'}" data-tick-color-norm="${t.colorNorm || '#1565c0'}"`
          : ` data-tick-mode="countup" data-tick-base-sec="${t.baseSec}" data-tick-anchor-ms="${t.anchorMs}"${t.suffix ? ` data-tick-suffix="${escapeHtml(t.suffix)}"` : ''}`
      ) : '';
      // v466 関係者 アバター を 重ねて (overlap) 横並び 表示。 最大 5 名。
      const parts = Array.isArray(r.participants) ? r.participants : [];
      const partsHtml = parts.length ? `
        <div style="display:flex; margin-right:6px; flex-shrink:0">
          ${parts.slice(0, 5).map((p, i) => {
            const ml = i === 0 ? '' : 'margin-left:-6px';
            const initial = (p.display_name || '?').trim().charAt(0).toUpperCase();
            return p.avatar_url
              ? `<img src="${escapeHtml(p.avatar_url)}" alt="${escapeHtml(p.display_name)}" title="${escapeHtml(p.display_name)}" loading="lazy" decoding="async" fetchpriority="low" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:2px solid #fff; ${ml}">`
              : `<div title="${escapeHtml(p.display_name)}" style="width:22px; height:22px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px; border:2px solid #fff; ${ml}">${escapeHtml(initial)}</div>`;
          }).join('')}
        </div>` : '';
      // v478 タグ を 時間 の 下 に 配置 し、 タイトル に 横幅 を 渡す (タイトル が
      // 改行 されない ように)。 左カラム = [時間 + タグ] スタック、 中 = タイトル、 右 = アバター + →。
      return `
        <a class="list-item" href="${r.href}">
          <div style="display:flex; flex-direction:column; align-items:center; flex:none; min-width:80px; gap:2px">
            <div${tickAttrs} style="font-family:monospace; font-size:16px; font-weight:700; color:${r.color}">${r.time}</div>
            <span class="tag" style="background:${r.bg}; color:${r.color}; font-size:10px; white-space:nowrap">${escapeHtml(r.kind)}</span>
          </div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title)}</div>
          </div>
          ${partsHtml}
          <div class="hint">→</div>
        </a>`;
    }).join('');
    // ローカル 秒 tick 開始。 root が DOM から 外れたら 自動 停止。
    myActiveTimersTickId = setInterval(() => updateMyActiveTimersTicks(root), 1000);
  } catch (_) {
    card.hidden = true;
    if (myActiveTimersTickId) { clearInterval(myActiveTimersTickId); myActiveTimersTickId = null; }
  }
}

async function renderFreshListings() {
  const root = document.getElementById('home-fresh-listings');
  if (!root) return; // 非同期 await 中にユーザが home から離れて DOM が消えてるケース
  try {
    const d = await get('/api/listings', { limit: 50 });
    const items = (d.items || [])
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 3);
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ出品はありません</div>`;
      return;
    }
    // グループ / 募集と同じ with-cover レイアウト (左 110px の表紙画像) で
    // 新規入荷も大きく見せる。 残数が分かるようメタ行に 「在庫 N」 を入れる。
    root.innerHTML = items.map(l => {
      // v376 価格 / プレゼントは 画像の左下に absolute オーバーレイ。
      const priceColor = l.is_gift ? '#b71c50' : 'var(--primary)';
      const priceLabel = l.is_gift ? '🎁' : `${l.price.toLocaleString()} pt`;
      const priceBadge = `<div class="price-badge" style="color:${priceColor}">${priceLabel}</div>`;
      // 在庫数: 2 個以上の時だけ表示。 1 個は 「言うまでもない」 のでノイズ削減。
      const qtyTag = (typeof l.qty === 'number' && l.qty >= 2) ? ` · 在庫 ${l.qty}` : '';
      // v378 created_at は YYYY-MM-DD だけ (時刻は不要)。
      const when = fmtDate(l.created_at);
      // v378 出品者は アイコンで (名前は title 属性に)。
      const sellerAvatar = `<span title="${escapeHtml(l.seller_name)}" style="display:inline-flex; vertical-align:middle">${avatarHtml(l.seller_name, l.seller_avatar_url, 'xs')}</span>`;
      const meta = `${sellerAvatar}${l.location ? ' · 📍 ' + escapeHtml(l.location) : ''}${qtyTag} · ${escapeHtml(when)}`;
      const href = `#/product/${encodeURIComponent(l.jan)}`;
      const lCover = l.image_thumb_url || l.image_url; // v511 サムネ優先
      if (lCover) {
        return `
          <a class="list-item with-cover" href="${href}">
            <div class="cover-img" style="background-image:url('${escapeHtml(lCover)}')">${priceBadge}</div>
            <div class="grow">
              <div class="bold">${escapeHtml(l.name)}</div>
              <div class="meta" style="display:flex; align-items:center; gap:4px">${meta}</div>
            </div>
          </a>`;
      }
      // 画像なし: 頭文字プレースホルダを cover サイズに引き伸ばす。
      const initial = (l.name || '?').trim().charAt(0).toUpperCase();
      return `
        <a class="list-item with-cover" href="${href}">
          <div class="cover-img cover-img-fallback">${escapeHtml(initial)}${priceBadge}</div>
          <div class="grow">
            <div class="bold">${escapeHtml(l.name)}</div>
            <div class="meta" style="display:flex; align-items:center; gap:4px">${meta}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Open tasks I can apply for (top 5 by id DESC). Also splits out tasks the
// user is CURRENTLY working on (my_status = claimed / reported) into a
// separate top-of-page card — without this, workers who claimed a task often
// forget to come back and report done because nothing on home reminded them.
async function renderFreshTasks() {
  const root = document.getElementById('home-fresh-tasks');
  const myCard = document.getElementById('home-my-claims-card');
  const myList = document.getElementById('home-my-claims');
  if (!root || !myCard || !myList) return;
  try {
    const d = await get('/api/tasks');
    const items = d.items || [];
    const myActive = items.filter(t => t.my_status === 'claimed' || t.my_status === 'reported');
    const available = items.filter(t => t.can_claim).slice(0, 5);

    if (myActive.length) {
      myCard.hidden = false;
      myList.innerHTML = myActive.map(t => {
        const statusTag = t.my_status === 'reported'
          ? '<span class="tag warn">承認待ち</span>'
          : '<span class="tag warn">引き受け中</span>';
        return `
          <a class="list-item" href="#/tasks/${t.id}" style="border-left:4px solid #b54708">
            <div style="display:flex; align-items:center; gap:8px; flex:1">
              ${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}
              <div>
                <div class="bold">${escapeHtml(t.title)} ${statusTag}</div>
                <div class="meta">${escapeHtml(t.requester_name)} · ${t.reward}pt${t.deadline ? ' · 締切 ' + escapeHtml(t.deadline) : ''}</div>
                ${t.my_status === 'claimed'
                  ? '<div class="meta" style="color:#b54708">→ タップして完了報告</div>'
                  : '<div class="meta">依頼者の承認待ち</div>'}
              </div>
            </div>
          </a>`;
      }).join('');
    } else {
      myCard.hidden = true;
    }

    // 「＋ 新しくタスクを設定する」 は常に出す。受けられるタスクがゼロでも、
    // 「設定する」 という能動的な行動が一発でできるように。
    const addLink = `
      <a class="list-item add-row" href="#/tasks?new=request">
        <div class="grow bold" style="color:var(--primary)">＋ 新しくタスクを設定する</div>
        <div class="hint">→</div>
      </a>`;
    if (!available.length) {
      root.innerHTML = addLink;
      return;
    }
    root.innerHTML = available.map(t => `
      <a class="list-item" href="#/tasks/${t.id}">
        <div style="display:flex; align-items:center; gap:8px; flex:1">
          ${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}
          <div>
            <div class="bold">${escapeHtml(t.title)}</div>
            <div class="meta">${escapeHtml(t.requester_name)} · 残 ${t.remaining ?? '-'}人${t.deadline ? ' · 締切 ' + escapeHtml(t.deadline) : ''}</div>
          </div>
        </div>
        <div class=" bold text-primary">${t.reward}pt</div>
      </a>
    `).join('') + addLink;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderRecentTx() {
  const root = document.getElementById('recent');
  if (!root) return;
  try {
    const tx = await get('/api/me/transactions', { limit: 5 });
    if (!tx.items.length) {
      root.innerHTML = `<div class="empty">まだ取引がありません</div>`;
    } else {
      root.innerHTML = tx.items.map(renderTxItem).join('');
    }
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Render the check-in area based on today's status:
//  - Already checked in:     subtle ✓ message
//  - Not yet, today is workday: passive message (Wi-Fi scanner handles it)
//  - Not yet, not workday:   inert message, but still allow optional checkin
// v508 ヒーロー チェックイン 表示も SWR キャッシュ化。 同じく前回のステータスを
//   即出して、 裏で /api/checkins/status を取り直す。
const CHECKIN_CACHE_KEY = 'labpay-checkin-status-cache';
function paintCheckin(status) {
  const root = document.getElementById('checkin-area');
  if (!root || !status) return;
  if (status.checked_in_today) {
    root.innerHTML = `<div style="font-size:14px" class="muted">✓ 本日ラボイン済み (+${status.points_today}pt / 連続ラボイン ${status.current_streak} 日)</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
    return;
  }
  const seenLabin = (status.longest_streak || 0) >= 1;
  const veteran = (status.longest_streak || 0) >= 5;
  const intro = seenLabin
    ? ''
    : (status.today_is_workday
        ? `<div class="hint">ラボの Wi-Fi に繋ぐと自動でチェックインされます。</div>`
        : `<div class="hint">今日は稼働日ではないため、連続ボーナスには影響しません。</div>`);
  const rule = veteran ? '' : bonusRuleHtml(status.bonus_rule);
  root.innerHTML = intro + rule;
}
async function renderCheckinArea() {
  const root = document.getElementById('checkin-area');
  if (!root) return;
  try {
    const cached = localStorage.getItem(CHECKIN_CACHE_KEY);
    if (cached) paintCheckin(JSON.parse(cached));
  } catch (_) {}
  try {
    const status = await get('/api/checkins/status');
    paintCheckin(status);
    try { localStorage.setItem(CHECKIN_CACHE_KEY, JSON.stringify(status)); } catch (_) {}
  } catch (e) {
    // 既にキャッシュ描画済みならそのまま。 キャッシュも無い場合のみエラー表示。
    if (!root.innerHTML) root.innerHTML = `<div class="hint">${escapeHtml(e.message)}</div>`;
  }
}

// Tiny inline explainer of the checkin bonus formula. Values come from /api/checkins/status
// so they survive admin tweaks without re-deploying. Returns '' when the API didn't
// include the field (older server, defensive).
function bonusRuleHtml(rule) {
  if (!rule) return '';
  const { base, max_total, days_to_max } = rule;
  return `<div class="muted" style="font-size:11px; margin-top:8px; line-height:1.5">
    💰 ラボインボーナス: ベース <b>${base}</b>pt + 連続日数で上乗せ、最大 <b>${max_total}</b>pt
  </div>`;
}

// Apply the icon/name display mode to the presence container.
// On = names visible (default), Off = icons only. Toggled by adding a class on the parent
// so the same DOM serves both modes — no re-render needed.
export function applyPresenceMode(showNames) {
  const root = document.getElementById('presence');
  if (!root) return;
  root.classList.toggle('presence-icons-only', !showNames);
}

function applyDurationMode(showDuration) {
  const root = document.getElementById('presence');
  if (!root) return;
  root.classList.toggle('presence-show-duration', showDuration);
}

// Compute a short Japanese duration label from session_start_at (server timestamp,
// "YYYY-MM-DD HH:MM:SS" in JST). Returns "" if unavailable.
function formatStayDuration(sessionStartAt) {
  if (!sessionStartAt) return '';
  const start = new Date(sessionStartAt.replace(' ', 'T') + '+09:00').getTime();
  if (!Number.isFinite(start)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (mins < 60) return `${mins}分`;
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return rem === 0 ? `${hours}時間` : `${hours}時間${rem}分`;
}

export function renderRoom(r, windowMin) {
  // Fade-by-age: pills are fully opaque when last seen <30s ago, then ramp
  // linearly to 0.35 by the window edge (after which the API drops them).
  // This makes brief detection gaps visible without yanking the avatar out
  // of the list entirely.
  const now = Date.now();
  const parseJst = ts => Date.parse(ts.replace(' ', 'T') + '+09:00');
  // Three values per user: opacity 1.0→0.15, grayscale 0→100%, and a bold
  // flag for the unmistakably-just-now case (≤30s). Bold on the name pulls
  // the eye to who's actively scanning right now; fade conveys "ago".
  const fadeFor = lastSeen => {
    if (!lastSeen) return { opacity: 1, gray: 0, isFresh: true };
    const ageSec = Math.max(0, (now - parseJst(lastSeen)) / 1000);
    const fresh = 30;
    const cutoff = windowMin * 60;
    if (ageSec <= fresh)  return { opacity: 1,    gray: 0,   isFresh: true  };
    if (ageSec >= cutoff) return { opacity: 0.15, gray: 100, isFresh: false };
    const t = (ageSec - fresh) / Math.max(1, cutoff - fresh);
    return {
      opacity: Number((1 - 0.85 * t).toFixed(2)),
      gray:    Math.round(100 * t),
      isFresh: false,
    };
  };
  const formatDur = mins => {
    if (mins < 1) return '1分未満';
    if (mins < 60) return `${mins}分`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
  };
  const peopleHtml = r.users.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px">
         ${r.users.map(u => {
           const { opacity, gray, isFresh } = fadeFor(u.last_seen_at);
           let dur = '';
           let stayMinutes = 0;
           if (u.session_start_at && u.last_seen_at) {
             stayMinutes = Math.max(0, Math.round(
               (parseJst(u.last_seen_at) - parseJst(u.session_start_at)) / 60000));
           }
           // 24h+ 連続検知 = ほぼ間違いなくデバイス置き忘れ。化石化 (sepia + 重い
           // grayscale) して 🗿 を添える。本人がうっかり連泊してたら戻ってきた
           // 時に普通の色に戻るので false positive はそんなに痛くない。
           const isFossil = stayMinutes >= 24 * 60;
           // 化石化した場合の生の数値は意味がない (端末が一晩中つながり
           // っぱなしだっただけ) ので「24時間+」と頭打ちで表示。それ未満
           // は通常の「滞在 N時間Y分」。
           if (stayMinutes > 0) {
             dur = isFossil ? '滞在 24時間+' : `滞在 ${formatDur(stayMinutes)}`;
           }
           const ageHint = opacity < 1 ? ' (検知途切れ気味)' : '';
           const fossilHint = isFossil ? ' (24時間以上連続検知 — 端末忘れかも)' : '';
           const tooltip = `${u.display_name}${dur ? ' — ' + dur : ''}${ageHint}${fossilHint}`;
           const style = isFossil
             ? `opacity:0.5; filter:grayscale(100%) sepia(40%) brightness(.85)`
             : `opacity:${opacity}; filter:grayscale(${gray}%)`;
           const nameStyle = isFossil ? 'font-weight:400; color:#666' : (isFresh ? 'font-weight:700' : '');
           const fossilBadge = isFossil ? ' 🗿' : '';
           return `
             <span class="presence-pill" title="${escapeHtml(tooltip)}" style="${style}">
               ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
               <span class="presence-pill-name" style="${nameStyle}">${escapeHtml(u.display_name)}${fossilBadge}</span>
             </span>`;
         }).join('')}
       </div>`
    : `<div class="muted" style="font-size:13px; margin-top:4px">誰も検知されていません</div>`;
  const scan = r.last_scan_at ? `· 最終スキャン ${escapeHtml(r.last_scan_at)}` : '· 未スキャン';
  return `
    <div style="margin-bottom:12px">
      <div class="bold">${escapeHtml(r.display_name)} (${r.users.length}人) <span class="muted" style="font-weight:normal; font-size:12px">${scan}</span></div>
      ${peopleHtml}
    </div>`;
}

function renderTxItem(t) {
  const sign = t.signed_amount > 0 ? '+' : '';
  const color = t.signed_amount > 0 ? 'var(--primary)' : 'var(--danger)';
  const label = labelFor(t.type) + (t.product_name ? ` · ${escapeHtml(t.product_name)}` : '');
  return `
    <div class="list-item">
      <div>
        <div class="bold">${label}</div>
        <div class="meta">${escapeHtml(t.counterparty ?? '')} · ${escapeHtml(t.created_at)}</div>
      </div>
      <div style="color:${color}; font-weight:800; white-space:nowrap">${sign}${t.signed_amount.toLocaleString()} pt</div>
    </div>`;
}

function labelFor(type) { return ledgerTypeLabel(type); }
