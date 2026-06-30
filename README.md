# LabPay

研究室ローカルポイントシステム。約 35 人規模のクローズドコミュニティ向けに「**買う・売る・タスク・送る・実績**」+ ラボ活動の可視化、さらに**ワリカ / 飲み会割り勘 / 請求 / ルーレット / 募集 / グループ / 投票 / 点呼 / タイマー / 待ち合わせ / オークション / 運動 (歩数) / 効果音 / 公開プロフィール**などの小道具をひとつにまとめた PWA + バックエンド。

```
本番稼働: https://pay.nkmr.io  (中村研 内部)
```

LabPay は **使い切りの軽さ** を最優先に設計されています:

- **フレームワークなし** — 素の PHP 8.x + Vanilla JS。React や Composer を入れない
- **ビルド工程なし** — `git pull` + `systemctl reload httpd` で反映
- **依存ゼロ** — npm パッケージは使わない (ZXing と d3 はベンダディレクトリに同梱)
- **長期凍結耐性** — 10 年後も同じコードが PHP 8.x + ブラウザで動く想定

---

## 機能一覧

### 残高・取引

| 領域 | 内容 |
|---|---|
| 残高・取引 | 購入 / 販売 / 個人送金 (QR) / 自己消費 (在庫を自分用に減らす・手数料なし) |
| 購入 | ラボ Wi-Fi 接続中のみ許可 (オフラインからは閲覧のみ) / リピート購入は履歴一致のタイル上位表示 / バーコード読取 |
| マーケット (販売) | バーコード読取 + 楽天 API で商品名・画像自動取得 / 置き場所 / 出品ごとに購入時お礼メッセージ / Slack 入荷通知 / 出品中はサマリ表示 → 編集モードでフィールド一括更新 |

### タスク・依頼・募集

| 領域 | 内容 |
|---|---|
| タスク | 報酬付きの 依頼 → 引き受け → 承認、エスクロー預け / 時間枠分割 (`6/15 11:00-15:00 30分刻み`) / 締切自動取消 + 返金 / 完了報告フィードバック / **ファイル添付** (原稿チェック向け、最大 50MB) / 引き受け本人にも通知 / ホームに「あなたが引き受け中のタスク」カード |
| 指名タスク | 特定メンバーに限定して 報酬つきで送れるタスク (誰でも受諾できる通常タスクと別動線)。指名された人だけが受諾可能 |
| 🙏 リクエスト (報酬なし) | 0pt の お願いベース。 タスクとは 別動線で 作成、 一覧では 🙏 タグで識別。 ESCROW なし、 善意 引き受け |
| 募集 (invitations) | 「お昼ご飯」「ビアガーデン」「ポケモン GO」など pt の無いカジュアル招集。 表紙画像、 開催日 (任意・時刻 / 日付だけ も可) + **募集締切** (任意・参加表明はこの時刻まで)、 場所 / 上限 / 詳細 / 参加表明、 **発起人 自動 +1** + 事前参加者の登録 (作成時に 学年バルクで 選択), 終了済の 編集 (タイトル / 日時 / 場所 / 上限 / 詳細)、 再募集ボタン (発起人) |

### 小道具 (`#/apps` + 上部タブ `#/research` `#/lab-mgmt` `#/games` から)

アプリは v601+ で **9 カテゴリ** に整理 (research / lab-mgmt / trade / urgent / inform / tool / game / health / ai / archive)。 上部ナビには **「研究」「運営」** のショートカットタブが あり、 該当カテゴリ だけを 絞り込んで 表示する。 `localStorage` ベースの アプリ個別 ON/OFF は v497 以降 撤廃 (全アプリ 常時表示)。

主要カテゴリ:

- 🔬 **研究用** (v792 で AI で 研究 を 直接 進める もの に 絞り 込み) — **🔎 Deep Research** / **📑 論文要約** / **📑 論文全訳** / **📝 原稿チェック** / **📄 論文査読** / **✂️ 文字数 リライター** / **📝 研究 ノート (Cosense)** / **📝 Overleaf 更新状況**
- 🏢 **研究室運営サポート** (v793 で 2 サブ ブロック に 分割表示) — **🏫 ゼミ・研究会・学会 サポート** (タイマー / ストップウォッチ / 順番決め / ランダムグループ / イベント・出張用グループ / ルーレット / どこ行くルーレット) + **🏢 研究室 運営** (投票 / チャット / ファイル / 一時画像 / 〆切 / 学会〆切 / 重要連絡 / 点呼 / 待ち合わせ / 飲み会割り勘 / 集金 / **💼 アルバイト申請**)
- 💴 **売買** — 販売 / 購入 / オークション
- 🎮 **ゲーム / 娯楽** — 麻雀 / 大富豪 / 地雷オセロ / 優勝予想 / 勝敗予測 / ito / 人狼 / 絵しりとり / ティア表 / ビンゴ / ⭕❌ マルバツ + 自作ゲーム (各ユーザが 設定から JS を アップロードして 追加可能) / **📝 フリップクイズ** (出題 → フリップ 回答 → 採点) / **⚾ ドラフト** (プロ野球 風 順番 指名 + くじ抽選) / **⚡ 早押し クイズ** (現場 で ms 差 判定) / **🏁 制覇 リスト** (パン屋 / 温泉 等 ユーザ 作成) / らぼったー / 食べある記 / フライト応援 / プレイリスト / 制覇マップ / **🎰 着回し ビンゴ** (着る服 5x5) / **🎥 ゼミ動画** (YouTube 限定公開 検索)
- 💪 **健康** — 体重 BMI / 筋トレ / 散歩 / 運動 / **📓 Habit Tracker** (自分 の 習慣 を 日 毎 ✓ で 積み上げ + 60 日 カレンダー + streak)
- 🤖 **AI** — 翻訳 / チャット / 操作ガイド AI / **🏅 実績 称号** (AI が 獲得 実績 から ラノベ 風 称号 を 1 行 生成) / **💬 今日 の 名言** (デフォルト OFF、 偉人 / 漫画 / アニメ 名言 を 日 単位 で 1 件、 ラボメン による 名言 登録 可)
- 🧩 **拡張** — **ウィジェット センター** (自作 ウィジェット を 登録 → ホーム に 表示。 JS で `render(root)` を 書く だけ。 詳細 → [docs/CUSTOM_WIDGETS.md](docs/CUSTOM_WIDGETS.md))

