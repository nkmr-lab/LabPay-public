# LabPay API

自作クライアント向けのリファレンス。全エンドポイントは JSON、Cookie 認証 (`labpay_sid`) または Bearer 認証。 CORS は **`*.nkmr.io` サブドメイン全許可** (v932+、それ以外は同一オリジンのみ)。

> 現行バージョン: **v935** (最終大幅更新)。
> 変更点は git log と `public/js/version_history.js` を参照。
> v932: **CORS を `*.nkmr.io` に開放** (旧: 同一オリジン限定)、 Cookie `SameSite=None`。 v933: AI 系結果の PDF エクスポート (印刷経由)。 v934: **かんばん (Trello-like) 追加** (`/api/kanban`)。 v935: refs UI 微調整 (BibTeX = クリップボード / タグ chip 固定 / PC 左右余白)。

## 共通ルール

- **認証**: ブラウザで `GET /api/auth/login` (Google) もしくは `POST /api/auth/dev-login` を済ませると `labpay_sid` Cookie が立つ。以降は `fetch(url, { credentials: 'same-origin' })` で OK
- **CSRF**: 変更系 (`POST/PATCH/PUT/DELETE`) は **必ず** `X-Requested-With: labpay` ヘッダを付ける。`Authorization: Bearer ...` を使う場合はこのチェックをスキップ
- **冪等性**: `POST /api/purchases` `POST /api/transfers` は body に `idempotency_key` (UUID 推奨、8-80字) が必須。同じキーで再送すると保存済みレスポンスが返る
- **エラー形式**:
  ```json
  { "error": { "code": "insufficient_funds", "message": "...", "details": { ... } } }
  ```
- **exposure 設定** で無効化されている機能は `403 feature_disabled`
- **CORS (v932+)**: `Origin` が `^https://[a-z0-9-]+\.nkmr\.io$` にマッチすれば `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true` を返す。 preflight `OPTIONS` は 204。 Cookie は `SameSite=None; Secure` で `*.nkmr.io` のサブドメイン間で自動送信される
- **ルーティング**: `public/api/index.php` の dispatch table が第1セグメント → `route_XXX` に振り分け。以降の path は各ハンドラ内の `if` 分岐で method + sub-segments を判定する二段階ルーティング

---

## 認証 `/api/auth`

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/auth/me`        | 現ログイン情報 + 残高。未ログインは 401 |
| GET  | `/api/auth/login`     | Google OAuth 開始 (302 → Google) |
| GET  | `/api/auth/callback`  | OAuth 戻り先 (Google が呼ぶ) |
| POST | `/api/auth/dev-login` | `{ "email": "..." }` 許可リストにあれば即ログイン (`dev_login_enabled` 時のみ) |
| POST | `/api/auth/logout`    | セッション破棄 |

---

## 自分 `/api/me`

| Method | Path | 説明 |
|---|---|---|
| GET   | `/api/me`                | 残高 + streak + `avatar_url` / `scrapbox_username` / `grade` / `birthday_md` / `hobbies` / `favorites` 含む |
| PATCH | `/api/me`                | プロフィール更新: `{ display_name?, avatar_url?, scrapbox_username?, birthday_md?, hobbies?, favorites?, slack_member_id? }` |
| GET   | `/api/me/transactions?limit=&offset=` | 取引履歴 (購入/販売/手数料/来室/送金/タスク報酬/取消全部) |
| GET   | `/api/me/listings?status=` | 自分の出品 |
| GET   | `/api/me/achievements`   | 実績 15軸 × 4段階の獲得状況・進捗 |
| GET   | `/api/me/presence_summary` | ラボ滞在時間 (today/week/month/total minutes) |
| GET   | `/api/me/scrapbox_handles` | 申告した Scrapbox 表示名一覧 + 直近 30 日の獲得 pt |
| POST  | `/api/me/scrapbox_handles` | `{ handle }` 申告 (既存 handle は奪取される) |
| DELETE| `/api/me/scrapbox_handles/{handle}` | 解除 |
| GET   | `/api/me/lab_settings`   | 自分のホーム / タブ表示設定 (v600 台) |
| PATCH | `/api/me/lab_settings`   | 上書き保存 |

GET `/api/me` 応答例:

```json
{
  "user": {
    "id": 3, "email": "...", "display_name": "...",
    "role": "admin", "kind": "human",
    "avatar_url": "/uploads/products/abc123.jpg",
    "scrapbox_username": "nakamura-satoshi",
    "grade": "M2", "birthday_md": "01-15"
  },
  "balance": 1010,
  "streak": { "current_streak": 1, "longest_streak": 1, "last_checkin_date": "2026-05-31" }
}
```

---

## ユーザ一覧 `/api/users`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/users?q=` | 人間ユーザの軽量ディレクトリ。`{id, display_name, avatar_url, grade}` |
| GET | `/api/users/{id}/profile` | 公開プロフィール (display_name / avatar / grade / hobbies / favorites / scrapbox_username) |

---

## 商品マスタ `/api/products`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/products?q=&limit=`     | 商品マスタ検索 |
| GET    | `/api/products/{jan}`         | JAN 指定。マスタになければ外部 API (楽天) 試行、無ければ 404 |
| POST   | `/api/products`               | `{ jan, name, image_url? }` JAN 登録/更新 (8-20桁数字に自動正規化) |
| POST   | `/api/products/no_jan`        | `{ name, image_url? }` バーコード無し商品 — 合成 JAN を自動発行 |

---

## 出品 `/api/listings`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/listings?status=on_sale&q=` | 一覧 (jan / 出品者 / 価格 / 画像 / タグ) |
| POST   | `/api/listings`                   | `{ jan, price, qty, description?, image_url?, tags?[], location?, closes_at? }` |
| GET    | `/api/listings/{id}`              | 詳細 |
| PATCH  | `/api/listings/{id}`              | 編集 (出品者 or admin) |
| DELETE | `/api/listings/{id}`              | 取下げ |

---

## 購入 `/api/purchases`

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/purchases` | `{ listing_id, idempotency_key }` 実行。残高不足で 402 |

---

## 送金 `/api/transfers`

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/transfers` | `{ to_user_id, amount, memo?, idempotency_key }` |

