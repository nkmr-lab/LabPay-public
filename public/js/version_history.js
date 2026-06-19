// LabPay バージョン履歴。 トップバーの v### をタップで モーダル表示。
//   新しいバージョンを ship したら 先頭に追記してください。

export const VERSION_HISTORY = [
  { v: 'v696', d: '2026-06-20', s: '📅 ホーム 学会 〆切 widget で サブ 締切 も 考慮 する ように (#281)。 メイン 締切 (原稿) が 過ぎて も サブ 締切 (申込 / アブスト 等) が 未来 なら 出す。 各 conf の 最寄り 未過去 deadline で ソート、 ラベル付き で 表示' },
  { v: 'v695', d: '2026-06-19', s: '🐛 ホーム 娯楽 widget で 麻雀 を キャンセル 後 も 表示 され続ける bug 修正 (#280)。 recruiting cache が page lifetime で 持って いた ため 古い data の まま だった → renderHome 冒頭 で 必ず キャッシュ を 捨てる ように' },
  { v: 'v694', d: '2026-06-19', s: '🐛🎉 AI 麻雀 「対局 を 終了」 で Internal Server Error 修正 + 娯楽 widget に 「締切済 結果待ち」 の 予想 を 表示 (#279, #278)。 AI bot は accounts row が ない ので 返金 対象 から 除外 (人間 のみ)。 優勝予想 / 勝敗予測 は status open/closed の もの を 全件 取得 して 締切後 は pending タグ で 表示' },
  { v: 'v693', d: '2026-06-19', s: '🎉 ホーム の 娯楽 widget を 折りたたまず 全件 表示 に (#277)。 従来 は 上位 10 件 + 「他 N 件 (1 週間 以上先)」 hint だった が、 娯楽 だけ は 全件 並べる ように。 renderCategoryWidget に showAll オプション を 追加' },
  { v: 'v692', d: '2026-06-19', s: '🀄 AI 麻雀 対戦 中 に 「対局 を 終了」 ボタン を 追加 (#276)。 起案者 (= AI 戦 で は 自分) は playing 中 で も 卓 を キャンセル できる。 既存 の /cancel endpoint を 利用、 state response に is_creator フラグ を 追加' },
  { v: 'v691', d: '2026-06-19', s: '📅 学会 〆切 で メイン 締切 に 種別 ラベル (原稿 / 申込 / アブスト 等) + AOE フラグ を 追加 + サブ 締切 を 同 entry 内 に 最大 10 件 並べられる ように (#275)。 AOE 入力 は JST 換算 して 保存、 表示 時 に 元 の AOE 形式 も 併記。 conf_deadlines table に deadline_label / deadline_is_aoe / extra_deadlines を 追加' },
  { v: 'v690', d: '2026-06-19', s: '⚖️ 体重 / BMI 記録 で 過去 日 の 入力 が できる ように (#274)。 「📅 日付」 入力 + 「今日」 ボタン を 追加、 既定 は 今日。 過去 日 を 選ぶ と recorded_at に その日 の 23:59:59 を 渡して 保存。 server 側 は 元々 recorded_at 受付 済 だった ので UI 追加 のみ' },
  { v: 'v689', d: '2026-06-19', s: '🏆 優勝予想 / スコア予想 で 「⏳ 締切まで 締切超過 ⛔」 だった 重ね 表示 を 修正 (#273)。 締切 を 過ぎたら シンプル に 「⏰ 締切終了」 を 表示、 status badge も 「受付中」 のまま なら 「締切済」 に 下げる' },
  { v: 'v688', d: '2026-06-18', s: '📅 学会 〆切 widget で list-item の 80px 既定 高 を 解除 (#272)。 v687 で 1 行 化 した のに list-item の height:80px が 効いて しまい 縦幅 を 取り過ぎて いた → conf-deadlines カード だけ height:auto + min-height:0 に override' },
  { v: 'v687', d: '2026-06-18', s: '📅 ホーム の 学会 〆切 widget を 1 行 化 して 詰める (#271)。 旧版 は 学会名 と 締切+残日数 が 2 段 で 縦 に 嵩んで いた → icon + 名前 (場所) + 締切 (MM/DD) + 「あと N 日」 を flex 1 行 で 表示。 名前 は ellipsis で 切詰め。 表示 件数 も 5 → 8 件 に 増やした' },
  { v: 'v686', d: '2026-06-18', s: '🛡 在室 検知 で VM の MAC を 除外 (#270)。 Hyper-V / VMware / VirtualBox / KVM / Xen の OUI を 検知 → 新規 登録 を 弾く + 既存 登録 に ⚠️ 警告 を 表示 + 未 登録 一覧 で 「これは私」 ボタン を 非表示。 「ずっと いる」 状態 の 多く は ホスト 常時 稼働 の 仮想 NIC が 原因' },
  { v: 'v685', d: '2026-06-18', s: '🐛 公開 タイマー で 横 が 切れる bug 修正 (#268)。 style.css の main#app { max-width:720px; padding:14px; overflow-x:hidden } が 100vw を 削って いた → 公開 タイマー では 親 #app の 制約 を override (max-width:none, padding:0, overflow:visible)。 ついで に 6 文字 「+MM:SS」 が 確実 に 収まる ように font-size を min(35vw,90vh) → min(26vw,80vh) に 縮小' },
  { v: 'v684', d: '2026-06-18', s: '🛎 タイマー 表示 を 3 フェーズ に 整理 (#267)。 ① 発表終了 (= end_bell) まで は 通常 の カウントダウン、 ② そこ から 最後 の ベル まで は 0:00 から カウントアップ (= 質疑 時間)、 ③ 最後 の ベル を 越えて から 「+MM:SS 超過」。 通常 タイマー + 公開 タイマー 共通。 ついで に 公開 タイマー の bells 変数 重複 宣言 bug も 修正' },
  { v: 'v683', d: '2026-06-18', s: '🛎 タイマー の wake lock を 超過 表示 中 も 保持 する ように (#266)。 終了 ding で 解放 して いた 行 を 削除 + status=done でも 取得 し続ける。 公開 タイマー にも acquireWakeLock を 追加 (タブレット 表示 中 は 常時 ON)' },
  { v: 'v682', d: '2026-06-18', s: '🛎 タイマー 超過 の 基準 を 最後 の ベル 位置 に 変更 (#264)。 例: 論文紹介 で 5min=発表終了 (server 側 で done に なる) でも、 視覚 的 には 3鈴 (10min) まで 通常 の 残り 時間 表示、 そこ を 過ぎて から 「+MM:SS 超過」 扱い。 公開 タイマー も 同様' },
  { v: 'v681', d: '2026-06-18', s: '🛎 タイマー 表示 大型化 + 操作画面 で 参加者 を 折り畳み (#261/#262/#263)。 公開 タイマー font-size を min(25vw,60vh) → min(35vw,90vh)、 通常 タイマー の カウント を 64px → clamp(96px,22vw,180px) で 大幅 拡大。 参加者 セクション を <details> に して 標準 折り畳み' },
  { v: 'v680', d: '2026-06-18', s: '🐛 公開 タイマー で 時間 表示 が 横幅 切れる bug 修正 (#260)。 font-size を clamp 280px 上限 → min(25vw, 60vh) に 変更 して viewport に 完全 fit、 #pt-wrap を 100vw + box-sizing border-box、 white-space:nowrap で 1 行 強制' },
  { v: 'v679', d: '2026-06-18', s: '🐛 公開 タイマー で リロード する と login に 飛ばされる bug 修正 (#259)。 api.js の 401 redirect が /#/public-timer/* も 弾いて いた → 例外 対応' },
  { v: 'v678', d: '2026-06-18', s: '🛎 公開 タイマー (#/public-timer/:id) で topbar / tabs (LabPay の メニュー) を 隠す ように (#258)。 タブレット を 演台 に 置く 用途 で メニュー は 邪魔 だった。 ページ 離脱 で 自動 復帰' },
  { v: 'v677', d: '2026-06-18', s: '🛎 学会 タイマー の UX 改善 (#257): (1) 新規 作成 で 参加者 を 選択 する と picker が 自動 で 折り畳まれる (details element + onChange で 1 回 だけ collapse、 summary に 件数 表示)、 (2) 超過 表示 を 強化 「終了 + 超過 MM:SS 経過 中」 に 変更 で 終わって ない 感 を 強調 (count は 元々 +MM:SS で 増え 続けて いた)' },
  { v: 'v676', d: '2026-06-18', s: '🛎 学会 タイマー: 「論文紹介 (4/5/10、 5分=発表終了)」 プリセット 追加 + 公開 URL 機能 新規 (#256)。 タイマー 詳細 で 「🔗 公開 URL」 ボタン → 認証 不要 の /#/public-timer/{id} を コピー、 タブレット 等 に 開いて 演台 に 置ける。 大きい カウントダウン + ベル 位置 表示 + 5 秒 毎 polling で 他 端末 操作 と 同期' },
  { v: 'v675', d: '2026-06-18', s: '📅 学会 〆切 widget の 行間 スペース を 詰めた (#255): gap 8px→0、 padding 4px→3px、 line-height 1.3、 締切 行 を 11px に。 場所 を 取り過ぎな レイアウト を コンパクト に' },
  { v: 'v674', d: '2026-06-18', s: '📅 学会 〆切 widget 修正 (#254): /upcoming endpoint が location を 返して いなかった bug 修正 + 「あと N 日」 を 締切日 の 右側 に 移動 (= 1 行目 学会名+場所、 2 行目 締切 ・・・ あと N 日)' },
  { v: 'v673', d: '2026-06-18', s: '📅 学会 〆切 widget の format 変更 (#253): 1 段目 = 学会名 (開催場所) ... 残り日数、 2 段目 = 締切 datetime。 開催場所 が ある と 1 段目 に 括弧 で 入る' },
  { v: 'v672', d: '2026-06-18', s: '🔮 占い を 「娯楽」 タブ (#/games) の 「✈️ ひとり遊び」 カテゴリ に も 追加 (#252)。 v671 で apps.js の cat=game だけ 入れて いた が、 #/games は 独自 の GAMES 配列 を 持つ ので 二箇所 で 登録 必要 だった' },
  { v: 'v671', d: '2026-06-18', s: '🔮 占い を 娯楽 カテゴリ に 追加 (#250) — #/fortune の 単独 ページ + apps menu に 登録。 📅 学会 〆切 一覧 アプリ 新規 (#251) — 国際 会議 / 国内 研究会 / 論文誌 / その他 カテゴリ、 誰でも 登録、 全員 閲覧、 〆切 順 一覧 + あと N 日 カウントダウン。 ホーム widget も 追加 (直近 5 件 を 〆切 順 で 表示)' },
  { v: 'v670', d: '2026-06-18', s: '💬 チャット 「unknown room」 bug 修正 + Slack 風 見た目 改修 (#249): backend で room_key を urldecode (path_segments が 自動 decode しなかった)、 view は 紫 ヘッダ + チャンネル / DM の セクション 分け、 メッセージ は 全部 左寄せ で アバター + 名前 + 時刻 ヘッダ + hover で 削除 ボタン (Slack 風)。 🀄 麻雀 対局画面 で 横向き lock 試行 + portrait の とき は 「横にして」 バナー' },
  { v: 'v669', d: '2026-06-18', s: '💬 Slack 風 チャット 新規 (#248): 3 固定 チャンネル (🚨 重要 / 📢 連絡 / 💭 相談) + 1対1 DM。 2 秒 polling で 准 リアルタイム、 「重要」 への 投稿 は 全員 に 自動 通知 (in-app + Slack DM)。 #/chat-rooms から。 🐛 アルバイト 申請 #244 で picker TDZ ReferenceError 修正 (#247)' },
  { v: 'v668', d: '2026-06-17', s: '🐛 cg2 runtime の critical bug 修正: sharedValues が plain object のまま export されて いた ので mutation 追跡 が 一切 動かず 同期 が ゼロ だった → deep Proxy で wrap し直し。 _suppressDirty で server → client → server の ping-pong も 防止' },
  { v: 'v667', d: '2026-06-17', s: '🎮 自作 ゲーム v2 (cg2) framework 実装。 p5.js + sharedValues 自動 同期 の 准 リアルタイム multiplayer。 DB: cg2_kinds + cg2_games、 backend: src/handlers/cg2.php、 runtime: public/js/cg2.js (deep Proxy + 500ms polling + host.start/stop ライフサイクル)、 view: public/js/views/cg2.js (#/cg2)。 サンプル 4 件 (マルバツ / ニム / ライツアウト / すごろく) を kind に 登録。 詳細: docs/CUSTOM_GAMES_V2.md。 README + docs (CUSTOM_GAMES_V2 / WIDGETS) も 更新' },
  { v: 'v666', d: '2026-06-17', s: '🧩 ウィジェット センター 新規 (#246)。 自作 widget を DB に JS で 登録 → ホーム に 表示。 #/widgets で 管理。 サンプル 2 種 (🕐 時計 / 💰 残高)。 API: /js/widgets_api.js (me / get / post / html を import)。 開発者 は meta + render(root) だけ 書けば OK' },
  { v: 'v665', d: '2026-06-17', s: '既存 娯楽 ゲーム の 順番 を ランダム 化: 地雷オセロ (先手 = creator/opponent ランダム)、 大富豪 (着席 順 + ♣3 ホルダ ランダム)、 麻雀 (親 を 0..3 ランダム)、 絵しりとり (turn_order shuffle)、 custom_games (status→playing 時 に 先手 ランダム)。 ito / 人狼 は 既 に 配布 / 役職 が ランダム 済 で 変更 なし' },
  { v: 'v664', d: '2026-06-17', s: '優勝予想 ルール 改定: 順位 重み を [5,3,2,1] → [4,3,2,1]、 集合 一致 ボーナス (+1/件) を 追加、 配分 を 「最高点 山分け」 に。 #1 WC 優勝予想 (8 名 参加 中) の description 更新 + 参加者 へ 通知 済' },
  { v: 'v663', d: '2026-06-17', s: '💼 アルバイト 申請 アプリ 新規 (#244)。 実験 協力 等 の 依頼 を 時間 (小数) + 対象者 で 出す → 受け取った 側 は 月別 で 全部 見える + 処理 済 マーク → 依頼者 は 進捗 確認 + 未処理者 に 催促。 通知 / 削除 / 完了 マーク 対応' },
  { v: 'v662', d: '2026-06-17', s: '🐛 フリップクイズ #245 修正: (a) display:none 配下 の textarea が focus 状態 で polling 停止 → 回答数 表示 が 固定 されて いた / (b) reveal phase で ⭕❌ ボタン を 押す と 1-2 秒 で 元 に 戻る (採点中 polling skip)。 ✨ 娯楽 widget 参加者 アイコン を 全員 表示 (折り返し)、 AI (kind=bot) は 🤖 で 表示' },
  { v: 'v661', d: '2026-06-17', s: '🐛 娯楽 widget の 参加者 アイコン が 出ない bug 修正。 player テーブル に id カラム が ない (game_id, user_id 複合 PK) ので ORDER BY p.id が 全 silent fail していた → ORDER BY p.user_id へ' },
  { v: 'v660', d: '2026-06-17', s: '進行中 widget: 「他 N 件」 だけ の とき は ウィジェット 自体 を 表示 しない (rows 空 で hide)。 応答 済 点呼 は 進行中 から 自動 で 消える (#242)。 娯楽 widget: 参加者 アイコン を 横並び 表示 (#243) — 麻雀 / 大富豪 / ito / 人狼 / 絵しりとり / custom_games / 優勝予想 / 勝敗予測 / ドラフト / クイズ / 地雷オセロ' },
  { v: 'v659', d: '2026-06-16', s: '請求 ページ 未払い人 別 合算 で アバター が 横長 に 伸びて いた 修正 (.row > * の flex:1 1 auto が 効いて いた → plain flex に 変更)' },
  { v: 'v658', d: '2026-06-16', s: '請求 ページ の 履歴 下 に 「👥 未払い人 別 合算」 セクション 追加。 自分 が 受取側 の 請求 で、 同じ 人 が 複数 請求 を 未払 い の 場合 は 一行 に 合算 して 「user X: 合計 ¥Y (N 件)」 を 表示 (各 請求 タイトル も 展開)' },
  { v: 'v657', d: '2026-06-16', s: 'LabPay 内 通知 ページ で SNS 反応 / 予想 / スコア予想 / ドラフト 通知 が タップ しても 飛べなかった bug 修正 (refUrl に post / prediction / score_pred / drafts を 追加)。 これで 「どの 投稿 / 予想 か わからない」 問題 を 解消' },
  { v: 'v656', d: '2026-06-16', s: 'Slack DM 通知 の 末尾 に 「→ https://pay.nkmr.io/#/...」 を 自動 付与。 どの 請求 / 投稿 / 点呼 / 集合 / フィードバック / ゲーム の 通知 か が ワンクリック で 開ける ように (ref_type 別 に URL マップ)' },
  { v: 'v655', d: '2026-06-16', s: '進行中 ウィジェット の 「⏳ 他 N 件」 footer の 上 罫線 を 削除 (border-top を 除去)' },
  { v: 'v654', d: '2026-06-16', s: '🐛 設定 で 隠した ウィジェット が 一部 ホーム に 出続けた 問題 を 全 撤去。 あなた宛て / 娯楽 も 影響 (renderCategoryWidget が home-card-user-hidden class を 外して いた)。 force-render filter も 廃止 し、 全 widget が ユーザ の 隠す 設定 を 尊重' },
  { v: 'v653', d: '2026-06-16', s: '🐛 実績 widget が 設定 で 隠して も ホーム に 出続けた bug 修正 (force-render filter から achievements を 除外 + home-card-user-hidden class を 触らない)' },
  { v: 'v652', d: '2026-06-16', s: '🐛 設定 → ホーム ウィジェット 設定 で チェック を 外して も 反映 されない バグ 修正 (NEW_DEFAULT_SHOWN の auto-show merge() が ユーザ の チェック 解除 を 上書き していた)。 実績 widget を シンプル化: 達成 実績 リスト (tier 昇順) + 一番 下 に 「最新: 〇〇」 1 行 だけ (AI 称号 box / 次 の 実績 進捗 hint は 撤去)' },
  { v: 'v651', d: '2026-06-16', s: '🏅 実績 + 称号 ウィジェット 新規 (AI 称号 + 獲得済 実績 トップ 5)。 点呼 詳細 に 「残り時間」 表示 + 起案者 用 ✏️ 編集 (タイトル / 本文 / 締切 変更)。 請求 ページ に 「未払い 合算」 セクション 追加 (受取人 別 リスト + 合計 ¥)。 進行中 ウィジェット footer は 件数 だけ に 簡素化 (1週間以上先 内訳 は 省略)。 ラボ滞在マップ / 実績 を SHORTCUT_CARDS から 除外 (実 widget が ある)' },
  { v: 'v650', d: '2026-06-16', s: '🎉 娯楽 ウィジェット に 「現在 予想中」 (優勝予想 / 勝敗予測 で 既に エントリ済) も 表示 (▶ 参加中 タグ)。 進行中 ウィジェット の 1 週間 以上先 待ち合わせ / 〆切 は 件数のみ の フッタに 集約' },
  { v: 'v649', d: '2026-06-16', s: 'ホームウィジェット 大整理: 🎉 娯楽 新規 (ゲーム/予想/ドラフト/クイズ) + 🎯 あなた宛て (投票/点呼/論文査読/原稿チェック) に 分離。 1 週間以上先 は 「他 N 件」 で 集約。 SHORTCUT カード 35 個 削除 (実進行は 上の 2 widget に 集約、 個別アクセスは #/apps から)' },
  { v: 'v648', d: '2026-06-16', s: '集合連絡 (meetups) を 31日 → 半年 (180日) に 拡張 (もっと 先の 予定 も 登録可)。 グループ編集 で グループ名 も 変更可能 に (編集モード中 「✏️ 名前 変更」 ボタン)' },
  { v: 'v647', d: '2026-06-16', s: '募集を終了 (invitations_close) で Internal Server Error → invitations テーブルに 存在しない cancelled_at カラム を 参照していた バグ修正 (実際は deleted_at)' },
  { v: 'v646', d: '2026-06-16', s: 'recruiting ウィジェット を 常時表示 に (アイテム 0 件 でも 「現在 なし」 で 表示)。 console.log 追加 で デバッグ可。 エンドポイント は 動作確認済 (中村さん の 場合 麻雀#4 を 返す) が ブラウザ側 で 表示 されない 報告 への 切り分け' },
  { v: 'v645', d: '2026-06-16', s: 'v644 ウィジェット 全 SQL バグ修正: AS by (予約語) → by_name で 全クエリ silent 失敗してた + paper_reviews.title (実在せず) → pdf_name + roll_call_responses (実在せず) → roll_call_targets.responded_at IS NULL。 履歴カード の summary 内 <a> を 外に出して a11y warning も解消' },
  { v: 'v644', d: '2026-06-16', s: '🎯 ホーム ウィジェット 大拡張 + 強制表示。 「あなた宛て / 関わってる」 に 投票 / 点呼 / 論文査読 / 原稿チェック も 集計 + 表示。 アイテム ある時は ユーザの hidden 設定 を 上書きして 必ず 出す' },
  { v: 'v643', d: '2026-06-16', s: '📝 フリップ クイズ #240/#241 対応: テキスト入力中 (textarea/input フォーカス時) は polling re-render を スキップ で 入力 消える 問題 解決 + 「🗣️ 口頭モード」 追加 (問題は 声で 出して、 フリップだけ で 解答 → 採点 → 次の問)' },
  { v: 'v642', d: '2026-06-16', s: '設定 タブ順番 が 反映されない 問題 を 修正。 applyTabLayout を appendChild 連発 → remove-then-append に 堅化、 単純な move では 一部 ブラウザで 再 layout 更新されない 報告に 対応' },
  { v: 'v641', d: '2026-06-16', s: '🎉 娯楽ウィジェット を デフォルト ON に。 HOME_CARDS / DEFAULT_VISIBLE / NEW_DEFAULT_SHOWN 全部 に recruiting を追加、 既存ユーザにも 自動表示。 設定 → ホーム からも 個別 ON/OFF 可' },
  { v: 'v640', d: '2026-06-16', s: '🎉 娯楽 ウィジェット 大改修: 参加中 + 募集中 を まとめて 表示。 各 item に ▶参加中 / 🎯募集中 タグ。 優勝予想 / 勝敗予測 の テーブル名 を 修正 (predictions_games / score_pred_games)。 進行中ゲーム も 出るので 「自分の番だっけ?」 が ホームで わかる' },
  { v: 'v639', d: '2026-06-16', s: '募集 (invitations) に 「✋ 募集を 終了」 ボタン追加。 「人 集まったから 確定したい」 「定員 あふれた」 時に creator が closed_at セット。 既参加者 と イベント は そのまま、 新規 join のみ 不可。 取消 とは 別動作' },
  { v: 'v638', d: '2026-06-16', s: '🎉 娯楽 募集中 ウィジェット を ホーム に 追加。 地雷オセロ / 大富豪 / 麻雀 / ito / 人狼 / 自作ゲーム の 募集中卓 + 招待中の ドラフト / クイズ / 優勝予想 を 横断 集計 (/api/me/recruiting)' },
  { v: 'v637', d: '2026-06-16', s: '⚾ ドラフト と 📝 フリップ クイズ を 娯楽 へ 移動。 終了済 ゲーム から 「参加中」 タグ 撤去 (othello / daifugo / mahjong / ito / 人狼)。 各ゲームに 🏳 投了 ボタン (地雷オセロ / 大富豪 / マルバツ / 四目 / すごろく / ニム など custom_games 全部、 ポイント 戻りません)' },
  { v: 'v636', d: '2026-06-16', s: '💣 地雷オセロ で 地雷 踏んだ 演出 (💥音 + 🔥 + 3x3 ぐるぐる 回って ひっくり返る アニメ)。 Web Audio で 爆発音 生成、 CSS keyframes で 1.3 秒 の rotate アニメ' },
  { v: 'v635', d: '2026-06-16', s: '📝 フリップ クイズ 新規。 出題者 が 問題 → 参加者が フリップに 記述回答 → 一斉開示 (タップで 拡大表示) → 出題者が ⭕❌ 採点 → ランキング 自動集計。 次の問へ で 連続 出題、 終了で 全 履歴 振り返り' },
  { v: 'v634', d: '2026-06-16', s: '⚾ ドラフト 新規 (プロ野球風 順番指名 + くじ抽選)。 候補は 人 or 自由入力。 picking → reveal → lottery → lottery_reveal → 確定 → 次 round の state machine。 競合 は くじ で 決着、 ハズレ た 人は その round で 再指名' },
  { v: 'v633', d: '2026-06-16', s: '「対象者指定 → 即起動」 を 🎲 ito / 🐺 人狼 にも 拡大。 起案画面 の 「対象者で即開始」 チェックで 全員着席 + 一括徴収 + 役職/数字 即配布 + lobby スキップ。 (絵しりとり は 既に 即開始)' },
  { v: 'v632', d: '2026-06-16', s: '対戦ゲーム に 「対象者指定 → 即起動」 機能。 🃏 大富豪 / 💣 地雷オセロ / 🀄 麻雀 で member picker → 全員から 一括徴収 + 通知 + 即開始 (公開卓 で 立てる オプション も 残す)' },
  { v: 'v631', d: '2026-06-16', s: '自作ゲーム の play() を action() に 改名 (gameplay と かぶる紛らわしさ 解消)。 setup / draw / action の 3 関数 で 足りる ことを 明示。 旧 play は 後方互換で 受け付け。 全サンプル + テンプレ + docs 更新' },
  { v: 'v630', d: '2026-06-16', s: '自作ゲーム を 1 人 / 2 人 / 4 人 対応 に。 sketch({ players: 1/2/4 }) + max_players 列 + players_json 着席順 管理 + 全員揃った時に 一括徴収。 新サンプル: 🟦 ライツアウト (ソロ) + 🎲 すごろく (4 人)' },
  { v: 'v629', d: '2026-06-15', s: '自作ゲーム を Processing 風 に: sketch({ setup, draw, play }) で 書ける。 「いつ 何が 呼ばれるか」 を 流れ図で明示。 ニム / マルバツ / 四目並べ サンプル も 同じ形式 に 書き直し' },
  { v: 'v628', d: '2026-06-15', s: '自作ゲーム をさらに簡単化: defineGame() 全部入りラッパー + 🪙 ニム サンプル追加 + /#/my-games に インライン JS エディタ + 「テンプレート 読み込み」 (🪙 ニム / ⭕❌ マルバツ / 🟦 四目並べ から ひな型 を 即注入)' },
  { v: 'v627', d: '2026-06-15', s: 'オセロ AI の 考える間を 1 秒 → 2 秒 に' },
  { v: 'v626', d: '2026-06-15', s: '自作ゲーム 共通ヘルパー /js/cg_ui.js 切り出し (マルバツ ~80 行に短縮、 examples/connect_four も 同様) + 誕生日バナー 古いキャッシュ 救済 + オセロ AI 名 「💣 オセロ AI」 専用化 + AI 地雷 配置済み hint + AI に 1 秒 考える間' },
  { v: 'v625', d: '2026-06-15', s: '💣 地雷オセロ コンピュータ対戦 追加 (2pt、 払戻なし、 greedy + 角ボーナス AI、 AI 地雷は内側 12 マスからランダム配置)' },
  { v: 'v624', d: '2026-06-15', s: 'プレイフィー 調整: AI 麻雀 1→5pt / 地雷オセロ 1→2pt / 大富豪 1→2pt / 人狼 1→2pt (マルバツ 1pt / ito 1pt / 絵しりとり 2pt は据置)' },
  { v: 'v623', d: '2026-06-15', s: 'マルバツ 改良 (新 場代モデルに合わせて UI 文言整理) + 娯楽ハブ の バッジ統一 (無料は 表示なし / プレイフィーは X pt のみ表示)。 絵しりとり プレイフィー 2pt/人 (初回ターンで lazy 徴収)、 AI 麻雀 プレイフィー 1pt 化。 README + docs/CUSTOM_GAMES.md 更新' },
  { v: 'v622', d: '2026-06-15', s: 'ビンゴ 実績 追加: 🎯 通算 ライン数 + 🗓 ビンゴ 達成 週数' },
  { v: 'v621', d: '2026-06-15', s: '自作ゲーム 課金モデル を 「掛け金 / pot」 から 「場代 = プレイ毎の課金 (提供者 90% / SYSTEM 10%、 fee=0 可)」 に 簡素化。 終了時の払戻なし。' },
  { v: 'v620', d: '2026-06-15', s: '自作ゲーム を ユーザ単位で 登録可能に (設定→自作ゲーム管理) + JS を DB アップロード (サーバ書込権限不要) + 場代 % を 提供者が 受取れる + 汎用 /cg/:kind ディスパッチャ' },
  { v: 'v619', d: '2026-06-15', s: '自作ゲーム kind を DB 管理化 (管理画面から登録) + ビンゴ詳細レイアウト fix + 待ち合わせ false-positive 修正' },
  { v: 'v618', d: '2026-06-15', s: '自作ゲーム JS-only 化 (PHP 1 行 + JS 1 ファイル) + ビンゴ反映 bug 修正 (table/column 名 全部間違い)' },
  { v: 'v617', d: '2026-06-15', s: '自作ゲーム フレームワーク + サンプル ⭕❌ マルバツ + docs/CUSTOM_GAMES.md ガイド #236' },
  { v: 'v616', d: '2026-06-15', s: 'ビンゴ平日限定撤廃 (土日も) #239 + 食べある記メニュー化 #238 + SNS シェア モーダル化 #237' },
  { v: 'v615', d: '2026-06-15', s: '誕生日バナー出てなかった bug 修正 (/api/auth/me が birthday_md を返してなかった)' },
  { v: 'v614', d: '2026-06-15', s: 'ワリカ: 海外通貨の支出に カード会社の為替手数料 3.63% を 自動上乗せ' },
  { v: 'v613', d: '2026-06-15', s: '✂️ 文字数・単語数リライター (アブスト/リバッタル の制限と戦う、 サーバ側で正確カウント + 最大3回 再依頼)' },
  { v: 'v612', d: '2026-06-15', s: '原稿チェック PDF オンリー化 + ランダムグループ自動通知 + 順番決め コピー + 大富豪/オセロ プレイフィーのみ化' },
  { v: 'v611', d: '2026-06-15', s: '研究 / 運営 タブ から アイコン (🔬 🏢) を撤去、 文字のみに' },
  { v: 'v610', d: '2026-06-15', s: '優勝予想 / 勝敗予測 で 起案時の 通知対象 メンバー指定 + 「本日ラボイン済み」 メッセージ撤去' },
  { v: 'v609', d: '2026-06-15', s: '研究 / 運営タブ追加 + 勝敗予測アプリ (試合のスコアを当てて山分け)' },
  { v: 'v608', d: '2026-06-15', s: 'バージョン履歴 モーダル (タップで表示) + 地雷オセロ 地雷 2 → 1 個に' },
  { v: 'v607', d: '2026-06-15', s: 'ラボインボーナス説明: ベテラン判定 longest_streak 5 → 3 に緩和' },
  { v: 'v606', d: '2026-06-15', s: '残高横ビンゴを 5x5 ミニ盤に + ラボインボーナス説明をベテラン (5+ 連続) は省略' },
  { v: 'v605', d: '2026-06-15', s: 'ホーム残高横に ビンゴサマリ、 ウィジェットは デフォルト OFF に戻す' },
  { v: 'v604', d: '2026-06-15', s: '娯楽ハブ: 💬 みんなで共有 (らぼったー/食べある記) を最上段に' },
  { v: 'v603', d: '2026-06-15', s: '💴 売買 カテゴリ新設 + らぼったー/食べある記/フライト応援を娯楽へ' },
  { v: 'v602', d: '2026-06-15', s: 'アプリ: カテゴリ内の並び順を CATEGORY_ORDER マップで指定可能に' },
  { v: 'v601', d: '2026-06-15', s: '🔬 研究用 + 🏢 研究室運営サポート の 2 カテゴリ新設、 トップに配置' },
  { v: 'v600', d: '2026-06-15', s: '巡回まとめ: 連続ラボイン切れ表示修正 + カテゴリ整理 + 誕生日登録 + ビンゴウィジェット' },
  { v: 'v599', d: '2026-06-15', s: 'らぼったーが古いまま問題を修正 (SW SWR キャッシュ無効化のバグ)' },
  { v: 'v598', d: '2026-06-15', s: '占いスペース修正 + 原稿チェック PDF 対応 + サムネ品質改善 (320→640px)' },
  { v: 'v597', d: '2026-06-15', s: 'ビンゴ: FREE マス撤廃 + TODO/重要連絡 を プールから除外' },
  { v: 'v596', d: '2026-06-15', s: '散歩 特殊スワイプロック (↑→↓→↑ で解除)' },
  { v: 'v595', d: '2026-06-15', s: '大富豪 革命 (4 枚同時) + 8 切り (場流し + 同プレイヤー継続)' },
  { v: 'v594', d: '2026-06-15', s: 'シェアボタン展開 (tierlists / polls / auctions / mahjong / othello / daifugo)' },
  { v: 'v593', d: '2026-06-15', s: 'ビンゴ過去週閲覧 + 過去カード メタ取得 API' },
  { v: 'v592', d: '2026-06-15', s: 'ビンゴ 500 修正 + 占いボタン化 + SNS 画像/位置 + 残高カード 表示要素 設定' },
  { v: 'v591', d: '2026-06-15', s: '散歩 軌跡 画像化 → SNS 投稿 + 過去軌跡 重ね合わせ' },
  { v: 'v590', d: '2026-06-15', s: '大富豪 (シンプル MVP、 2-4 人、 1pt buy-in、 1 位 総取り)' },
  { v: 'v589', d: '2026-06-15', s: '散歩モード (Wake Lock + GPS 5 秒 軌跡記録 + 履歴閲覧)' },
  { v: 'v588', d: '2026-06-15', s: 'ビンゴ (週次 5x5、 平日 行動 自動判定、 リーチ / BINGO 演出、 LB)' },
  { v: 'v587', d: '2026-06-15', s: '地雷オセロ (1pt buy-in、 各自 2 地雷、 3x3 反転)' },
  { v: 'v586', d: '2026-06-14', s: 'フライト応援 (オフライン、 Wake Lock、 進捗% + 応援メッセージ)' },
  { v: 'v585', d: '2026-06-14', s: '麻雀 音声 (チー/ポン/ロン/カン/リーチ) + 天気/日の出 + シェアボタン' },
  { v: 'v584', d: '2026-06-14', s: '1 日 1 回 占い (30 種、 ホーム ポイント ウィジェット 内 表示)' },
  { v: 'v583', d: '2026-06-14', s: 'レジュメ原稿チェック (paper-review の 軽量版、 5pt、 #225)' },
  { v: 'v582', d: '2026-06-14', s: '優勝予想 締切 カウントダウン + ティア表 5 段階 + 画像対応 + 「対戦」 ラベル' },
  { v: 'v581', d: '2026-06-14', s: 'らぼったー ウィジェット に 投稿欄を追加 (Ctrl+Enter 対応)' },
  { v: 'v580', d: '2026-06-13', s: 'ホームのウィジェット / アイコン を 全アプリ 設定可能に + 絵しりとり 30 秒固定' },
  { v: 'v579', d: '2026-06-13', s: '制覇マップ 国リスト を 105 → 201 (UN 加盟 193 国 + 主要地域)' },
  { v: 'v578', d: '2026-06-13', s: 'AI 麻雀 を 練習モード化 (ポイント授受なし、 #224)' },
  { v: 'v577', d: '2026-06-13', s: '優勝予想: 締切後に予想を 即公開 + 2026 W杯 出場 48 か国 実データ' },
  { v: 'v576', d: '2026-06-12', s: '優勝予想 アプリ (W杯 / スポーツ / 学会 best paper の 順位予想で 山分け)' },
  { v: 'v575', d: '2026-06-12', s: 'AI 麻雀 + 麻雀 ターン管理 修正 + 各種 細かい改善' },
];

