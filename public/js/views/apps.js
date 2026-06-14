// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).
//
// v384: 各ユーザが 「メニューに出すアプリ」 を選べるように。 デフォルト表示は
// id を defaultVisible=true で 指定。 設定 → 「アプリ表示」 で個別 ON/OFF。
//
// v444: 通知 軸 で 5 カテゴリ に 分割 (cat フィールド)。 一覧画面 / 設定 とも
// セクション 見出し付き で 並べる。 並び順 = 締切系 → お知らせ系 → 道具 →
// AI → 受動。 「届く タイプ」 と 「黙って 使う タイプ」 が 一目で 分かる ように。

import { escapeHtml } from '../router.js';

// 通知 軸 カテゴリ。 並び順 = 表示順。
export const APP_CATEGORIES = [
  { id: 'research',  label: '🔬 研究用',                  hint: '査読・原稿チェック・締切・タイマー・順番決め・学会情報・グループなど、研究活動で日常的に使うもの。' },
  { id: 'lab-mgmt',  label: '🏢 研究室運営サポート',      hint: '投票・点呼・待ち合わせ・割り勘・集金・くじ引きなど、ラボの運営や合意形成で使うもの。' },
  { id: 'urgent',    label: '🔴 締切・応答が要るもの',     hint: '期限つき / 行動を要求 / 即応 通知を出すジャンル。' },
  { id: 'inform',    label: '🟡 全員に届くお知らせ',       hint: '投稿や参加で全員に情報通知。締切はない / 緩い。' },
  { id: 'tool',      label: '🟢 その場で結論が出る道具',   hint: '結果は画面内で完結。通知は出さない。' },
  { id: 'game',      label: '🎮 ゲーム / 娯楽',           hint: 'ラボメンバーで遊ぶゲーム。娯楽タブからもアクセス可。' },
  { id: 'health',    label: '💪 健康 / 運動',             hint: '体・運動の記録。個人ツール中心。' },
  { id: 'ai',        label: '🤖 個人ツール (AI / 計算)',   hint: '自分用の会話 / 翻訳 / 計算。通知は出さない。' },
  { id: 'archive',   label: '📚 ラボの情報・蓄積',         hint: '受動的に参照する静的・蓄積系。通知は出さない。' },
];