---

## ラボイン (来室) `/api/checkins`

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/checkins` | 手動チェックイン (1 日 1 回) |
| GET  | `/api/checkins/today` | 今日の状況 |
| GET  | `/api/checkins/history` | 履歴 |

---

## タスク `/api/tasks`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/tasks?status=&scope=` | 一覧 (open/claimed/reported/approved/closed/cancelled) |
| POST   | `/api/tasks`                | 新規募集 (深い body、 slots_spec / assigned_user_ids / funded_by_system 等) |
| GET    | `/api/tasks/{id}`           | 詳細 (claims / slots 含む) |
| PATCH  | `/api/tasks/{id}`           | 編集 |
| DELETE | `/api/tasks/{id}`           | 削除 |
| POST   | `/api/tasks/{id}/claim`     | 手を挙げる |
| POST   | `/api/tasks/{id}/unclaim`   | 取消 |
| POST   | `/api/tasks/{id}/report`    | 完了報告 (details 入力) |
| POST   | `/api/tasks/{id}/approve`   | 承認 → 支払 |
| POST   | `/api/tasks/{id}/reject`    | 差戻し |
| POST   | `/api/tasks/{id}/close`     | 締める |
| POST   | `/api/tasks/{id}/cancel`    | 起案取消 (エスクロー返金) |

---

## 在室検知 `/api/presence`

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/presence/now`     | 現在誰が居るか (最終検知 5 分以内) |
| POST | `/api/presence/scan`    | Scanner が Bearer 認証で送信 (`{ room_id, observations: [{mac, ip}] }`) |
| GET  | `/api/presence/sessions?date=` | 全員の滞在セッション |

---

## 通知 `/api/notifications`

| Method | Path | 説明 |
|---|---|---|
| GET   | `/api/notifications?unread=1` | 一覧 |
| POST  | `/api/notifications/read`     | `{ ids: [...] }` 既読 |
| POST  | `/api/notifications/read-all` | 全既読 |

---

## 売主信用 `/api/sellers`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/sellers/{user_id}` | 評価 / トラブル履歴 |

---

## 画像アップロード `/api/uploads`

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/uploads/image` | `multipart/form-data` (file)。 JPEG/PNG/HEIC 対応、最大 15MB、 EXIF 回転補正済 URL 返却 |

---

## 管理者 `/api/admin`

要 admin role。

### 許可リスト
| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/admin/allowlist(/...)` | 許可 email + 表示名 + grade 管理 |

### ユーザ
| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH | `/api/admin/users(/...)` | ユーザ一覧 + 個別編集 (grade / role / active) |

### 経済操作
| Method | Path | 説明 |
|---|---|---|
| POST | `/api/admin/grant`  | `{ user_id, amount, memo }` 手動配布 |
| POST | `/api/admin/refund` | 逆仕訳 |

### 設定
| Method | Path | 説明 |
|---|---|---|
| GET / PATCH | `/api/admin/settings` | fee_rate / initial_points / dev_login_enabled 等 |

### 統計
| Method | Path | 説明 |
|---|---|---|
| GET | `/api/admin/stats` | 総売上 / 手数料 / 発行 pt / ユーザ数 |

### お知らせ
| Method | Path | 説明 |
|---|---|---|
| POST | `/api/admin/broadcast` | 全員に通知 |

### 部屋 / 在室機材 (scanner)
| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/admin/rooms(/...)` | 部屋 CRUD + 位置 (lat/lng/半径) + scanner token 発行 |
| GET / POST / DELETE         | `/api/admin/mac_registrations` | MAC ↔ user_id 紐付け |

### カレンダー
| Method | Path | 説明 |
|---|---|---|
| GET / PATCH | `/api/admin/calendar/oauth` | Google Calendar 認可トークン管理 |
| GET / POST  | `/api/admin/calendar/filters` | 表示フィルタ |

### Scrapbox 同期 (Slack ブリッジ)
| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/admin/scrapbox/sync/status` | 同期状況 |
| POST | `/api/admin/scrapbox/sync/backfill` | 過去分再取得 |

---

## Wishlist `/api/wishlist`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/wishlist`               | 一覧 |
| POST   | `/api/wishlist`               | `{ jan, name, price?, note? }` |
| PATCH  | `/api/wishlist/{id}`          | 編集 |
| DELETE | `/api/wishlist/{id}`          | 削除 |

---

## 募集 `/api/invitations`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/invitations(/...)` | 学会/遠征などの寄付募集。 `feat_actions` でオンライン説明会/懇親会追加可 |
| POST | `/api/invitations/{id}/join` | 参加 |
| POST | `/api/invitations/{id}/donate` | 寄付 (`{amount}`) |

---

## 投票 `/api/polls`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/polls`             | 一覧 |
| POST   | `/api/polls`             | 作成 (options / deadline / visibility=creator/open/after_deadline / multi_select / allow_revote / allow_free_text) |
| GET    | `/api/polls/{id}`        | 詳細 (集計は visibility 次第で表示) |
| PATCH  | `/api/polls/{id}`        | 編集 |
| DELETE | `/api/polls/{id}`        | 削除 |
| POST   | `/api/polls/{id}/vote`   | 投票 |
| PATCH  | `/api/polls/{id}/close`  | 締切 |
| POST   | `/api/polls/{id}/remind` | 未投票者に督促 |
| POST   | `/api/polls/{id}/create-group` | v912 投票結果からグループ作成 |

## 点呼 `/api/rollcalls`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/rollcalls(/...)` | 出欠確認 (deadline + 対象者 list) |
| POST | `/api/rollcalls/{id}/respond` | 応答 |
| PATCH | `/api/rollcalls/{id}/close` | 締切 |
| POST | `/api/rollcalls/{id}/remind` | 未応答者に督促 |

## タイマー `/api/timers`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / DELETE | `/api/timers(/...)` | 学会タイマー (発表時間 + ベル 3 段 + repeat) |
| GET  | `/api/timers/{id}/public` | 認証不要の公開表示用 (v676) |
| PATCH | `/api/timers/{id}/start` | 開始 |
| PATCH | `/api/timers/{id}/pause` | 一時停止 |
| PATCH | `/api/timers/{id}/reset` | リセット |
| PATCH | `/api/timers/{id}/cancel` | 中止 |

