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
| GET   | `/api/me/achievements`   | 実績 9軸 × 4段階の獲得状況・進捗 |
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