export const APPS = [
  // 🔴 urgent — 締切・応答が要る (通知 出す)
  { id: 'rollcalls',     cat: 'lab-mgmt', url: '#/rollcalls',     title: '📣 点呼',            desc: '「いる?」「起きてる?」 をワンタップで集める。締切タイマー + 未応答者に催促 push 通知。', defaultVisible: true },
  { id: 'polls',         cat: 'lab-mgmt', url: '#/polls',         title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。個人の票は非公開、集計の可視タイミングは選べる。', defaultVisible: true },
  { id: 'requests',      cat: 'lab-mgmt', url: '#/requests',      title: '💴 請求 (集金)',     desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。', defaultVisible: true },
  { id: 'meetups',       cat: 'lab-mgmt', url: '#/meetups',       title: '🤝 待ち合わせ',      desc: '集合時刻 + 場所 + メンバーを一発で全員に通知。30分後 / 1時間後などのプリセット時刻あり。', defaultVisible: true },
  { id: 'deadlines',     cat: 'research', url: '#/meetups?kind=deadline', title: '📌 〆切',     desc: '〆切時刻 + 対象者を一発で全員に通知。365日先まで。待ち合わせと同じ仕組み (kind=deadline)。', defaultVisible: true },
  { id: 'timers',        cat: 'research', url: '#/timers',        title: '🛎 タイマー',        desc: '参加者全員で同じカウントダウンを共有。ポモドーロ / 会議の時間配分 / イベント開始までなど。', defaultVisible: true },
  { id: 'auctions',      cat: 'urgent', url: '#/auctions',      title: '🏷 オークション',    desc: '出品 + 入札。 締切時刻に 最高額入札者が落札。 落札後は 出品者が 「請求を飛ばす」 ボタンから 請求機能で 集金 (連絡先は ラボ内 既知 前提なので 表示しない)。', defaultVisible: true },
  { id: 'nomikai',       cat: 'lab-mgmt', url: '#/nomikai',       title: '🍶 飲み会割り勘',    desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。', defaultVisible: true },

  // 🟡 inform — 全員に届くお知らせ
  { id: 'notices',       cat: 'research', url: '#/notices',       title: '📢 重要連絡 / 学会情報', desc: 'タイトル + 本文 + URL でピン留め可能。カテゴリで切替。全メンバーが投稿可、投稿者 + admin が編集/削除。', defaultVisible: true },
  { id: 'groups',        cat: 'research', url: '#/groups',        title: '👥 イベント・出張用グループ作成', desc: '学会・出張・イベントなど一時的な括り。ワリカや一斉連絡に使う。自分の入ってるグループはホームから直接アクセス。', defaultVisible: true },

  // 🟢 tool — その場で結論が出る道具 (通知なし)
  { id: 'roulette',      cat: 'lab-mgmt', url: '#/roulette',      title: '🎰 ルーレット',       desc: 'メンバーから1人をくじ引きで選ぶ。賞金つき可。', defaultVisible: true },
  { id: 'text-roulette', cat: 'lab-mgmt', url: '#/text-roulette', title: '🍜 どこ行くルーレット', desc: '昼飯どこ行く / 何食べるなど、任意のテキスト候補から1つを選ぶシンプル版。', defaultVisible: true },
  { id: 'random-groups', cat: 'research', url: '#/random-groups', title: '🎲 ランダムグループ生成', desc: '選んだメンバーをNチームにランダム分け。学年/男女を 「できるだけ均等」 にする配慮も可能。', defaultVisible: true },
  // v523 #160 順番決め (発表順 / 当番 など)。 メンバーを 1 列に並び替えて 結果を全員に通知。
  { id: 'orderings',     cat: 'research', url: '#/orderings',     title: '📋 順番決め',         desc: 'メンバーを1列に並び替え (発表順 / 当番割など)。結果は各メンバーに通知される。1人ずつめくる演出付き。', defaultVisible: true },
  // v529 #165 ストップウォッチを 締切系 (urgent) カテゴリに移動 (発表時間など 「時間で動く」 性質)
  { id: 'stopwatches',   cat: 'research', url: '#/stopwatches',   title: '⏱ ストップウォッチ', desc: 'メンバー共有のカウントアップ計測器。開始 / 一時停止 / リセット全員操作可。発表時間や雑談計測用。', defaultVisible: true },

  { id: 'todos',         cat: 'ai',     url: '#/todos',         title: '📝 自分の TODO',     desc: 'やる こと メモ。 サーバ 保存 で 端末間 共有。 完了 と 未完了 を 分けて 表示。', defaultVisible: true },

  // 🤖 ai — 個人ツール (AI / 計算、 通知なし)
  { id: 'chat',          cat: 'ai',     url: '#/chat',          title: '💬 AI 対話 / 翻訳',  desc: '汎用 多言語 チャット (中国語・イタリア語・英語など)。 海外出張での 翻訳・会話 補助に。 クイック ボタンで 「〇〇 に 翻訳」 を 即発射。', defaultVisible: true },
  { id: 'help',          cat: 'ai',     url: '#/help',          title: '🤖 操作ガイド AI',   desc: 'LabPay の 使い方 を AI に 聞ける チャット。 「○○ ってどこから?」 「△△ したいんだけど」 に 操作手順 で 答えます。', defaultVisible: true },
  { id: 'translate',     cat: 'ai',     url: '#/translate',     title: '🌐 画像 和訳',       desc: '写真 (メニュー / 看板 / 説明文 など) を アップロード → AI で 日本語に 翻訳。 出張 / 旅行 で 便利。', defaultVisible: true },

  // 📚 archive — ラボの情報・蓄積 (受動、 通知なし)
  { id: 'contacts',      cat: 'archive', url: '#/contacts',     title: '📞 連絡先',          desc: 'ラボメンバーの緊急連絡用電話番号。 タップで通話。 自分の番号は設定から登録。', defaultVisible: true },
  { id: 'scrapbox',      cat: 'archive', url: '#/scrapbox',     title: '📚 Scrapbox 履歴',   desc: '#scrapbox の研究ノート編集を読みやすくまとめて表示。', defaultVisible: true },
  { id: 'network',       cat: 'archive', url: '#/network',      title: '🕸 関係性グラフ',    desc: '売買・タスク・送金・Wishlist などのつながりをグラフで可視化。', defaultVisible: true },
  { id: 'exercise',      cat: 'health',  url: '#/exercise',     title: '🏃 運動 (歩数)',     desc: 'ポケットに入れて 「開始」 → 歩く / 階段。 端末センサーで歩数カウント、 ラボ内 ランキング表示。', defaultVisible: true },
  // v531 #163 行った国 / 都道府県 制覇マップ
  { id: 'regions',       cat: 'game',   url: '#/regions',       title: '🗺 制覇マップ',     desc: '行った国・都道府県をタップで登録。進捗バー (47/47都道府県や100/X国) + ラボメンバーの集計 (何人訪問してるか) も表示。', defaultVisible: true },
  // v532 #161 体重 / BMI 記録 (個人ツール、 通知なし)
  { id: 'health',        cat: 'health', url: '#/health',         title: '⚖️ 体重 / BMI',    desc: '体重・身長・体脂肪 を 1 タップで記録。 BMI 自動計算 + やせ/標準/肥満 分類 + 折れ線グラフ。 完全に個人ツール (他のメンバーには見えません)。', defaultVisible: true },
  // v533 #162 筋トレ記録 + 仲間 (mutual follow)
  { id: 'workouts',      cat: 'health',  url: '#/workouts',      title: '💪 筋トレ',         desc: '腕立て / 腹筋 / 背筋 / スクワット / プランク / 懸垂 / ベンチプレス などをプリセットから 1 タップ記録。 仲間 (お互いに追加) と 様子を共有 / 比べ合い。', defaultVisible: true },
  // v538 #169 散歩に行きたくなるアプリ
  { id: 'walk',          cat: 'health', url: '#/walk',           title: '🚶 散歩',           desc: '現在地周辺の 食べある記 から 散歩先を ランダムにおすすめ。 距離 + 徒歩何分 + 方位矢印 + Google Maps 経路。 未訪を優先 + 半径切替 (500m〜5km)。', defaultVisible: true },
  // v540 #171 絵しりとり (v574 から game カテゴリへ)
  { id: 'shiritori',     cat: 'game',   url: '#/shiritori',      title: '🎨 絵しりとり',     desc: 'メンバーで順番に絵を描く 絵しりとり。 タイムリミット付きキャンバス + ストローク記録。 自分が何を描いたか + 前の人を何と予想したかを登録。 周回数 + ギブアップ。 AI 予想 + 最終当ては Phase 2 で。', defaultVisible: true },
  // v549 #210 ティア表
  { id: 'tierlists',     cat: 'game',   url: '#/tierlists',      title: '🎯 ティア表',       desc: 'お題 + 候補リスト で みんなで S/A/B/C/D 5段階のティア分け。自分の回答を保存すると他人の回答 + 全員集計が見れる。', defaultVisible: true },
  // v550 #206 論文査読
  { id: 'paper-review',  cat: 'research', url: '#/paper-review',   title: '📄 論文 査読',      desc: '論文本文を貼ると章立て和訳要約 + 査読コメント (Accept/Reject + 強み/弱み/著者へのコメント) を返します。ターゲット会議と査読の厳しさを指定可。', defaultVisible: true },
  // v583 #225 レジュメ原稿チェック (短原稿向け 軽量版、 5pt)
  { id: 'resume-check',  cat: 'research', url: '#/resume-check',   title: '📝 原稿チェック',    desc: 'レジュメ / 概要 / 申請書など1-2ページの短原稿をチェック (5pt)。背景妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用を一通り見ます。論文ほど厳密ではない軽量版。', defaultVisible: true },
  // v586 フライト応援 (オフライン、 機内で使う)
  { id: 'flight',        cat: 'tool',   url: '#/flight',         title: '✈️ フライト応援',    desc: '長いフライトの 進捗 (%) / 残り時間 / 経過時間 を 大きく可視化。 完全オフラインで動作。 画面 自動ON 維持。 機内で 退屈 しのぎ に。', defaultVisible: true },
  // v553 #209 麻雀 (v574 から game カテゴリへ)
  { id: 'mahjong',       cat: 'game',   url: '#/mahjong',       title: '🀄 麻雀',           desc: '4 人で 50pt 賭けて 本格麻雀 (門前/鳴き/役判定/連荘/半荘) or 1〜4 位申告で 自動分配。 AI 対戦は ポイント授受なし の 練習モード。', defaultVisible: true },
  // v568 #223 ito (v574 から game カテゴリへ)
  { id: 'ito',           cat: 'game',   url: '#/ito',            title: '🎲 ito',           desc: '2 人以上で プレイフィー 1pt、 各自に 1-100 の数字 → お題に沿って表現を入力 → 全員の数字を開示する協力ゲーム。 数字を直接言わずに 「強い動物の強さ」 などで 大小を伝える。', defaultVisible: true },
  // v570 #223 人狼 (v574 から game カテゴリへ)
  { id: 'jinrou',        cat: 'game',   url: '#/jinrou',         title: '🐺 人狼',          desc: '4-16 人で プレイフィー 1pt → 役職配布 (村人 / 人狼 / 占い師 / 騎士) → 夜 (人狼襲撃 + 占い + 護衛) → 昼 (投票で追放) → 人狼全滅 or 人狼≥村人 で決着。', defaultVisible: true },
  // v576 優勝予想 (W 杯 / スポーツ大会 / 学会 best paper など)
  { id: 'predictions',   cat: 'game',   url: '#/predictions',    title: '🏆 優勝予想',       desc: 'ワールドカップや スポーツ大会、 大学受験・学会 best paper など 「順位」 を予想して 参加フィー で景品を 山分け。 1位のみ / 1-2位 / 1-4位 を 起案ごとに設定可能。', defaultVisible: true },
  // v587 地雷オセロ
  { id: 'othello',       cat: 'game',   url: '#/othello',        title: '💣 地雷オセロ',     desc: '通常オセロ + 各自 2 か所 地雷。 地雷を踏むと 周囲 3x3 (9 マス) 反転。 1pt で 対戦、 勝者が pot 総取り (引分は半分ずつ)。', defaultVisible: true },
  // v588 ビンゴ (週次)
  { id: 'bingo',         cat: 'game',   url: '#/bingo',          title: '🎰 ビンゴ',          desc: '毎週 5x5 ビンゴカードが 自動生成。 平日の 行動 (ラボイン/らぼったー投稿/麻雀/オセロ/食べある記 など) が 自動カウント。 達成早 + ライン数 で 週次 リーダーボード。', defaultVisible: true },
  // v590 大富豪 (シンプル MVP)
  { id: 'daifugo',       cat: 'game',   url: '#/daifugo',        title: '🃏 大富豪',         desc: '2-4 人。 単出し / ペア / N 枚 出し で 同枚数 + 強い数字 を 出す。 ジョーカー ワイルド。 1pt buy-in、 1 位が pot 総取り。 革命 / 縛り は省略 (MVP)。', defaultVisible: true },
  { id: 'playlists',     cat: 'game',   url: '#/playlists',    title: '🎵 プレイリスト',    desc: 'YouTube/Spotify URLをまとめて紹介。⭐1-5評価 + コメント + ❤️お気に入り + ジャンル + シャッフル再生。', defaultVisible: true },
  { id: 'places',        cat: 'archive', url: '#/places',       title: '🍴 食べある記',      desc: 'お店 情報 (住所 / 緯度経度 / 紹介文) を ラボメンバー で 共有。 口コミ・写真・⭐評価 + 地図ビュー + tabelog URL から 自動取得。', defaultVisible: true },
  { id: 'sns',           cat: 'inform',  url: '#/sns',          title: '💬 らぼったー',       desc: 'シンプル な つぶやき (テキスト + 画像 + 位置 + @メンション + 返信 + 👍 ❤ ⭐ リアクション)。 フォロー なし — 全員 の 投稿 が 見える。', defaultVisible: true },
];

const APP_VIS_KEY = 'labpay-apps-visibility';

// v497 #103 アプリ表示の個別設定は撤去 (全部 表示する方針)。 isAppVisible は
//   後方互換のため残し、 常に true を返す。 setAppVisible はno-op。
export function isAppVisible(_id) { return true; }
export function setAppVisible(_id, _visible) {}

// v602 カテゴリ内の 表示順を 明示指定するマップ。 値は [id, id, ...] の順序。
//   ここに 含まれない id は ソース宣言順 で末尾に。
const CATEGORY_ORDER = {
  research: [
    'paper-review', 'resume-check', 'timers', 'stopwatches',
    'orderings', 'random-groups', 'groups', 'deadlines', 'notices',
  ],
};

export async function renderApps() {
  const app = document.getElementById('app');
  const visible = APPS.filter(a => isAppVisible(a.id));
  const hiddenCount = APPS.length - visible.length;

  // カテゴリ毎 に セクション化。 空セクション は 出さない。
  const sectionsHtml = APP_CATEGORIES.map(c => {
    let items = visible.filter(a => a.cat === c.id);
    // 指定があれば 並び替え
    const order = CATEGORY_ORDER[c.id];
    if (order) {
      const idx = (id) => {
        const i = order.indexOf(id);
        return i === -1 ? 1000 + items.findIndex(x => x.id === id) : i;
      };
      items = items.slice().sort((a, b) => idx(a.id) - idx(b.id));
    }
    if (!items.length) return '';
    return `
      <div class="card" style="margin-top:10px">
        <h3 style="margin:0 0 4px">${escapeHtml(c.label)}</h3>
        <p class="hint" style="margin:0 0 8px">${escapeHtml(c.hint)}</p>
        <div class="list">
          ${items.map(a => `
            <a class="list-item" href="${a.url}">
              <div class="grow">
                <div class="bold">${escapeHtml(a.title)} →</div>
                <div class="meta">${escapeHtml(a.desc)}</div>
              </div>
            </a>`).join('')}
        </div>
      </div>`;
  }).join('');

  app.innerHTML = `
    ${sectionsHtml}
    ${hiddenCount > 0
      ? `<div class="hint" style="text-align:center; padding:10px">…他 ${hiddenCount} 個は <a href="#/settings" style="color:var(--primary)">設定 → アプリ表示</a> から ON にできます</div>`
      : ''}
  `;
}