## お知らせ `/api/notices`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/notices(/...)` | 学会案内 / ラボ通達 |

## 待ち合わせ `/api/meetups`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH / DELETE | `/api/meetups(/...)` | `{title, location, meetup_at, member_ids[]}` 集合 |
| PATCH | `/api/meetups/{id}/cancel` | 取消 |
| POST  | `/api/meetups/{id}/participants` | 参加者追加 |
| GET / POST | `/api/meetups/{id}/messages` | シェアメッセージ |

---

## 食べある記 `/api/places`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/places`         | お店一覧 (地図モード / 新着モード) |
| POST   | `/api/places`         | 作成 (title / category / lat / lng / phone / hours / source_url) |
| POST   | `/api/places/import_url` | tabelog / Retty / hotpepper / TripAdvisor URL → JSON-LD 抽出 (v921 TripAdvisor 対応) |
| POST   | `/api/places/search_url` | キーワードから tabelog URL 検索 |
| POST   | `/api/places/backfill_tabelog_urls` | admin: URL 一括補完 |
| GET    | `/api/places/{id}`    | 詳細 |
| PATCH  | `/api/places/{id}`    | 編集 |
| DELETE | `/api/places/{id}`    | 削除 |
| POST   | `/api/places/{id}/comments` | 口コミ投稿 (v921 で起案者にレビュー通知) |
| DELETE | `/api/places/{id}/comments/{cid}` | 削除 |
| POST   | `/api/places/{id}/comments/{cid}/rotate-image` | 画像回転 |
| POST   | `/api/places/{id}/rotate-image` | ヒーロー画像回転 |
| POST/DELETE | `/api/places/{id}/like`  | いいね ❤ |
| POST/DELETE | `/api/places/{id}/visit` | 訪問 👣 |

---

## らぼったー (SNS) `/api/posts`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/posts`             | タイムライン (`?since_id` / `?until_id` で双方向) |
| POST   | `/api/posts`             | 投稿 (text + image + lat/lng + mentions + reply_to) |
| GET    | `/api/posts/latest_id`   | 軽量ポーリング用 max id |
| GET    | `/api/posts/{id}`        | 詳細 (返信ツリー含む) |
| DELETE | `/api/posts/{id}`        | 削除 |
| DELETE | `/api/posts/{id}/location` | 位置だけ削除 (v736) |
| POST/DELETE | `/api/posts/{id}/like` | (旧) heart |
| POST   | `/api/posts/{id}/reaction?kind=thumb\|heart\|star` | 付与 |
| DELETE | `/api/posts/{id}/reaction?kind=...` | 解除 |
| POST   | `/api/posts/{id}/rotate-image` | 画像回転 |

## TODO `/api/todos`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/todos(/...)` | 個人 TODO (body / due / url / notes / partner) |

## 効果音 `/api/sounds`

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/sounds/clips`   | 全 clip 一覧 |
| POST | `/api/sounds/clips`   | audio upload (admin、 mp3/ogg/wav/m4a、 2MB) |
| DELETE | `/api/sounds/clips/{id}` | 削除 (admin) |
| GET  | `/api/sounds/defaults`| event 規定値一覧 |
| PATCH| `/api/sounds/defaults/{event_key}` | 規定値変更 (admin) |
| GET  | `/api/sounds/my`      | 自分の上書き + 解決済み |
| PATCH| `/api/sounds/my/{event_key}` | `{mode: default\|custom\|mute, clip_id?, volume?}` |

## オークション `/api/auctions`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / DELETE | `/api/auctions(/...)` | 単位は **円** |
| POST  | `/api/auctions/{id}/bids`  | `{amount}` 現最高 +1 以上 |
| PATCH | `/api/auctions/{id}/cancel`| 出品取消 |

## 運動 (歩数) `/api/exercise`

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/exercise`             | 自分の sessions + today/this_week/this_month/lifetime |
| POST | `/api/exercise`             | `{step_count, duration_seconds, started_at, ended_at}` (1 セッション 30 分まで、 6 歩/秒超は弾く) |
| DELETE | `/api/exercise/{id}`      | 削除 |
| GET  | `/api/exercise/leaderboard` | 今週合計トップ 30 |

## プレイリスト `/api/playlists`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH / DELETE | `/api/playlists(/...)` | YouTube / Spotify URL コレクション |
| POST | `/api/playlists/{id}/like` | ❤ トグル |
| POST | `/api/playlists/{id}/items` | 曲追加 |
| PATCH/DELETE | `/api/playlists/{id}/items/{iid}` | 編集/削除 |
| PATCH | `/api/playlists/{id}/items/{iid}/move` | 並べ替え |
| POST/DELETE | `/api/playlists/{id}/items/{iid}/rating` | ⭐ 評価 |

## ストップウォッチ `/api/stopwatches`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / DELETE | `/api/stopwatches(/...)` | 共有ラップタイム |
| POST | `/api/stopwatches/{id}/start` | 開始 |
| POST | `/api/stopwatches/{id}/pause` | 停止 |
| POST | `/api/stopwatches/{id}/reset` | リセット |
| POST | `/api/stopwatches/{id}/lap`   | ラップ記録 |

---

## AI 系 `/api/ai`

大きく 4 系統 + ヘルパ。全て OpenAI Files API + chat.completions / Responses API 経由、非同期 + share_token パターン。

### 論文要約 (paper_translate, v748+)

