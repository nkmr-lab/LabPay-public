# LabPay API サンプル

LabPay の API を使った 「超短い」 サンプルスクリプト集です。 1 ファイル 1 目的、
20〜30 行で完結します。 何かを作りたい人はここから 1 個 コピーして書き換えるのが
おすすめです。

API のフルリファレンスは [docs/api.md](../docs/api.md)、 認証や CSRF などの
仕組みは [docs/HACKATHON.md](../docs/HACKATHON.md) を見てください。

## セットアップ

```bash
# Python 3.10+ と requests があれば動きます
pip install requests

# 環境変数に dev-login 用 email を入れます (主催者から発行)
export LABPAY_EMAIL=you@example.ac.jp

# 別ホストの場合だけ:
# export LABPAY_BASE=https://pay.example.com/api
```

## サンプル一覧

### 🌐 ブラウザ Vanilla JS (samples/web/)

ファイルを `pay.nkmr.io` 配下に置けば そのまま動きます (LabPay にログイン中の
Cookie がそのまま使えるので 認証コード不要)。 1 ファイル 1 機能、 ~40 行:

| ファイル | 内容 |
|---|---|
| [web/who_is_here.html](web/who_is_here.html) | 今ラボにいる人を 1 分ごとに表示 (LED 看板的用途に) |
| [web/product_list.html](web/product_list.html) | 出品中の商品を安い順/新しい順で一覧 |
| [web/my_balance.html](web/my_balance.html) | 残高 + streak を 30 秒ごとに更新するウィジェット |

### 🐍 Python (samples/0X_*.py)

| ファイル | 内容 | API |
|---|---|---|
| [01_my_balance.py](01_my_balance.py)         | 自分の残高と streak を表示    | `GET /api/me` |
| [02_whos_here.py](02_whos_here.py)           | 今ラボにいる人を部屋別に列挙   | `GET /api/presence` |
| [03_product_listings.py](03_product_listings.py) | 出品中の商品を一覧          | `GET /api/listings` |
| [04_users_directory.py](04_users_directory.py)   | LabPay メンバー一覧         | `GET /api/users` |
| [05_my_recent_activity.py](05_my_recent_activity.py) | 自分の最近の取引履歴      | `GET /api/me/transactions` |
| [06_task_board.py](06_task_board.py)         | 開いてるタスクを一覧          | `GET /api/tasks` |
| [07_send_thanks.py](07_send_thanks.py)       | 誰かに 1pt を送る            | `POST /api/transfers` |
| [08_heatmap_to_csv.py](08_heatmap_to_csv.py) | 部屋ごとの曜日 × 時間ヒートマップを CSV に | `GET /api/presence/heatmap` |

## 実行

```bash
python3 samples/01_my_balance.py
```

## 全部のサンプルに共通する流れ

1. `requests.Session()` を作る (Cookie が自動で保持される)
2. `POST /api/auth/dev-login` でログイン → Cookie が立つ
3. 以後 同じ session で `GET / POST` を叩く

変更系 (POST/PATCH/DELETE) は **`X-Requested-With: labpay`** ヘッダ必須です
(CSRF ガード)。

## ハマりどころ

- **`401 Unauthorized`**: `LABPAY_EMAIL` が主催者の allowlist に入ってない
- **`403 csrf`**: 変更系で `X-Requested-With` 忘れ
- **CORS エラー** (ブラウザのみ): LabPay は同一オリジン専用。 Python など
  サーバサイドなら無関係

## おまけ

- もし 「こういうエンドポイント欲しい」 みたいなのがあれば GitHub Issues か
  主催者まで
- 各 .py の冒頭コメントに 「これで何ができるか」 を 1 行書いてあるので
  ファイル一覧をざっと眺めると インスピレーション湧くかも