| 領域 | 内容 |
|---|---|
| グループ (ad-hoc) | 学会・出張・イベント用の暫定メンバー枠。表紙画像 (ヒーロー風 64% 表示 + 斜めカット) + slug URL (`#/groups/avi2026`) / 自由投稿のフィード (memo / URL / 時刻) / 中で「ワリカ」「ルーレット」「点呼」「タイマー」「投票」「📸 レシート撮影」 「🤝 待ち合わせ」 を呼び出せる (グループメンバーのみが選択対象、 機能 ON/OFF も per-group 設定) / 終了グループは デフォ非表示 + 閉鎖後に 完全削除 |
| グループスケジュール | 日程 (開始〜終了日) を入れると 各日カードが並ぶ。 アイテム種別 (移動 / 宿泊 / 会議 / 食事 / 観光 / 他)、 時刻、 場所、 緯度経度 (📍 タップで Google Maps)、 メモ、 画像、 URL、 添付ファイル (PDF/画像/Office)、 ペアリンク (帯ストリップで連結表示)、 「行きたい場所ストック」 (日付未定の候補)。 編集モードで **ドラッグアンドドロップ並び替え** (日またぎ可) + 動かせない多日項目は 🔒 マーク。 画像付きアイテムは ヒーロー風 (左 64% + 斜めカット + ドラッグハンドル オーバーレイ) |
| 宿泊地 / 航空券エンティティ | スケジュールとは別管理。 場所 / 緯度経度 / チェックイン・アウト / 部屋番号 / 予約番号 / 座席 / 予約 URL を保持。 「📅 反映」 で schedule_items に展開 (宿泊は日付ごとに N 行、 航空券は出発 + 到着 のペア)。 同じエンティティから再 sync は冪等。 **航空券 e-ticket** は人ごとに QR 画像 (航空会社配布のもの) + 座席 + 予約番号 をアップロード保存 |
| グループ チャット | LINE 風吹き出し (自分=右 primary 色) で会話。 5 秒ポーリング (差分のみ)、 URL 自動リンク、 タブ裏なら停止 |
| 行く場所マップ | グループのスケジュール lat/lng を時系列順に結ぶ線マップ (`#/groups/:id/map`)。 Leaflet + OpenStreetMap (API key 不要)、 ピンに順番ラベル、 ポリラインで線結び |
| ワリカ (Splitwise 風) | グループ内で「誰が何を立て替えたか」を積み上げ、ネット残高と推奨送金を計算。各支出はメンバースナップショット保存 / 多通貨 + 自動 FX レート / レシート写真添付可 |
| 📸 レシート撮影 | グループ内で `<input capture="environment">` + GPS で即撮影。 内部的には「下書き状態のワリカ支出 (`is_draft=1`)」として保存され、後で金額 / 立替人 / 対象を埋めると自動で本物の支出に昇格 (移動中の精緻化を想定) |
| 飲み会割り勘 (nomikai) | 新歓・送別会用の一回精算。学年傾斜 + 飲酒 / ソフドリで割って通知 |
| 請求 (集金 / money_requests) | メンバーから集金。全員同額 or 人ごと指定、支払い方法 (現金 / PayPay / 銀行 / 立替) のチェック付き / ワリカの精算結果から bulk 生成も可 |
| ルーレット | タイトル + メンバー (学年 / 部屋単位 bulk select 可) + 任意の賞金、サーバ側 CSPRNG 抽選 → SVG 円盤 14s スピン → 停止後に当選者へ送金 + 全員通知 (`notified_at` で多重防止)。テストモード (dry-run) で空回し可 |
| どこ行くルーレット | 任意テキスト候補で回す軽量版 (`#/text-roulette`)。 サーバには何も保存しない 端末内ツール。 プリセット保存可 |
| ランダムグループ生成 | 選んだメンバーを N チームにランダム分け。学年 / 性別を「できるだけ均等」にする配慮オプション付き。結果は「このメンバーでグループ作成」から ad-hoc グループに実体化可能 |
| 投票・アンケート (polls) | 対象者 + 締切 + 選択肢を指定して投票を集める。 単複選択 / 自由記述 / 再投票可否 / 集計可視性 (creator / open / after_deadline) / 締切までのカウントダウン + 集計の自動更新 (60s, 残 10 分から 10s) / 未投票者催促 push / URL コピー |
| 点呼 (roll call) | 「いる？」 「起きてる？」 をワンタップで集める。 プリセット 3 種 (10/5/60 分) / 任意メモ / 残り時間で sync 間隔可変 / 起案者の「🏁 終了」 + 未応答者催促 |
| タイマー | 参加者全員に 同じカウントダウンを共有。 サーバが `started_at / ends_at` を持ち、 detail で `server_now` を返してクライアントがオフセット補正。 開始 30 秒 + 終了 30 秒前は 3 秒間隔再 sync、 中盤は 15 秒。 **中間ベル 3 + リピート N 回** 対応 (各ベル時刻に効果音、 終了で 自動 N 回 繰返し) |
| 🤝 待ち合わせ (meetups) | 集合時刻 + 場所 + メンバー で 24h 以内の 短期集合。 プリセット (30分後/1時間後/2時間後/3時間後) + datetime-local 任意。 詳細は 48px 大時計 + 1 秒刻みカウントダウン + 場所 Google Maps リンク。 場所に **緯度,経度** (例 `35.6586,139.7454`) を入れると Leaflet 小マップが表示される。 起案者が 取消・削除可。 募集の参加者から ワンクリック起動可能 |
| 🏷 オークション (auctions) | 出品 + 入札 (現在最高+1 以上)、 締切時刻に 最高額入札者が落札。 単位は **円** (LabPay pt は動かない、 本人同士で 外で支払い)。 落札後は 出品者の詳細画面に **「💸 落札者に請求を飛ばす」** ボタンが出る → ワンタップで 請求機能 (money_requests) を生成 + 落札者に通知。 連絡先は ラボ内 既知 前提なので 表示しない。 取消 / 14 日以内の締切。 lazy settle (API アクセス時に自動確定) |
| 🏃 運動 (exercise / 歩数) | ポケットに入れて「開始」 → 歩く / 階段、 DeviceMotion で歩数カウント (iOS 13+ は明示許可)。 加速度 magnitude → 9.8 (重力) 引いて純振動 → 閾値 2.0 m/s² + hysteresis + 250ms debounce。 1 セッション 30 分まで、 6 歩/秒超は弾く。 ラボ内ランキング (今週合計) 付き |
| 🔊 効果音 (sounds) | 決済 (送金 / 購入) と ルーレット回転開始時 に効果音。 Admin が 音源 mp3/ogg/wav (2MB まで) を `#/admin/sounds` から upload、 各 event の規定値を設定。 ユーザは 設定で 「規定値を使う / 自分で選ぶ / 無音」 を上書き可能 |
| 重要連絡 / 学会情報 (notices) | カテゴリ別 (`important` / `conference`) のピン留め可能リスト。 全員が投稿可、 投稿者 / admin が編集 / 削除。 シンプルに タイトル + 本文 + URL |
| 連絡先 (contacts) | ラボメンバーの緊急連絡用電話番号 (`#/contacts`)。 学年順一覧、 `tel:` リンクでタップ通話。 自分の番号は設定から登録。 行タップで `/#/users/:id` 公開プロフィールへ遷移 |
| 公開プロフィール (`/#/users/:id`) | アバター + 表示名 + 学年 + 趣味 + 推し + Scrapbox。 全 human user 同士で 閲覧可。 自分の設定は 設定 → プロフィール |
| これ欲しい (Wishlist) | 商品名 + 任意 JAN + メモでリクエスト掲示、誰でも閲覧可・誰でも「出ました!」で達成扱い |
| Scrapbox 履歴 | `#scrapbox` の研究ノート編集を「誰が・いつ・どの page を」読みやすくまとめて表示 (read-only feed) |
| 関係グラフ | 売買 / タスク / 統合の 3 タブ。d3 v7 force-directed、アバター node + 件数 or 総額ベースのエッジ太さ切替 |
| 💬 らぼったー (posts / SNS) | シンプル な つぶやき (テキスト + 画像 + 位置 + @メンション + 返信 + 👍 ❤️ ⭐ リアクション 3 種)。 フォロー なし — 全員 の 投稿 が 見える。 画像 EXIF GPS から 位置 を 自動取得、 返信スレッド、 投稿者 / admin のみ削除可、 検索 (本文 / 投稿者) |
| 🍴 食べある記 (places) | お店 (住所 / 緯度経度 / 紹介文 / カテゴリ) を ラボメンバー で 共有。 タイル一覧 + Leaflet 地図ビュー (表示中エリア絞り込み + カテゴリフィルタ) + ⭐評価 / ❤️ いいね / 口コミ + 写真 + tabelog URL 自動取得 + **Google Maps の保存リスト KML / GeoJSON インポート** (重複スキップ) |
| 🎵 プレイリスト (playlists) | YouTube / Spotify URL を まとめて 紹介。 ⭐ 1-5 評価 + コメント + ❤️ お気に入り + ジャンル + シャッフル 再生 + 公開 / 限定公開 |
| 🤖 AI 対話 / 翻訳 / 操作ガイド (chat) | 汎用 多言語 チャット (中国語・イタリア語・英語など)。 海外出張での 翻訳・会話 補助。 「操作ガイド AI」 は LabPay の使い方を聞ける チャット (操作手順 で 答える) |
| 🌐 画像 和訳 (translate) | 写真 (メニュー / 看板 / 説明文) を アップロード → AI で 日本語に 翻訳。 出張 / 旅行 で 便利。 履歴あり |
| 📝 自分の TODO (todos) | やる こと メモ。 サーバ 保存 で 端末間 共有。 締切 (color-coded で 残時間表示) + URL + 相手 + 詳細メモ。 完了 と 未完了 を 分けて 表示。 ホームに 直近 締切 ハイライト |
| ⏱ ストップウォッチ (stopwatches) | メンバー共有の カウントアップ計測器 (ms 精度)。 開始 / 一時停止 / リセット / ラップ 全員操作可。 発表時間 や 雑談計測 用 |
| 📋 順番決め (orderings) | メンバーを 1 列に並べ替え (発表順 / 当番 など)。 CSPRNG + 1 人ずつめくる演出。 結果は全員通知 + テキストコピー (Scrapbox 貼付け 用) |
| 🎲 ランダムグループ (random-groups) | N チームに均等分け (学年 / 性別 配慮可)。 分けた瞬間に全員自動通知 + テキストコピー + そのまま ad-hoc グループ実体化 |
| 🔎 Deep Research (deep-research) | ChatGPT の Deep Research を 真似た 多段 Web 調査 (v781〜)。 OpenAI Responses API + web_search ツール で Web を 横断 検索 → サブ 問い 分解 → セクション別 調査 → 全体 まとめ + 重要 発見 + 出典 URL 一覧 を 構造化 JSON で 返す。 深さ 3 段階 (軽い gpt-5-mini 20pt / 標準 gpt-5 50pt / 深い gpt-5 高 reasoning 100pt)、 background mode + ポーリング で 長時間 ジョブ を 安全 に。 公開 + キーワード 検索 + 履歴 削除 + 完了 通知 込み |
| 📑 論文要約 (paper-summary) | 論文 PDF を upload → 章立て 要約 + RQ / 仮説 / 主張 する 貢献 / 自前 実験 + 結果 / 引用 研究 / 押さえて おく べき 参考文献 / 落合 メソッド / 図表 (ページ 画像 + 視覚要素 説明) を 構造化 JSON で 抽出。 モデル 選択 (gpt-4.1=20 / gpt-5-mini=30 / gpt-5=50 デフォルト / o1=80pt)、 2 段階 (推論 モデル で 詳細 抽出 → gpt-4.1 で 日本語 を 自然 に 校正)、 公開 / キーワード 検索 / いいね・ブックマーク・コメント / 失敗 row 再 実施 ボタン |
| 📑 論文全訳 (paper-translate-full) | 章 ごと の フル 翻訳 + 2-3 文 サンプル を back-translation して 整合 確認 + 用語 統一 と 全体 ポリッシュ。 方向 切替 で 英→日 (gpt-5-mini=30 / gpt-5=50 / o1=80pt) と 日→英 (5x、 em-dash 等 GPT-isms 除去 込み) 両 対応。 OpenAI Responses API + background mode。 公開 / 検索 / コメント / 同 PDF の 要約 へ の クロス リンク (pdf_sha256) / 失敗 row 再 実施 ボタン |
| 📄 論文査読 (paper-review) | 論文 PDF を upload → OpenAI Files API + chat.completions で 章立て要約 + 査読 (10pt 〜、 モデル 選択 可、 非同期 + share_token + プロンプト編集 + 共有対象通知)。 + 任意 で 回答文 (rebuttal) を 渡す と 「査読 指摘 を 回答 が カバー できて いる か / 安直 な N 増 で 流して いない か / 主張 弱い 箇所 / 書き換え 提案」 まで 評価。 アップロード PDF + 回答 PDF を サーバ に 保存 して 結果 ページ から 開ける |
| 📝 原稿チェック (resume-check) | 1-2 ページの 短原稿 を PDF アップロードで チェック (5pt 〜、 モデル 選択 可)。 6項目スコア (背景 / 論理 / 専門用語 / 接続詞 / 表記揺れ / 引用) + リライト案 + 著者コメント。 失敗時 自動返金 |
| ✂️ 文字数 / 単語数 リライター (rewriter) | アブスト / リバッタル の 文字数・単語数制限と戦う (1pt)。 サーバ側で 正確カウント + 超過時は GPT に再依頼 (最大 3 回)。 英文は 元と書き直しを 和訳。 単語レベル diff で 色付き表示 |
| 🀄 麻雀 (mahjong) | 4 人で 50pt 賭けの 本格麻雀 (門前 / 鳴き / 役判定 / 連荘 / 半荘 / 点数計算)。 AI 3 体との 練習対戦も (ポイント授受なし) |
| 🃏 大富豪 (daifugo) | 2-4 人、 単出し / ペア / N 枚出し + ジョーカーワイルド + 革命 (4 枚同時) + 8 切り。 1pt の プレイフィー (1 位もポイント貰わず純粋に遊ぶ) |
| 💣 地雷オセロ (othello) | 通常オセロ + 各自 1 か所 地雷 (踏むと 周囲 3x3 反転)。 1pt の プレイフィー (引分のみ双方返金) |
| 🎲 ito | 2 人以上で 1-100 の数字 + お題に沿った表現 → 全員の数字を開示する 協力ゲーム |
| 🐺 人狼 (jinrou) | 4-16 人、 役職配布 (村人 / 人狼 / 占い師 / 騎士)、 夜 (襲撃 + 占い + 護衛) → 昼 (投票で 追放) |
| 🎨 絵しりとり (shiritori) | タイムリミット 30 秒固定 キャンバスで 順番に絵を描く。 ストローク記録 + 自分のラベル + 前の人の予想 |
| 🎯 ティア表 (tierlists) | お題 + 候補リスト で みんなで S/A/B/C/D 5 段階の ティア分け。 正方形画像を 候補ごとに 設定可能 |
| 🏆 優勝予想 (predictions) | W 杯 / スポーツ大会 / 学会 best paper など 順位を予想 (1 位のみ / 1-2 位 / 1-4 位)。 完全的中で 山分け + 場代 5%。 起案時に通知対象 指定可。 締切後 すぐ予想公開 + ライブ カウントダウン |
| 🎯 勝敗予測 (score-predictions) | 試合 (X 対 Y) のスコアを 当てる (例: 3-2)。 完全的中で 山分け + 場代 5%、 誰も当たらなければ 全員返金。 基本 20pt / 10-100pt 設定可 |
| ⭕❌ マルバツ + 🎮 自作ゲーム (custom-games) | 3x3 マルバツ を サンプル に、 各ユーザが 設定 → 🎮 自作ゲーム 管理 から 自前の 2 人対戦 JS を アップロード で 登録できる framework。 JS は DB に格納 + `/api/custom-games/kinds/:kind/script.js` で 配信、 サーバの 書き込み権限不要。 課金は **場代** モデル: 両者が join 成立時に fee pt 払い、 提供者 (kind 登録者) に 90% / SYSTEM に 10% 分配。 起案 / 移動 / 終了 では 課金なし。 fee=0 で 無料ゲームも可。 アップロード可能な サンプル: [examples/custom-games/connect_four.js](examples/custom-games/connect_four.js) (🟦 四目並べ)。 詳細 → [docs/CUSTOM_GAMES.md](docs/CUSTOM_GAMES.md) |
| 🎰 ビンゴ (bingo) | 毎週 5x5 カードが 自動生成 (日曜〜土曜)、 平日 (月-金) の 行動 (ラボイン / オープナー / らぼったー投稿 / 麻雀 / オセロ / 食べある記 / 占い / 投票 等 28 種) を 自動カウント。 リーチ / BINGO 演出 + 達成早 + ライン数 で 週次 リーダーボード。 残高横に 5x5 ミニ盤 サマリ表示 |
| 📝 フリップクイズ (quizzes) | 出題者 が 問題 を 出す (テキスト / 口頭 モード) → 参加者 は フリップ に 記述 回答 → 一斉 開示 (タップ で 拡大) → 出題者 が ⭕❌ 採点 → ランキング 自動 集計。 連続 出題 + 終了 で 全 履歴 振り返り |
| ⚾ ドラフト (drafts) | プロ野球 風 順番 指名 + くじ抽選。 候補 は 人 or 自由 入力。 picking → reveal → lottery → 確定 → 次 round の state machine。 競合 は くじ で 決着、 ハズレ は 同 round 内 で 再 指名 |
| 💼 アルバイト 申請 (bait) | 実験 協力 等 で 学生 に アルバイト を 依頼。 時間 (小数) + 対象者 を 指定 して 送る と、 受け取った 側 は 月別 で 全部 見えて 処理 済 マーク。 依頼者 は 進捗 確認 + 未処理者 催促 可。 タスク と 似て いる が 「自分 が 関わった もの が 月別 で 全部 見える」 が ポイント |
| 🏅 実績 称号 (achievements_title) | 獲得 した 実績 一覧 を 元 に AI が 「カッコイイ 称号」 を 1 行 生成 (例: 「黄昏 の 点呼 マスター 🌅」)。 実績 が 増える と 自動 で 「stale」 に なって 再 生成 可能 |
| 🧩 自作 ウィジェット (custom_widgets) | 自分専用 の ウィジェット を 登録 して ホーム に 表示。 JS で `meta` + `render(root)` を 書く だけ。 サンプル 同梱 (🕐 時計 / 💰 残高)。 1 秒 〜 任意 秒 で 自動 リフレッシュ。 詳細 → [docs/CUSTOM_WIDGETS.md](docs/CUSTOM_WIDGETS.md) |
| ✈️ フライト応援 (flight) | 長いフライトの 進捗 (%) / 残り時間 / 経過時間 を 大きく可視化 (機内・ オフライン)。 Wake Lock で 画面維持 + 1 分ごと 応援メッセージローテ |
| 🚶 散歩モード (walk-mode) | 全画面マップ + Wake Lock + GPS 5 秒 polling で 軌跡 polyline 記録 → SNS 投稿可能 (Canvas で 1024px PNG 生成)。 ↑→↓→↑ 特殊スワイプロック。 過去軌跡 重ね合わせ表示 |
| 💪 筋トレ (workouts) | 腕立て / 腹筋 / プランク等 を 1 タップ記録 + mutual follow で 仲間と 比較 |
| ⚖️ 体重 / BMI (health) | 体重 / 身長 / 体脂肪 を 記録、 BMI 自動計算 + やせ / 標準 / 肥満 分類 + 折れ線グラフ (個人ツール) |
| 🗺 制覇マップ (regions) | 行った国 (UN 加盟 193 + 主要地域 = 201) + 都道府県 (47) を タップで登録。 進捗バー + ラボ内集計 |
| 🔮 1 日 1 回 占い (fortune) | 30 種の運勢 (大吉 / 中吉 / 小吉 / 末吉 / 凶 + ジョーク系)、 1 日 1 引き 固定。 ホーム残高エリアの 🔮 アイコンで 表示切替 |
| 🎂 誕生日 (birthday_md) | 設定 → プロフィールで MM-DD + 西暦任意 を登録。 当日のみ ホームに 🎂 バナー表示 (年齢付き可) |
| 📝 研究 ノート (Cosense / research-notes) | nkmr-lab Cosense の 「YYYY.MM_研究ノート_<handle>」 ページ を 直接 ロード し、 今日 / 昨日 の 日付 セクション を 抽出 表示。 書く 時 は Cosense を 開いて 編集。 ユーザ ごとに 自分 の PAT (Personal Access Token) を 設定 → 自分 の 編集 履歴 が 反映 (admin 限定 だった cookie 方式 から ユーザ ごと PAT に 変更 で 安定 化) |
| 🎥 ゼミ 動画 (zemi-videos) | YouTube の 限定公開 ゼミ 動画 を タイトル / 説明 で キーワード 検索 + その場 で 視聴。 誰でも 動画 URL + タイトル + 説明 を 登録 可。 重複 防止 + YT API で タイトル / 再生 時間 を 自動 補完 |
| 🏁 制覇 リスト (conquest) | 街 の パン屋、 ラーメン屋、 温泉地 など、 自分 だけ の 制覇 対象 リスト を 作って、 達成 したら チェック。 公開 すれば みんな で アイテム を 育てられる |
| 📓 Habit Tracker (habits) | 毎日 論文 を 読む / 早起き / 運動 など 自分 の 習慣 を 登録 して、 日 毎 ✓ で 積み上げ。 連続記録 (streak) と 60 日 カレンダー で 可視化。 公開 すれば ラボ メン 全員 が 達成 状況 を 見られる |
| ⚡ 早押し クイズ (buzzer) | リアル現場 (ゼミ / 飲み会 等) で クイズ を 出題 → 参加者 が スマホ で 早押し。 タップ し た 順 で 順位 が 決まり、 1 位 は 緑 で 回答権、 他 は 赤 + 1 位 と の 差 が ms で 表示。 800ms ポーリング で 順位 リアル タイム |
| 📝 Overleaf 更新状況 (overleaf) | 教員 アカウント で 共有 されてる 全 Overleaf プロジェクト の 文字数 推移 を ラボ メン 全員 で 可視化。 24h / 7d 差分 + sparkline、 複数 プロジェクト の 推移 比較 グラフ、 60 日 履歴、 ファイル 別 内訳。 メイン .tex (`\documentclass` で 検出) のみ 集計 で サンプル / 過去 ファイル を 除外。 絞り込み プリセット (ResearchProgressReport / MasterThesis2026 / BachelorThesis2026) + URL slug (`?filter=...&mode=chart`) で 共有 可能。 1か月 以上 更新 なし は グラフ から 除外 し て 一覧 で 折りたたみ。 hover ツールチップ で 名前 + 値 + 日付。 v896 で 「変更 が 無い プロジェクト は .tex DL を スキップ」 最適化 (250 件 中 ~5 件 だけ 実 DL) |