要約 (落合メソッド + 図表 inline)。モデル別 pt (gpt-5-mini 30 / gpt-5 50 / o1 80)。 v914 で「共有=半額、非共有=基本額」プライシング (auto_share フラグ)。

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/paper_translate` | 開始 (multipart PDF + model + auto_share) |
| GET  | `/api/ai/paper_translate` | 履歴一覧 |
| GET  | `/api/ai/paper_translate/r/{token}` | 共有取得 (認証必要、中身は全員 read 可) |
| GET  | `/api/ai/paper_translate/shared?q=` | 公開要約一覧 (v756) |
| PATCH| `/api/ai/paper_translate/{id}` | 共有 toggle (`{is_shared}`, v914 で差額課金/返金) |
| POST | `/api/ai/paper_translate/{id}/redo` | やり直し (別モデルで再要約、保存 PDF 使用) |
| POST | `/api/ai/paper_translate/{id}/retry` | エラー再投入 (v806) |
| DELETE | `/api/ai/paper_translate/{id}` | 削除 |
| POST | `/api/ai/paper_translate/from_full/{id}` | 全訳 row から要約 pair を作る (v813) |
| POST | `/api/ai/paper_translate/{id}/react`   | ❤ toggle |
| GET/POST/DELETE | `/api/ai/paper_translate/{id}/comments(/...)` | コメント |

### 論文全訳 (paper_full_translate, v788+)

章ごと full translation + back-translation 整合確認。英→日 (gpt-5 60pt 等) と日→英 (5x 料金)。

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/paper_full_translate` | 開始 (`{direction: en2ja\|ja2en, model, auto_share}`) |
| GET  | `/api/ai/paper_full_translate` | 履歴 |
| GET  | `/api/ai/paper_full_translate/r/{token}` | 取得 |
| GET  | `/api/ai/paper_full_translate/shared?q=` | 公開一覧 |
| PATCH| `/api/ai/paper_full_translate/{id}` | 共有 toggle |
| DELETE | `/api/ai/paper_full_translate/{id}` | 削除 |
| POST | `/api/ai/paper_full_translate/{id}/retry` | 再投入 |
| POST | `/api/ai/paper_full_translate/from_summary/{id}` | 要約 row から全訳 pair (v798) |
| POST | `/api/ai/paper_full_translate/{id}/react` | ❤ toggle |
| GET/POST/DELETE | `/api/ai/paper_full_translate/{id}/comments(/...)` | コメント |

### 論文査読 (paper_review, v550+)

Accept/Reject + 強み/弱み/著者へのコメント。 target_venue + strictness 指定。

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/paper_review` | 開始 (multipart PDF + target_venue + strictness + model + response_text/pdf?) |
| GET  | `/api/ai/paper_review` | 履歴 |
| GET  | `/api/ai/paper_review/r/{token}` | 取得 |
| GET  | `/api/ai/paper_review/settings` | プロンプト設定 |
| PUT  | `/api/ai/paper_review/settings` | 設定保存 |

### Deep Research (deep_research, v781+)

Web 横断多段調査。 gpt-5-mini (light 10pt) / gpt-5 (standard 25pt / deep 50pt)。 background=true で非同期。

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/deep_research` | 開始 (`{query, depth, auto_share}`) |
| GET  | `/api/ai/deep_research` | 履歴 |
| GET  | `/api/ai/deep_research/r/{token}` | 取得 |
| GET  | `/api/ai/deep_research/shared?q=` | 公開一覧 |
| PATCH| `/api/ai/deep_research/{id}` | 共有 toggle |
| DELETE | `/api/ai/deep_research/{id}` | 削除 |

### 原稿チェック / リライター (v583, v613)

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/resume_check` | レジュメ / 概要チェック (5pt、 PDF 必須 v612+) |
| GET / GET :id | `/api/ai/resume_check(/{id})` | 履歴 / 個別 |
| POST | `/api/ai/rewriter`     | 文字数リライター (1pt、サーバ側カウント + 最大 3 回再依頼) |
| GET / GET :id | `/api/ai/rewriter(/{id})` | 履歴 / 個別 |

### チャット / アシスタント / 短タイトル

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/ai/chat`         | チャット |
| POST | `/api/ai/assistant`    | 一般アシスタント |
| POST | `/api/ai/short_title`  | タイトル AI 命名 |
| POST | `/api/ai/expand_schedule` | 予定フリーフォーム展開 |
| POST | `/api/ai/translate_image` | 画像翻訳 |
| POST | `/api/ai/place_lookup` | 店名等情報検索 |
| GET / DELETE | `/api/ai/translations(/{id})` | 翻訳履歴 |

### スター / ブックマーク (v789+)

各 AI 結果 (paper_translate / paper_full / deep_research / rewriter 等) を `kind + ref_id` で ⭐ / 🔖。

| Method | Path | 説明 |
|---|---|---|
| POST/DELETE | `/api/ai/stars`     | `{kind, ref_id}` |
| POST/DELETE | `/api/ai/bookmarks` | 同上 |

### 新着 feed

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/ai/paper_recent?sort=new\|stars` | v809 要約 + 全訳合算新着 |

---

## 予測系

### 優勝予想 (v580+) `/api/predictions`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH | `/api/predictions/games(/...)` | 順位予想 (1位のみ / 1-2位 / 1-4位) |
| POST | `/api/predictions/games/{id}/predict` | 予想 |
| POST | `/api/predictions/games/{id}/close` | 締切 |
| POST | `/api/predictions/games/{id}/finalize` | 結果 (山分け + 場代 5%) |
| POST | `/api/predictions/games/{id}/cancel` | 取消 |

### 勝敗予測 (v610+) `/api/score_predictions`

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH | `/api/score_predictions/games(/...)` | スコア予想 (例 3-2) |
| POST | `/api/score_predictions/games/{id}/predict` | 予想 |
| POST | `/api/score_predictions/games/{id}/close` | 締切 |
| POST | `/api/score_predictions/games/{id}/finalize` | 結果 (完全的中山分け + 場代 5%) |
| POST | `/api/score_predictions/games/{id}/cancel` | 取消 |

---

## 占い `/api/fortune`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/fortune/today` | 今日の運勢 + 星座 (user × date で一意) |

---

## ゲーム系

### `/api/mahjong` 麻雀

賭けプール + 実ゲーム (門前/鳴き/役判定/連荘/半荘) + AI 対戦。

| Method | Path | 説明 |
|---|---|---|
| GET/POST/GET :id/POST :id/{join,leave,start,cancel,call,discard,riichi,tsumo,ron,pass} | `/api/mahjong/games(/...)` | 全ライフサイクル |
| POST | `/api/mahjong/sim` | 賭けプールのみシミュレート |
| POST | `/api/mahjong/ai/new` | AI 対戦作成 |

