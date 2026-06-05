// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).
//
// v384: 各ユーザが 「メニューに出すアプリ」 を選べるように。 デフォルト表示は
// id を defaultVisible=true で 指定。 設定 → 「アプリ表示」 で個別 ON/OFF。
// 表示順は 一旦 APPS の宣言順 (= 重要なものほど 上)。

import { escapeHtml } from '../router.js';

export const APPS = [
  { id: 'groups',        url: '#/groups',        title: 'イベント・出張用グループ作成', desc: '学会・出張・イベントなど一時的な括り。ワリカや一斉連絡に使う。自分の入ってるグループはホームから直接アクセス。', defaultVisible: true },
  { id: 'roulette',      url: '#/roulette',      title: 'ルーレット',         desc: 'メンバーから 1 人をくじ引きで選ぶ。賞金つき可。', defaultVisible: true },
  { id: 'text-roulette', url: '#/text-roulette', title: 'どこ行くルーレット', desc: '昼飯どこ行く / 何食べる など、 任意のテキスト候補から 1 つを選ぶシンプル版。', defaultVisible: true },
  { id: 'polls',         url: '#/polls',         title: '投票・アンケート',   desc: '対象者・締切・選択肢を指定して投票を集める。 個人の票は非公開、 集計の可視タイミングは選べる。', defaultVisible: true },
  { id: 'rollcalls',     url: '#/rollcalls',     title: '点呼',               desc: '「いる？」 「起きてる？」 をワンタップで集める。 締切タイマー + 未応答者に催促 push 通知。', defaultVisible: true },
  { id: 'timers',        url: '#/timers',        title: 'タイマー',           desc: '参加者全員で 同じカウントダウンを共有。 ポモドーロ / 会議の時間配分 / イベント開始まで など。', defaultVisible: true },
  { id: 'meetups',       url: '#/meetups',       title: '🤝 待ち合わせ',      desc: '集合時刻 + 場所 + メンバー を 一発で全員に通知。 30 分後 / 1 時間後 などのプリセット時刻あり。', defaultVisible: true },
  { id: 'contacts',      url: '#/contacts',      title: '連絡先',             desc: 'ラボメンバーの緊急連絡用電話番号。 タップで通話。 自分の番号は設定から登録。', defaultVisible: true },
  { id: 'notices',       url: '#/notices',       title: '重要連絡 / 学会情報', desc: 'タイトル + 本文 + URL でピン留め可能。 カテゴリで切替。 全メンバーが投稿可、 投稿者 + admin が編集 / 削除。', defaultVisible: true },
  // v396: 以降も デフォ ON (旧 false 群は ユーザー要望で 全部 ON に変更)。
  // 使わないものは 設定 → アプリ表示 から 個別に OFF にする方針。
  { id: 'random-groups', url: '#/random-groups', title: 'ランダムグループ生成', desc: '選んだメンバーを N チームにランダム分け。学年/男女を「できるだけ均等」にする配慮も可能。', defaultVisible: true },
  { id: 'auctions',      url: '#/auctions',      title: '🏷 オークション',    desc: '出品 + 入札。 締切時刻に 最高額入札者が落札。 落札後は 出品者が 「請求を飛ばす」 ボタンから 請求機能で 集金 (連絡先は ラボ内 既知 前提なので 表示しない)。', defaultVisible: true },
  { id: 'exercise',      url: '#/exercise',      title: '🏃 運動 (歩数)',     desc: 'ポケットに入れて 「開始」 → 歩く / 階段。 端末センサーで歩数カウント、 ラボ内 ランキング表示。', defaultVisible: true },
  { id: 'nomikai',       url: '#/nomikai',       title: '飲み会割り勘',       desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。', defaultVisible: true },
  { id: 'requests',      url: '#/requests',      title: '請求 (集金)',        desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。', defaultVisible: true },
  { id: 'scrapbox',      url: '#/scrapbox',      title: 'Scrapbox 履歴',      desc: '#scrapbox の研究ノート編集を読みやすくまとめて表示。', defaultVisible: true },
  { id: 'network',       url: '#/network',       title: '関係性グラフ',       desc: '売買・タスク・送金・Wishlist などのつながりをグラフで可視化。', defaultVisible: true },
];

const APP_VIS_KEY = 'labpay-apps-visibility';

// 各 app id について 「表示する」 か。 ユーザ設定 が無ければ defaultVisible に従う。
export function isAppVisible(id) {
  try {
    const j = JSON.parse(localStorage.getItem(APP_VIS_KEY) || '{}');
    if (id in j) return !!j[id];
  } catch (_) {}
  const a = APPS.find(x => x.id === id);
  return a ? !!a.defaultVisible : false;
}

export function setAppVisible(id, visible) {
  let j = {};
  try { j = JSON.parse(localStorage.getItem(APP_VIS_KEY) || '{}'); } catch (_) {}
  j[id] = !!visible;
  localStorage.setItem(APP_VIS_KEY, JSON.stringify(j));
}

export async function renderApps() {
  const app = document.getElementById('app');
  const visible = APPS.filter(a => isAppVisible(a.id));
  app.innerHTML = `
    <div class="card page-header">
      <p class="card-subtitle" style="margin:0">
        ラボ内・出張中で使える小道具集です。 並び順 / 表示する物は
        <a href="#/settings" style="color:var(--primary)">設定 → アプリ表示</a> から変えられます。
      </p>
    </div>
    <div class="list">
      ${visible.map(a => `
        <a class="list-item" href="${a.url}">
          <div class="grow">
            <div class="bold">${escapeHtml(a.title)} →</div>
            <div class="meta">${escapeHtml(a.desc)}</div>
          </div>
        </a>`).join('')}
      ${visible.length < APPS.length
        ? `<div class="hint" style="text-align:center; padding:8px">…他 ${APPS.length - visible.length} 個は <a href="#/settings" style="color:var(--primary)">設定 → アプリ表示</a> から ON にできます</div>`
        : ''}
    </div>
  `;
}