### ラボ活動の可視化

| 領域 | 内容 |
|---|---|
| ラボイン (来室) | ラボ Wi-Fi で自動検知 → 1日1回ボーナス。連続日数で base に最大 +10 上乗せ。`base + min(cap, max(0, streak-1)) * per_day / divisor` 式で全パラメータ admin 編集可。MAC 未登録ユーザにはホームでオンボーディング誘導 |
| 連続ラボイン streak | 祝日・休業日カレンダー対応。来た日は曜日問わず連続日数が進む。来なくても祝日 / 週末はマイナスしない。平日 (workday) を逃した分だけ `streak_decay_per_missed_workday` (デフォルト 5) で減衰 |
| 在室検知 | scanner 経由で部屋単位の MAC 観測 → アバター付きで「今ラボにいる人」表示。直近 30 秒以内は太字フルカラー、それ以降は徐々にグレースケール化、`presence_window_minutes` を超えると消える。閉じたセッションは `presence_sessions` に記録、CSV ログにも追記 |
| ラボ活動マップ | 部屋 × 曜日 × 時間の在室人数ヒートマップ (`#/activity`)。ログが蓄積されるほど長期間のパターン (1週間 → 1年) が選べる |
| 草 (GitHub 風) | ホームに本年度 (4/1 起点) の日次滞在時間グリッド |
| 今日の予定 (Google Calendar) | 各ユーザの Google Calendar (`calendar.readonly`) と incremental authorization で連携。複数カレンダー選択可 / 個人ルール (正規表現含む) で非表示にできるイベントを設定可 / **ETag + localStorage 5 分 TTL** でクライアント側キャッシュし、Google API 呼出を抑制 |
| 実績 | **15 カテゴリ × 4 段階** のメダル。 段位名は category 別の 極端化 された 名前 (例: `お試し気分` → `ラボの常連` → `住んでる人` → `ラボに生まれた説` / `たまの夜更かし` → `夜のラボ住民` → `闇属性` → `夜の支配者`)。 ラボイン日数 / 連続記録 / 販売 / 購入 / 取扱高 / タスク完了 / Scrapbox 寄稿日数 / ルーレット主催・当選 / **夜間ラボ族 (23:00-25:00)** / **早起き (7:00-8:30 で 泊まりでない)** / **オープナー (最初に入る)** / **クローザー (最後に出る)** |
| Scrapbox 寄稿ボーナス | Slack の `#scrapbox` 通知を読んで `author_name` ごとに集計 → 申告 handle 経由で LabPay user に配布 (日次 23:59 JST cron)。任意編集 5pt + 自身の研究ノート編集で +5pt (= 最大 10pt/日) |