### `/api/ito` ito 協力

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/ito/games(/...)` | 一覧 / 作成 / 詳細 |
| POST | `/api/ito/games/{id}/{join,leave,start,express,reveal,cancel}` | ライフサイクル |

### `/api/jinrou` 人狼

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/jinrou/games(/...)` | |
| POST | `/api/jinrou/games/{id}/{join,leave,start,action,advance,cancel}` | 夜/昼 action + フェーズ進行 |

### `/api/daifugo` 大富豪

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/daifugo/games(/...)` | 革命 + 8切り + ジョーカー |
| POST | `/api/daifugo/games/{id}/{join,start,play,pass,cancel,resign}` | プレイフィー 1pt |

### `/api/othello` 地雷オセロ

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/othello/games(/...)` | 各自 1 地雷 (3x3 反転) |
| POST | `/api/othello/games/{id}/{join,mines,move,pass,cancel,resign}` | |
| POST | `/api/othello/ai/new` | AI 対戦 |

### `/api/shiritori` 絵しりとり

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/shiritori/games(/...)` | 時間制限キャンバス + ストローク記録 |
| POST | `/api/shiritori/games/{id}/{join,draw,submit,skip,cancel}` | |

### `/api/tierlists` ティア表

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/tierlists`     | 一覧 / 作成 (お題 + 候補) |
| GET / PUT / DELETE | `/api/tierlists/{id}` | 詳細 / 回答保存 / 削除 |

### `/api/bingo` 週次ビンゴ

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/bingo/me` | 今週の自分カード |
| GET | `/api/bingo/leaderboard` | 今週リーダーボード |
| GET | `/api/bingo/history` | 過去 12 週 |
| GET | `/api/bingo/week/{date}` | 過去週閲覧 |

### `/api/bingofit` 服ビンゴ (v815+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/bingofit/items` | 衣類一覧 / 追加 |
| PATCH / DELETE | `/api/bingofit/items/{id}` | 編集 / ソフト削除 |
| POST | `/api/bingofit/items/{id}/retry-bg` | 背景透過再試行 |
| GET | `/api/bingofit/board?week=` | 今週 or 過去週の盤 |
| POST / DELETE | `/api/bingofit/board/cells/{idx}/open` | マス開ける / 取消 |
| GET | `/api/bingofit/history` | 過去 12 週 |

### `/api/quizzes` フリップクイズ (v655+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/quizzes` | 一覧 / 作成 |
| GET  | `/api/quizzes/{id}` | 詳細 |
| POST | `/api/quizzes/{id}/{ask,answer,reveal,score,next,finish,cancel}` | ライフサイクル |

### `/api/buzzer` 早押しクイズ (v872)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/buzzer/sessions` | 一覧 / 作成 |
| GET  | `/api/buzzer/sessions/{id}` | 詳細 (現在 round + ranking) |
| POST | `/api/buzzer/sessions/{id}/new-round` | 起案者「次へ」 |
| POST | `/api/buzzer/sessions/{id}/tap`  | 早押し送信 (ローカル ms 計測) |
| POST | `/api/buzzer/sessions/{id}/end`  | 終了 |
| GET  | `/api/buzzer/sessions/{id}/poll` | 800ms ポーリング |

### `/api/drafts` ドラフト

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id | `/api/drafts(/...)` | 起案 / 一覧 |
| POST | `/api/drafts/{id}/{pick,draw,advance,cancel}` | 指名 / くじ / ラウンド進行 |

### `/api/custom-games` 自作ゲーム v1

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/custom-games/list` | 有効な kind 一覧 |
| GET / POST | `/api/custom-games/kinds` | 全 kind (含 disabled) / 登録 |
| GET  | `/api/custom-games/kinds/{kind}/script.js` | JS 配信 (認証不要) |
| PATCH / DELETE | `/api/custom-games/kinds/{kind}` | 編集 / 無効化 |
| GET / POST | `/api/custom-games/{kind}/games`      | 卓一覧 / 起案 |
| GET  | `/api/custom-games/{kind}/games/{id}` | 詳細 |
| POST | `/api/custom-games/{kind}/games/{id}/{join,move,cancel,resign}` | |

### `/api/cg2` 自作ゲーム v2

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/cg2/kinds` | kind 一覧 / 新規 |
| GET  | `/api/cg2/kinds/{slug}/script.js` | JS 配信 (認証不要) |
| PATCH / DELETE | `/api/cg2/kinds/{slug}` | 更新 / 削除 |
| GET / POST | `/api/cg2/kinds/{slug}/games` | 卓 |
| GET  | `/api/cg2/games/{id}` | 詳細 |
| POST | `/api/cg2/games/{id}/{join,add-ai,start,cancel,finalize}` | |
| GET / POST | `/api/cg2/games/{id}/shared` | 共有状態取得 / 更新 |

### `/api/custom-widgets` 自作ウィジェット

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH / DELETE | `/api/custom-widgets(/...)` | |
| GET  | `/api/custom-widgets/{id}/script.js` | JS 配信 |

### `/api/bait` 釣り依頼

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / DELETE | `/api/bait/requests(/...)` | 起案側 |
| POST | `/api/bait/requests/{id}/remind` | 督促 |
| PATCH | `/api/bait/requests/{id}/close` | 締める |
| GET  | `/api/bait/my-assignments` | worker 視点 |
| PATCH | `/api/bait/assignments/{aid}/{done,undone}` | 完了 / 取消 |

---

## グループ・チャット・共有

### `/api/groups` (ad-hoc + スケジュール + 宿泊 + 航空券 + e-ticket)

主要 (詳細は `src/handlers/adhoc_groups.php` 内 dispatch を参照):

