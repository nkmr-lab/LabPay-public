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
  { id: 'urgent',  label: '🔴 締切・応答が要るもの',     hint: '期限つき / 行動を要求 / 即応 通知 を 出す ジャンル。' },
  { id: 'inform',  label: '🟡 全員に届くお知らせ',       hint: '投稿 や 参加で 全員に 情報通知。 締切は ない / 緩い。' },
  { id: 'tool',    label: '🟢 その場で結論が出る道具',   hint: '結果は 画面内で 完結。 通知は 出さない。' },
  { id: 'game',    label: '🎮 ゲーム / 娯楽',           hint: 'ラボメンバーで遊ぶ ゲーム。 娯楽タブからも アクセス可。' },
  { id: 'health',  label: '💪 健康 / 運動',             hint: '体・運動の記録。 個人ツール 中心。' },
  { id: 'ai',      label: '🤖 個人ツール (AI / 計算)',   hint: '自分用 の 会話 / 翻訳 / 計算。 通知は 出さない。' },
  { id: 'archive', label: '📚 ラボの情報・蓄積',         hint: '受動的に 参照する 静的・蓄積系。 通知は 出さない。' },
];

export const APPS = [
  // 🔴 urgent — 締切・応答が要る (通知 出す)
  { id: 'rollcalls',     cat: 'urgent', url: '#/rollcalls',     title: '📣 点呼',            desc: '「いる？」 「起きてる？」 をワンタップで集める。 締切タイマー + 未応答者に催促 push 通知。', defaultVisible: true },
  { id: 'polls',         cat: 'urgent', url: '#/polls',         title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。 個人の票は非公開、 集計の可視タイミングは選べる。', defaultVisible: true },
  { id: 'requests',      cat: 'urgent', url: '#/requests',      title: '💴 請求 (集金)',     desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。', defaultVisible: true },
  { id: 'meetups',       cat: 'urgent', url: '#/meetups',       title: '🤝 待ち合わせ',      desc: '集合時刻 + 場所 + メンバー を 一発で全員に通知。 30 分後 / 1 時間後 などのプリセット時刻あり。', defaultVisible: true },
  { id: 'deadlines',     cat: 'urgent', url: '#/meetups?kind=deadline', title: '📌 〆切',     desc: '〆切時刻 + 対象者 を 一発で全員に通知。 365 日先 まで。 待ち合わせ と 同じ 仕組み (kind=deadline)。', defaultVisible: true },
  { id: 'timers',        cat: 'urgent', url: '#/timers',        title: '🛎 タイマー',        desc: '参加者全員で 同じカウントダウンを共有。 ポモドーロ / 会議の時間配分 / イベント開始まで など。', defaultVisible: true },
  { id: 'auctions',      cat: 'urgent', url: '#/auctions',      title: '🏷 オークション',    desc: '出品 + 入札。 締切時刻に 最高額入札者が落札。 落札後は 出品者が 「請求を飛ばす」 ボタンから 請求機能で 集金 (連絡先は ラボ内 既知 前提なので 表示しない)。', defaultVisible: true },
  { id: 'nomikai',       cat: 'urgent', url: '#/nomikai',       title: '🍶 飲み会割り勘',    desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。', defaultVisible: true },

  // 🟡 inform — 全員に届くお知らせ
  { id: 'notices',       cat: 'inform', url: '#/notices',       title: '📢 重要連絡 / 学会情報', desc: 'タイトル + 本文 + URL でピン留め可能。 カテゴリで切替。 全メンバーが投稿可、 投稿者 + admin が編集 / 削除。', defaultVisible: true },
  { id: 'groups',        cat: 'inform', url: '#/groups',        title: '👥 イベント・出張用グループ作成', desc: '学会・出張・イベントなど一時的な括り。ワリカや一斉連絡に使う。自分の入ってるグループはホームから直接アクセス。', defaultVisible: true },

  // 🟢 tool — その場で結論が出る道具 (通知なし)
  { id: 'roulette',      cat: 'tool',   url: '#/roulette',      title: '🎰 ルーレット',       desc: 'メンバーから 1 人をくじ引きで選ぶ。賞金つき可。', defaultVisible: true },
  { id: 'text-roulette', cat: 'tool',   url: '#/text-roulette', title: '🍜 どこ行くルーレット', desc: '昼飯どこ行く / 何食べる など、 任意のテキスト候補から 1 つを選ぶシンプル版。', defaultVisible: true },
  { id: 'random-groups', cat: 'tool',   url: '#/random-groups', title: '🎲 ランダムグループ生成', desc: '選んだメンバーを N チームにランダム分け。学年/男女を「できるだけ均等」にする配慮も可能。', defaultVisible: true },
  // v523 #160 順番決め (発表順 / 当番 など)。 メンバーを 1 列に並び替えて 結果を全員に通知。
  { id: 'orderings',     cat: 'tool',   url: '#/orderings',     title: '📋 順番決め',         desc: 'メンバーを 1 列に並び替え (発表順 / 当番割 など)。 結果は 各メンバーに通知される。 1 人ずつめくる演出 付き。', defaultVisible: true },
  // v529 #165 ストップウォッチを 締切系 (urgent) カテゴリに移動 (発表時間など 「時間で動く」 性質)
  { id: 'stopwatches',   cat: 'urgent', url: '#/stopwatches',   title: '⏱ ストップウォッチ', desc: 'メンバー共有の カウントアップ計測器。 開始 / 一時停止 / リセット 全員操作可。 発表時間 や 雑談計測 用。', defaultVisible: true },

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
  { id: 'regions',       cat: 'archive', url: '#/regions',       title: '🗺 制覇マップ',     desc: '行った国・都道府県 を タップで 登録。 進捗バー (47/47 都道府県 や 100/X 国) + ラボ メンバーの集計 (何人訪問してるか) も表示。', defaultVisible: true },
  // v532 #161 体重 / BMI 記録 (個人ツール、 通知なし)
  { id: 'health',        cat: 'health', url: '#/health',         title: '⚖️ 体重 / BMI',    desc: '体重・身長・体脂肪 を 1 タップで記録。 BMI 自動計算 + やせ/標準/肥満 分類 + 折れ線グラフ。 完全に個人ツール (他のメンバーには見えません)。', defaultVisible: true },
  // v533 #162 筋トレ記録 + 仲間 (mutual follow)
  { id: 'workouts',      cat: 'health',  url: '#/workouts',      title: '💪 筋トレ',         desc: '腕立て / 腹筋 / 背筋 / スクワット / プランク / 懸垂 / ベンチプレス などをプリセットから 1 タップ記録。 仲間 (お互いに追加) と 様子を共有 / 比べ合い。', defaultVisible: true },
  // v538 #169 散歩に行きたくなるアプリ
  { id: 'walk',          cat: 'health', url: '#/walk',           title: '🚶 散歩',           desc: '現在地周辺の 食べある記 から 散歩先を ランダムにおすすめ。 距離 + 徒歩何分 + 方位矢印 + Google Maps 経路。 未訪を優先 + 半径切替 (500m〜5km)。', defaultVisible: true },
  // v540 #171 絵しりとり (v574 から game カテゴリへ)
  { id: 'shiritori',     cat: 'game',   url: '#/shiritori',      title: '🎨 絵しりとり',     desc: 'メンバーで順番に絵を描く 絵しりとり。 タイムリミット付きキャンバス + ストローク記録。 自分が何を描いたか + 前の人を何と予想したかを登録。 周回数 + ギブアップ。 AI 予想 + 最終当ては Phase 2 で。', defaultVisible: true },
  // v549 #210 ティア表
  { id: 'tierlists',     cat: 'tool',   url: '#/tierlists',      title: '🎯 ティア表',       desc: 'お題 + 候補リスト で みんなで S/A/B/C/D/F 6 段階の ティア分け。 自分の回答を保存すると 他人の回答 + 全員集計 が見れる。', defaultVisible: true },
  // v550 #206 論文査読
  { id: 'paper-review',  cat: 'ai',     url: '#/paper-review',   title: '📄 論文 査読',      desc: '論文本文を貼ると 章立て和訳要約 + 査読コメント (Accept/Reject + 強み/弱み/著者へのコメント) を返します。 ターゲット会議と査読の厳しさを指定可。', defaultVisible: true },
  // v583 #225 レジュメ原稿チェック (短原稿向け 軽量版、 5pt)
  { id: 'resume-check',  cat: 'ai',     url: '#/resume-check',   title: '📝 原稿チェック',    desc: 'レジュメ / 概要 / 申請書 など 1-2 ページの 短原稿 を チェック (5pt)。 背景妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用 を 一通り 見ます。 論文ほど厳密ではない 軽量版。', defaultVisible: true },
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
  { id: 'playlists',     cat: 'archive', url: '#/playlists',    title: '🎵 プレイリスト',    desc: 'YouTube / Spotify URL を まとめて 紹介。 ⭐ 1-5 評価 + コメント + ❤️ お気に入り + ジャンル + シャッフル 再生。', defaultVisible: true },
  { id: 'places',        cat: 'archive', url: '#/places',       title: '🍴 食べある記',      desc: 'お店 情報 (住所 / 緯度経度 / 紹介文) を ラボメンバー で 共有。 口コミ・写真・⭐評価 + 地図ビュー + tabelog URL から 自動取得。', defaultVisible: true },
  { id: 'sns',           cat: 'inform',  url: '#/sns',          title: '💬 らぼったー',       desc: 'シンプル な つぶやき (テキスト + 画像 + 位置 + @メンション + 返信 + 👍 ❤ ⭐ リアクション)。 フォロー なし — 全員 の 投稿 が 見える。', defaultVisible: true },
];

const APP_VIS_KEY = 'labpay-apps-visibility';

// v497 #103 アプリ表示の個別設定は撤去 (全部 表示する方針)。 isAppVisible は
//   後方互換のため残し、 常に true を返す。 setAppVisible はno-op。
export function isAppVisible(_id) { return true; }
export function setAppVisible(_id, _visible) {}

export async function renderApps() {
  const app = document.getElementById('app');
  const visible = APPS.filter(a => isAppVisible(a.id));
  const hiddenCount = APPS.length - visible.length;

  // カテゴリ毎 に セクション化。 空セクション は 出さない。
  const sectionsHtml = APP_CATEGORIES.map(c => {
    const items = visible.filter(a => a.cat === c.id);
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