### 横断機能

| 領域 | 内容 |
|---|---|
| バグ報告 / 機能要望 | 設定から送信、admin の通知 + Slack に転送。admin から返信を打てて、投稿者には通知が飛ぶ |
| 利用ログ | 全 API リクエストを `activity_log` に記録 (user / method / path / status / duration / ip / UA) — 将来の論文用 |
| 通知 | アプリ内通知 + (任意) メール + Slack incoming webhook。未読は太い橙ボーダー + 黄背景で強調、 「未読に戻す」 で取り消し可。 残高・履歴・通知数はホームで 30 秒間隔ポーリング |
| ホームの 未対応 / 依頼中 カード | 自分が応答すべきもの (`#/api/me/pending`: 未投票 polls / 未応答 rollcalls / 未払い money_requests) と、 自分が起案して未完了のもの (`#/api/me/asking`) をホームに集約。 通知を既読にしても消えない、 締切色 (赤=10 分未満 / 橙=1 時間未満) |
| 性別フラグ | 'M' / 'F' / 'X' / NULL。新歓ワリカン振り分けやランダムグループの「できるだけ均等」配慮で使用。プロフィール非表示可 |
| 管理機能 | 取引一覧から取消 / ポイント発行 (全員配布 or 個人指定) / 流通量サマリ (Admin vs 一般保有) / カレンダー編集 / 部屋登録 (scanner_token 発行) / 配信 / 設定ノブ編集 / feedback 返信 |
| PWA | オフライン shell / ホーム画面追加 / インストール可 / Service Worker は `/api/*` を絶対にキャッシュしない (台帳整合性) |
| 体感速度の最適化 | (a) HTTP/2 + Brotli/gzip 圧縮で 並列 fetch 上限解除 + JS / CSS を 1/4 程度に圧縮、 (b) Service Worker shell SWR で 起動時の白画面を最小化、 (c) ホームウィジェットを Promise.all で並列実行 + 残高 / 連続 / 実績 / チェックイン を localStorage SWR キャッシュ、 (d) hidden カードはレンダー + polling を skip、 (e) `<img loading="lazy"> + content-visibility:auto` で 折り畳まれたカードの画像を遅延ロード、 (f) サーバ側で `image_thumb_url` (320px 実在チェック済み) を返してクライアントは サムネ優先 fallback、 (g) router dispatch debounce で renderHome 二重実行抑止、 (h) 通知一覧は 20 件ずつカーソル pagination + 「さらに読み込み」 |

---

## ディレクトリ構成

```
LabPay/
├── public/                  ← Apache DocumentRoot
│   ├── index.html           ← SPA shell
│   ├── api/index.php        ← フロントコントローラ (全 API 入口、dispatch table)
│   ├── manifest.webmanifest, sw.js
│   ├── css/style.css
│   ├── img/                 ← PWA アイコン
│   ├── privacy.html         ← Google OAuth 審査用プライバシーポリシー
│   ├── js/
│   │   ├── app.js              ← 起動 + ルータ + 認証
│   │   ├── router.js, api.js, scan.js
│   │   ├── labels.js           ← LEDGER_TYPE_LABEL の単一定義 (home/history/admin が共有)
│   │   ├── upload.js           ← uploadImage / uploadTaskAttachment ヘルパ
│   │   ├── format.js           ← 共有: fmtDate / fmtDateTime / fmtTime / fmtRelative / fmtLocalInput / tag(kind,label) / participantPill / participantChip / participantChipRow
│   │   ├── member_picker.js    ← 共有: createMemberPicker() — 全員/学年/性別 bulk + 個別 chip + 選択数
│   │   ├── modal.js            ← 共有: openModal({title,bodyHtml,buttons}) / confirmModal()
│   │   ├── image_picker.js     ← 共有: setupImagePicker(prefix) — file + url + preview + status を自動配線
│   │   ├── sounds.js           ← playSound(eventKey) / preloadSounds() — 決済 / ルーレット の効果音
│   │   ├── audio_unlock.js     ← iOS Safari の AudioContext を 初回タップで unlock (sounds に必要)
│   │   ├── settings_sync.js    ← 個人設定 (user_settings KV) を サーバと同期
│   │   ├── gmap_import.js      ← 共有: Google Maps の保存リスト (KML / GeoJSON) パーサ + 重複判定 (places と groups schedule の両方で使う)
│   │   └── views/              ← ページ毎の renderer
│   │       ├── home.js, buy.js, sell.js, product.js
│   │       ├── tasks.js, transfer.js, history.js
│   │       ├── achievements.js, network.js, activity.js
│   │       ├── notifications.js, settings.js, admin.js, login.js
│   │       ├── invitations.js, roulette.js, text_roulette.js, wishlist.js
│   │       ├── apps.js              ← 小道具ハブ + APPS export + isAppVisible
│   │       ├── groups.js            ← ad-hoc グループ + スケジュール DnD + ヒーロー風 list
│   │       ├── group_map.js         ← Leaflet で行く場所マップ
│   │       ├── wari.js              ← ワリカ (Splitwise 風)
│   │       ├── nomikai.js           ← 飲み会割り勘
│   │       ├── money_requests.js    ← 請求 (集金)
│   │       ├── random_groups.js     ← ランダム N チーム分け
│   │       ├── scrapbox_feed.js     ← Scrapbox 履歴 read-only feed
│   │       ├── feedback_admin.js    ← 報告・要望 admin UI
│   │       ├── feedback_user.js     ← 機能要望 / バグ報告 単独ページ
│   │       ├── polls.js             ← 投票・アンケート
│   │       ├── rollcalls.js         ← 点呼
│   │       ├── timers.js            ← 共有タイマー + ベル + リピート
│   │       ├── meetups.js           ← 待ち合わせ (短期集合)
│   │       ├── auctions.js          ← オークション (落札後は本人同士)
│   │       ├── exercise.js          ← 運動 / 歩数 (DeviceMotion)
│   │       ├── notices.js           ← 重要連絡 / 学会情報
│   │       ├── contacts.js          ← 連絡先
│   │       ├── profile.js           ← /#/users/:id 公開プロフィール
│   │       ├── requests_hub.js      ← 依頼 (タスク + 募集 + 投票) ハブ
│   │       ├── admin_sounds.js      ← 効果音 規定値 (admin)
│   │       ├── posts.js             ← 💬 らぼったー (シンプル SNS: テキスト + 画像 + 位置 + @ + リアクション)
│   │       ├── places.js            ← 🍴 食べある記 (お店 + 口コミ + Leaflet 地図 + Google Maps インポート)
│   │       ├── playlists.js         ← 🎵 プレイリスト (YouTube/Spotify + ⭐ 評価)
│   │       ├── stopwatches.js       ← ⏱ ストップウォッチ (ms 精度 + ラップ)
│   │       ├── todos.js             ← 📝 個人 TODO (締切 + URL + 相手 + 詳細)
│   │       ├── translate.js         ← 🌐 画像 和訳 (AI)
│   │       ├── chat.js              ← 💬 AI 対話 / 翻訳
│   │       └── help.js              ← 🤖 操作ガイド AI
│   ├── vendor/              ← ZXing (バーコード / QR) + d3 (関係グラフ)
│   └── uploads/             ← ユーザアップロード (gitignore)
│       ├── products/        ← 商品画像・アバター
│       ├── tasks/{task_id}/ ← タスク添付ファイル
│       └── .htaccess        ← PHP 実行不可化 (多段防御)
├── src/                     ← PHP (DocumentRoot 外)
│   ├── bootstrap.php        ← config 読込・PDO 生成・ヘルパ (save_uploaded_file / slack_notify / notify_safely / slack_api_get / activity_log_write / fx_rate_to_jpy / db_tx)
│   ├── Db.php, Ledger.php, Money.php, Auth.php
│   ├── Calendar.php         ← 祝日 / workday ヘルパ
│   ├── GoogleCalendar.php   ← /me/calendar/events 用 OAuth クライアント + ETag 対応
│   ├── Labels.php           ← サーバ側ラベル定数
│   ├── Notifier.php, ProductInfo.php, Achievements.php
│   └── handlers/            ← /api/* の各リソース
│       ├── auth.php, me.php, products.php
│       ├── listings.php, purchases.php, sellers.php
│       ├── tasks.php, transfers.php
│       ├── checkins.php, presence.php
│       ├── notifications.php, network.php
│       ├── uploads.php, admin.php
│       ├── feedback.php, wishlist.php
│       ├── invitations.php, roulettes.php
│       ├── nomikai.php, money_requests.php
│       ├── adhoc_groups.php    ← グループ + ワリカ + レシート (draft 支出) + フィード + スケジュール + 宿泊 + 航空券 + e-ticket
│       ├── random_groups.php
│       ├── scrapbox_feed.php
│       ├── fx.php              ← 為替レート (ワリカ多通貨)
│       ├── polls.php           ← 投票・アンケート
│       ├── rollcalls.php       ← 点呼
│       ├── timers.php          ← 共有タイマー (+ベル, リピート)
│       ├── notices.php         ← 重要連絡 / 学会情報
│       ├── meetups.php         ← 待ち合わせ
│       ├── auctions.php        ← オークション (lazy settle)
│       ├── exercise.php        ← 運動 / 歩数 セッション + ランキング
│       └── sounds.php          ← 効果音 clips / defaults / 各ユーザ override
├── config/
│   ├── config.sample.php    ← 設定テンプレ
│   └── config.php           ← 実設定 (gitignore — シークレットを含む)
├── migrations/              ← 001…050 順に流す
├── bin/
│   ├── scanner.py           ← 部屋常駐スキャナ
│   ├── scanner.config.json  ← scanner 設定 (gitignore)
│   ├── scanner.config.sample.json
│   ├── scanner_run.bat      ← Windows タスクスケジューラ用 wrapper
│   ├── install_scanner.ps1  ← Windows 一発セットアップ
│   ├── install_scanner.sh   ← Linux/Mac 一発セットアップ
│   ├── scrapbox_slack_sync.php  ← Scrapbox-via-Slack 集計 (日次 cron)
│   ├── run_migration.php    ← マイグレーション適用 (app config 共用)
│   ├── backup.sh            ← mysqldump バックアップ
│   └── make_icons.py        ← PWA アイコン生成 (Pillow)
├── scripts/                 ← その他バックエンド スクリプト
│   └── overleaf_collector.py ← 📝 Overleaf 更新状況 collector (systemd timer から 1h おき 起動、 venv + pyoverleaf + cookie 必要)
└── docs/
    ├── INSTALL.md           ← 本番サーバ導入手順 (学生向け)
    ├── HACKATHON.md         ← LabPay API でハック作る人向け
    └── api.md               ← API エンドポイントリファレンス
```

