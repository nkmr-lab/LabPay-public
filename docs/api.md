# LabPay API

自作クライアント向けのリファレンス。全エンドポイントは JSON、同一オリジン Cookie 認証 (`labpay_sid`)。

## 共通ルール

- **認証**: ブラウザで `GET /api/auth/login` (Google) もしくは `POST /api/auth/dev-login` を済ませると `labpay_sid` Cookie が立つ。以降は `fetch(url, { credentials: 'same-origin' })` で OK
- **CSRF**: 変更系 (`POST/PATCH/PUT/DELETE`) は **必ず** `X-Requested-With: labpay` ヘッダを付ける。`Authorization: Bearer ...` を使う場合はこのチェックをスキップ
- **冪等性**: `POST /api/purchases` `POST /api/transfers` は body に `idempotency_key` (UUID 推奨、8-80字) が必須。同じキーで再送すると保存済みレスポンスが返る
- **エラー形式**:
  ```json
  { "error": { "code": "insufficient_funds", "message": "...", "details": { ... } } }
  ```
- **exposure 設定**で無効化されている機能は `403 feature_disabled`

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
| GET   | `/api/me`                | 残高 + streak + `avatar_url` / `scrapbox_username` / `grade` 含む |
| PATCH | `/api/me`                | プロフィール更新: `{ display_name?, avatar_url?, scrapbox_username? }` |
| GET   | `/api/me/transactions?limit=&offset=` | 取引履歴 (購入/販売/手数料/来室/送金/タスク報酬/取消 全部) |
| GET   | `/api/me/listings?status=` | 自分の出品 |
| GET   | `/api/me/achievements`   | 実績 15軸 × 4段階の獲得状況・進捗 |
| GET   | `/api/me/presence_summary` | 自分のラボ滞在時間 (today/week/month/total minutes + 現在開いてるセッションの開始時刻) |
| GET   | `/api/me/scrapbox_handles` | 自分が申告した Scrapbox 表示名一覧 + 直近30日の獲得 pt サマリー |
| POST  | `/api/me/scrapbox_handles` | `{ handle: "..." }` を申告 (既に他人が持っていた場合は奪取される — 自己責任) |
| DELETE| `/api/me/scrapbox_handles/{handle}` | 自分の handle を解除 |

GET `/api/me` 応答例:

```json
{
  "user": {
    "id": 3, "email": "...", "display_name": "...",
    "role": "admin", "kind": "human",
    "avatar_url": "/uploads/products/abc123.jpg",
    "scrapbox_username": "nakamura-satoshi",
    "grade": "M2"
  },
  "balance": 1010,
  "streak": { "current_streak": 1, "longest_streak": 1, "last_checkin_date": "2026-05-31" }
}
```

---

## ユーザ一覧 `/api/users`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/users?q=` | 人間ユーザの軽量ディレクトリ (送金・タスクの受取人選択用)。`{id, display_name, avatar_url, grade}` |

---

## 商品マスタ `/api/products`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/products?q=&limit=`     | 商品マスタ検索 |
| GET    | `/api/products/{jan}`         | JAN 指定。マスタになければ外部 API (楽天) 試行、無ければ 404 |
| POST   | `/api/products`               | `{ jan, name, image_url? }` JAN 登録/更新 (8-20桁数字に自動正規化) |
| POST   | `/api/products/no_jan`        | `{ name, image_url? }` バーコード無し商品 — 合成 JAN を自動発行 |

GET `/api/products/{jan}` で外部 API ヒット時の応答:

```json
{
  "jan": "4902102159975",
  "name": "コカ・コーラ 500ml ペット …",
  "image_url": "https://thumbnail.image.rakuten.co.jp/...",
  "source": "api", "pending": true, "confidence": "low"
}
```
`confidence`: `high` = JAN がレスポンスに含まれる確実な一致 / `low` = テキスト検索一致 (要確認)

---

