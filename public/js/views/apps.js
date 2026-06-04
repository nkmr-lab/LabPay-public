// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).

import { escapeHtml } from '../router.js';

const APPS = [
  { url: '#/groups',        title: 'イベント・出張用グループ作成', desc: '学会・出張・イベントなど一時的な括り。ワリカや一斉連絡に使う。自分の入ってるグループはホームから直接アクセス。' },
  { url: '#/random-groups', title: 'ランダムグループ生成', desc: '選んだメンバーを N チームにランダム分け。学年/男女を「できるだけ均等」にする配慮も可能。' },
  { url: '#/roulette',      title: 'ルーレット',         desc: 'メンバーから 1 人をくじ引きで選ぶ。賞金つき可。' },
  { url: '#/text-roulette', title: 'どこ行くルーレット', desc: '昼飯どこ行く / 何食べる など、 任意のテキスト候補から 1 つを選ぶシンプル版。' },
  { url: '#/polls',         title: '投票・アンケート',   desc: '対象者・締切・選択肢を指定して投票を集める。 個人の票は非公開、 集計の可視タイミングは選べる。' },
  { url: '#/rollcalls',     title: '点呼',               desc: '「いる？」 「起きてる？」 をワンタップで集める。 締切タイマー + 未応答者に催促 push 通知。' },
  { url: '#/timers',        title: 'タイマー',           desc: '参加者全員で 同じカウントダウンを共有。 ポモドーロ / 会議の時間配分 / イベント開始まで など。' },
  { url: '#/notices',       title: '重要連絡 / 学会情報', desc: 'タイトル + 本文 + URL でピン留め可能。 カテゴリで切替。 全メンバーが投稿可、 投稿者 + admin が編集 / 削除。' },
  { url: '#/contacts',      title: '連絡先',             desc: 'ラボメンバーの緊急連絡用電話番号。 タップで通話。 自分の番号は設定から登録。' },
  { url: '#/nomikai',       title: '飲み会割り勘',       desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。' },
  { url: '#/requests',      title: '請求 (集金)',        desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。' },
  { url: '#/scrapbox',      title: 'Scrapbox 履歴',      desc: '#scrapbox の研究ノート編集を読みやすくまとめて表示。' },
  { url: '#/network',       title: '関係性グラフ',       desc: '売買・タスク・送金・Wishlist などのつながりをグラフで可視化。' },
];

export async function renderApps() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <p class="card-subtitle" style="margin:0">
        ラボ内・出張中で使える小道具集です。
      </p>
    </div>
    <div class="list">
      ${APPS.map(a => `
        <a class="list-item" href="${a.url}">
          <div class="grow">
            <div class="bold">${escapeHtml(a.title)} →</div>
            <div class="meta">${escapeHtml(a.desc)}</div>
          </div>
        </a>`).join('')}
    </div>
  `;
}