技術スタック:

- **OS**: Rocky Linux 10 (本番想定)
- **HTTP**: Apache 2.4 + mod_rewrite + PHP-FPM、 **HTTP/2 (h2 via ALPN)** + **mod_brotli / mod_deflate 圧縮** 有効
- **DB**: MariaDB 10.11 (InnoDB)
- **言語**: PHP 8.3 + PDO
- **フロント**: ES Modules + 素 CSS、ベンダはローカル配置の ZXing と d3 v7 + Leaflet
- **認証**: Google OAuth + dev login (Cookie session) / Google Calendar も incremental authorization で同じ OAuth を再利用
- **HTTPS**: Let's Encrypt (certbot)
- **Slack**: incoming webhook (送信) + Bot Token (`conversations.history` 取得)
- **HTTP cache**: Google Calendar 連携は ETag + localStorage 5 分 TTL でクライアント側 revalidate
- **PWA / SW**: shell は stale-while-revalidate (前回キャッシュ即返し + 裏で再取得)、 `/api/*` の content cache は groups / places / posts / notices / scrapbox / me / users だけ SWR、 ledger 系 (送金 / 残高) は毎回ネット。 install 時に index.html / css / app.js / router.js / login.js / home.js を precache

---

## ドキュメント

| 文書 | 用途 |
|---|---|
| **[docs/INSTALL.md](docs/INSTALL.md)** | サーバへの導入を最初から最後まで。学生が読んでセットアップできることを目標にしています |
| **[docs/HACKATHON.md](docs/HACKATHON.md)** | LabPay の API を使って何か作る人向け。認証フロー・主要エンドポイント・サンプルクライアント |
| **[docs/api.md](docs/api.md)** | 全エンドポイントの簡易リファレンス |
| **[docs/CUSTOM_WIDGETS.md](docs/CUSTOM_WIDGETS.md)** | 🧩 自作 ウィジェット 開発 ガイド (= ホーム に 自分専用 widget を JS で 書ける) |
| **[docs/CUSTOM_GAMES.md](docs/CUSTOM_GAMES.md)** | 🎮 自作 ゲーム v1 framework (現行 動作中。 ⭕❌ / ニム / ライツアウト / すごろく) |
| **[docs/CUSTOM_GAMES_V2.md](docs/CUSTOM_GAMES_V2.md)** | 🎮 自作 ゲーム v2 framework cg2 (p5.js + sharedValues 自動 同期、 准 リアルタイム。 サンプル 4 件 同梱) |
| **[docs/GRANTS_DESIGN.md](docs/GRANTS_DESIGN.md)** | 研究費 執行 管理 設計 案 (保留 中) |
| **[samples/](samples/)** | API を叩く短い Python サンプル集 (在室一覧 / 商品一覧 / タスク一覧 / 送金 など、 1 ファイル 1 目的) |
| **[examples/custom-games/](examples/custom-games/)** | v1 自作 ゲーム JS サンプル (アップロード 用 ニム / ライツアウト / すごろく / 四目並べ) |
| **[bin/README.md](bin/README.md)** | Scanner のセットアップ詳細 (Windows/Linux/Mac) |

---

## ローカル開発クイックスタート

PHP 8.x と MariaDB/MySQL が手元にあれば動きます。

```bash
git clone https://github.com/nkmr-lab/LabPay.git
cd LabPay

# DB
mysql -u root -p -e "CREATE DATABASE labpay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'labpay'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';"
mysql -u root -p -e "GRANT ALL ON labpay.* TO 'labpay'@'127.0.0.1';"

# 設定
cp config/config.sample.php config/config.php
$EDITOR config/config.php   # db.pass, app.base_url, auth.bootstrap_admin_email を埋める

# マイグレーション (順番に)
for f in migrations/*.sql; do
  php bin/run_migration.php "$f"
done

# ZXing と d3 (バーコード読取・関係グラフ)
mkdir -p public/vendor
curl -sL -o public/vendor/zxing.min.js https://unpkg.com/@zxing/library@latest/umd/index.min.js
curl -sL -o public/vendor/d3.min.js     https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js

# 起動 (開発用 PHP ビルトインサーバ)
php -S 127.0.0.1:8080 -t public public/api/index.php
# → http://127.0.0.1:8080/ にアクセス
```

> ビルトインサーバには `.htaccess` の rewrite が無いので `public/api/index.php` をルータとして渡しています。ブラウザのカメラ機能 (バーコード読取・📸 レシート撮影) は HTTPS 必須なので、本格テストは本番デプロイか `mkcert` で TLS を張ってください。

---

## 設定リファレンス (`config/config.php`)

**シークレットを含むので git には絶対 commit しない** (`.gitignore` 対象)。

| キー | 用途 |
|---|---|
| `db.dsn / user / pass` | MariaDB 接続情報 |
| `app.base_url` | 公開 URL (末尾 `/` なし)。OAuth redirect の組立に使う |
| `app.cookie_secure` | 本番は `true`、HTTPS 前提 |
| `app.timezone` | デフォルト `Asia/Tokyo` |
| `auth.google_oauth_enabled` | Google OAuth を使うか |
| `auth.google_client_id / client_secret` | Google Cloud Console で発行。Calendar API も有効化しておく (今日の予定用) |
| `auth.dev_login_enabled` | 許可リスト email を選ぶだけでログイン。**本番は false** |
| `auth.bootstrap_admin_email` | 起動時に許可リストへ admin として自動登録される |
| `mail.enabled` | 通知メール (`mail()` 経由) を送るか |
| `rakuten.application_id / access_key` | 楽天 Ichiba 商品検索 API (任意。空なら手動入力フロー) |
| `slack.webhook_url` | 入荷・新規タスク等の Slack 通知 (incoming webhook) |
| `slack.bot_token` | `xoxb-…` — `#scrapbox` 読み取り用 Bot Token |
| `slack.scrapbox_channel_id` | `Cxxxx…` — Scrapbox 通知が流れるチャンネル ID |
| `exposure.*` | 各機能の有効化トグル (`public_read`, `listings_write`, `purchase`) |

**DB 上のランタイム設定** (admin UI から変更可) は `config` テーブル:

| キー | デフォルト | 意味 |
|---|---|---|
| `fee_rate` | 0.05 | 取引手数料率 (売り手負担、floor) |
| `initial_points` | 500 | 初回ログイン時の付与額 |
| `checkin_base` | 10 | ラボイン 1 回の基本ポイント |
| `streak_bonus_per_day` | 1 | streak ボーナスの 1日あたり単位 |
| `streak_bonus_cap` | 10 | streak ボーナス計算の上限 |
| `streak_bonus_divisor` | 1 | `points = base + floor(min(cap, max(0, streak-1)) * per_day / divisor)` |
| `streak_weekday_only` | 0 | 0=祝日 / 週末でも来れば streak が進む (現行) |
| `streak_decay_per_missed_workday` | 5 | 連続が途切れた時の減衰量 (workday を逃した時のみ) |
| `presence_window_minutes` | 3 | 在室判定の有効分 |
| `scrapbox_any_edit_pt` | 5 | その日に 1 件以上 Scrapbox を編集していれば +5 |
| `scrapbox_own_note_pt` | 5 | さらに自分の研究ノート page を編集していれば +5 |
| `scrapbox_start_date` | `2026-06-01` | この日付以降のみ Scrapbox 集計対象 |

> 旧 `scrapbox_base_pt / pt_per_extra / bonus_cap` は migration 025 で any-edit + own-note 方式に切り替わって以降は参照されない (互換のため row は残置)。

---

## 経済仕様

- 1pt ≒ 1円相当 / **正の整数のみ** (小数なし)
- 手数料: 5% (売り手負担・floor)。20pt 未満の取引は手数料 0
- ポイント発行は **SYSTEM 口座のみ** (初期配布・ラボインボーナス・タスク報酬・Scrapbox 寄稿ボーナス・admin 配布)
- 初期付与: 500pt
- ラボイン: `10 + min(10, max(0, streak-1))` → **10〜20 pt** / 1日1回 (11 日連続で天井)
  - 祝日・週末に来ても streak は進む / 来なくてもマイナスは無し
  - 平日 (workday) を逃した分だけ `-5` で減衰
- Scrapbox 寄稿: 任意 page 編集で **+5**、自分の研究ノート編集でさらに **+5** (= 1日最大 10pt)
- タスク報酬: `>= 0` (0pt も許容)。0pt はお願いベース、誰でも受諾可。指名タスクは指名された人だけ受諾可
- 自己消費 (自分の出品を自分で減らす) はポイント移動なし・手数料なし、在庫だけ減る
- 全移転は 1 つの `Ledger::transfer()` 関数を通り、`BEGIN + FOR UPDATE + 残高チェック` で整合性を担保
- 台帳 (`ledger` テーブル) は **追記専用**。訂正は逆仕訳 (`type='reversal'`) で行う
- **ワリカ / 飲み会割り勘 / 請求** は LabPay の pt を動かさない。「誰が誰に外でいくら払うべきか」の計算と払った / 払ってないチェックのみ。実際の決済は現金 / PayPay / 銀行 / 立替で外でやり取りする

### Admin の流通量ビュー

管理画面トップに「流通ポイント」サマリーカードがあり、`流通中 (admin + 一般) / Admin 保有 / 一般 保有 / 一般保有率 (%)` を一目で確認できます。インフレ防止のバランス監視用。

---

## マイグレーション履歴

日付は git に最初に追加された日 (= 本番投入日とほぼ同じ)。

