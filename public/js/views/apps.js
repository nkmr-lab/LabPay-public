// /#/apps — hub for the mini-tools (ルーレット / ワリカ / 飲み会割り勘 / 他).
//
// v384: 各ユーザが「メニューに出すアプリ」を選べるように。デフォルト表示は
// id を defaultVisible=true で指定。設定 → 「アプリ表示」で個別 ON/OFF。
//
// v444: 通知軸で 5 カテゴリに分割 (cat フィールド)。一覧画面 / 設定とも
// セクション見出し付きで並べる。並び順 = 締切系 → お知らせ系 → 道具 →
// AI → 受動。「届くタイプ」と「黙って使うタイプ」が一目で分かるように。

import { escapeHtml } from '../router.js';

// 通知軸カテゴリ。並び順 = 表示順。
export const APP_CATEGORIES = [
  { id: 'research',  label: '🔬 研究用',                  hint: '論文要約 / 全訳 / 査読 / 原稿チェック / リライター / Deep Researchなど、AIを使って研究を直接進めるもの。' },
  { id: 'lab-mgmt',  label: '🏢 研究室運営サポート',      hint: 'ゼミ / 研究会 / 学会サポート (タイマー・順番決め・グループ・ルーレット) + 研究室運営 (投票・請求・待ち合わせなど)。' },
  { id: 'shared',    label: '📤 共有',                    hint: 'ラボメンバーで情報や成果物を共有するもの (アルバム・ゼミ動画・チャット・ファイル送受信・締切・重要連絡・かんばんなど)。' },
  { id: 'trade',     label: '💴 売買',                    hint: 'ラボ内での売買。 購入・販売・オークション・ラーボーイーツ・チケット・発表順オークション。' },
  { id: 'urgent',    label: '🔴 締切・応答が要るもの',     hint: '期限つき / 行動を要求 / 即応通知を出すジャンル。' },
  { id: 'inform',    label: '🟡 全員に届くお知らせ',       hint: '投稿や参加で全員に情報通知。締切はない / 緩い。' },
  { id: 'tool',      label: '🟢 その場で結論が出る道具',   hint: '結果は画面内で完結。通知は出さない。' },
  { id: 'game',      label: '🎮 ゲーム / 娯楽',           hint: 'ラボメンバーで遊ぶゲーム。娯楽タブからもアクセス可。' },
  { id: 'health',    label: '💪 健康 / 運動',             hint: '体・運動の記録。個人ツール中心。' },
  { id: 'ai',        label: '🤖 個人ツール (AI / 計算)',   hint: '自分用の会話 / 翻訳 / 計算。通知は出さない。' },
  { id: 'archive',   label: '📚 ラボの情報・蓄積',         hint: '受動的に参照する静的・蓄積系。通知は出さない。' },
  // v1016 中村さん要望「ファイルブラウザ / DB / ウィジェットセンターをアプリタブの中に」
  { id: 'tools',     label: '🧰 ツール',                   hint: 'ファイル操作 / DB / 自作ウィジェット拡張など、 LabPay の運用や自分の作業を支える汎用ツール。' },
];