- `GET / POST / GET :id / PATCH :id / DELETE :id (close)` 通常 CRUD
- `DELETE :id/hard_delete` 完全削除 (closed_at セット済のみ)
- `POST :id/items` フィード投稿、 `DELETE :id/items/:itemId`
- `POST :id/members`, `DELETE :id/members/:uid`
- `GET/POST :id/expenses`, `PATCH/DELETE :id/expenses/:eid` ワリカ
- `POST :id/settle` 精算通知
- `GET/POST :id/receipts`, `DELETE :id/receipts/:rid` レシート (draft 支出)
- `GET/POST :id/lodgings`, `PATCH/DELETE :id/lodgings/:lid`, `POST :id/lodgings/:lid/sync` スケジュール反映
- `GET/POST :id/flights`, `PATCH/DELETE :id/flights/:fid`, `POST :id/flights/:fid/sync`
- `GET/POST/DELETE :id/flights/:fid/attachments` 添付 PDF / 画像
- `GET/POST/DELETE :id/flights/:fid/etickets` 航空券 e-ticket
- `GET/POST :id/chats`, `DELETE :id/chats/:mid` チャット
- `GET/POST :id/schedule`, `PATCH/DELETE :id/schedule/:itemId`, `PATCH :id/schedule/:itemId/move (up/down)`, `PATCH :id/schedule/:itemId/relocate` (cross-day DnD)
- `GET/POST/DELETE :id/schedule/:itemId/attachments`

### `/api/chat` ラボ内チャット

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/chat/rooms`                    | ルーム一覧 (channel + DM) |
| GET  | `/api/chat/rooms/{roomKey}/messages` | メッセージ取得 |
| POST | `/api/chat/rooms/{roomKey}/messages` | 送信 |
| PATCH| `/api/chat/rooms/{roomKey}/read`     | 既読 |
| DELETE | `/api/chat/messages/{id}`          | メッセージ削除 |
| GET  | `/api/chat/unread`                   | 未読合計 |

### `/api/screen-shares` 画面共有 broadcast

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/screen-shares/active` | 現在アクティブな共有 |
| POST   | `/api/screen-shares`        | 作成 (image+body, expires_at) |
| DELETE | `/api/screen-shares/{id}`   | 起案者 / admin が dismiss |

### `/api/file-transfers` ファイル送信

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/file-transfers` | 送受信一覧 |
| POST   | `/api/file-transfers` | 送信 (multipart, 複数受信者) |
| GET    | `/api/file-transfers/{id}/download` | DL |
| DELETE | `/api/file-transfers/{id}` | 削除 |

### `/api/share` タイトル+URL 共有 (v853)

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/share/notify-users` | タイトル+URL を指定ユーザに共有通知 |

---

## Scrapbox / Cosense

### `/api/scrapbox` Slack ブリッジ経由の Scrapbox feed

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/scrapbox/updates?since=` | 最近の更新 (project 別) |
| GET | `/api/scrapbox/handles` | handle map (Scrapbox 表示名 ↔ user_id) |
| POST | `/api/scrapbox/awards/backfill` | admin: 過去 pt 遡及配布 |

### `/api/cosense` Cosense (旧 Scrapbox) 直接連携 (v821+)

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/cosense/research-note?ym=YYYY-MM` | 研究ノートページ取得 (v825+ セクションエディタ) |
| POST | `/api/cosense/research-note/section` | セクション保存 |
| POST | `/api/cosense/research-note/create-monthly` | v910 未作成月の自動生成 |
| GET  | `/api/cosense/pages/{title}` | 任意ページ取得 |
| GET/POST | `/api/cosense/admin/cookie` | admin: connect.sid |

---

## 研究支援

### `/api/refs` 文献管理 (Zotero-like、v925+)

大幅拡張。主な機能: import (DOI/arXiv/URL/PDF/BibTeX/RIS/Zotero API/CSL-JSON/EndNote XML/Semantic Scholar 検索)、 note (Markdown + 共有)、読状態、コレクション、タグ、 trash、 saved searches、 related items、添付、 highlights、 CSL 引用 7 style、 bibliography 一括生成、 SS references/citations/recommend、 PDF fulltext 検索、 refs 詳細から LabPay AI (要約/全訳/査読/DR) をキック等。

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/refs?q=&tag=&year=&status=&sort=&trash=&collection_id=&uncategorized=&fulltext_q=` | 一覧 (LabPay 側全 filter) |
| POST   | `/api/refs`                    | 新規作成 (title 必須、 doi/arxiv_id/item_type/authors/year/venue/abstract/url/tags/extra、 force=1 で二重登録バイパス) |
| POST   | `/api/refs/import_doi`         | DOI → crossref metadata |
| POST   | `/api/refs/import_arxiv`       | arXiv ID → arxiv API |
| POST   | `/api/refs/import_url`         | URL から DOI / arXiv 抽出 |
| POST   | `/api/refs/import_bibtex`      | BibTeX ファイル / テキスト一括 import |
| POST   | `/api/refs/import_ris`         | RIS 一括 import |
| POST   | `/api/refs/extract_pdf`        | PDF → pdftotext → DOI 検出 or OpenAI で metadata 抽出 |
| POST   | `/api/refs/import_zotero`      | Zotero API 直接連携 (api_key + user_id/group_id、 fetch_all + sync_pdfs 可) |
| POST   | `/api/refs/import_csljson`     | CSL-JSON ファイル |
| POST   | `/api/refs/import_endnote`     | EndNote XML |
| POST   | `/api/refs/bibliography`       | 複数 ref を CSL style で一括引用 (`{ref_ids or collection_id or tag, style}`) |
| POST   | `/api/refs/ss_search`          | Semantic Scholar 検索 (`{query, year?, venue?, limit}`) |
| POST   | `/api/refs/ss_recommend`       | SS レコメンド (`{ref_ids, limit}`) |
| GET    | `/api/refs/tags`               | タグ一覧 + count |
| GET    | `/api/refs/export/bibtex?tag=` | BibTeX 一括ダウンロード |
| GET / POST | `/api/refs/collections`    | コレクション一覧 / 作成 |
| GET / PATCH / DELETE | `/api/refs/collections/{cid}` | 詳細 / 編集 / 削除 |
| POST / DELETE | `/api/refs/collections/{cid}/refs/{rid}` | ref をコレクションに追加 / 除外 |
| GET / POST | `/api/refs/saved_searches` | 保存済検索 |
| DELETE | `/api/refs/saved_searches/{sid}` | 削除 |
| GET    | `/api/refs/{id}`               | 詳細 (links 含む、 SHA 一致でラボ全員の paper_translate/full/review を相互リンク) |
| PATCH  | `/api/refs/{id}`               | 編集 |
| DELETE | `/api/refs/{id}`               | ソフト削除 (二度目で hard delete、 hard は admin のみ) |
| PATCH  | `/api/refs/{id}/note`          | 自分 note + 読状態 upsert |
| POST   | `/api/refs/{id}/attach_pdf`    | 主 PDF 添付 (SHA256 で同定 + pdftotext で fulltext 抽出) |
| GET    | `/api/refs/{id}/bibtex`        | 個別 BibTeX (text/plain) |
| GET / POST | `/api/refs/{id}/attachments`  | 補足添付 (kind = pdf/supplement/slides/video/image/other) |
| DELETE | `/api/refs/{id}/attachments/{aid}` | 削除 |
| POST   | `/api/refs/{id}/restore`       | trash から復元 |
| GET / POST | `/api/refs/{id}/relations` | 関連論文 (bidirectional) |
| DELETE | `/api/refs/{id}/relations/{rid}` | 関連解除 |
| GET    | `/api/refs/{id}/citation?style=apa\|mla\|chicago\|ieee\|nature\|science\|acm` | 単体引用生成 |
| GET    | `/api/refs/{id}/ss_references` | SS: この論文の参考文献 |
| GET    | `/api/refs/{id}/ss_citations`  | SS: この論文の被引用 |
| POST   | `/api/refs/{id}/ss_enrich`     | SS から citation_count / reference_count / ss_id を焼き込む |
| GET / POST | `/api/refs/{id}/highlights`| PDF ハイライト (page + quote + comment + color) |
| PATCH / DELETE | `/api/refs/{id}/highlights/{hid}` | 編集 / 削除 |

### `/api/overleaf` Overleaf プロジェクト追跡 (v886+)

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/overleaf/projects`      | プロジェクト一覧 (delta_24h/7d + sparkline) |
| GET  | `/api/overleaf/projects/{id}` | 詳細 (60日 history + per-file 内訳) |
| GET  | `/api/overleaf/status`        | collector 状態 |
| GET / POST | `/api/overleaf/admin/cookie`  | admin: overleaf_session2 cookie 管理 |
| POST | `/api/overleaf/admin/verify`  | admin: cookie 検証 |
| POST | `/api/overleaf/admin/run`     | admin: collector 即時実行 |
| GET  | `/api/overleaf/admin/runs`    | admin: 実行履歴 |