| # | 日付 | 内容 |
|---|---|---|
| 001 | 2026‑06‑01 | 初期スキーマ + seed (system / escrow 口座、初期 config) |
| 002 | 2026‑06‑01 | Presence (在室検知) テーブル |
| 003 | 2026‑06‑01 | カレンダー overrides + Geo 座標フィールド |
| 004 | 2026‑06‑01 | Streak 線形上限式へ変更 (milestone 表は廃止) |
| 005 | 2026‑06‑01 | Presence first_seen_at 追加 |
| 006 | 2026‑06‑01 | Presence infrastructure (機材 MAC 除外) |
| 007 | 2026‑06‑01 | `users.avatar_url` 追加 |
| 008 | 2026‑06‑01 | tasks / task_claims / transfers + grade 列 + 35人 bulk allowlist |
| 009 | 2026‑06‑01 | tasks.deadline + streak 微調整 |
| 010 | 2026‑06‑01 | streak 簡素化 + idempotency_keys PK 合成 + tasks.url / completion_message + listings.completion_message |
| 011 | 2026‑06‑01 | listings.location (置き場所) |
| 012 | 2026‑06‑01 | listings.display_name (出品者表示名スナップショット) |
| 013 | 2026‑06‑01 | 無料 (`これどうぞ`) 出品 + 購入時お礼メッセージ |
| 014 | 2026‑06‑01 | listings.resale_chain (転売経路) |
| 015 | 2026‑06‑01 | presence_seen.session_start_at (連続在室セッション計測) |
| 016 | 2026‑06‑01 | listings.expires_at (締切自動取消) |
| 017 | 2026‑06‑01 | presence_sessions テーブル (閉じたセッションログ) |
| 018 | 2026‑06‑01 | task_slots + task_claims.slot_id (時間枠分割) |
| 019 | 2026‑06‑01 | user_scrapbox_handles + scrapbox_awards + ledger 'scrapbox_reward' 追加 |
| 020 | 2026‑06‑01 | Scrapbox handle 22 件 seed |
| 021 | 2026‑06‑01 | Scrapbox handle `Sakura` 追加 |
| 022 | 2026‑06‑01 | Scrapbox handle `Member 03` 追加 |
| 023 | 2026‑06‑02 | task_attachments (タスク添付ファイル) |
| 024 | 2026‑06‑02 | 旧 Scrapbox 直接 API 関連 config row 削除 |
| 025 | 2026‑06‑02 | Scrapbox 寄稿ルール変更 — any-edit +5 + own-note +5 / 1日最大 10pt |
| 026 | 2026‑06‑02 | feedback (バグ報告 / 機能要望) + activity_log (利用ログ) |
| 027 | 2026‑06‑02 | wishlist (これ欲しい) |
| 028 | 2026‑06‑02 | invitations + invitation_joins (募集機能) |
| 029 | 2026‑06‑02 | roulettes (ルーレット履歴) |
| 030 | 2026‑06‑02 | roulettes に reward / ledger_id 列追加 |
| 031 | 2026‑06‑02 | nomikai (飲み会割り勘) |
| 032 | 2026‑06‑02 | adhoc_groups + adhoc_group_members + adhoc_group_feed (暫定グループ + フィード) |
| 033 | 2026‑06‑02 | `users.gender` 追加 (M/F/X/NULL) |
| 034 | 2026‑06‑02 | gender seed (現メンバーの一括初期化) |
| 035 | 2026‑06‑02 | adhoc_group_expenses (ワリカ Splitwise 風) |
| 036 | 2026‑06‑02 | Scrapbox handle 追加 seed (033 以降の新メンバー対応) |
| 037 | 2026‑06‑02 | adhoc_groups.slug (人間が読める URL 識別子) |
| 038 | 2026‑06‑02 | Scrapbox handle `shige` 追加 |
| 039 | 2026‑06‑02 | money_requests (請求 / 集金) |
| 040 | 2026‑06‑02 | money_requests.actor_user_id (bulk 生成の操作者を保持) |
| 041 | 2026‑06‑02 | presence_seen.session_start_at の過去 backfill |
| 042 | 2026‑06‑02 | task_assigned_users (指名タスク) |
| 043 | 2026‑06‑02 | 0pt タスク許可 (`reward >= 0` に緩和) |
| 044 | 2026‑06‑02 | feedback に admin 返信 + 通知 |
| 045 | 2026‑06‑03 | Google Calendar OAuth (`calendar.readonly`) + 選択カレンダー JSON |
| 046 | 2026‑06‑03 | groups / invitations.image_url (表紙画像) |
| 047 | 2026‑06‑03 | users.calendar_filter_rules (今日の予定の非表示ルール) |
| 048 | 2026‑06‑03 | adhoc_group_expenses.image_url (ワリカ支出にレシート添付) |
| 049 | 2026‑06‑03 | adhoc_group_receipts (撮影だけしておくレシートストック / v225 限り) |
| 050 | 2026‑06‑03 | adhoc_group_expenses を draft 対応 (`is_draft / taken_at / lat / lng` + `payer_user_id` NULL 許容)。レシートは draft 支出として一元化 |
| 051 | 2026‑06‑03 | roulettes に tags 用 config row |
| 052 | 2026‑06‑03 | app_open 報酬の config row |
| 053 | 2026‑06‑03 | 飲み会割り勘 ソフドリ割引 |
| 054 | 2026‑06‑03 | Zoom OAuth (`meeting:write`) — 「+ Zoom を追加」 機能 |
| 055 | 2026‑06‑03 | adhoc_groups.schedule_start_date / schedule_end_date + adhoc_group_schedule_items (出張 / 旅行のスケジュール表) |
| 056 | 2026‑06‑03 | adhoc_group_schedule_items 拡張: `image_url / url / end_date / end_time / duration_minutes` |
| 057 | 2026‑06‑03 | adhoc_group_schedule_items.link_pair_id (連結ペア) |
| 058 | 2026‑06‑02 | adhoc_group_schedule_items.lat / lng + day_date NULL 許容 (「行きたい場所ストック」) |
| 059 | 2026‑06‑02 | adhoc_group_schedule_attachments (予定アイテムへのファイル添付) |
| 060 | 2026‑06‑03 | polls + poll_options + poll_voters + poll_votes (投票・アンケート) |
| 061 | 2026‑06‑04 | polls 拡張: `allow_revote / allow_free_text` + `poll_voters.free_text` (再投票可否 + 自由記述) |
| 062 | 2026‑06‑03 | users.phone_number (緊急連絡先電話番号) |
| 063 | 2026‑06‑03 | adhoc_group_chats (グループチャット / LINE 風) |
| 064 | 2026‑06‑03 | adhoc_group_lodgings + adhoc_group_flights (宿泊地 / 航空券エンティティ。 反映でスケジュール展開) |
| 065 | 2026‑06‑04 | roll_calls + roll_call_targets (点呼 / 「いる？」 「起きてる？」) |
| 066 | 2026‑06‑04 | timers + timer_participants (共有タイマー) |
| 067 | 2026‑06‑04 | roulettes.notified_at (ホイール停止後に通知遅延) |
| 068 | 2026‑06‑04 | notices (重要連絡 / 学会情報リスト) |
| 069 | 2026‑06‑04 | adhoc_group_chats / 通知系 微調整 |
| 070 | 2026‑06‑04 | adhoc_group_flight_attachments (e-ticket PDF / 画像 / QR スクショ per-owner) |
| 071 | 2026‑06‑04 | adhoc_groups の feat_schedule / feat_lodging / feat_flight (機能 ON/OFF カラム) + 既存 row の backfill |
| 072 | 2026‑06‑04 | meetups + meetup_participants (待ち合わせ 短期集合) |
| 073 | 2026‑06‑04 | adhoc_groups.feat_wari + feat_actions (8 アクションボタン JSON で per-group 制御) |
| 074 | 2026‑06‑04 | sound_clips / sound_event_defaults / sound_user_prefs (効果音システム) |
| 075 | 2026‑06‑04 | auctions + auction_bids (オークション 単位は円) |
| 076 | 2026‑06‑04 | exercise_sessions (歩数 / 階段) |
| 077 | 2026‑06‑04 | timers にベル × 3 + リピート (`bell1/2/3_seconds`, `repeat_max`, `repeat_idx`) |
| 078 | 2026‑06‑04 | adhoc_group_flight_etickets (e-ticket QR image / seat / booking_ref / note per-owner) |
| 079 | 2026‑06‑04 | flight_etickets に qr_image_url / qr_thumb_url 追加、 qr_payload を NULL 許可 (画像 主体に) |
| 080 | 2026‑06‑05 | users に hobbies / favorites (公開プロフィール) |
| 081 | 2026‑06‑05 | invitations.signup_closes_at (募集締切 = 開催時刻と別。 過ぎたら 参加表明拒否) |
| 082 | 2026‑06‑05 | invitations.starts_at_has_time (日付だけ / 時刻あり の区別) + 既存 invitation の発起人を 自動 join (backfill) |
| 083 | 2026‑06‑05 | money_requests.source_group_id (グループのワリカ精算から bulk 生成された請求を逆引き) |
| 084 | 2026‑06‑05 | invitations.feat_actions (募集内ボタンの ON/OFF を JSON 制御) |
| 085 | 2026‑06‑05 | schedule_items.sort_order の rebase (DnD 並び替え用に隙間を空ける) |
| 086 | 2026‑06‑05 | playlists + playlist_items + playlist_ratings (🎵 プレイリスト共有) |
| 087 | 2026‑06‑05 | adhoc_group_day_memos (グループスケジュールの日ごとメモ) |
| 088 | 2026‑06‑05 | stopwatches + stopwatch_participants (⏱ ストップウォッチ) |
| 089 | 2026‑06‑05 | feedback の Claude 自動対応ワークフロー (claude_status / claude_summary / replied_by_user_id / finished_at) |
| 090 | 2026‑06‑06 | translations + 履歴 (🌐 画像 和訳) |
| 091 | 2026‑06‑06 | adhoc_group_schedule_items.hearts と location_text 拡張 |
| 092 | 2026‑06‑06 | feedback.assigned_by_user_id (誰が approve した feedback か) |
| 093 | 2026‑06‑06 | timers に paused 状態 + paused_at |
| 094 | 2026‑06‑06 | stopwatches.elapsed_ms / laps (ミリ秒精度 + ラップ) |
| 095 | 2026‑06‑06 | timers.end_bell_index (終了ベルの曲選択) |
| 096 | 2026‑06‑06 | meetups.kind = 'meetup' \| 'deadline' (待ち合わせ / 〆切 を 同一実装で) |
| 097 | 2026‑06‑06 | places + place_comments + place_comment_images (🍴 食べある記) |
| 098 | 2026‑06‑06 | user_settings (個人設定 KV) |
| 099 | 2026‑06‑06 | posts + post_images + post_replies + post_mentions (💬 らぼったー) |
| 100 | 2026‑06‑07 | soft_delete: 各リソースに deleted_at + 関連 cascade ヘルパ |
| 101 | 2026‑06‑07 | adhoc_group_flight_attachments.owner_user_id NULL 許可 (共有) |
| 102 | 2026‑06‑07 | LabPay system account (お知らせ・自動投稿用 bot user) |
| 103 | 2026‑06‑07 | adhoc_groups.invite_token (招待リンク + 期限) |
| 104 | 2026‑06‑08 | users.paypay_id / users.bank_info (支払い ID) |
| 105 | 2026‑06‑08 | places.image_url (メイン写真) + image_thumb_url 派生 |
| 106 | 2026‑06‑08 | user_todos (📝 自分の TODO) |
| 107 | 2026‑06‑08 | post_likes (👍 ❤️ ⭐ リアクション 3 種、PK = (post_id, user_id, kind)) |
| 108 | 2026‑06‑09 | meetup_messages (待ち合わせのシェアメッセージ) |
| 109 | 2026‑06‑09 | user_todos.due_at + url + partner + notes |
| 110 | 2026‑06‑09 | user_todos の詳細フィールド一式 (タイトル / カテゴリ / 完了履歴) |
| 111 | 2026‑06‑10 | users.achievements_title (AI 命名の称号 + generated_at + is_stale フラグ) |
| 112 | 2026‑06‑10 | place_likes (食べある記 ❤️ いいね、 PK = (place_id, user_id)) |
| 113 | 2026‑06‑10 | orderings + ordering_results (📋 順番決め、 シャッフルは CSPRNG) |
| 114 | 2026‑06‑10 | place_visits (食べある記の「行った」👣 足跡マーク) |
| 115 | 2026‑06‑11 | visited_regions (🗺 行った国 / 都道府県、 ISO 3166-1 + JP-NN) |
| 116 | 2026‑06‑11 | health_records (⚖️ 体重 / BMI / 体脂肪、 個人時系列) |
| 117 | 2026‑06‑11 | workouts + workout_follows (💪 筋トレ + 仲間 mutual follow) |
| 118 | 2026‑06‑11 | shiritori_games + shiritori_players + shiritori_drawings (🎨 絵しりとり) |
| 119 | 2026‑06‑11 | tierlists + tierlist_answers (🎯 ティア表 S/A/B/C/D 振り分け) |
| 120 | 2026‑06‑12 | paper_reviews + paper_review_settings (📄 論文査読 拡張: 共有 URL + 課金 + プロンプト編集) |
| 121 | 2026‑06‑12 | mahjong_games + mahjong_players (🀄 麻雀 Phase 1 賭けプール) |
| 122 | 2026‑06‑12 | mahjong_games.state_json (🀄 麻雀 Phase 2 実ゲーム本体) |
| 123 | 2026‑06‑12 | ito_games + ito_players (🎲 ito 協力ゲーム、 プレイフィー 1pt) |
| 124 | 2026‑06‑12 | jinrou_games + jinrou_players + jinrou_actions (🐺 人狼 役職 / 夜 / 昼) |
| 125 | 2026‑06‑12 | predictions_games + predictions_entries (🏆 優勝予想、 順位予想で 山分け) |
| 126 | 2026‑06‑13 | resume_checks (📝 原稿チェック、 paper-review 軽量版 5pt) |
| 127 | 2026‑06‑14 | user_daily_fortunes (🔮 1 日 1 回 占い、 30 種運勢) |
| 128 | 2026‑06‑14 | othello_games (💣 地雷オセロ、 1 か所地雷 + 3x3 反転) |
| 129 | 2026‑06‑14 | bingo_cards (🎰 週次 5x5 ビンゴ、 平日行動 自動判定) |
| 130 | 2026‑06‑14 | walk_sessions (🚶 散歩 軌跡記録、 GPS 5 秒 polling) |
| 131 | 2026‑06‑14 | daifugo_games + daifugo_players (🃏 大富豪、 革命 + 8 切り + ジョーカー) |
| 132 | 2026‑06‑15 | users.birthday_md / birthday_year (🎂 誕生日 + バースデー表示) |
| 133 | 2026‑06‑15 | score_pred_games + score_pred_entries (🎯 勝敗予測、 スコアを当てて山分け) |
| 134 | 2026‑06‑15 | rewriter_tasks (✂️ 文字数 / 単語数リライター、 サーバ側で正確カウント) |
| 135 | 2026‑06‑15 | custom_games (⭕❌ 自作ゲーム framework、 turn制 + state_json) |
| 136 | 2026‑06‑15 | custom_game_kinds (🎮 自作ゲーム kind を DB 管理化) |
| 137 | 2026‑06‑15 | custom_game_kinds.js_source / js_size (JS module を DB に格納、 ユーザ アップロード対応) |
| 138 | 2026‑06‑15 | custom_game_kinds.provider_share_pct (v620 でのみ存在、 v621 で drop) |
| 139 | 2026‑06‑15 | custom_game_kinds.provider_share_pct を drop (場代を 提供者 90% / SYSTEM 10% に 固定化) |
| 140 | 2026‑06‑15 | shiritori_play_fee (絵しりとり 場代 設定) |
| 141 | 2026‑06‑15 | othello_ai (地雷オセロ AI 戦 toggle) |
| 142 | 2026‑06‑15 | othello_ai_bot (地雷オセロ AI 用 bot user 確定) |
| 143 | 2026‑06‑15 | custom_game_n_players (自作ゲーム 1〜4 人 用 拡張) |
| 144 | 2026‑06‑16 | drafts + draft_picks (⚾ ドラフト 順番 指名 + くじ抽選) |
| 145 | 2026‑06‑16 | quizzes + quiz_questions + quiz_answers (📝 フリップ クイズ) |
| 146 | 2026‑06‑16 | quizzes.mode (text / verbal 切替) |
| 147 | 2026‑06‑17 | bingofit_cards (🎰 着回し ビンゴ、 5x5 服 グリッド) |
| 148 | 2026‑06‑17 | bingofit_cards.last_worn_at (最後 に 着た 日 を 記録) |
| 149 | 2026‑06‑18 | money_requests.recipients_json (1 回 の 請求 で 複数 人 別 額 を 指定 できる) |
| 150 | 2026‑06‑20 | paper_translates (📑 論文 要約 v755〜、 OpenAI Files API + chat.completions) |
| 151 | 2026‑06‑21 | paper_translates.pages_json (PDF ページ サムネ + 図表 region) |
| 152 | 2026‑06‑21 | paper_translates.is_shared / shared_at (🌐 公開) |
| 153 | 2026‑06‑22 | paper_translates.pdf_path / model (再 実施 用 PDF 保存 + 使用 モデル 記録) |
| 154 | 2026‑06‑22 | paper_reviews.response_text (🗨️ 回答文 / リバトル 評価 モード) |
| 155 | 2026‑06‑22 | deep_researches (🔎 Deep Research、 Responses API + web_search) |
| 156 | 2026‑06‑22 | deep_researches.is_shared / shared_at (🌐 公開) |
| 157 | 2026‑06‑22 | deep_researches.openai_response_id / progress_text (background mode 進捗) |
| 158 | 2026‑06‑23 | paper_full_translations (📑 論文 全訳、 章 ごと 翻訳 + back-translation) |
| 159 | 2026‑06‑23 | paper_reactions + paper_comments (要約 / 全訳 に ❤️ / 🔖 / 💬) |
| 160 | 2026‑06‑23 | tasks.completion_fields_json + task_claims.completion_data_json (📝 タスク 完了 時 カスタム 入力 欄) |
| 161 | 2026‑06‑23 | paper_reviews.pdf_path + response_pdf_path (元 PDF / 回答 PDF を 保存 して 結果 ページ から 開ける) |
| 162 | 2026‑06‑23 | paper_translates / paper_full_translations.pdf_sha256 (同 PDF の 横展開 リンク) |
| 163 | 2026‑06‑23 | quotes (💬 名言 を ラボメン が 登録、 静的 配列 と 合算 で 日 単位 で 1 件) |
| 164 | 2026‑06‑23 | paper_translates / paper_full_translations.auto_share (完了 と 同時 に 自動 公開 ON) |
| 165 | 2026‑06‑23 | ledger.type に paper_translate / paper_full_translate / deep_research (取引 履歴 で 個別 表示) |
| — | 2026‑06‑17 | (migrations フォルダ 外) bait_requests + bait_assignments (アルバイト 申請) |
| — | 2026‑06‑17 | (migrations フォルダ 外) custom_widgets (自作 ウィジェット) |
| 166 | 2026‑06‑24 | adhoc_group_files (グループに 画像 / 音声 / ドキュメント 添付) |
| 167 | 2026‑06‑25 | users.cosense_cookie (Cosense session cookie 連携、 170 で drop) |
| 168 | 2026‑06‑25 | users.cosense_pat (Cosense PAT に切替 — 安定運用に) |
| 169 | 2026‑06‑25 | users.cosense_page_handle (研究ノート ページ 名 解決) |
| 170 | 2026‑06‑25 | drop users.cosense_cookie (PAT に 移行 完了) |
| 171 | 2026‑06‑26 | ai_result_stars (paper-summary / paper-translate-full / deep-research に ⭐ 評価) |
| 172 | 2026‑06‑26 | ai_result_bookmarks (AI 結果 に 🔖 ブックマーク) |
| 173 | 2026‑06‑26 | zemi_videos (🎥 ゼミ動画 = YouTube 限定公開 を キーワード 検索 + その場 視聴) |
| 174 | 2026‑06‑26 | zemi_videos UNIQUE + yt_title (重複 防止 + YT タイトル 自動 取得) |
| 175 | 2026‑06‑26 | users.birth_place (出身地 — プロフィール 公開 項目) |
| 176 | 2026‑06‑26 | zemi_videos.duration_sec (再生 時間 秒、 ソート 用) |
| 177 | 2026‑06‑27 | conquest_lists + conquest_items + conquest_checks (🏁 制覇 リスト — ユーザ 作成 の パン屋 / 温泉 等 を 達成 チェック) |
| 178 | 2026‑06‑28 | habits + habit_days (📓 Habit Tracker — 日 毎 ✓ + 60 日 カレンダー + streak) |
| 179 | 2026‑06‑29 | buzzer_sessions + buzzer_taps (⚡ 早押し クイズ — 現場 で 800ms ポーリング、 タップ 順 で ms 差 表示) |
| 180 | 2026‑06‑29 | tasks.funded_by_system (admin が タスク 起案 時 に 「💰 システム 持ち出し」 オプション — エスクロー が SYSTEM 口座 から 出る) |
| 181 | 2026‑06‑30 | overleaf_projects + overleaf_snapshots + overleaf_file_snapshots + overleaf_collector_runs (📝 Overleaf 更新状況 — pyoverleaf で 教員 アカウント の 全 共有 プロジェクト の 文字数 推移 を 1 時間 おき スナップショット) |
| 182 | 2026‑06‑30 | overleaf_snapshots.main_file_path + main_char_count_* (主 .tex を `\documentclass` で 検出、 過去 ファイル / サンプル を 集計 対象 外 に) |