export const APPS = [
  // 💴 売買 (v602)
  { id: 'sell',          cat: 'trade',    url: '#/sell',          title: '🏷 販売',            desc: 'ラボ内に商品を出品。 JAN コード対応、在庫管理、ピン留めセール可。', defaultVisible: true },
  { id: 'buy',           cat: 'trade',    url: '#/buy',           title: '🛒 購入',            desc: 'ラボ内の商品一覧から購入。出品者・在庫・写真・口コミ付き。', defaultVisible: true },
  // 🔴 urgent — 締切・応答が要る (通知出す)
  { id: 'rollcalls',     cat: 'lab-mgmt', url: '#/rollcalls',     title: '📣 点呼',            desc: '「いる?」「起きてる?」をワンタップで集める。締切タイマー + 未応答者に催促 push 通知。', defaultVisible: true },
  // v634 ⚾ ドラフト (v637 娯楽へ)
  { id: 'drafts',        cat: 'game', url: '#/drafts',        title: '⚾ ドラフト',         desc: 'プロ野球風順番指名 + くじ抽選。参加者と候補 (人 or 自由入力) を揃えて開始 → 1 位、 2 位と順番に指名、競合はくじで決着。', defaultVisible: true },
  // v1208 🎤 ラボ名言集
  { id: 'sayings',       cat: 'game', url: '#/sayings',       title: '🎤 ラボ名言集',       desc: '誰が いつ どこで 何を 言ったか を 年度別 (4月-3月) に 登録。 ❤️ で 投票、 年度末 に 得票順 で 名言/迷言 大賞。', defaultVisible: true },
  // v635 📝 フリップクイズ (v637 娯楽へ)
  { id: 'quizzes',       cat: 'game', url: '#/quizzes',       title: '📝 フリップクイズ', desc: '出題者が問題を出す → 参加者はフリップに記述回答 → 一斉開示 (タップで拡大) → 出題者が ⭕❌ 採点 → ランキング集計。連続出題 OK。', defaultVisible: true },
  { id: 'polls',         cat: 'lab-mgmt', url: '#/polls',         title: '📊 投票・アンケート', desc: '対象者・締切・選択肢を指定して投票を集める。個人の票は非公開、集計の可視タイミングは選べる。', defaultVisible: true },
  { id: 'requests',      cat: 'lab-mgmt', url: '#/requests',      title: '💴 請求 (集金)',     desc: 'メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金/PayPay/銀行/立替) のチェック付き。', defaultVisible: true },
  { id: 'bait',          cat: 'lab-mgmt', url: '#/bait',          title: '💼 アルバイト申請', desc: '実験協力などで学生にアルバイトを依頼。時間 (小数) + 対象者を指定して送ると、受け取った側は月別で全部見えて処理済マーク。依頼者は進捗確認 + 未処理者催促可。', defaultVisible: true },
  { id: 'widgets',       cat: 'tools',    url: '#/widgets',       title: '🧩 ウィジェットセンター', desc: '自作ウィジェットを登録してホームに表示。 JS で render(root) を書くだけ。サンプルも用意 (時計 / 残高)。', defaultVisible: true },
  { id: 'cg2',           cat: 'game', url: '#/cg2',           title: '🎮 自作ゲーム v2 (cg2)', desc: 'p5.js で描画する准リアルタイム multiplayer framework。 sharedValues 自動同期 + host.start / host.stop のライフサイクル + CPU 戦対応。サンプル: マルバツ / ニム / ライツアウト / すごろく。', defaultVisible: true },
  { id: 'chat-rooms',    cat: 'shared', url: '#/chat-rooms', title: '💬 チャット (重要 / 連絡 / 相談 + DM)', desc: 'Slack 風チャット。 3 つのチャンネル + 1対1 DM。 2 秒 polling で准リアルタイム。「重要」への投稿は全員に通知が飛ぶ。', defaultVisible: true },
  // v734 #344 新規追加機能の登録 (v718 / v733 で実装したが apps 一覧に入れ忘れていたもの)
  { id: 'screen-shares', cat: 'shared', url: '#/screen-shares', title: '🖼 一時画像共有',  desc: 'ラボ全体 or 自分のグループ宛に画像 + ひとことを投げて 15 分〜24 時間の間ホームに大きく表示。「とにかく今これ見て」用。', defaultVisible: true },
  { id: 'file-transfers', cat: 'shared', url: '#/file-transfers', title: '📦 ファイル送受信', desc: '相手を指定してファイル (PDF / Word / Excel / 画像 / zip / txt 等最大 50MB) を送れる。受信者のダウンロード回数と初回ダウンロード時刻を記録。', defaultVisible: true },
  // v740 #288 BingoFit
  { id: 'bingofit',      cat: 'game',     url: '#/bingofit/closet', title: '👕 BingoFit', desc: '手持ちの服を 25 着以上登録すると、日曜始まりの 5x5 ビンゴ盤が自動生成。着た服を盤面から開けて、ラインが揃えばビンゴ。背景は自動で透過処理されます。', defaultVisible: true },
  { id: 'meetups',       cat: 'lab-mgmt', url: '#/meetups',       title: '🤝 待ち合わせ',      desc: '集合時刻 + 場所 + メンバーを一発で全員に通知。30分後 / 1時間後などのプリセット時刻あり。', defaultVisible: true },
  { id: 'buy-requests',  cat: 'lab-mgmt', url: '#/buy-requests',  title: '🛒 購入依頼',        desc: '「これ買ってほしい」を中村さんに投げる (URL + タイトル + 数量 + 理由)。中村さんが「買った / 却下」を返す。従来 #want_to_buy Slack の後継。LabPay 台帳のお金は動かない、現物受渡しだけ。', defaultVisible: true },
  // v1230 fb#502 教室予約依頼 (購入依頼の直下に配置、中村さん指示)
  { id: 'room-requests', cat: 'lab-mgmt', url: '#/room-requests', title: '🏫 教室予約依頼',   desc: '発表練習や会議で教室を押さえてほしい時にここから依頼。教室番号は指定不要 (プロジェクター / 大人数 / 何階など条件を書けば中村さんが最適な教室を押さえる)。LabPay 台帳は動かない。中野キャンパスフロア情報 (Cosense) へのリンクつき。', defaultVisible: true },
  { id: 'my-fund',       cat: 'lab-mgmt', url: '#/my-fund',       title: '💴 自分宛の研究費支払い', desc: 'fund.nkmr.io の SSO 直結 API から、自分宛の科研費支払い (相手先か摘要に自分の氏名を含む行) を年度別・状態別・キーワード検索で一覧表示。支払済 / 予定の合計も出す。widget はホームカードにも。', defaultVisible: true },
  { id: 'deadlines',     cat: 'shared', url: '#/meetups?kind=deadline', title: '📌 〆切',     desc: '〆切時刻 + 対象者を一発で全員に通知。365日先まで。待ち合わせと同じ仕組み (kind=deadline)。', defaultVisible: true },
  { id: 'timers',        cat: 'lab-mgmt', url: '#/timers',        title: '🛎 タイマー',        desc: '参加者全員で同じカウントダウンを共有。ポモドーロ / 会議の時間配分 / イベント開始までなど。', defaultVisible: true },
  { id: 'auctions',      cat: 'trade',  url: '#/auctions',      title: '🏷 オークション',    desc: '出品 + 入札。締切時刻に最高額入札者が落札。落札後は出品者が「請求を飛ばす」ボタンから請求機能で集金 (連絡先はラボ内既知前提なので表示しない)。', defaultVisible: true },
  { id: 'nomikai',       cat: 'lab-mgmt', url: '#/nomikai',       title: '🍶 飲み会割り勘',    desc: '新歓・送別会などの一回精算用。学年傾斜 + 飲酒/ソフドリで割って通知。', defaultVisible: true },

  // 🟡 inform — 全員に届くお知らせ
  { id: 'notices',       cat: 'shared', url: '#/notices',       title: '📢 重要連絡 / 学会情報', desc: 'タイトル + 本文 + URL でピン留め可能。カテゴリで切替。全メンバーが投稿可、投稿者 + admin が編集/削除。', defaultVisible: true },
  { id: 'groups',        cat: 'lab-mgmt', url: '#/groups',        title: '👥 イベント・出張用グループ作成', desc: '学会・出張・イベントなど一時的な括り。ワリカや一斉連絡に使う。自分の入ってるグループはホームから直接アクセス。', defaultVisible: true },

  // 🟢 tool — その場で結論が出る道具 (通知なし)
  { id: 'roulette',      cat: 'lab-mgmt', url: '#/roulette',      title: '🎰 ルーレット',       desc: 'メンバーから1人をくじ引きで選ぶ。賞金つき可。', defaultVisible: true },
  { id: 'text-roulette', cat: 'lab-mgmt', url: '#/text-roulette', title: '🍜 どこ行くルーレット', desc: '昼飯どこ行く / 何食べるなど、任意のテキスト候補から1つを選ぶシンプル版。', defaultVisible: true },
  { id: 'random-groups', cat: 'lab-mgmt', url: '#/random-groups', title: '🎲 ランダムグループ生成', desc: '選んだメンバーをNチームにランダム分け。学年/男女を「できるだけ均等」にする配慮も可能。', defaultVisible: true },
  // v523 #160 順番決め (発表順 / 当番など)。メンバーを 1 列に並び替えて結果を全員に通知。
  { id: 'orderings',     cat: 'lab-mgmt', url: '#/orderings',     title: '📋 順番決め',         desc: 'メンバーを1列に並び替え (発表順 / 当番割など)。結果は各メンバーに通知される。1人ずつめくる演出付き。', defaultVisible: true },
  // v529 #165 ストップウォッチを締切系 (urgent) カテゴリに移動 (発表時間など「時間で動く」性質)
  { id: 'stopwatches',   cat: 'lab-mgmt', url: '#/stopwatches',   title: '⏱ ストップウォッチ', desc: 'メンバー共有のカウントアップ計測器。開始 / 一時停止 / リセット全員操作可。発表時間や雑談計測用。', defaultVisible: true },

  { id: 'todos',         cat: 'ai',     url: '#/todos',         title: '📝 自分の TODO',     desc: 'やることメモ。サーバ保存で端末間共有。完了と未完了を分けて表示。', defaultVisible: true },

  // 🤖 ai — 個人ツール (AI / 計算、通知なし)
  { id: 'chat',          cat: 'ai',     url: '#/chat',          title: '💬 AI 対話 / 翻訳',  desc: '汎用多言語チャット (中国語・イタリア語・英語など)。海外出張での翻訳・会話補助に。クイックボタンで「〇〇に翻訳」を即発射。', defaultVisible: true },
  { id: 'help',          cat: 'ai',     url: '#/help',          title: '🤖 操作ガイド AI',   desc: 'LabPay の使い方を AI に聞けるチャット。「○○ ってどこから?」「△△ したいんだけど」に操作手順で答えます。', defaultVisible: true },
  { id: 'translate',     cat: 'ai',     url: '#/translate',     title: '🌐 画像和訳',       desc: '写真 (メニュー / 看板 / 説明文など) をアップロード → AI で日本語に翻訳。出張 / 旅行で便利。', defaultVisible: true },

  // 📚 archive — ラボの情報・蓄積 (受動、通知なし)
  { id: 'contacts',      cat: 'archive', url: '#/contacts',     title: '📞 連絡先',          desc: 'ラボメンバーの緊急連絡用電話番号。タップで通話。自分の番号は設定から登録。', defaultVisible: true },
  { id: 'scrapbox',      cat: 'archive', url: '#/scrapbox',     title: '📚 Scrapbox 履歴',   desc: '#scrapbox の研究ノート編集を読みやすくまとめて表示。', defaultVisible: true },
  { id: 'network',       cat: 'archive', url: '#/network',      title: '🕸 関係性グラフ',    desc: '売買・タスク・送金・Wishlist などのつながりをグラフで可視化。', defaultVisible: true },
  { id: 'exercise',      cat: 'health',  url: '#/exercise',     title: '🏃 運動 (歩数)',     desc: 'ポケットに入れて「開始」 → 歩く / 階段。端末センサーで歩数カウント、ラボ内ランキング表示。', defaultVisible: true },
  // v531 #163 行った国 / 都道府県制覇マップ
  { id: 'regions',       cat: 'game',   url: '#/regions',       title: '🗺 制覇マップ',     desc: '行った国・都道府県をタップで登録。進捗バー (47/47都道府県や100/X国) + ラボメンバーの集計 (何人訪問してるか) も表示。', defaultVisible: true },
  // v860 #445 ユーザが自由に作れる制覇リスト (中野区のパン屋 / 県庁所在地など)
  { id: 'conquest',      cat: 'game',   url: '#/conquest',      title: '🏁 制覇リスト',    desc: '街のパン屋、ラーメン屋、温泉地など、自分だけの制覇対象リストを作って、達成したらチェック。公開すればみんなでアイテムを育てられる。', defaultVisible: true },
  // v870 #452 Habit Tracker (個人 / 公開習慣の日毎 ✓ 入力)
  { id: 'habits',        cat: 'health', url: '#/habits',        title: '📓 Habit Tracker',  desc: '毎日論文を読む / 早起き / 運動など自分の習慣を登録して、日毎 ✓ で積み上げ。連続記録 (streak) と 60 日カレンダーで可視化。公開すればラボメン全員が達成状況を見られる。', defaultVisible: true },
  // v872 #454 早押しクイズ (リアル現場で出題者 + 参加者早押し)
  { id: 'buzzer',        cat: 'game',   url: '#/buzzer',        title: '⚡ 早押しクイズ',  desc: 'リアル現場 (ゼミ / 飲み会等) でクイズを出題 → 参加者がスマホで早押し。タップした順で順位が決まり、 1 位は緑で回答権、他は赤 + 1 位との差が ms で表示。出題者が「次へ」で全員が再入力モードに。', defaultVisible: true },
  // v532 #161 体重 / BMI 記録 (個人ツール、通知なし)
  { id: 'health',        cat: 'health', url: '#/health',         title: '⚖️ 体重 / BMI',    desc: '体重・身長・体脂肪を 1 タップで記録。 BMI 自動計算 + やせ/標準/肥満分類 + 折れ線グラフ。完全に個人ツール (他のメンバーには見えません)。', defaultVisible: true },
  // v533 #162 筋トレ記録 + 仲間 (mutual follow)
  { id: 'workouts',      cat: 'health',  url: '#/workouts',      title: '💪 筋トレ',         desc: '腕立て / 腹筋 / 背筋 / スクワット / プランク / 懸垂 / ベンチプレスなどをプリセットから 1 タップ記録。仲間 (お互いに追加) と様子を共有 / 比べ合い。', defaultVisible: true },
  // v538 #169 散歩に行きたくなるアプリ
  { id: 'walk',          cat: 'health', url: '#/walk',           title: '🚶 散歩',           desc: '現在地周辺の食べある記から散歩先をランダムにおすすめ。距離 + 徒歩何分 + 方位矢印 + Google Maps 経路。未訪を優先 + 半径切替 (500m〜5km)。', defaultVisible: true },
  // v540 #171 絵しりとり (v574 から game カテゴリへ)
  { id: 'shiritori',     cat: 'game',   url: '#/shiritori',      title: '🎨 絵しりとり',     desc: 'メンバーで順番に絵を描く絵しりとり。タイムリミット付きキャンバス + ストローク記録。自分が何を描いたか + 前の人を何と予想したかを登録。周回数 + ギブアップ。プレイフィー 5pt / 人 (固定)。', defaultVisible: true },
  // v549 #210 ティア表
  { id: 'tierlists',     cat: 'game',   url: '#/tierlists',      title: '🎯 ティア表',       desc: 'お題 + 候補リストでみんなで S/A/B/C/D 5段階のティア分け。自分の回答を保存すると他人の回答 + 全員集計が見れる。', defaultVisible: true },
  // v550 #206 論文査読
  { id: 'paper-review',  cat: 'research', url: '#/paper-review',   title: '📄 論文査読',      desc: '論文 PDF を渡すと章立て和訳要約 + 査読コメント (Accept/Reject + 強み/弱み + 引用実在性検証 + 統計妥当性) を返します。', defaultVisible: true },
  // v748 #359 #360 #361 論文和訳要約 (落合メソッド)
  { id: 'paper-summary', cat: 'research', url: '#/paper-summary', title: '📑 論文要約', desc: '論文 PDF から章立て要約 + RQ/仮説 + 落合メソッド + 図表を構造化して 3-5 分で返す。引用実在性の自己検証つき。', defaultVisible: true },
  // v583 #225 レジュメ原稿チェック (短原稿向け軽量版)
  // v1023 実験計画書チェック (Scrapbox 形式の実験計画書を精査)
  { id: 'exp-plan',       cat: 'research', url: '#/exp-plan',        title: '🧪 実験計画書チェック', desc: 'Scrapbox 形式で書いた実験計画書を精査。 RQ / 仮説の書き方、仮説と実験の対応、データの適切さ、統計手法、サンプルサイズを特に重視。 6 観点別スコア + 優先度別の修正提案。', defaultVisible: true },
  // v1024 サンプルサイズ / 検定力 (G*Power ベースライン)
  { id: 'power',          cat: 'research', url: '#/power',           title: '📐 サンプルサイズ / 検定力', desc: 'A priori (α + 検定力 + 効果量 → 必要 n) と Post hoc (α + 効果量 + n → 検定力) を計算。 t / ANOVA / rmANOVA / 相関 (Pearson/Spearman) / χ² / Fisher / LMM/GLMM / ベイズの 17 検定 + 予算試算 + 論文用 R/Python コード自動生成。', defaultVisible: true },
  { id: 'resume-check',  cat: 'research', url: '#/resume-check',   title: '📝 原稿チェック',    desc: 'レジュメ / 概要 / 申請書など 1-2 ページの短原稿をチェック。背景妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用 / 統計指標を一通り見ます。', defaultVisible: true },
  // v613 文字数・単語数リライター
  { id: 'rewriter',      cat: 'research', url: '#/rewriter',       title: '✂️ 文字数リライター', desc: 'アブストやリバッタルの文字数・単語数制限と戦うツール。サーバ側で正確にカウントして超過時は再依頼 (最大 3 回)。英文は和訳も。元と書き直しを色付き diff で表示。', defaultVisible: true },
  // v781 #376 Deep Research (ChatGPT 風多段 Web 調査)
  { id: 'deep-research', cat: 'research', url: '#/deep-research',  title: '🔎 Deep Research',  desc: 'ChatGPT の Deep Research を真似た多段 Web 調査。サブ問い分解 + セクション別調査 + 全体まとめ + 出典 URL を構造化して返す。引用実在性の自己検証つき。', defaultVisible: true },
  // v788 #386 #387 #388 論文全訳 (フル翻訳 + back-translation チェック、 E↔J)
  { id: 'paper-translate-full', cat: 'research', url: '#/paper-translate-full', title: '📑 論文全訳', desc: '要約でなく章ごとのフル翻訳。各章を訳 → 2-3 文サンプルを back-translation で整合確認 → 用語統一 + 全体ポリッシュ。英→日と日→英 (em-dash 等 GPT-isms 除去込み) の双方向対応。', defaultVisible: true },
  // v942 公開投票 (誰でも投票)
  { id: 'public-polls', cat: 'lab-mgmt', url: '#/public-polls', title: '🗳 公開投票', desc: '公開URL or 4桁コードで誰でも投票できる汎用アンケート (LabPayログイン不要、SNSシェア可)。単一/複数選択 + 任意で自由記述、集計公開タイミングも選択可。外部イベント来場者やSNS向け。', defaultVisible: true },
  // v941 合同研究会用投票 (v944 で research → lab-mgmt にカテゴリ移動)
  { id: 'joint-events', cat: 'lab-mgmt', url: '#/joint-events', title: '🎪 合同研究会投票', desc: '2ラボ以上の合同研究会でセッション別優秀発表者を投票で決める。外部参加者も4桁コード or 公開URLで匿名投票可 (LabPayログイン不要)。投票者は所属を選び、相手ラボの発表だけに投票 (クロスラボ制約)。', defaultVisible: true },
  // v961 中村研 Google Photos アルバム集 / v998 運営 → 娯楽に移動
  { id: 'nkmr-albums',    cat: 'shared', url: '#/albums', title: '📸 中村研アルバム',
    desc: '中村研の Google Photos アルバム集を LabPay 内から一覧・タップで遷移。年別に折りたたみ、学会 / 合宿 / 飲み会 / 卒業式等 200+ 件の思い出。各アルバムは Google Photos が別タブで開きます。', defaultVisible: true },
  // v960 外部ツールポータル (LabPay をハブにして別アプリに飛ぶ)
  { id: 'fund-portal',    cat: 'lab-mgmt', url: 'https://fund.nkmr.io', title: '💴 研究費ポータル (fund.nkmr.io)',
    desc: '中村研の 予算執行 DB。 科研費 / 校費 / 各種 fund の 予定 と 実績、 アルバイト代の 登録、 支払明細、 予算残高 まで。 nkmr-SSO で保護。 自分宛の 支払いだけ を LabPay 内で 見たい 時 は 💴 自分宛の研究費支払い を どうぞ。', defaultVisible: true },
  // v1229 中村研 写真基盤 (Google Photos 脱出後の自前アルバム)
  { id: 'photo-portal',   cat: 'shared', url: 'https://photo.nkmr.io', title: '📷 中村研フォト (photo.nkmr.io)',
    desc: '中村研の 写真・動画 を 全部 貯める 自前 フォト基盤 (Google Photos の 代替)。 学会 / 合宿 / 飲み会 / ゼミの 写真 と 動画 を まとめて 保存 + 検索。 nkmr-SSO で保護。 アルバム 一覧 を LabPay 内 で 見たい 時 は 🖼 フォト アルバム を どうぞ。', defaultVisible: true },
  // v1234 photo.nkmr.io の アルバム を LabPay 内 で 閲覧 (API 直叩き)
  { id: 'photo',          cat: 'shared', url: '#/photo', title: '🖼 フォト アルバム (LabPay 内)',
    desc: 'photo.nkmr.io の アルバム を LabPay 内 で 閲覧。 アルバム一覧 → タイル → タップ で 全画面 ライトボックス (前後 スワイプ 可)。 タグ / タイトル で 絞り込み。 nkmr-SSO で 保護。 全機能 は 外部 サイト (📷 中村研フォト) を どうぞ。', defaultVisible: true },
  { id: 'poster-maker',   cat: 'shared', url: 'https://member.nkmr.io', title: '📇 メンバー紹介ポスター作成',
    desc: '研究室メンバー紹介ポスターを Web で入力 → pptx 自動生成。顔写真 / 名前 / 学年 / 研究テーマ / 趣味などを打ち込むと綺麗な A3 ポスターの pptx が落ちてくる。新歓 / 学会準備 / 研究室訪問対応に。 nkmr-SSO で保護。', defaultVisible: true },
  { id: 'file-browser',   cat: 'tools',    url: 'https://file.nkmr.io', title: '🗄 ファイルブラウザ',
    desc: 'ラボ NFS / VPS 上のファイルをブラウザで一覧・編集・アップロード・ダウンロード。 VS Code Remote がメモリ枯渇するときの代替。 Google 認証で保護、 realpath で閉じ込め済。', defaultVisible: true },
  { id: 'db-admin',       cat: 'tools',    url: 'https://db2.nkmr.io', title: '🗃 データベース (phpMyAdmin)',
    desc: 'MariaDB (home2) を phpMyAdmin で直接触る。 LabPay 本体・poster・mojirage 等の DB を SQL で確認/編集。 admin 権限が必要な人向け。', defaultVisible: true },
  // v934 かんばん (Trello-like)
  // v1002 個人家計簿
  // v1019 🍅 ポモドーロタイマー (個人の集中管理)
  { id: 'pomodoro',       cat: 'health', url: '#/pomodoro',      title: '🍅 ポモドーロタイマー',
    desc: '集中25分 → 小休憩5分を繰り返す集中法。 4 セット目の後は大休憩15分。タスクラベル、完了時チャイム + ブラウザ通知、集中中は画面 sleep 抑止、日次実績グラフ、 duration カスタマイズ可。個人の作業効率アップに。', defaultVisible: true },
  { id: 'expenses',       cat: 'health', url: '#/expenses',      title: '💰 家計簿 (領収書撮影)',
    desc: '個人の支出を記録。手動追加 or 領収書を撮影して OpenAI Vision で店名/日付/金額/カテゴリを自動抽出。月別 + カテゴリ別合計 + 明細一覧。全て個人スコープ (他人には見えない)。', defaultVisible: true },
  { id: 'kanban', cat: 'shared', url: '#/kanban', title: '📋 かんばん', desc: 'Trello 的タスクボード。列 (Backlog/Doing/Done 等) + カードを D&D。カードは担当者 / ラベル / 期限 / チェックリスト / Markdown 説明 + コメント。アサインとコメントで通知、履歴も残る。', defaultVisible: true },
  { id: 'exp-recruits', cat: 'research', url: '#/exp-recruits', title: '🧪 実験協力者募集', desc: '実験の被験者を早い者順で募集。 枠 (時間帯や日程) と定員を並べて公開、 メンバーは空いてる枠に自分でエントリー。 実施者は代理追加も可能。 参加者は自分の枠を後から確認できる。', defaultVisible: false },
  { id: 'bokete', cat: 'game', url: '#/bokete', title: '😆 ぼけて (bokete)', desc: '画像大喜利。 お題 (画像 + 任意の一言) を出して、みんなでボケ (面白い一言) を書く → ⭐ で評価 → ⭐ 数で ランキング。 bokete.jp 的、 無料。', defaultVisible: true },
  { id: 'setlog', cat: 'game', url: '#/setlog', title: '📸 setlog (LabPay 版 Vlog)', desc: '1 日を短いクリップ (写真 + キャプション) で断片記録するラボ内 Vlog (BeReal 的)。写真を随時ポスト → 日別・ユーザ別に時系列でまとまる。今日のみんなのフィードもある。', defaultVisible: true },
  { id: 'research-ai', cat: 'research', url: '#/research-ai', title: '🔬 研究特化 AI サブスク', desc: '研究に特化したプロンプトテンプレート付きチャット (研究テーマ相談 / 実験デザインチェック / アブスト磨き / 関連研究整理 / リバッタル起草 / 科研費文章 / 汎用)。サブスク: 200pt/60件 or 1000pt/無制限 (30 日)。', defaultVisible: true },
  { id: 'profile-book', cat: 'game', url: '#/profile-book', title: '🎀 プロフ帳 (平成デザ)', desc: '基本情報 + 心理テスト + 匿名質問。基本情報を 6 個以上埋めると +50pt reward。他人のプロフ閲覧 10pt (一度アンロックで無制限)、匿名質問投稿 10pt、質問回答 +5pt。手書き風フォント + パステル背景。', defaultVisible: true },
  { id: 'labo-eats', cat: 'trade', url: '#/labo-eats', title: '🍱 ラーボーイーツ', desc: '研究室にいる人が外にいる人に「ついで買い」を頼めるサービス。基本料 50pt + 距離 10pt/100m + 商品代 (実費)。依頼 → 引受 → 引渡 (商品代入力) → 依頼者が受取確定で全額支払。', defaultVisible: true },
  { id: 'tickets', cat: 'trade', url: '#/tickets', title: '🎫 チケット', desc: '「◯◯します」「◯◯できる権利」を pt で売買できる社内マーケット。誰でも発行 → 対象者が pt を払って使う → 発行者に pt 入る。例: 運転しますチケット / 席を選べる / 罰ゲーム回避 / 好きなお菓子選べる。発行時に対象 (全員 / 学年限定) と有効期限、発行枚数を指定。', defaultVisible: true },
  { id: 'trading-cards', cat: 'game', url: '#/trading-cards', title: '🎴 ゼミ人トレカ + ガチャ', desc: 'ラボメンのトレカ (SSR/SR/R/N) を誰でも作成。作ると本人へ承認申請が飛び、承認されると公開 pool 入り。ガチャは 1 連 30pt / 10 連 250pt (R 以上確定)。集めよう。', defaultVisible: true },
  { id: 'pres-order', cat: 'trade', url: '#/pres-order', title: '🎪 発表順オークション', desc: '論文紹介やポスターセッションの発表順を sealed 入札で決める。全員好きな額を入れて締切 → 金額の高い順に 1 番目 / 2 番目 / … を割り当て、勝者は入札額を pot に支払う。未入札は 0pt で最下位ゾーンに並ぶ。', defaultVisible: true },
  { id: 'tomorrow-lab', cat: 'lab-mgmt', url: '#/tomorrow-lab', title: '🏫 明日、研究室に一緒に行こう', desc: '明日行くと宣言 → 誰も居ないと寂しいので集まる仕組み。最初に宣言した人が罰金 fee を設定、他の人は無料で参加。当日以降に精算 → checkin データから行かなかった人 (no-show) から罰金を徴収し、行った人 (show) で山分け。', defaultVisible: true },
  { id: 'board', cat: 'shared', url: '#/board', title: '🗒 Board (ポストイット空間)', desc: 'グループで自由にポストイットを配置できる共有ボード。ドラッグで動かす / つまんでリサイズ / 色や表裏を変える / 🎨 で AI 画像生成 / 📚 論文 or 🍜 食べある記から一括貼付 (元ページへの 🔗 リンク付き)。 v1172 で Miro から Board にリネーム (id/URL も miro→board)。 v1173 (計画中): 手書き対応。', defaultVisible: true },
  // v925 文献管理 (Zotero-like)
  { id: 'refs', cat: 'research', url: '#/refs', title: '📚 文献管理', desc: 'Zotero的な文献管理。DOI/arXiv ID/URLからmetadata (title/authors/year/venue/abstract) を自動取得。PDF添付、タグ、BibTeX出力、検索・絞り込み、読状態、自分のnoteをラボ全員で共有。要約/全訳と相互リンク。', defaultVisible: true },
  // v821 Cosense (nkmr-lab) 連携 — 研究ノートの今日 / 昨日をロード + 編集リンク
  { id: 'research-notes', cat: 'research', url: '#/research-notes', title: '📝 研究ノート (Cosense)', desc: 'nkmr-lab Cosense の「YYYY.MM_研究ノート_<handle>」ページを直接ロードし、今日 / 昨日の日付セクションを抽出表示。書く時は Cosense を開いて編集。 admin 側で session cookie 設定必須。', defaultVisible: true },
  // v886 Overleaf プロジェクト追跡 (教員 admin 限定)
  { id: 'overleaf',     cat: 'shared',   url: '#/overleaf',     title: '📝 Overleaf 更新状況',  desc: '教員アカウント共有の全 Overleaf プロジェクトの文字数推移を可視化。 24h/7d 差分 + sparkline + 60 日履歴 + 比較グラフ。', defaultVisible: true },
  { id: 'zemi-videos', cat: 'shared', url: '#/zemi-videos', title: '🎥 ゼミ動画', desc: 'YouTubeの限定公開ゼミ動画をタイトル/説明でキーワード検索 + その場で視聴。誰でも動画URL + タイトル + 説明を登録できる。', defaultVisible: true },
  // v586 フライト応援 (オフライン、機内で使う)
  { id: 'flight',        cat: 'game',   url: '#/flight',         title: '✈️ フライト応援',    desc: '長いフライトの進捗 (%) / 残り時間 / 経過時間を大きく可視化。完全オフラインで動作。画面自動ON維持。機内で退屈しのぎに。', defaultVisible: true },
  // v553 #209 麻雀 (v574 から game カテゴリへ)
  { id: 'mahjong',       cat: 'game',   url: '#/mahjong',       title: '🀄 麻雀',           desc: '4 人で 50pt 賭けて本格麻雀 (門前/鳴き/役判定/連荘/半荘) or 1〜4 位申告で自動分配。 AI 対戦はプレイフィー 5pt の練習モード。', defaultVisible: true },
  // v568 #223 ito (v574 から game カテゴリへ)
  { id: 'ito',           cat: 'game',   url: '#/ito',            title: '🎲 ito',           desc: '2 人以上でプレイフィー 5pt / 人 (固定)、各自に 1-100 の数字 → お題に沿って表現を入力 → 全員の数字を開示する協力ゲーム。数字を直接言わずに「強い動物の強さ」などで大小を伝える。', defaultVisible: true },
  // v570 #223 人狼 (v574 から game カテゴリへ)
  { id: 'jinrou',        cat: 'game',   url: '#/jinrou',         title: '🐺 人狼',          desc: '4-16 人でプレイフィー 5pt / 人 (固定) → 役職配布 (村人 / 人狼 / 占い師 / 騎士) → 夜 (人狼襲撃 + 占い + 護衛) → 昼 (投票で追放) → 人狼全滅 or 人狼≥村人で決着。', defaultVisible: true },
  { id: 'fortune',       cat: 'game',   url: '#/fortune',        title: '🔮 今日の占い + ♈ 西洋占星術',  desc: '1 日 1 回だけ引ける運勢 (大吉 / 中吉 / 凶等 30 種)。設定 → プロフィールで誕生日を登録すると 12 星座占い (メッセージ + ラッキーカラー / アイテム / ナンバー) も一緒に表示。同じ日は同じ結果、翌日 0:00 で更新。ホームの残高エリア 🔮 アイコンからも引ける。', defaultVisible: true },
  { id: 'conf-deadlines',cat: 'shared',url: '#/conf-deadlines', title: '📅 学会〆切',    desc: '国際会議 / 国内研究会 / 論文誌の投稿〆切を登録 + 一覧。誰でも登録可、全員閲覧可。〆切順表示 + あと N 日のカウントダウン。', defaultVisible: true },
  // v576 優勝予想 (W 杯 / スポーツ大会 / 学会 best paper など)
  { id: 'predictions',   cat: 'game',   url: '#/predictions',    title: '🏆 優勝予想',       desc: 'ワールドカップやスポーツ大会、大学受験・学会 best paper など「順位」を予想して参加フィーで景品を山分け。 1位のみ / 1-2位 / 1-4位を起案ごとに設定可能。', defaultVisible: true },
  // v609 #235 勝敗予測 (試合のスコアを当てる)
  { id: 'score-predictions', cat: 'game', url: '#/score-predictions', title: '🎯 勝敗予測', desc: '試合のスコア (X-Y) を予想して完璧に当てた人が pot 総取り (山分け、場代5%)。誰も当たらなければ全員返金。基本20pt、 10-100pt 設定可。', defaultVisible: true },
  // v587 地雷オセロ
  { id: 'othello',       cat: 'game',   url: '#/othello',        title: '💣 地雷オセロ',     desc: '通常オセロ + 各自 1 か所地雷。地雷を踏むと周囲 3x3 (9 マス) 反転。プレイフィー 5pt。', defaultVisible: true },
  // v617 #236 マルバツ (自作ゲームフレームワークサンプル)
  { id: 'tictactoe',     cat: 'game',   url: '#/tictactoe',      title: '⭕❌ マルバツ',      desc: '3x3 のマルバツ。起案者=⭕、参加者=❌。縦/横/斜め 3 つ並べたら勝ち。プレイフィー 5pt。自作ゲームのサンプル実装 (docs/CUSTOM_GAMES.md 参照)。', defaultVisible: true },
  // v588 ビンゴ (週次)
  { id: 'bingo',         cat: 'game',   url: '#/bingo',          title: '🎰 ビンゴ',          desc: '毎週 5x5 ビンゴカードが自動生成。平日の行動 (ラボイン/らぼったー投稿/麻雀/オセロ/食べある記など) が自動カウント。達成早 + ライン数で週次リーダーボード。', defaultVisible: true },
  // v590 大富豪 (シンプル MVP)
  { id: 'daifugo',       cat: 'game',   url: '#/daifugo',        title: '🃏 大富豪',         desc: '2-4 人。単出し / ペア / N枚出しで同枚数 + 強い数字を出す。ジョーカーワイルド + 革命 + 8切り。プレイフィー 5pt / 人 (固定)。', defaultVisible: true },
  { id: 'playlists',     cat: 'game',   url: '#/playlists',    title: '🎵 プレイリスト',    desc: 'YouTube/Spotify URLをまとめて紹介。⭐1-5評価 + コメント + ❤️お気に入り + ジャンル + シャッフル再生。', defaultVisible: true },
  { id: 'places',        cat: 'game',   url: '#/places',       title: '🍴 食べある記',      desc: 'お店情報 (住所 / 緯度経度 / 紹介文) をラボメンバーで共有。口コミ・写真・⭐評価 + 地図ビュー + tabelog URLから自動取得。', defaultVisible: true },
  { id: 'sns',           cat: 'game',   url: '#/sns',           title: '💬 らぼったー',       desc: 'シンプルなつぶやき (テキスト + 画像 + 位置 + @メンション + 返信 + 👍 ❤ ⭐ リアクション)。フォローなし — 全員の投稿が見える。', defaultVisible: true },
  // v884 #457 実績 (アプリ一覧に入れ忘れていた)
  { id: 'achievements',  cat: 'archive', url: '#/achievements', title: '🏆 実績',           desc: 'ラボ内で達成してきた実績を一覧表示。売買/投稿/食べある記/ゲーム/筋トレ/論文要約など各種行動が記念バッジとして並び、AI が称号 (例「らぼ酒場の主」) を命名してくれる。', defaultVisible: true },
  // v1151 中村さん指摘「全てタブに入っていない機能が結構ある」→ 独立ページで動くのに apps.js 未登録だった 12 個を追加。
  { id: 'send',          cat: 'trade',    url: '#/send',           title: '💸 個人送金',        desc: '相手を選んで pt を送る (プロフィール → 「💸 LabPay で送金」経由でも起動)。 効果音つき。', defaultVisible: true },
  { id: 'wishlist',      cat: 'trade',    url: '#/wishlist',       title: '🛍 これ欲しい',      desc: 'ラボにあると嬉しい商品を掲示。 誰かが「出ました!」で達成扱い。 リクエスト → 出品 に つながる。', defaultVisible: true },
  { id: 'tasks',         cat: 'lab-mgmt', url: '#/tasks',          title: '✅ タスク',           desc: '報酬付きの依頼 → 引き受け → 承認、 エスクロー預け。 時間枠分割 / 指名 / ファイル添付対応。', defaultVisible: true },
  { id: 'invitations',   cat: 'lab-mgmt', url: '#/invitations',    title: '📢 募集',             desc: 'お昼ご飯 / ビアガーデン / ポケモン GO などカジュアル招集。 参加表明型、 6h で自動 close。', defaultVisible: true },
  { id: 'wari',          cat: 'tools',    url: '#/wari',           title: '🧮 ワリカ (計算)',   desc: '合計金額 + 通貨 + 人数から 1 人あたりを 即算出。 多通貨 + JPY 換算、 DB 保存なしの計算機。 グループ内ワリカとは別、 その場計算用。', defaultVisible: true },
  { id: 'my-games',      cat: 'game',     url: '#/my-games',       title: '🎮 自作ゲーム管理',   desc: 'cg2 (自作ゲーム v2 フレームワーク) 用に、 自作の 2 人対戦 JS をアップロード / 編集 / 削除。 詳細 → docs/CUSTOM_GAMES.md。', defaultVisible: true },
  { id: 'walk-mode',     cat: 'health',   url: '#/walk-mode',      title: '🚶 散歩モード',       desc: '全画面マップ + Wake Lock + GPS 5 秒 polling で軌跡 polyline 記録 → SNS 投稿可能。 過去軌跡重ね合わせ表示。', defaultVisible: true },
  { id: 'quotes',        cat: 'ai',       url: '#/quotes',         title: '💬 名言集',           desc: '偉人 / 漫画 / アニメの名言を日単位で 1 件。 ラボメンによる名言登録も可能。 ホームウィジェットとしても表示可 (デフォルト OFF)。', defaultVisible: true },
  { id: 'papers-recent', cat: 'research', url: '#/papers-recent',  title: '📚 最近の論文まとめ', desc: 'ラボ内で 公開された 論文要約 / 全訳 / 査読 / Deep Research の 最近一覧。 ⭐ ブックマーク済 / いいね順 / 検索。', defaultVisible: true },
  { id: 'news',          cat: 'shared',   url: '#/news',           title: '📰 LabPay ニュース',  desc: 'LabPay の更新情報 (新機能 / 修正)。 版履歴のダイジェスト。', defaultVisible: true },
  { id: 'activity',      cat: 'archive',  url: '#/activity',       title: '📊 活動ログ',         desc: 'ラボ内の最近の取引 / 投稿 / 参加 / 実績更新を時系列で一覧。', defaultVisible: true },
  { id: 'history',       cat: 'archive',  url: '#/history',        title: '💴 個人取引履歴',     desc: '自分の 送金 / 購入 / 販売 / 実績報酬 / タスク報酬 の 履歴を時系列で。', defaultVisible: true },
];