### `/api/conquest` 制覇リスト (v860+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/conquest/lists` | 一覧 / 作成 |
| GET / PATCH / DELETE | `/api/conquest/lists/{id}` | 詳細 + items / 編集 / 削除 |
| POST | `/api/conquest/lists/{id}/items` | アイテム追加 |
| PATCH / DELETE | `/api/conquest/lists/{id}/items/{iid}` | 編集 / 削除 |
| POST | `/api/conquest/lists/{id}/items/{iid}/visit` | 訪問トグル |

### `/api/habits` Habit Tracker (v870+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/habits` | 一覧 / 作成 |
| GET / PATCH / DELETE | `/api/habits/{id}` | 詳細 (60日カレンダー) / 編集 / 削除 |
| POST / DELETE | `/api/habits/{id}/checkin?date=YYYY-MM-DD` | 達成入力 / 取消 |

### `/api/zemi-videos` ゼミ動画 (v843+)

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/zemi-videos?q=` | 一覧 |
| POST | `/api/zemi-videos`    | 新規登録 |
| POST | `/api/zemi-videos/import-from-cosense` | admin: Cosense タグから一括 import |
| GET / PATCH / DELETE | `/api/zemi-videos/{id}` | 個別 |

### `/api/conf-deadlines` 学会 〆切 (v580+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/conf-deadlines` | 一覧 / 追加 |
| GET  | `/api/conf-deadlines/upcoming` | 直近 upcoming |
| GET / PATCH / DELETE | `/api/conf-deadlines/{id}` | 個別 |
| POST | `/api/conf-deadlines/{id}/members` | メンバー追加 |
| POST | `/api/conf-deadlines/{id}/join` | 自分を追加 |
| POST | `/api/conf-deadlines/{id}/leave` | 自分を除外 |
| DELETE | `/api/conf-deadlines/{id}/members/{uid}` | メンバー除外 |

### `/api/news` IT ニュース

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/news/it`         | はてなIT + HackerNews |
| GET  | `/api/news/history`    | 履歴 |
| POST | `/api/news/summarize`  | 1 件 GPT 要約 |

---

## 名言 `/api/quotes` (v804+)

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/quotes` | 一覧 / 追加 |
| DELETE | `/api/quotes/{id}` | 削除 |

---