## 出品 `/api/listings`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/listings?jan=&limit=`   | 販売中一覧 (安い順) |
| GET    | `/api/listings/{id}`          | 個別 |
| POST   | `/api/listings`               | `{ jan, price, qty }` 出品 |
| PATCH  | `/api/listings/{id}`          | `{ price?, qty?, status? }` |
| DELETE | `/api/listings/{id}`          | 取り下げ (`status='withdrawn'`) |
| DELETE | `/api/listings/{id}?hard=1`   | **完全削除** (購入実績無い場合のみ。あれば 409) |

---

## 購入 `/api/purchases`

```http
POST /api/purchases
X-Requested-With: labpay
Content-Type: application/json

{ "listing_id": 123, "idempotency_key": "9b3d..." }
```

応答:
```json
{
  "purchase_id": 42, "listing_id": 123, "product_name": "...",
  "unit_price": 130, "seller_take": 124, "fee": 6,
  "new_balance": 870, "qty_remaining": 0
}
```

エラー: `insufficient_funds` (402), `self_purchase` (400), `not_available` (409)

---

## 送金 `/api/transfers`

```http
POST /api/transfers
X-Requested-With: labpay
Content-Type: application/json

{ "to_user_id": 5, "amount": 50, "memo": "ありがとう", "idempotency_key": "..." }
```

応答:
```json
{ "transfer_id": 7, "to_user_id": 5, "to_name": "...",
  "amount": 50, "memo": "ありがとう", "new_balance": 820 }
```

QR コードの URI 仕様 (フロントで使用): `labpay:transfer?to=<user_id>&name=<URLエンコード名>`

---

## ラボイン (来室) `/api/checkins`

| Method | Path | 説明 |
|---|---|---|
| GET  | `/api/checkins/status` | 本日の状態確認 + ボーナス式パラメータ |
| POST | `/api/checkins`        | 手動チェックイン (本番では Wi-Fi 自動。テスト/フォールバック用) |

`/api/checkins/status` 応答例:
```json
{
  "checked_in_today": true,
  "points_today": 12,
  "current_streak": 3,
  "longest_streak": 12,
  "today_is_workday": true,
  "bonus_rule": {
    "base": 10, "per_day": 1, "cap": 10, "divisor": 1,
    "max_total": 20, "days_to_max": 11
  }
}
```

POST `/api/checkins` 応答:
```json
{
  "already_checked_in": false, "points": 12, "awarded_today": 12,
  "current_streak": 3, "longest_streak": 12, "new_balance": 1012
}
```

> 通常は presence scanner が登録 MAC を観測した瞬間にサーバ側で自動チェックインされるので、明示的に呼ぶ必要は少ない。

---

## タスク `/api/tasks`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/tasks?filter=available\|mine\|active` | 一覧 |
| POST   | `/api/tasks`                         | 出題 (下記参照) |
| GET    | `/api/tasks/{id}`                    | 詳細 (`my_claims` 含む。依頼者は `claims` も) |
| PATCH  | `/api/tasks/{id}`                    | 依頼者のみ編集。報酬/人数変更時はエスクロー自動精算 |
| POST   | `/api/tasks/{id}/cancel`             | 依頼者: 取消 + 未承認分返金 |
| POST   | `/api/tasks/{id}/claim`              | 受諾宣言 |
| POST   | `/api/tasks/{id}/claims/{cid}/report` | `{ notes? }` 完了報告 |
| POST   | `/api/tasks/{id}/claims/{cid}/approve` | 依頼者: 承認 → 報酬支払 |
| POST   | `/api/tasks/{id}/claims/{cid}/reject`  | 依頼者: 却下 |
| POST   | `/api/tasks/{id}/attachments`        | 依頼者: ファイル添付 (multipart `file`、~50MB / PDF・docx・画像等) |
| GET    | `/api/tasks/{id}/attachments/{aid}`  | 添付 download (元のファイル名で) |
| DELETE | `/api/tasks/{id}/attachments/{aid}`  | 依頼者または uploader: 添付削除 |