const APP_VIS_KEY = 'labpay-apps-visibility';

// v497 #103 アプリ表示の個別設定は撤去 (全部表示する方針)。 isAppVisible は
//   後方互換のため残し、常に true を返す。 setAppVisible はno-op。
export function isAppVisible(_id) { return true; }
export function setAppVisible(_id, _visible) {}

// v602 カテゴリ内の表示順を明示指定するマップ。値は [id, id, ...] の順序。
//   ここに含まれない id はソース宣言順で末尾に。
// v792 #396 (再編) カテゴリ内でさらにサブ見出しで 2 分割したい場合の設定。
//   サブグループに該当する id はその順番で並ぶ。ここに載っていない id は
//   末尾の「(その他)」に自動で入る (普段は起きない想定)。
const CATEGORY_SUBGROUPS = {
  'lab-mgmt': [
    { label: '🏫 ゼミ・研究会・学会サポート',
      hint:  '発表順 / タイマー / 一時グループ / くじなど。ゼミや研究会、学会出張で使う。',
      ids: ['timers', 'stopwatches', 'orderings', 'random-groups', 'groups', 'roulette', 'text-roulette'] },
    { label: '🏢 研究室運営サポート',
      hint:  '投票 / 締切 / 割り勘 / 集金 / アルバイトなど、研究室の運営と合意形成。',
      ids: ['polls', 'rollcalls', 'meetups', 'nomikai', 'requests', 'bait'] },
  ],
};

