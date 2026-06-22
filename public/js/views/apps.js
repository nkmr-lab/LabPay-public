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
  { id: 'trade',     label: '💴 売買',                    hint: 'ラボ内での売買。販売・購入・オークション。' },
  { id: 'urgent',    label: '🔴 締切・応答が要るもの',     hint: '期限つき / 行動を要求 / 即応 通知を出すジャンル。' },
  { id: 'inform',    label: '🟡 全員に届くお知らせ',       hint: '投稿や参加で全員に情報通知。締切はない / 緩い。' },
  { id: 'tool',      label: '🟢 その場で結論が出る道具',   hint: '結果は画面内で完結。通知は出さない。' },
  { id: 'game',      label: '🎮 ゲーム / 娯楽',           hint: 'ラボメンバーで遊ぶゲーム。娯楽タブからもアクセス可。' },
  { id: 'health',    label: '💪 健康 / 運動',             hint: '体・運動の記録。個人ツール中心。' },
  { id: 'ai',        label: '🤖 個人ツール (AI / 計算)',   hint: '自分用の会話 / 翻訳 / 計算。通知は出さない。' },
  { id: 'archive',   label: '📚 ラボの情報・蓄積',         hint: '受動的に参照する静的・蓄積系。通知は出さない。' },
];

export const APPS = [
  // 💴 売買 (v602)
  { id: 'sell',          cat: 'trade',    url: '#/sell',          title: '🏷 販売',            desc: 'ラボ内に商品を出品。 JAN コード対応、 在庫管理、 ピン留めセール可。', defaultVisible: true },
  { id: 'buy',           cat: 'trade',    url: '#/buy',           title: '🛒 購入',            desc: 'ラボ内の商品一覧から購入。 出品者・在庫・写真・口コミ付き。', defaultVisible: true },
  // 🔴 urgent — 締切・応答が要る (通知 出す)
  { id: 'rollcalls',     cat: 'lab-mgmt', url: '#/rollcalls',     title: '📣 点呼',            desc: '「いる?」「起きてる?」 をワンタップで集める。締切タイマー + 未応答者に催促 push 通知。', defaultVisible: true },
  // v634 ⚾ ドラフト (v637 娯楽 へ)
  { id: 'drafts',        cat: 'game', url: '#/drafts',        title: '⚾ ドラフト',         desc: 'プロ野球風 順番指名 + くじ抽選。 参加者と候補 (人 or 自由入力) を 揃えて 開始 → 1 位、 2 位 と 順番に 指名、 競合は くじ で 決着。', defaultVisible: true },
  // v635 📝 フリップ クイズ (v637 娯楽 へ)
  { id: 'quizzes',       cat: 'game', url: '#/quizzes',       title: '📝 フリップ クイズ', desc: '出題者が 問題 を 出す → 参加者は フリップ に 記述回答 → 一斉開示 (タップで 拡大) → 出題者が ⭕❌ 採点 → ランキング 集計。 連続出題 OK。', defaultVisible: true },
  { id: 'polls',         cat: 'lab-mgmt', url: '#/polls',         title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。個人の票は非公開、集計の可視タイミングは選べる。', defaultVisible: true },
  { id: 'requests',      cat: 'lab-mgmt', url: '#/requests',      title: '💴 請求 (集金)',     desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。', defaultVisible: true },
  { id: 'bait',          cat: 'lab-mgmt', url: '#/bait',          title: '💼 アルバイト 申請', desc: '実験 協力 などで 学生 に アルバイト を 依頼。 時間 (小数) + 対象者 を 指定 して 送ると、 受け取った 側 は 月別 で 全部 見えて 処理 済 マーク。 依頼者 は 進捗 確認 + 未処理者 催促 可。', defaultVisible: true },
  { id: 'widgets',       cat: 'misc', url: '#/widgets',       title: '🧩 ウィジェット センター', desc: '自作 ウィジェット を 登録 して ホーム に 表示。 JS で render(root) を 書く だけ。 サンプル も 用意 (時計 / 残高)。', defaultVisible: true },
  { id: 'cg2',           cat: 'game', url: '#/cg2',           title: '🎮 自作 ゲーム v2 (cg2)', desc: 'p5.js で 描画 する 准 リアルタイム multiplayer framework。 sharedValues 自動 同期 + host.start / host.stop の ライフサイクル + CPU 戦 対応。 サンプル: マルバツ / ニム / ライツアウト / すごろく。', defaultVisible: true },
  { id: 'chat-rooms',    cat: 'lab-mgmt', url: '#/chat-rooms', title: '💬 チャット (重要 / 連絡 / 相談 + DM)', desc: 'Slack 風 チャット。 3 つ の チャンネル + 1対1 DM。 2 秒 polling で 准 リアルタイム。 「重要」 への 投稿 は 全員 に 通知 が 飛ぶ。', defaultVisible: true },
  // v734 #344 新規追加機能の登録 (v718 / v733 で実装したが apps 一覧に入れ忘れていたもの)
  { id: 'screen-shares', cat: 'lab-mgmt', url: '#/screen-shares', title: '🖼 一時画像共有',  desc: 'ラボ全体 or 自分のグループ宛に画像 + ひとことを投げて 15 分〜24 時間の間ホームに大きく表示。「とにかく今これ見て」 用。', defaultVisible: true },
  { id: 'file-transfers', cat: 'lab-mgmt', url: '#/file-transfers', title: '📦 ファイル送受信', desc: '相手を指定してファイル (PDF / Word / Excel / 画像 / zip / txt 等 最大 50MB) を送れる。受信者のダウンロード回数と初回ダウンロード時刻を記録。', defaultVisible: true },
  // v740 #288 BingoFit
  { id: 'bingofit',      cat: 'lab-mgmt', url: '#/bingofit/closet', title: '👕 着回しビンゴ (BingoFit)', desc: '手持ちの服を 25 着以上登録すると、 日曜始まりの 5x5 ビンゴ盤が自動生成。 着た服を盤面から開けて、 ラインが揃えばビンゴ。 背景は自動で透過処理されます。', defaultVisible: true },
  { id: 'meetups',       cat: 'lab-mgmt', url: '#/meetups',       title: '🤝 待ち合わせ',      desc: '集合時刻 + 場所 + メンバーを一発で全員に通知。30分後 / 1時間後などのプリセット時刻あり。', defaultVisible: true },
  { id: 'deadlines',     cat: 'research', url: '#/meetups?kind=deadline', title: '📌 〆切',     desc: '〆切時刻 + 対象者を一発で全員に通知。365日先まで。待ち合わせと同じ仕組み (kind=deadline)。', defaultVisible: true },
  { id: 'timers',        cat: 'research', url: '#/timers',        title: '🛎 タイマー',        desc: '参加者全員で同じカウントダウンを共有。ポモドーロ / 会議の時間配分 / イベント開始までなど。', defaultVisible: true },
  { id: 'auctions',      cat: 'trade',  url: '#/auctions',      title: '🏷 オークション',    desc: '出品 + 入札。締切時刻に最高額入札者が落札。落札後は出品者が 「請求を飛ばす」 ボタンから請求機能で集金 (連絡先はラボ内既知前提なので表示しない)。', defaultVisible: true },
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
  // v748 #359 #360 #361 論文 和訳要約 (落合メソッド)
  { id: 'paper-summary', cat: 'research', url: '#/paper-summary', title: '📑 論文要約 (自動翻訳)', desc: '論文 PDF を読ませて、 全体要約 → RQ・仮説 + 結果 → 主張する貢献 → 章立て要約 (重要図表 inline) → 今後の課題 → 押さえておくべき参考文献 → 落合メソッドまとめ、 という順番 で 構造化して 3-5 分 (1500-2500 字) で 返します。 モデル選択 可 (gpt-4o-mini 5pt 〜 o1 120pt)、 デフォルト gpt-4o 20pt。 公開 ON で みんなが 検索 / 閲覧 可能', defaultVisible: true },
  // v583 #225 レジュメ原稿チェック (短原稿向け 軽量版、 5pt)
  { id: 'resume-check',  cat: 'research', url: '#/resume-check',   title: '📝 原稿チェック',    desc: 'レジュメ / 概要 / 申請書など1-2ページの短原稿をチェック (5pt)。背景妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用を一通り見ます。論文ほど厳密ではない軽量版。', defaultVisible: true },
  // v613 文字数・単語数リライター
  { id: 'rewriter',      cat: 'research', url: '#/rewriter',       title: '✂️ 文字数リライター', desc: 'アブストやリバッタルの文字数・単語数制限と戦うツール (1pt)。サーバ側で正確にカウントして超過時は再依頼 (最大3回)。英文は和訳も。元と書き直しを 色付きdiff で表示。', defaultVisible: true },
  // v586 フライト応援 (オフライン、 機内で使う)
  { id: 'flight',        cat: 'game',   url: '#/flight',         title: '✈️ フライト応援',    desc: '長いフライトの進捗 (%) / 残り時間 / 経過時間を大きく可視化。完全オフラインで動作。画面自動ON維持。機内で退屈しのぎに。', defaultVisible: true },
  // v553 #209 麻雀 (v574 から game カテゴリへ)
  { id: 'mahjong',       cat: 'game',   url: '#/mahjong',       title: '🀄 麻雀',           desc: '4 人で 50pt 賭けて 本格麻雀 (門前/鳴き/役判定/連荘/半荘) or 1〜4 位申告で 自動分配。 AI 対戦は プレイフィー 5pt の 練習モード。', defaultVisible: true },
  // v568 #223 ito (v574 から game カテゴリへ)
  { id: 'ito',           cat: 'game',   url: '#/ito',            title: '🎲 ito',           desc: '2 人以上で プレイフィー 1pt、 各自に 1-100 の数字 → お題に沿って表現を入力 → 全員の数字を開示する協力ゲーム。 数字を直接言わずに 「強い動物の強さ」 などで 大小を伝える。', defaultVisible: true },
  // v570 #223 人狼 (v574 から game カテゴリへ)
  { id: 'jinrou',        cat: 'game',   url: '#/jinrou',         title: '🐺 人狼',          desc: '4-16 人で プレイフィー 2pt → 役職配布 (村人 / 人狼 / 占い師 / 騎士) → 夜 (人狼襲撃 + 占い + 護衛) → 昼 (投票で追放) → 人狼全滅 or 人狼≥村人 で決着。', defaultVisible: true },
  { id: 'fortune',       cat: 'game',   url: '#/fortune',        title: '🔮 今日 の 占い',  desc: '1 日 1 回 だけ 引ける 運勢。 同じ 日 は 同じ 結果、 翌日 0:00 で 更新。 ホーム の 残高 エリア 🔮 アイコン から も 引ける。', defaultVisible: true },
  { id: 'conf-deadlines',cat: 'research',url: '#/conf-deadlines', title: '📅 学会 〆切',    desc: '国際 会議 / 国内 研究会 / 論文誌 の 投稿 〆切 を 登録 + 一覧。 誰でも 登録 可、 全員 閲覧 可。 〆切順 表示 + あと N 日 のカウントダウン。', defaultVisible: true },
  // v576 優勝予想 (W 杯 / スポーツ大会 / 学会 best paper など)
  { id: 'predictions',   cat: 'game',   url: '#/predictions',    title: '🏆 優勝予想',       desc: 'ワールドカップや スポーツ大会、 大学受験・学会 best paper など 「順位」 を予想して 参加フィー で景品を 山分け。 1位のみ / 1-2位 / 1-4位 を 起案ごとに設定可能。', defaultVisible: true },
  // v609 #235 勝敗予測 (試合のスコアを当てる)
  { id: 'score-predictions', cat: 'game', url: '#/score-predictions', title: '🎯 勝敗予測', desc: '試合のスコア (X-Y) を予想して完璧に当てた人が pot 総取り (山分け、 場代5%)。誰も当たらなければ全員返金。基本20pt、 10-100pt 設定可。', defaultVisible: true },
  // v587 地雷オセロ
  { id: 'othello',       cat: 'game',   url: '#/othello',        title: '💣 地雷オセロ',     desc: '通常オセロ + 各自 1 か所地雷。地雷を踏むと周囲 3x3 (9 マス) 反転。プレイフィー 2pt。', defaultVisible: true },
  // v617 #236 マルバツ (自作ゲーム フレームワーク サンプル)
  { id: 'tictactoe',     cat: 'game',   url: '#/tictactoe',      title: '⭕❌ マルバツ',      desc: '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。 プレイフィー 1pt。 自作ゲームの サンプル実装 (docs/CUSTOM_GAMES.md 参照)。', defaultVisible: true },
  // v588 ビンゴ (週次)
  { id: 'bingo',         cat: 'game',   url: '#/bingo',          title: '🎰 ビンゴ',          desc: '毎週 5x5 ビンゴカードが 自動生成。 平日の 行動 (ラボイン/らぼったー投稿/麻雀/オセロ/食べある記 など) が 自動カウント。 達成早 + ライン数 で 週次 リーダーボード。', defaultVisible: true },
  // v590 大富豪 (シンプル MVP)
  { id: 'daifugo',       cat: 'game',   url: '#/daifugo',        title: '🃏 大富豪',         desc: '2-4 人。単出し / ペア / N枚出しで同枚数 + 強い数字を出す。ジョーカーワイルド + 革命 + 8切り。プレイフィー 2pt。', defaultVisible: true },
  { id: 'playlists',     cat: 'game',   url: '#/playlists',    title: '🎵 プレイリスト',    desc: 'YouTube/Spotify URLをまとめて紹介。⭐1-5評価 + コメント + ❤️お気に入り + ジャンル + シャッフル再生。', defaultVisible: true },
  { id: 'places',        cat: 'game',   url: '#/places',       title: '🍴 食べある記',      desc: 'お店情報 (住所 / 緯度経度 / 紹介文) をラボメンバーで共有。口コミ・写真・⭐評価 + 地図ビュー + tabelog URLから自動取得。', defaultVisible: true },
  { id: 'sns',           cat: 'game',   url: '#/sns',           title: '💬 らぼったー',       desc: 'シンプルなつぶやき (テキスト + 画像 + 位置 + @メンション + 返信 + 👍 ❤ ⭐ リアクション)。フォローなし — 全員の投稿が見える。', defaultVisible: true },
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
    'paper-review', 'resume-check', 'rewriter',
    'timers', 'stopwatches',
    'orderings', 'random-groups', 'groups', 'deadlines', 'notices',
  ],
};

export async function renderApps(ctx = {}) {
  const app = document.getElementById('app');
  const filterCat = ctx?.cat || null;
  const visible = APPS.filter(a => isAppVisible(a.id));
  const hiddenCount = APPS.length - visible.length;

  // カテゴリ毎 に セクション化。 空セクション は 出さない。
  //   filterCat が 指定されていたら そのカテゴリだけ 描画。
  const filteredCats = filterCat
    ? APP_CATEGORIES.filter(c => c.id === filterCat)
    : APP_CATEGORIES;
  const sectionsHtml = filteredCats.map(c => {
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
