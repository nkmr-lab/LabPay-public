# LabPay API

学生が自作クライアントを書けるようにするための簡易リファレンス。
すべて JSON。同一オリジン Cookie 認証 (`labpay_sid`)。

## 共通ルール
- 認証: ブラウザで `/api/auth/login` (Google) または `POST /api/auth/dev-login` を済ませると Cookie が立ちます。以降は `fetch(url, { credentials: 'same-origin' })` で OK。
- 変更系 (`POST/PATCH/DELETE`) は **必ず** `X-Requested-With: labpay` ヘッダを付ける (CSRF 簡易対策)。
- `POST /api/purchases` のように冪等が必要なものは body に `idempotency_key`（UUID 推奨）を入れる。同じキーで再送すると保存済みレスポンスが返る。
- エラー形式:
  ```json
  { "error": { "code": "insufficient_funds", "message": "...", "details": { ... } } }
  ```
- `exposure` 設定で無効化された機能は `403 feature_disabled`。

## 認証

| Method | Path | 説明 |
|---|---|---|
| GET  | /api/auth/me            | 現在のログイン情報・残高。未ログインは 401 |
| GET  | /api/auth/login         | Google OAuth 開始 (302) |
| GET  | /api/auth/callback      | OAuth 戻り先 (Google が呼ぶ) |
| POST | /api/auth/dev-login     | `{ "email": "..." }` 許可リスト経由で即ログイン (dev_login_enabled 時のみ) |
| POST | /api/auth/logout        | セッション破棄 |

## 自分

| Method | Path | 説明 |
|---|---|---|
| GET | /api/me                          | 残高 + streak |
| GET | /api/me/transactions?limit&offset| 取引履歴 |
| GET | /api/me/listings?status=         | 自分の出品 |

## マーケット

| Method | Path | 説明 |
|---|---|---|
| GET    | /api/products?q=&limit=          | 商品マスタ検索 |
| GET    | /api/products/{jan}              | JAN 指定。未登録は 404 |
| POST   | /api/products                    | `{ jan, name, image_url? }` |
| GET    | /api/listings?jan=&limit=        | 販売中一覧 (安い順) |
| GET    | /api/listings/{id}               | 個別出品 |
| POST   | /api/listings                    | `{ jan, price, qty }` |
| PATCH  | /api/listings/{id}               | `{ price?, qty?, status? }` |
| DELETE | /api/listings/{id}               | 取り下げ |

## 購入

```http
POST /api/purchases
X-Requested-With: labpay
Content-Type: application/json

{ "listing_id": 123, "idempotency_key": "9b3d..." }
```

応答:
```json
{
  "purchase_id": 42, "listing_id": 123,
  "product_name": "...", "unit_price": 130,
  "seller_take": 124, "fee": 6,
  "new_balance": 870, "qty_remaining": 0
}
```

## 来室

```http
POST /api/checkins
X-Requested-With: labpay
```
→ `{ already_checked_in, points, current_streak, longest_streak, new_balance }`

## 通知

| Method | Path | 説明 |
|---|---|---|
| GET   | /api/notifications?unread=1 | 通知一覧 |
| GET   | /api/notifications/unread_count | 未読数 (バッジ用) |
| PATCH | /api/notifications/{id}/read | 既読 |
| PATCH | /api/notifications/read_all  | 全既読 |

## 信用

| Method | Path | 説明 |
|---|---|---|
| GET | /api/sellers/{id}/stats | 累計販売・取扱高など |

## 管理者

`role=admin` のみ。それ以外は 403。

| Method | Path | 説明 |
|---|---|---|
| GET    | /api/admin/allowlist             | 一覧 |
| POST   | /api/admin/allowlist             | `{ email, display_name, role, active }` |
| DELETE | /api/admin/allowlist/{email}     | 無効化 (削除はしない) |
| GET    | /api/admin/users                 | ユーザー残高一覧 |
| POST   | /api/admin/issue                 | `{ to_user_id, amount, memo? }` SYSTEM→user 発行 |
| POST   | /api/admin/reversal              | `{ ledger_id, memo? }` 逆仕訳 (purchase は fee 行も自動取消) |
| GET    | /api/admin/config                | ランタイム設定一覧 |
| PATCH  | /api/admin/config                | `{ fee_rate?, initial_points?, ... }` |
| GET    | /api/admin/dashboard             | 総発行量・残高・取引数 等 |
| POST   | /api/admin/broadcast             | `{ body }` 全員へ通知 |

## サンプル: Python から購入する

```python
import requests, uuid

s = requests.Session()
s.post('https://pay.example.ac.jp/api/auth/dev-login',
       headers={'X-Requested-With': 'labpay'},
       json={'email': 'me@example.ac.jp'})

r = s.post('https://pay.example.ac.jp/api/purchases',
           headers={'X-Requested-With': 'labpay'},
           json={'listing_id': 42, 'idempotency_key': str(uuid.uuid4())})
print(r.json())
```

## FUTURE (実装中・現状は 403)

- `POST /api/transfers` 個人送金
- `GET/POST /api/messages` チャット
- `GET/POST /api/tasks`, `POST /api/tasks/{id}/submit` クラウドソーシング
- `/api/loans`, `/api/books` 本の貸出