const CATEGORY_ORDER = {
  // v792 #396 研究用は AI で研究を直接進めるものだけ
  research: [
    'research-notes', // v821 Cosense 連携
    'deep-research',
    'paper-summary',
    'paper-translate-full',
    'refs',
    'resume-check',
    'paper-review',
    'rewriter',
  ],
  // v792 #396 ゼミ・研究会・学会サポート群 → 研究室運営群の順で並べる
  'lab-mgmt': [
    // ── ゼミ・研究会・学会サポート ──
    'timers', 'stopwatches',
    'orderings', 'random-groups',
    'groups',                       // イベント・出張用グループ作成
    'roulette', 'text-roulette',
    // ── 研究室運営サポート ──
    'polls',                        // 投票・アンケート
    'rollcalls',                    // 点呼
    'meetups',                      // 待ち合わせ
    'nomikai',                      // 飲み会割り勘
    'requests',                     // 請求 (集金)
    'bait',                         // アルバイト申請
  ],
  // v1016 🧰 ツールカテゴリの並び順
  'tools': [
    'widgets',                      // 🧩 ウィジェットセンター
    'file-browser',                 // 🗄 ファイルブラウザ
    'db-admin',                     // 🗃 phpMyAdmin
  ],
  // v1001 共有タブ (中村さん指定順)
  'shared': [
    'nkmr-albums',                  // 📸 中村研アルバム (最上位)
    'zemi-videos',                  // 🎥 ゼミ動画
    'chat-rooms',                   // 💬 チャット
    'file-transfers',               // 📦 ファイル送受信
    'screen-shares',                // 🖼 一時画像共有
    'deadlines',                    // 📌 〆切
    'conf-deadlines',               // 📅 学会〆切
    'notices',                      // 📢 重要連絡 / 学会情報
    'poster-maker',                 // 📇 メンバー紹介ポスター作成
    'kanban',                       // 📋 かんばん
    'overleaf',                     // v1018 📝 Overleaf 更新状況 (中村さん指示: 共有タブの一番下)
  ],
};