export function showVersionHistory() {
  // 既存モーダルがあれば閉じる
  document.getElementById('vh-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'vh-modal';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:80vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.3)">
      <div style="padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px">
        <h3 style="margin:0; flex:1; font-size:16px">📜 LabPay バージョン履歴</h3>
        <button id="vh-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
      </div>
      <div style="flex:1; overflow:auto; padding:6px 16px">
        ${VERSION_HISTORY.map(v => `
          <div style="padding:10px 0; border-bottom:1px solid #f3f4f6">
            <div style="display:flex; align-items:baseline; gap:8px">
              <span style="font-weight:700; color:#4a106d; font-family:ui-monospace, monospace">${v.v}</span>
              <span style="font-size:11px; color:#999; font-variant-numeric:tabular-nums">${v.d}</span>
            </div>
            <div style="font-size:13px; line-height:1.5; margin-top:2px">${v.s}</div>
          </div>
        `).join('')}
        <div style="padding:14px 0; text-align:center; font-size:12px; color:#888">
          より古いバージョン は <a href="https://github.com/nkmr-lab/LabPay/commits/main" target="_blank" rel="noopener" style="color:#4a106d">GitHub</a> で
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.getElementById('vh-close').addEventListener('click', () => overlay.remove());
}

// グローバル関数として登録 (HTML attribute から呼べるように)
window.showVersionHistory = showVersionHistory;