POST `/api/tasks` body:
```json
{
  "title": "...", "description": "...",
  "reward": 10, "capacity": 3,
  "per_user_limit": 1,            // 0=無制限
  "deadline": "2026-06-30 18:00:00", // 任意。空なら無期限
  "audience_grades": ["B3","B4"],  // 任意。空なら全員
  "slots_spec": "6/15 11:00-15:00 30分刻み"   // 任意。指定すると capacity が自動算出される
}
```

タスク詳細 (`GET /api/tasks/{id}`) は `slots[]` (時間枠) と `attachments[]` (添付ファイル) を含みます。

タスクの状態遷移:
- 作成時 `status='open'`、エスクローに `reward × capacity` 預け入れ
- 承認累計が `capacity` 到達 → 自動で `closed`
- `deadline` 経過 → リスト/詳細 API がアクセスされた瞬間に自動取消 + 未承認分返金
- ledger では `deposit` (預け) / `task_reward` (支払) / `refund` (返金) の3種で記録

---

## 在室検知 `/api/presence`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/presence`                       | 部屋ごとの「今いる人」(直近 N 分内に登録 MAC が観測された人) |
| GET    | `/api/presence/heatmap?days=7`        | 部屋 × 曜日 × 時間 の平均在室人数行列 (7-365 日) |
| GET    | `/api/presence/devices`               | 自分の登録 MAC 一覧 |
| POST   | `/api/presence/devices`               | `{ mac, label? }` MAC 登録 |
| DELETE | `/api/presence/devices/{id}`          | 削除 |
| GET    | `/api/presence/unregistered_macs`     | 直近観測の未登録 MAC (自分のを見つけるため。OUI ヒントと「NEW」候補付き) |
| POST   | `/api/presence/scan`                  | Scanner 専用 (Bearer token 認証)。`{ room_id, observations: [{mac, ip}] }` |

`/api/presence/heatmap` 応答:
```json
{
  "days": 7, "range_from": "...", "range_to": "...",
  "days_of_week": [1,1,1,1,1,1,1],  // Sun..Sat 各曜日が何日分含まれるか
  "rooms": [
    { "id": "10F", "display_name": "10階研究室",
      "matrix": [[0,...24 hours], ..., 7 weekdays] }
  ]
}
```
`matrix[w][h]` は Sun=0..Sat=6 / 0..23 時の平均同時在室人数 (距 distinct user)。

---

## 通知 `/api/notifications`

| Method | Path | 説明 |
|---|---|---|
| GET   | `/api/notifications?unread=1&limit=` | 通知一覧 |
| GET   | `/api/notifications/unread_count`    | 未読数 (バッジ用) |
| PATCH | `/api/notifications/{id}/read`       | 既読 |
| PATCH | `/api/notifications/read_all`        | 全既読 |

通知 `type`: `sale`, `sold_out`, `transfer_received`, `task_claimed`, `task_reported`, `task_approved`, `task_cancelled`, `task_expired`, `admin_notice`

---

## 売主信用 `/api/sellers`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/sellers/{user_id}/stats` | 累計販売数・取扱高 |

---

## 画像アップロード `/api/uploads`

```http
POST /api/uploads/image
X-Requested-With: labpay
Content-Type: multipart/form-data

(file=<image>)
```

応答:
```json
{ "url": "https://pay.../uploads/products/abc123.jpg",
  "path": "/uploads/products/abc123.jpg",
  "mime": "image/jpeg", "size": 12345 }
```

最大 8MB、`image/jpeg|png|gif|webp|heic|heif` のみ。

---

## 管理者 `/api/admin`

`role=admin` のみ。それ以外は 403。

### 許可リスト
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/allowlist`           | 一覧 |
| POST   | `/api/admin/allowlist`           | `{ email, display_name, role, active }` |
| DELETE | `/api/admin/allowlist/{email}`   | 無効化 (`active=0`) |

### ユーザ
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/users`               | 全ユーザ + 残高 |