---

## 運用 cron

| 名前 | スケジュール | 役割 |
|---|---|---|
| `/etc/cron.d/labpay-scrapbox` | `59 23 * * *` | Scrapbox-via-Slack 当日分集計 → pt 配布 |
| `/etc/cron.d/labpay-backup` | `30 3 * * *` | `mysqldump --single-transaction` バックアップ (30 日保持) |
| `/etc/cron.d/certbot` | (certbot 自動生成) | Let's Encrypt 証明書更新 |
| `systemd: labpay-overleaf.timer` | `OnUnitActiveSec=1h` | 📝 Overleaf 更新状況 collector — pyoverleaf で 教員 アカウント の 全 プロジェクト の 文字数 を スナップショット。 v896 の last_updated ETag 的 skip 最適化で 変更 が 無い プロジェクト は .tex DL を 完全 省略 (典型 250 件 中 5 件 程度 だけ 実 DL) |

各部屋 scanner の cron / Task Scheduler 設定は [bin/README.md](bin/README.md) 参照。
Overleaf collector の セットアップ 手順 (venv + cookie + systemd unit) は [scripts/overleaf_collector.py](scripts/overleaf_collector.py) 冒頭 コメント 参照。

---

## 開発スタイル

- **ビルドなし**: PHP / JS / CSS は配置で即反映。常駐プロセス無し
- **コメントは "WHY" のみ**: 何をしているかはコードで読める。なぜそうしたかは制約・過去のバグ・微妙な不変条件に対してのみ書く
- **エラーハンドリングは境界だけ**: 内部呼び出しは契約を信じる。`ApiException` でラップしてフロントコントローラが JSON で返す
- **追記専用台帳**: 残高は `ledger` 行の SUM(to) - SUM(from)。直接 UPDATE しない。修正は `reversal` 仕訳
- **新リソースは dispatch table に 1 行**: `public/api/index.php` の `$routes` に追加するだけで生える。複雑な権限 / 前処理は route_* 関数の中で済ませる
- **PWA キャッシュは shell だけ**: `sw.js` は `/api/*` を絶対にキャッシュしない (台帳の鮮度)。バージョン bump は `CACHE_NAME` (`labpay-shell-vNNN`) と `index.html` の `brand-version` の 2 箇所
- **共有 UI ヘルパ**: 各 view で重複していた パターンは `public/js/{format,member_picker,modal,image_picker,sounds}.js` に 集約。 新しい view を書くときは これらを 使う (status tag は `tag('ok'|'warn'|'danger'|'muted', label)`、 メンバー選択は `createMemberPicker({...})`、 モーダルは `openModal({title, bodyHtml, buttons})`、 画像 upload は `setupImagePicker(prefix)`、 時刻表示は `fmtDate / fmtDateTime / fmtRelative / fmtLocalInput`)。 新しい inline style を 書く前に 既存ヘルパで足りないか 一度確認

---

## ライセンス・連絡先

- 内部運用想定の社内ツール。ライセンス未設定 (利用は研究室メンバー限定)
- 連絡先: [@nkmr-lab](https://github.com/nkmr-lab)

---

## 本番化前のセキュリティチェックリスト

- [ ] `config/config.php`: `auth.dev_login_enabled = false`
- [ ] Google OAuth `client_secret` を本番値に差し替え (Calendar API も有効化)
- [ ] Rakuten `access_key`、Slack `webhook_url` / `bot_token` を本番値に差し替え
- [ ] `app.cookie_secure = true` を確認
- [ ] `bin/backup.sh` を cron 登録、復元手順を 1 回試す
- [ ] DB と config のオフサイトバックアップを別途構築
- [ ] `public/uploads/.htaccess` が反映されている (PHP 実行不可) ことを確認
- [ ] `/etc/php.d/99-labpay.ini` が配置されている (`upload_max_filesize=60M` 等)

### 既に実施済の堅牢化 (参考)

- 全 state-changing API は `X-Requested-With: labpay` ヘッダ強制 (CSRF)
- prepared statement + `escapeHtml` の徹底 (XSS / SQLi)
- avatar_url・タスク URL に同一オリジン / http(s) のみ許可するバリデーション + クライアント側 `safeHttpUrl` ガード
- アップロードは MIME 判定 + ファイル名 random + SVG 拒否 + 共通 `save_uploaded_file` ヘルパで一元化
- `idempotency_keys` の PK は `(ukey, user_id, endpoint)` 合成キー
- `public/uploads/.htaccess` で `.php` 等の実行・解釈を全て拒否
- 取引の取消は admin の「最近の取引から選ぶ」UI 経由 (ID 入力ミスを排除)
- scanner token は plaintext を返却するのは 1 回のみ、DB は sha256 ハッシュのみ保存
- Google Calendar token は users テーブルに保存 / `calendar.readonly` の最小権限のみ取得 / refresh token は incremental authorization で OAuth 同意フロー再利用