## 送金請求 `/api/money-requests`

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/money-requests` | 請求一覧 / 作成 |
| GET  | `/api/money-requests/unpaid-summary` | 未払サマリ |
| GET / PATCH / DELETE | `/api/money-requests/{id}` | 詳細 / 編集 / 締める |
| PATCH | `/api/money-requests/{id}/pay`   | 支払い済 |
| PATCH | `/api/money-requests/{id}/unpay` | 支払い取消 |

---

## かんばん `/api/kanban` (Trello-like、 v934+)

ラボ全員で共有するタスクボード。 board / list / card 三階層 + 担当者 (複数)、 label (色付き複数)、 checklist、 comment、 activity log。 HTML5 native drag-and-drop でリスト間・順序移動 (sort_order は shift-based)。

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/kanban/boards` | ボード一覧 / 作成 |
| GET  | `/api/kanban/boards/{id}` | 詳細 (lists + cards + assignees + labels をネスト) |
| PATCH / DELETE | `/api/kanban/boards/{id}` | 編集 / 削除 |
| POST | `/api/kanban/boards/{id}/lists` | リスト追加 |
| PATCH / DELETE | `/api/kanban/lists/{lid}` | リスト編集 / 削除 |
| POST | `/api/kanban/lists/{lid}/cards` | カード追加 |
| GET / PATCH / DELETE | `/api/kanban/cards/{cid}` | カード詳細 / 編集 / 削除 |
| PATCH | `/api/kanban/cards/{cid}/move` | `{list_id, sort_order}` リスト間移動 + 並び替え |
| POST / DELETE | `/api/kanban/cards/{cid}/assignees/{uid}` | 担当者追加 / 除外 |
| GET / POST | `/api/kanban/boards/{id}/labels` | ラベル一覧 / 作成 |
| PATCH / DELETE | `/api/kanban/labels/{lid}` | ラベル編集 / 削除 |
| POST / DELETE | `/api/kanban/cards/{cid}/labels/{lid}` | カードにラベル付け / 外し |
| GET / POST | `/api/kanban/cards/{cid}/checklist` | チェックリスト一覧 / 追加 |
| PATCH / DELETE | `/api/kanban/checklist/{iid}` | 個別トグル / 編集 / 削除 |
| GET / POST | `/api/kanban/cards/{cid}/comments` | コメント一覧 / 追加 |
| DELETE | `/api/kanban/comments/{cmid}` | 削除 (投稿者 or admin) |
| GET  | `/api/kanban/boards/{id}/activity` | activity log |

---

## 小道具 (utility)

### `/api/fx` 為替

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/fx?from=USD&to=JPY` | 直近 exchangerate.host キャッシュ |

### `/api/network` 内部ネットワーク

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/network/status` | 学内 LAN / VPN 状態 |

### `/api/random-groups` ランダムグループ

| Method | Path | 説明 |
|---|---|---|
| POST | `/api/random-groups/notify` | 分けた瞬間全員通知 |

### `/api/orderings` 順番決め

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/orderings(/...)` | CSPRNG + 演出 + コピー |

### `/api/regions` 行った国 / 都道府県

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/regions/visited` | 訪問済 |
| POST | `/api/regions/visit`   | 追加 (`{code}` ISO 3166-1 or JP-NN) |
| GET  | `/api/regions/stats`   | ラボ全体統計 |

### `/api/health` 体重 / BMI

| Method | Path | 説明 |
|---|---|---|
| GET / POST / DELETE | `/api/health(/...)` | 個人時系列 |

### `/api/workouts` 筋トレ

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/workouts` | 個人セット記録 |
| GET  | `/api/workouts/friends` | 仲間の様子 |

### `/api/walk` 散歩

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/walk/suggestions` | おすすめルート |
| GET / POST | `/api/walk/sessions(/...)` | GPS 軌跡記録 |

### `/api/nomikai` 飲み会精算

| Method | Path | 説明 |
|---|---|---|
| GET / POST / GET :id / PATCH / DELETE | `/api/nomikai(/...)` | 参加者 + 会費 + ソフドリ割引 |

### `/api/roulettes` ルーレット / どこ行く

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/roulettes`     | ラボ用 gacha (v385+) |
| POST | `/api/roulettes/{id}/spin` | 実行 |

---

## フィードバック `/api/feedback`

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/feedback` | 一覧 (自分の分) / 投稿 |
| PATCH | `/api/feedback/{id}` | 起案者が追記 |
| GET  | `/api/feedback/admin`  | admin 用全件 |
| PATCH | `/api/feedback/admin/{id}` | admin 応答 + Slack 通知 |
| GET  | `/api/feedback/claude_queue` | claude-cron 用 (approved の件数) |

---

## サンプル: Python から購入

```python
import requests, uuid

s = requests.Session()
s.post('https://pay.example.ac.jp/api/auth/dev-login',
       headers={'X-Requested-With': 'labpay'},
       json={'email': 'me@example.com'})

r = s.post('https://pay.example.ac.jp/api/purchases',
           headers={'X-Requested-With': 'labpay'},
           json={'listing_id': 42, 'idempotency_key': str(uuid.uuid4())})
print(r.json())
```

## サンプル: Bash で送金

```bash
COOKIE=$(mktemp)
curl -s -c "$COOKIE" -b "$COOKIE" \
  -H "Content-Type: application/json" -H "X-Requested-With: labpay" \
  -X POST -d '{"email":"me@example.com"}' \
  https://pay.example.ac.jp/api/auth/dev-login

curl -s -c "$COOKIE" -b "$COOKIE" \
  -H "Content-Type: application/json" -H "X-Requested-With: labpay" \
  -X POST -d "{\"to_user_id\":5,\"amount\":100,\"idempotency_key\":\"$(uuidgen)\"}" \
  https://pay.example.ac.jp/api/transfers
```

## サンプル: Scanner (Bearer 認証)

```bash
TOKEN="..."   # admin で room 作成時に発行される

curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST \
     -d '{"room_id":"10F","observations":[{"mac":"aa:bb:cc:dd:ee:ff","ip":"192.168.50.10"}]}' \
     https://pay.example.ac.jp/api/presence/scan
```

## サンプル: refs に DOI で追加 → 要約まで一気通貫

```bash
# 1. DOI で metadata 取得
curl -s -c $C -b $C \
  -H "Content-Type: application/json" -H "X-Requested-With: labpay" \
  -X POST -d '{"doi":"10.1145/3313831.3376234"}' \
  https://pay.example.ac.jp/api/refs/import_doi
# → { "meta": {...}, "existing": null }

# 2. refs 保存
REF_ID=$(curl -s -c $C -b $C \
  -H "Content-Type: application/json" -H "X-Requested-With: labpay" \
  -X POST -d @meta.json \
  https://pay.example.ac.jp/api/refs | jq -r .id)

# 3. PDF 添付
curl -s -c $C -b $C -H "X-Requested-With: labpay" \
  -F "file=@paper.pdf" \
  https://pay.example.ac.jp/api/refs/$REF_ID/attach_pdf

# 4. 要約をキック (refs 詳細の「📑 要約する」ボタン相当)
curl -s -c $C -b $C -H "X-Requested-With: labpay" \
  -F "file=@paper.pdf" -F "model=gpt-5" -F "auto_share=1" \
  https://pay.example.ac.jp/api/ai/paper_translate
```