### 経済操作
| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/admin/issue`               | `{ to_user_id, amount, memo? }` SYSTEM → ユーザ発行 |
| POST   | `/api/admin/reversal`            | `{ ledger_id, memo? }` 逆仕訳 (purchase は fee 行も自動取消) |

### 設定
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/config`              | DB ランタイム設定一覧 |
| PATCH  | `/api/admin/config`              | `fee_rate / initial_points / checkin_base / streak_bonus_* / presence_window_minutes / geo_default_radius_m / scrapbox_*` 等 |

### 統計
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/dashboard`           | 総発行量・SYSTEM/ESCROW 残高・取扱高 等 (1 round-trip) |

### お知らせ
| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/admin/broadcast`           | `{ body }` 全員に通知 |

### 部屋 (scanner)
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/rooms`               | 一覧 |
| POST   | `/api/admin/rooms`               | `{ id, display_name }` 作成 → **scanner_token を一度だけ返す** |
| PATCH  | `/api/admin/rooms/{id}`          | `{ display_name?, lat?, lng?, geo_radius_m? }` |
| DELETE | `/api/admin/rooms/{id}`          | 削除 |
| POST   | `/api/admin/rooms/{id}/rotate_token` | 新トークン発行 (旧は失効) |

### 在室機材登録
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/presence_infrastructure`        | 一覧 (プリンタ・PC 等の登録) |
| POST   | `/api/admin/presence_infrastructure`        | `{ mac, label, kind? }` ← 未登録 MAC リストから除外される |
| DELETE | `/api/admin/presence_infrastructure/{mac}`  | 削除 |

### カレンダー
| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/admin/holidays?year=`          | 国民の祝日一覧 |
| POST   | `/api/admin/holidays/sync`           | 内閣府 CSV から再取得 |
| GET    | `/api/admin/calendar_overrides?year=` | ラボ独自の `lab_closed` / `lab_open` |
| POST   | `/api/admin/calendar_overrides`      | `{ override_date, kind, label? }` (`kind` = `lab_closed`/`lab_open`) |
| DELETE | `/api/admin/calendar_overrides/{date}` | 解除 |

### Scrapbox 同期 (Slack ブリッジ)
| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/admin/scrapbox_slack/sync`     | `{ day?, dry_run? }` Slack の `#scrapbox` から指定日分を集計 (cron が日次自動実行) |
| GET    | `/api/admin/slack_diag`              | Slack bot の `auth.test` → team / user_id を返す (scope 確認用) |
| POST   | `/api/admin/slack_diag/test`         | 自分宛に test DM を送信。 `missing_scope` 等エラー時は対処 hint を返す |

---

## 小道具 (v270 以降に追加された各 API)

### 募集 `/api/invitations`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/invitations?status=open|all`    | 一覧。 各 item に `joins[]` (参加者) も同梱 |
| POST   | `/api/invitations`                    | `{title, starts_at?, signup_closes_at?, location?, capacity?, image_url?, description?, pre_join_user_ids?}` 作成時に 発起人が 自動 join。 `starts_at` は `Y-m-d` (時刻なし) も可 |
| GET    | `/api/invitations/{id}`               | 詳細 |
| PATCH  | `/api/invitations/{id}`               | 編集 (`reopen: true` で 終了済を再開) |
| DELETE | `/api/invitations/{id}`               | 取消 |
| POST   | `/api/invitations/{id}/joins`         | 参加表明 |
| DELETE | `/api/invitations/{id}/joins`         | 取消 |

### 投票 `/api/polls`, 点呼 `/api/rollcalls`, タイマー `/api/timers`

各々 `GET 一覧 / POST 作成 / GET 詳細 / PATCH 編集 / DELETE / POST {id}/vote (or respond, or cancel)` の標準形。 詳細は `src/handlers/polls.php` 等。 タイマーは `{bell1_seconds?, bell2_seconds?, bell3_seconds?, repeat_max?}` で 中間ベル + リピート可。

### 待ち合わせ `/api/meetups`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/meetups`                        | 自分関連の 一覧 |
| POST   | `/api/meetups`                        | `{title, location, meetup_at, member_ids[]}` 集合時刻 24h 以内 |
| GET    | `/api/meetups/{id}`                   | 詳細 + 参加者 |
| PATCH  | `/api/meetups/{id}/cancel`            | 取消 (起案者または admin) |
| DELETE | `/api/meetups/{id}`                   | 削除 |

