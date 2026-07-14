# LabPay ハッカソン参加者ガイド

> **現行バージョン: v1072**。v615 以降に大量の新機能 (refs / kanban / Overleaf / Deep Research / Semantic Scholar / conquest / habits / buzzer / zemi-videos / paper_review / paper_translate / paper_full / 実験計画書チェック / サンプルサイズ計算 等) が追加済。v932 で **`*.nkmr.io` からの CORS が全許可**、v950 で **auth.nkmr.io 統合 (中村研 SSO)**、v1072 で **`/api/auth/sso-login` によりリダイレクト無しログイン** が可能に。endpoint 一覧は [api.md](api.md) で。

LabPay の API を使って何か作ろうとしている人向けのガイドです。LabPay 自体の仕組みやデプロイ方法は気にせず、**「外部クライアントとして」** 何ができるかにフォーカスします。

**ハックの選択肢**:
- **外部クライアント** — Python / Node.js / Bash から API 叩いて賭け bot / 通知 / 自動化
- **ホームウィジェット** — [CUSTOM_WIDGETS.md](CUSTOM_WIDGETS.md) 参照。 JS 1 ファイルでホームに自分専用カードが生える
- **自作ゲーム v1** — [CUSTOM_GAMES.md](CUSTOM_GAMES.md) 参照。 turn-based で 2 人対戦のカスタムゲーム。マルバツ系
- **自作ゲーム v2** — [CUSTOM_GAMES_V2.md](CUSTOM_GAMES_V2.md) 参照。 p5.js + 共有 state の準リアルタイム multiplayer
- **文献管理拡張** — refs (v925+) は Zotero-like で拡張性が高い。 SS 検索 / DOI 追加 / 要約一気通貫の pipeline が作りやすい
- **かんばん拡張** — kanban (v934+) は Trello-like。 GitHub issue と両立させる / 在室と連動して asignee 通知する等の連携が書きやすい

## このドキュメントの構成