export async function renderApps(ctx = {}) {
  const app = document.getElementById('app');
  const filterCat = ctx?.cat || null;
  const visible = APPS.filter(a => isAppVisible(a.id));
  const hiddenCount = APPS.length - visible.length;

  // カテゴリ毎にセクション化。空セクションは出さない。
  //   filterCat が指定されていたらそのカテゴリだけ描画。
  const filteredCats = filterCat
    ? APP_CATEGORIES.filter(c => c.id === filterCat)
    : APP_CATEGORIES;
  // v960 外部URL (https://…) は別タブで開くよう target=_blank + rel、
  //   タイトル末尾に ↗ を付けて見分けがつくように。 SPA 内リンクは従来通り。
  const renderItemRow = (a) => {
    const isExternal = /^https?:\/\//.test(a.url);
    const attr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    const arrow = isExternal ? '↗' : '→';
    return `
    <a class="list-item" href="${a.url}"${attr}>
      <div class="grow">
        <div class="bold">${escapeHtml(a.title)} ${arrow}</div>
        <div class="meta">${escapeHtml(a.desc)}</div>
      </div>
    </a>`;
  };
  const sectionsHtml = filteredCats.map(c => {
    let items = visible.filter(a => a.cat === c.id);
    // 指定があれば並び替え
    const order = CATEGORY_ORDER[c.id];
    if (order) {
      const idx = (id) => {
        const i = order.indexOf(id);
        return i === -1 ? 1000 + items.findIndex(x => x.id === id) : i;
      };
      items = items.slice().sort((a, b) => idx(a.id) - idx(b.id));
    }
    if (!items.length) return '';
    // v792 #396 (再編) サブグループ設定があるなら 1 つのカード内を 2 ブロックで出す
    const subgroups = CATEGORY_SUBGROUPS[c.id];
    if (subgroups && subgroups.length) {
      const byId = new Map(items.map(a => [a.id, a]));
      const used = new Set();
      const subSections = subgroups.map(sg => {
        const sgItems = sg.ids.map(id => byId.get(id)).filter(Boolean);
        sgItems.forEach(it => used.add(it.id));
        if (!sgItems.length) return '';
        return `
          <div style="margin-top:10px">
            <div class="bold" style="font-size:13px; color:var(--primary); margin-bottom:2px">${escapeHtml(sg.label)}</div>
            ${sg.hint ? `<p class="hint" style="margin:0 0 6px; font-size:11px">${escapeHtml(sg.hint)}</p>` : ''}
            <div class="list">
              ${sgItems.map(renderItemRow).join('')}
            </div>
          </div>`;
      }).join('');
      const leftover = items.filter(a => !used.has(a.id));
      const leftoverHtml = leftover.length ? `
        <div style="margin-top:10px">
          <div class="bold" style="font-size:13px; color:#6b7280; margin-bottom:4px">（その他）</div>
          <div class="list">${leftover.map(renderItemRow).join('')}</div>
        </div>` : '';
      return `
        <div class="card" style="margin-top:10px">
          <h3 style="margin:0 0 4px">${escapeHtml(c.label)}</h3>
          <p class="hint" style="margin:0 0 8px">${escapeHtml(c.hint)}</p>
          ${subSections}
          ${leftoverHtml}
        </div>`;
    }
    // 通常 (フラットなリスト)
    return `
      <div class="card" style="margin-top:10px">
        <h3 style="margin:0 0 4px">${escapeHtml(c.label)}</h3>
        <p class="hint" style="margin:0 0 8px">${escapeHtml(c.hint)}</p>
        <div class="list">
          ${items.map(renderItemRow).join('')}
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