### オークション `/api/auctions`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/auctions`                       | 一覧 (lazy settle 込み)。 単位は **円** |
| POST   | `/api/auctions`                       | `{title, description?, image_url?, min_price, closes_at}` 締切 1分〜14日先 |
| GET    | `/api/auctions/{id}`                  | 詳細 + 入札履歴。 落札後は seller/winner に連絡先表示 |
| POST   | `/api/auctions/{id}/bids`             | `{amount}` 現在最高 +1 以上必須。 自分の出品には不可 |
| PATCH  | `/api/auctions/{id}/cancel`           | 取消 (seller / admin) |
| DELETE | `/api/auctions/{id}`                  | 削除 |

### 運動 (歩数) `/api/exercise`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/exercise`                       | 自分の sessions + today/this_week/this_month/lifetime |
| POST   | `/api/exercise`                       | `{step_count, duration_seconds, started_at, ended_at}` (1 セッション 30 分まで、 6 歩/秒超は弾く) |
| DELETE | `/api/exercise/{id}`                  | 削除 |
| GET    | `/api/exercise/leaderboard`           | 今週合計 トップ 30 |

### 効果音 `/api/sounds`

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/sounds/clips`                   | 全 clip 一覧 |
| POST   | `/api/sounds/clips`                   | audio upload (admin、 mp3/ogg/wav/m4a、 2MB まで) |
| DELETE | `/api/sounds/clips/{id}`              | 削除 (admin) |
| GET    | `/api/sounds/defaults`                | event 規定値一覧 |
| PATCH  | `/api/sounds/defaults/{event_key}`    | 規定値変更 (admin) |
| GET    | `/api/sounds/my`                      | 自分の上書き + 解決済 (再生に必要な file_url + volume) |
| PATCH  | `/api/sounds/my/{event_key}`          | `{mode: default|custom|mute, clip_id?, volume?}` |

### グループ `/api/groups` (ad-hoc + スケジュール + 宿泊 + 航空券 + e-ticket)

詳細は `src/handlers/adhoc_groups.php` 内 dispatch を参照。 主要:

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
- `GET/POST/DELETE :id/flights/:fid/etickets` 航空券 e-ticket (画像 + 座席 + 予約番号 + メモ)
- `GET/POST :id/chats`, `DELETE :id/chats/:mid` チャット
- `GET/POST :id/schedule`, `PATCH/DELETE :id/schedule/:itemId`, `PATCH :id/schedule/:itemId/move (up/down)`, `PATCH :id/schedule/:itemId/relocate (cross-day DnD)`
- `GET/POST/DELETE :id/schedule/:itemId/attachments`

### 公開プロフィール `/api/users/{id}/profile`

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/users/{id}/profile` | 公開プロフィール (display_name / avatar / grade / hobbies / favorites / scrapbox_username) |

### 食べある記 / らぼったー / プレイリスト / 制覇マップ / 体重BMI / 筋トレ / 散歩