1. [できそうなこと](#できそうなこと) — アイデア出しのヒント
2. [API の基本](#api-の基本) — エンドポイントの形式、認証、共通ルール
3. [ログインする](#ログインする) — Cookie ベース認証 + 開発者用エイリアス
4. [よく使うエンドポイント](#よく使うエンドポイント) — 残高 / 取引 / タスク / 在室など
5. [サンプルクライアント](#サンプルクライアント) — **Vanilla JS で 30 行** が一番ラク。 Python / curl も
6. [Tips とハマりどころ](#tips-とハマりどころ)
7. [全 API リファレンス](#全-api-リファレンス) → [api.md](api.md)

> **TL;DR**: LabPay にブラウザでログインしてる状態で、 `pay.nkmr.io` 配下に
> `<html><script>fetch('/api/me', { credentials: 'include' }).then(...)</script>`
> な HTML を置けば、もう動きます。詳しくは [サンプル一覧](../samples/) 。

---

## できそうなこと

LabPay は学内ポイントの台帳・タスク市場・在室データを持つので、これらを使ったアプリが作れます:

### 「お金」系
- **賭け事ボット** — Slack の bot から `/bet` で 100 pt の janken をして、勝者に送金する
- **オークション** — タイマー付きで一番高値の入札者にポイント移転 (LabPay 側に出品しなくても OK、独立アプリでもデータだけ取れる)
- **電子チケット** — イベント参加権を「LabPay の N pt 送金で発行」する仕組み
- **持ち寄り会の自動精算** — 参加者の出費を入力 → 全員均等になるよう自動で送金

### 「在室・活動」系
- **だれが今いるか可視化 LED** — Raspberry Pi で `/api/presence` をポーリング、人が居る数で部屋の LED を変える
- **自動ドアロック** — 在室がゼロになったら一定時間後に鍵を閉める。誰か入ったら開錠
- **来訪通知** — 「特定の人 (指導教員等) がラボに来たら自分のスマホに push」
- **静寂 / 賑わいインジケーター** — 在室人数 + 時間帯から雰囲気を推測して Slack に投稿

### 「タスク・市場」系
- **タスクの自動投稿 bot** — リポジトリの新着 issue を LabPay タスク化、報酬を自動見積もり
- **おすすめ商品 bot** — 在庫が増えた商品に「あなたこれ好きそうですよ」と push
- **クーポン発行** — 特定の出品者から N pt 以上買ったら N×0.1 をキャッシュバック (= 送金) する bot

### 「ゲーミフィケーション」系
- **連続ラボイン Slack 通知** — streak 5/10/20/30 日達成時にお祝いリアクション
- **Scrapbox 寄稿レース** — 月ごとに「メモ魔」上位 3 名を発表
- **総資産ランキング** — タイムスタンプ付きで残高を取得して、月次グラフを描く

### 「データ分析」系
- **活動ヒートマップ拡張** — `/api/presence/heatmap` を時系列で取得 → ダッシュボードや論文用の図に
- **ポイント流通の可視化** — `/api/me/transactions` を全員分集めて (admin 権限が必要) ネットワーク可視化を再実装
- **タスク完了率 vs 報酬金額** — `/api/tasks` の履歴から「いくら積めば人が動くか」を回帰

### 「予測・予想」系 (v576+)
- **試合結果アラート bot** — `/api/predictions/games` / `/api/score_predictions/games` の締切前に Slack へ「未予想だよ」リマインド
- **的中率ランキング** — 過去の `predictions_entries` / `score_pred_entries` を user 別に集計して「的中職人」を月次表彰
- **W 杯 / オリンピック自動起案** — sports API と連携して各日の試合を `score_predictions` に自動投入

### 「研究支援」系 (v550+)
- **査読依頼 bot** — Slack コマンド `/review <URL>` で `/api/ai/paper_review` (10pt) / `/api/ai/resume_check` (5pt) を kick
- **アブスト字数警告** — Scrapbox の新規ノート保存時に `/api/ai/rewriter` で字数チェック、超過なら警告
- **学会情報の自動集約** — `/api/notices` カテゴリ `conference` を RSS / API に流す

### 「文献管理」系 (v925+ refs、一番拡張性高い)
- **DOI ペースト → 全部やる bot** — Slack で DOI 投げたら `/api/refs/import_doi` → `/api/refs` に追加 → PDF 見つけて `/api/refs/{id}/attach_pdf` → `/api/refs/{id}/ss_enrich` で被引用数埋め → 完了通知
- **今週の新着論文 push** — 定期的に `/api/refs/ss_recommend` をコレクション「今年の CHI」に対して呼び、出たおすすめを Slack に
- **要約 pipeline** — refs に PDF 添付されたら自動で `/api/ai/paper_translate` を走らせ、完了通知 + refs.pdf_sha256 経由で相互リンク
- **Zotero → LabPay 同期 cron** — 定期的に `/api/refs/import_zotero` (fetch_all=1, sync_pdfs=1) を走らせ、個人 Zotero の変更をラボに反映
- **被引用数更新 job** — 全 refs に対して `/api/refs/{id}/ss_enrich` を週 1 で回して最新の citation_count に
- **参考文献セクション自動生成** — Overleaf の main.tex を監視、コレクションから `/api/refs/bibliography` で BibTeX 生成 → GitHub に PR

### 「Overleaf 追跡」系 (v886+)
- **執筆進捗 Slack bot** — `/api/overleaf/projects` を定期取得 → 24h delta を Slack に「今日の進捗: 中村 +342 字」
- **絶不調検知** — 1 週間動きが無いラボメンに「大丈夫?」 push
- **投稿間近追い込みゲージ** — refs.venue + 学会締切を突き合わせて進捗バーを LINE bot に

### 「Deep Research」系 (v781+)
- **論文サーベイ自動化** — キーワード定期で `/api/ai/deep_research` を深さ standard で 25pt 消費して走らせ、結果を Slack に summary post
- **競合リサーチ** — 「refs コレクション X に対して最新の関連論文を探す」を cron で週 1 実行

### 「ゲーミフィケーション」系追加 (v860-v872)
- **habit 応援 bot** — `/api/habits` の streak が途切れそうな人に応援メッセージ
- **conquest 制覇通知** — 誰かが list を完全制覇したら全員に celebration
- **早押しクイズホスト bot** — `/api/buzzer/sessions` を立てて全員集めて出題

### 「かんばん」系 (v934+ kanban、 Trello-like)
- **GitHub issue ↔ カード双方向同期** — Webhook で新 issue → `/api/kanban/cards` に投入、逆に card 移動 → issue label 変更
- **在室連動 assignee 通知** — `/api/kanban/cards/{cid}/assignees` を購読し、担当者が `/api/presence/now` にいなくなったら Slack DM
- **朝会 dashboard** — `/api/kanban/boards/{id}/activity` を昨日分だけ抽出 → 「昨日進んだ / 今日やる」を自動生成
- **stale カード検知** — 移動が無いまま 2 週間経過したカードを毎朝リマインド
- **WIP 制限アラート** — 特定リストの card 件数が閾値超えたら Slack で警告
- **タスク完了 → LabPay 送金 bot** — 「Done」リストに移動されたら起案者から担当者に自動送金 (`/api/transfers`)

---

## API の基本

### ホスト

```
https://pay.nkmr.io/api/
```

(ハッカソンで別ホストを使う場合は主催者が共有します。)

### 形式

- 全エンドポイントは **JSON in / JSON out**
- Cookie 認証 (`labpay_sid`) または `Authorization: Bearer <sid>`。 v932 で **`*.nkmr.io` からの CORS 全許可**
- エラーレスポンスは統一形式:

```json
{ "error": { "code": "insufficient_funds", "message": "...", "details": { ... } } }
```

### 共通ルール

| ルール | 詳細 |
|---|---|
| **認証** | Cookie `labpay_sid` または `Authorization: Bearer <session_id>` |
| **CSRF** | 変更系 (`POST/PATCH/PUT/DELETE`) は **必ず** `X-Requested-With: labpay` ヘッダを付ける。`Authorization: Bearer ...` を使う場合はスキップ可 |
| **冪等性** | `POST /api/purchases` `POST /api/transfers` は body に `idempotency_key` (UUID 推奨) が必須。同じキーで再送すると保存済みレスポンスが返る |
| **タイムゾーン** | 全タイムスタンプは Asia/Tokyo の `YYYY-MM-DD HH:MM:SS` 形式 |

---

## ログインする

### 🌟 推奨: 中村研 SSO 経由 (v1072+, `.nkmr.io` 内アプリなら 1 行)

参加者アプリを `hackathon.nkmr.io` などの **`*.nkmr.io` サブドメイン** に置くなら、これが一番ラク。ブラウザは auth.nkmr.io で 1 度 Google ログインすれば `.nkmr.io` 全域で NKMRID cookie が立っており、それを使って LabPay セッションをリダイレクト無しに JSON 1 発で発行できます:

```html
<!doctype html>
<meta charset="utf-8">
<title>My hackathon app</title>
<script type="module">
const PAY = 'https://pay.nkmr.io';

async function api(path, opts = {}) {
  const r = await fetch(PAY + path, {
    ...opts,
    credentials: 'include',
    headers: { 'X-Requested-With': 'labpay', 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

async function ensureLoggedIn() {
  // 1. 既に labpay_sid があれば /api/me が通る
  try { return await api('/api/me'); } catch (_) { /* 401 → 続行 */ }
  // 2. NKMRID から labpay_sid を発行 (リダイレクト無し、 POST 1 発)
  try { await api('/api/auth/sso-login', { method: 'POST' }); return await api('/api/me'); }
  catch (_) { /* まだ Google ログインしていない → 3 */ }
  // 3. auth.nkmr.io に飛ばして Google ログイン → 戻ってきたら (1) が通る
  location.href = 'https://auth.nkmr.io/?action=sso&return=' + encodeURIComponent(location.href);
}

const me = await ensureLoggedIn();
document.body.textContent = `${me.user.display_name} さんの残高: ${me.balance} pt`;
</script>
```

つまり:
- 参加者は **中村研 Google アカウントで 1 度ログインすれば LabPay も自動で使える** (別途のログイン不要)
- 参加者アプリ側は **LabPay 独自の Google OAuth に触らなくて済む** (`/api/auth/login` にリダイレクトさせなくて OK)
- 「未ログイン → auth.nkmr.io に飛ばして戻ってくる」だけを 3 のフォールバックに書いておけば十分

**`/api/auth/sso-login` の挙動**:

| 事前状態 | 応答 | 動き |
|---|---|---|
| NKMRID cookie 有効 + LabPay allowlist に載っている | `200 {ok:true, user:..., first_login:..., initial_points:...}` + `labpay_sid` cookie セット | 以降 `/api/*` が全部通る |
| NKMRID 無し / 期限切れ / 未認証 | `401 sso_required` | フロントで auth.nkmr.io に飛ばす |
| NKMRID 有効だが LabPay allowlist に無い | `403 not_allowed` | 中村さんに allowlist 追加を依頼 |

### 旧ブラウザ経由 (`/api/auth/login` リダイレクト)

`/api/auth/sso-login` を使わずに従来通り `/api/auth/login` を開かせても OK (内部で同じ auth.nkmr.io にリダイレクトされる)。 SPA でリダイレクトを避けたい場合だけ上の推奨パスを使ってください。

### スクリプトから (dev-login)

開発・ハッカソン用に **dev login** が用意されています (主催者が許可リストに登録してくれてれば):

```bash
curl -c /tmp/labpay.cookies \
     -H "X-Requested-With: labpay" \
     -H "Content-Type: application/json" \
     -d '{"email":"you@example.ac.jp"}' \
     https://pay.nkmr.io/api/auth/dev-login

# 以降は cookie jar を使い回す
curl -b /tmp/labpay.cookies https://pay.nkmr.io/api/me
```

### CORS / サブドメインについて (v932+ 開放済)

LabPay は **`*.nkmr.io` サブドメイン全域** から fetch できるようになりました (v932 で開放):

- `Origin` が `^https://[a-z0-9-]+\.nkmr\.io$` にマッチすれば `Access-Control-Allow-Origin` + `Allow-Credentials: true`
- Cookie `labpay_sid` は `SameSite=None; Secure` で発行 → `*.nkmr.io` 内なら別サブドメインの fetch でも自動送信
- preflight `OPTIONS` は 204 で通る

つまり `https://hackathon.nkmr.io` からも `fetch('https://pay.nkmr.io/api/me', {credentials: 'include'})` で直接叩けます。 `X-Requested-With: labpay` の CSRF ヘッダは変更系で引き続き必須。

**`.nkmr.io` の外** から叩きたい場合の選択肢:

| # | 方法 | 場面 |
|---|---|---|
| ① | **Bearer 認証** (`Authorization: Bearer <sid>`) | Python / Node / Bash などサーバー・CLI から叩く場合。 cookie 不要、 CSRF ヘッダも不要。一番楽 |
| ② | **カスタムウィジェット** ([CUSTOM_WIDGETS.md](CUSTOM_WIDGETS.md)) | ブラウザで動かす UI なら pay.nkmr.io のホーム内に直接生やす |
| ③ | **CORS allowlist 追加依頼** | 別ドメイン (`.nkmr.io` 外) が本当に必要なら admin に相談 |
| ④ | **サブパス相乗り** | admin に「`pay.nkmr.io/hack/xxx/` に static 置かせて」と頼む。同一オリジン扱いになる |

Bearer 認証でセッション ID を得る方法:
```bash
# dev-login で Cookie を貰った直後、セッション ID を取り出す
SID=$(curl -s -c - -H 'X-Requested-With: labpay' -H 'Content-Type: application/json' \
     -d '{"email":"you@example.ac.jp"}' \
     https://pay.nkmr.io/api/auth/dev-login | awk '/labpay_sid/ {print $NF}')
echo $SID  # 32 文字 hex

# 以降は Bearer で叩ける (Cookie 不要、別サブドメインからも OK)
curl -H "Authorization: Bearer $SID" https://pay.nkmr.io/api/me
```

---

## よく使うエンドポイント

> 全リストは [api.md](api.md) に。ここはハック頻出のものを抜粋。

### 残高と取引履歴

```http
GET /api/me
```

```json
{
  "user":    { "id": 3, "display_name": "中村聡史", "role": "admin", ... },
  "balance": 1234,
  "streak":  { "current_streak": 5, "longest_streak": 12, "last_checkin_date": "2026-06-01" }
}
```

```http
GET /api/me/transactions?limit=50
```

`type` は `initial / checkin / purchase / fee / reversal / transfer / task_reward / deposit / refund / burn / scrapbox_reward` のいずれか。`signed_amount` は自分の口座から見た符号付き整数 (正 = 受取、負 = 支払)。

### 送金 (友達に pt を渡す)

```http
POST /api/transfers
Content-Type: application/json
X-Requested-With: labpay

{
  "to_user_id": 7,
  "amount": 100,
  "memo": "ありがとう",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

成功すると `{ "ok": true, "ledger_id": 12345, "new_balance": 1134 }`。残高不足だと `402 insufficient_funds`。

### タスクを出す

```http
POST /api/tasks
Content-Type: application/json
X-Requested-With: labpay

{
  "title": "原稿チェックお願い",
  "description": "PDF 添付、ですます調統一の確認だけで OK",
  "reward": 50,
  "capacity": 1,
  "per_user_limit": 1,
  "audience_grades": "M1,M2,D",   // 任意
  "deadline": "2026-06-10 18:00:00"
}
```

返ってきたレスポンスの `id` を使って、別途ファイル添付 (multipart):

```bash
curl -b cookies.txt \
     -H "X-Requested-With: labpay" \
     -F "file=@manuscript.pdf" \
     https://pay.nkmr.io/api/tasks/123/attachments
```

### 在室情報を取る

```http
GET /api/presence
```

```json
{
  "rooms": [
    {
      "id": "10F", "display_name": "10階研究室",
      "users": [
        { "id": 7, "display_name": "...", "avatar_url": "...",
          "session_start_at": "2026-06-01 09:32:14", "stay_minutes": 234 }
      ]
    }
  ]
}
```

ポーリング推奨間隔: **60 秒以上** (頻度上げてもサーバ側のスナップショットは 1 分単位で更新される)。

### 文献管理 (refs、 v925+) — 一番拡張性高い

DOI から metadata 取得 → refs に追加 → 要約までの pipeline:

```http
# 1. DOI から metadata 取得
POST /api/refs/import_doi     { "doi": "10.1145/3313831.3376234" }
# → { "meta": { "title": "...", "authors": [...], "year": 2020, ... }, "existing": null }

# 2. refs に保存
POST /api/refs                { "title": "...", "doi": "...", "authors": [...], ... }
# → { "ok": true, "id": 42 }

# 3. PDF 添付 (multipart)
POST /api/refs/42/attach_pdf  [file=paper.pdf]
# → { "ok": true, "pdf_path": "/uploads/refs/xx/xxxx.pdf", "pdf_sha256": "..." }

# 4. 要約キック (PDF 再送)
POST /api/ai/paper_translate  [file=paper.pdf, model=gpt-5, auto_share=1]
# → { "share_token": "...", "message": "要約中..." }

# 5. Semantic Scholar で被引用数埋め
POST /api/refs/42/ss_enrich   {}
# → { "citation_count": 234, "reference_count": 45 }

# 6. bibliography 一括生成
POST /api/refs/bibliography   { "collection_id": 1, "style": "apa" }
# → { "bibliography": "Nakamura, S. (2020). ..." }
```

### AI 呼び出し (v750+)

```http
# 論文要約 (multipart PDF + model + auto_share フラグ)
POST /api/ai/paper_translate     [file, model=gpt-5, auto_share=1]

# Deep Research (query base)
POST /api/ai/deep_research       { "query": "eye tracking...", "depth": "standard", "auto_share": 1 }

# 原稿チェック
POST /api/ai/resume_check        [file] (5pt)

# 文字数リライター
POST /api/ai/rewriter            { "text": "...", "max_chars": 500 }
```

### Overleaf 追跡 (v886+)

```http
GET /api/overleaf/projects       # 全プロジェクトの 24h/7d delta + sparkline
GET /api/overleaf/projects/{id}  # 60 日履歴 + per-file 内訳
```

### 活動ヒートマップ

```http
GET /api/presence/heatmap?days=30
```

```json
{
  "days": 30,
  "range_from": "2026-05-03 00:00:00",
  "range_to":   "2026-06-02 00:00:00",
  "days_of_week": [4, 5, 5, 4, 4, 4, 4],  // Sun..Sat の各曜日が何日含まれるか
  "rooms": [
    {
      "id": "10F", "display_name": "10階研究室",
      "matrix": [
        // Sun..Sat 各曜日 (0..6) の 24 時間配列
        // matrix[w][h] = その曜日 h 時の平均在室人数
        [0,0,0,0,0,0,0,0,0.3,1.2,1.8, ...],
        ...
      ]
    }
  ]
}
```

`days` は 1..365 で指定可。1〜7 で短期パターン、30〜90 で「普段の感じ」、365 で「年単位の傾向」が見えます。

### ユーザリスト (誰がいるか調べる)

```http
GET /api/users
```

```json
{
  "items": [
    { "id": 3, "display_name": "中村聡史", "avatar_url": "...", "grade": null },
    ...
  ]
}
```

---

## サンプルクライアント

### Python (3.10+)

```python
import requests, uuid

BASE = "https://pay.nkmr.io/api"
EMAIL = "you@example.ac.jp"

session = requests.Session()

# 1) Dev login (cookie が session に乗る)
r = session.post(f"{BASE}/auth/dev-login",
                 headers={"X-Requested-With": "labpay"},
                 json={"email": EMAIL})
r.raise_for_status()
print("logged in as:", r.json()["user"]["display_name"])

# 2) 残高
me = session.get(f"{BASE}/me").json()
print("balance:", me["balance"], "streak:", me["streak"]["current_streak"])

# 3) 友達に 10pt 送る (冪等性キー付き)
def send(to_user_id, amount, memo):
    r = session.post(f"{BASE}/transfers",
        headers={"X-Requested-With": "labpay"},
        json={"to_user_id": to_user_id, "amount": amount, "memo": memo,
              "idempotency_key": str(uuid.uuid4())})
    r.raise_for_status()
    return r.json()

# print(send(to_user_id=7, amount=10, memo="hi"))

# 4) ヒートマップ取得 (例: 過去30日)
hm = session.get(f"{BASE}/presence/heatmap?days=30").json()
for room in hm["rooms"]:
    print(f"{room['id']}: peak={max(max(row) for row in room['matrix']):.1f} 人")
```

### Node.js (fetch ベース、Node 18+)

```javascript
import { CookieJar } from 'tough-cookie';
import { fetch as cookieFetch } from 'fetch-cookie';

const BASE = 'https://pay.nkmr.io/api';
const jar = new CookieJar();
const fetch = cookieFetch(globalThis.fetch, jar);

async function call(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'X-Requested-With': 'labpay', 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

await call('/auth/dev-login', {
  method: 'POST',
  body: JSON.stringify({ email: 'you@example.ac.jp' }),
});

const me = await call('/me');
console.log('balance:', me.balance);

const hm = await call('/presence/heatmap?days=7');
for (const room of hm.rooms) {
  const peak = Math.max(...room.matrix.flat());
  console.log(`${room.id}: peak=${peak.toFixed(1)} 人`);
}
```

### Bash + curl

```bash
#!/usr/bin/env bash
set -e
COOKIE=/tmp/labpay.cookies
BASE=https://pay.nkmr.io/api

# Login
curl -sS -c $COOKIE -H 'X-Requested-With: labpay' -H 'Content-Type: application/json' \
     -d '{"email":"you@example.ac.jp"}' \
     $BASE/auth/dev-login | jq .

# 残高
curl -sS -b $COOKIE $BASE/me | jq .

# 送金
UUID=$(python3 -c 'import uuid; print(uuid.uuid4())')
curl -sS -b $COOKIE \
     -H 'X-Requested-With: labpay' -H 'Content-Type: application/json' \
     -d "{\"to_user_id\":7,\"amount\":100,\"idempotency_key\":\"$UUID\"}" \
     $BASE/transfers | jq .
```

---

## Tips とハマりどころ

### CSRF ヘッダ忘れ

変更系 API で `X-Requested-With: labpay` を付け忘れると `403 csrf`。fetch ラッパでまとめてつけるのが楽。

### 冪等性キーの再利用

`idempotency_key` を **使い回す** と「前回のレスポンスがそのまま返ってくる」だけで、新しい移動は起きません。これは仕様 (ネットワーク再送対策)。新しい操作には新しい UUID を毎回作る。

### Cookie が立たない / 401 が出続ける

- HTTPS で接続している? Cookie は `Secure` 属性付きで HTTPS 必須
- 同一オリジン? `localhost:3000` → `pay.nkmr.io` は別オリジン
- `credentials: 'include'` (fetch) または cookie jar を持ち回している?

### 大量にポーリングしないで

`/api/presence` `/api/me` を 1秒に 10 回叩くようなコードは止めてください (DB に響くし他の人が困る)。一般原則として 30 秒〜 1 分間隔で十分です。

### 残高ゼロのテスト

dev login で入ったテストアカウントは初回時 500pt 付与されます。それを使い切ったら admin に追加発行してもらうか、互いに送り合って試してください。

### 大きな返答

`/api/me/transactions` は `limit` でページネーション。デフォルト 50、最大 500。`offset` で続きが取れます。

### 楽天 API について

`/api/products/{jan}` の裏では楽天 Ichiba Item Search が呼ばれることがありますが、レート制限があるので **同じ JAN を秒間何百回も叩かないでください**。クライアント側でキャッシュしてあげると喜ばれます。

---

## 全 API リファレンス

エンドポイント一覧は **[docs/api.md](api.md)** にあります (簡易リファレンス)。さらに深掘りたいときは `src/handlers/` のソースを直接読んでください — 1 ファイル 200〜500 行の素 PHP で読みやすく書いてあります。

---

## 困ったら

- API の挙動に納得いかない / 使いたいけど無いエンドポイント → GitHub Issues か直接スタッフへ
- ハッカソン期間中はサーバ側ログを見て応答に協力します
- データを「リセット」したい場合: 自分のテストアカウントの取引を admin に依頼して reversal で消してもらう (admin の `/#/admin → 決済の取消` から)

楽しいハックを！