| Method | Path | 説明 |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/places(/...)` | 🍴 お店の共有、 ⭐評価 / 👣 行った / ❤️ いいね / 口コミ + 画像 / カテゴリ |
| GET / POST / PATCH / DELETE | `/api/posts(/...)` | 💬 らぼったー (テキスト + 画像 + 位置 + @メンション + 返信 + 👍❤⭐ リアクション) |
| GET / POST / PATCH / DELETE | `/api/playlists(/...)` | 🎵 プレイリスト (YouTube/Spotify URL + ⭐評価) |
| GET / POST / DELETE | `/api/regions/visit` / `visited` / `stats` | 🗺 行った国・都道府県 (ISO 3166-1 + JP-NN) |
| GET / POST / DELETE | `/api/health(/...)` | ⚖️ 体重 / 身長 / BMI (個人時系列) |
| GET / POST / DELETE | `/api/workouts(/...)` | 💪 筋トレ + `/friends` で 仲間の様子 |
| GET / POST | `/api/walk/suggestions` `/walk/sessions(/...)` | 🚶 散歩おすすめ + 軌跡 GPS 記録 |

### ゲーム系: 麻雀 / ito / 人狼 / 大富豪 / 地雷オセロ / 絵しりとり / ティア表

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/mahjong/(games(/...)|sim|ai/new)` | 🀄 麻雀 賭けプール + 実ゲーム (門前/鳴き/役判定/連荘/半荘) + AI 対戦 (練習モード) |
| GET / POST | `/api/ito/games(/...)` | 🎲 ito 協力 (1-100 の数字 + お題で表現) |
| GET / POST | `/api/jinrou/games(/...)` | 🐺 人狼 役職配布 / 夜 (襲撃・占い・護衛) / 昼 (投票で追放) |
| GET / POST | `/api/daifugo/games(/...)` | 🃏 大富豪 (革命 + 8 切り + ジョーカー)、 プレイフィー 1pt |
| GET / POST | `/api/othello/games(/...)` | 💣 地雷オセロ、 各自 1 地雷 (3x3 反転)、 プレイフィー 1pt |
| GET / POST | `/api/shiritori/games(/...)` | 🎨 絵しりとり (時間制限つき キャンバス + ストローク記録) |
| GET / POST / PUT | `/api/tierlists(/...)` | 🎯 ティア表 S/A/B/C/D 振り分け (5 段階) |
| GET / POST | `/api/bingo/(me|leaderboard|history|week/{date})` | 🎰 週次 5x5 ビンゴ (平日行動 自動判定) |

### 予測系: 優勝予想 / 勝敗予測

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/predictions/games(/...)` | 🏆 順位予想 (1位のみ / 1-2位 / 1-4位)。 完全的中で 山分け + 場代 5% |
| POST | `/api/predictions/games/{id}/predict` `/close` `/finalize` `/cancel` | 予想 / 締切 / 結果開示 / キャンセル |
| GET / POST | `/api/score_predictions/games(/...)` | 🎯 スコア予想 (例: 3-2)。 完全的中で 山分け + 場代 5% |

### AI 系: 論文査読 / 原稿チェック / リライター / 翻訳 / チャット

| Method | Path | 説明 |
|---|---|---|
| POST (multipart) | `/api/ai/paper_review` | 📄 論文査読 PDF (10pt)、 OpenAI Files API + chat.completions、 非同期 + share_token |
| GET / PUT | `/api/ai/paper_review/(settings|r/{token})` | プロンプト編集 + 共有 URL |
| POST (multipart or JSON) | `/api/ai/resume_check` | 📝 短原稿チェック (5pt、 PDF 必須 v612〜)。 6項目スコア + リライト案 |
| GET / POST | `/api/ai/rewriter(/{id})` | ✂️ 文字数 / 単語数 制限リライター (1pt)。 サーバ側カウント + 最大 3 回 再依頼 |
| POST | `/api/ai/short_title` | タイトル AI 命名 |
| (chat / translate / help は フロント直で OpenAI 呼出、 履歴は別 API) | | |

### 1 日 1 回 占い / 誕生日 / フィードバック

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/fortune/today` | 🔮 今日の運勢 (30 種、 user × date で 一意) |
| GET / PATCH | `/api/me` (`birthday_md` / `birthday_year`) | 🎂 誕生日 (MM-DD + 西暦任意) |
| GET / POST / PATCH | `/api/feedback(/...)` | バグ報告 / 機能要望、 claude_status workflow、 admin 返信 + Slack 通知 |

### 順番決め / ランダムグループ / どこ行く ルーレット

| Method | Path | 説明 |
|---|---|---|
| GET / POST | `/api/orderings(/...)` | 📋 順番決め (CSPRNG + 演出 + コピー機能) |
| POST | `/api/random-groups/notify` | 🎲 ランダムグループ → 分けた瞬間に 全員通知 |
| (`text-roulette` は サーバ未保存、 端末内ツール) | | |

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
