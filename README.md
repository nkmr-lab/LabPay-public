# LabPay

研究室ローカルポイントシステム。約 35 人規模のクローズドコミュニティ向けに「**買う・売る・タスク・送る・実績**」+ ラボ活動の可視化を最小実装した PWA + バックエンド。

```
本番稼働: https://pay.nkmr.io  (中村研 内部)
```

LabPay は **使い切りの軽さ**を最優先に設計されています:

- **フレームワークなし** — 素の PHP 8.x + Vanilla JS。React や Composer を入れない
- **ビルド工程なし** — `git pull` + `systemctl reload httpd` で反映
- **依存ゼロ** — npm パッケージは使わない (ZXing と d3 はベンダディレクトリに同梱)
- **長期凍結耐性** — 10 年後も同じコードが PHP 8.x + ブラウザで動く想定

---

## 機能一覧

| 領域 | 内容 |
|---|---|
| 残高・取引 | 購入 / 販売 / 個人送金 (QR) / 自己消費 (在庫を自分用に減らす・手数料なし) |
| 購入 | ラボ Wi-Fi 接続中のみ許可 (オフラインからは閲覧のみ) / リピート購入は履歴一致のタイル上位表示 / バーコード読取 |
| マーケット (販売) | バーコード読取 + 楽天 API で商品名・画像自動取得 / 置き場所 / 出品ごとに購入時お礼メッセージ / Slack 入荷通知 / 出品中はサマリ表示 → 編集モードでフィールド一括更新 |
| タスク | 依頼 → 引き受け → 承認、エスクロー預け / 時間枠分割 (`6/15 11:00-15:00 30分刻み`) / 締切自動取消 + 返金 / 完了報告フィードバック / **ファイル添付** (原稿チェック向け、最大 50MB) / 引き受け本人にも通知 / ホームに「あなたが引き受け中のタスク」カード |
| 募集 | 「お昼ご飯」「ビアガーデン」「ポケモン GO」など pt の無いカジュアル招集。日時/場所/上限/詳細、参加表明、6h 経過で自動 close |
| ルーレット | タイトル + メンバー (学年 / 部屋単位 bulk select 可) + 任意の賞金、サーバ側 CSPRNG 抽選 → SVG 円盤 14s スピン → 当選者へ送金 + 全員通知。テストモード (dry-run) で空回し可 |
| これ欲しい (Wishlist) | 商品名 + 任意 JAN + メモでリクエスト掲示、誰でも閲覧可・誰でも「出ました!」で達成扱い |
| バグ報告 / 機能要望 | 設定から送信、admin の通知 + Slack に転送 |
| 利用ログ | 全 API リクエストを `activity_log` に記録 (user/method/path/status/duration/ip/UA) — 将来の論文用 |
| ラボイン (来室) | ラボ Wi-Fi で自動検知 → 1日1回ボーナス。連続日数で base に最大 +10 上乗せ。`base + min(cap, max(0, streak-1)) * per_day / divisor` 式で全パラメータ admin 編集可。MAC 未登録ユーザにはホームでオンボーディング誘導 |
| 連続ラボイン streak | 祝日・休業日カレンダー対応。来た日は曜日問わず連続日数が進む。来なくても祝日/週末はマイナスしない。平日 (workday) を逃した分だけ `streak_decay_per_missed_workday` (デフォルト 5) で減衰 |
| 在室検知 | scanner 経由で部屋単位の MAC 観測 → アバター付きで「今ラボにいる人」表示。直近 30 秒以内は太字フルカラー、それ以降は徐々にグレースケール化、`presence_window_minutes` を超えると消える。閉じたセッションは `presence_sessions` に記録、CSV ログにも追記 |
| ラボ活動マップ | 部屋 × 曜日 × 時間の在室人数ヒートマップ (`#/activity`)。ログが蓄積されるほど長期間のパターン (1週間 → 1年) が選べる |
| 草 (GitHub 風) | ホームに本年度 (4/1 起点) の日次滞在時間グリッド |
| 実績 | 11 カテゴリ × 4 段階のメダル (ラボイン日数・連続記録・販売・購入・取扱高・タスク完了・Scrapbox 寄稿日数・ルーレット主催/当選 など) |
| Scrapbox 寄稿ボーナス | Slack の `#scrapbox` 通知を読んで `author_name` ごとに集計 → 申告 handle 経由で LabPay user に配布 (日次 23:59 JST cron)。任意編集 5pt + 自身の研究ノート編集で +5pt (= 最大 10pt/日) |
| 関係グラフ | 売買 / タスク / 統合の 3 タブ。d3 v7 force-directed、アバター node + 件数 or 総額ベースのエッジ太さ切替 |
| 通知 | アプリ内通知 + (任意) メール + Slack incoming webhook。残高・履歴・通知数はホームで 30 秒間隔ポーリング |
| 管理機能 | 取引一覧から取消 / ポイント発行 (全員配布 or 個人指定) / 流通量サマリ (Admin vs 一般保有) / カレンダー編集 / 部屋登録 (scanner_token 発行) / 配信 / 設定ノブ編集 |
| PWA | オフライン shell / ホーム画面追加 / インストール可 |

---

## ディレクトリ構成

```
LabPay/
├── public/                  ← Apache DocumentRoot
│   ├── index.html           ← SPA shell
│   ├── api/index.php        ← フロントコントローラ (全 API 入口)
│   ├── manifest.webmanifest, sw.js
│   ├── css/style.css
│   ├── img/                 ← PWA アイコン
│   ├── js/
│   │   ├── app.js           ← 起動 + ルータ + 認証
│   │   ├── router.js, api.js, scan.js
│   │   ├── labels.js        ← LEDGER_TYPE_LABEL の単一定義 (home/history/admin が共有)
│   │   ├── upload.js        ← uploadImage / uploadTaskAttachment ヘルパ
│   │   └── views/           ← ページ毎の renderer
│   │       ├── home.js, buy.js, sell.js, product.js
│   │       ├── tasks.js, transfer.js, history.js
│   │       ├── achievements.js, network.js, activity.js
│   │       ├── notifications.js, settings.js, admin.js, login.js
│   │       ├── invitations.js, roulette.js, wishlist.js
│   ├── vendor/              ← ZXing (バーコード/QR) + d3 (関係グラフ)
│   └── uploads/             ← ユーザアップロード (gitignore)
│       ├── products/        ← 商品画像・アバター
│       ├── tasks/{task_id}/ ← タスク添付ファイル
│       └── .htaccess        ← PHP 実行不可化 (多段防御)
├── src/                     ← PHP (DocumentRoot 外)
│   ├── bootstrap.php        ← config 読込・PDO 生成・ヘルパ (save_uploaded_file / slack_notify / notify_safely / slack_api_get / activity_log_write)
│   ├── Db.php, Ledger.php, Money.php, Auth.php, Calendar.php
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
├── config/
│   ├── config.sample.php    ← 設定テンプレ
│   └── config.php           ← 実設定 (gitignore — シークレットを含む)
├── migrations/              ← 001…030 順に流す
├── bin/
│   ├── scanner.py           ← 部屋常駐スキャナ
│   ├── scanner.config.json  ← scanner 設定 (gitignore)
│   ├── install_scanner.ps1  ← Windows 一発セットアップ
│   ├── install_scanner.sh   ← Linux/Mac 一発セットアップ
│   ├── scrapbox_slack_sync.php  ← Scrapbox-via-Slack 集計 (日次 cron)
│   ├── run_migration.php    ← マイグレーション適用 (app config 共用)
│   ├── backup.sh            ← mysqldump バックアップ
│   └── make_icons.py        ← PWA アイコン生成 (Pillow)
└── docs/
    ├── INSTALL.md           ← 本番サーバ導入手順 (学生向け)
    ├── HACKATHON.md         ← LabPay API でハック作る人向け
    └── api.md               ← API エンドポイントリファレンス
```

技術スタック:

- **OS**: Rocky Linux 10 (本番想定)
- **HTTP**: Apache 2.4 + mod_rewrite
- **DB**: MariaDB 10.11 (InnoDB)
- **言語**: PHP 8.3 + PDO
- **フロント**: ES Modules + 素 CSS、ベンダはローカル配置の ZXing と d3 v7
- **認証**: Google OAuth + dev login (Cookie session)
- **HTTPS**: Let's Encrypt (certbot)
- **Slack**: incoming webhook (送信) + Bot Token (`conversations.history` 取得)

---

## ドキュメント

| 文書 | 用途 |
|---|---|
| **[docs/INSTALL.md](docs/INSTALL.md)** | サーバへの導入を最初から最後まで。学生が読んでセットアップできることを目標にしています |
| **[docs/HACKATHON.md](docs/HACKATHON.md)** | LabPay の API を使って何か作る人向け。認証フロー・主要エンドポイント・サンプルクライアント |
| **[docs/api.md](docs/api.md)** | 全エンドポイントの簡易リファレンス |
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

> ビルトインサーバには `.htaccess` の rewrite が無いので `public/api/index.php` をルータとして渡しています。ブラウザのカメラ機能 (バーコード読取) は HTTPS 必須なので、本格テストは本番デプロイか `mkcert` で TLS を張ってください。

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
| `auth.google_client_id / client_secret` | Google Cloud Console で発行 |
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
| `streak_weekday_only` | 0 | 0=祝日/週末でも来れば streak が進む (現行) |
| `streak_decay_per_missed_workday` | 5 | 連続が途切れた時の減衰量 (workday を逃した時のみ) |
| `presence_window_minutes` | 3 | 在室判定の有効分 |
| `scrapbox_base_pt` | 5 | Scrapbox 寄稿ボーナスのベース pt |
| `scrapbox_pt_per_extra` | 1 | 1 件追加更新ごとの上乗せ |
| `scrapbox_bonus_cap` | 5 | bonus 部分の上限 (`pt = base + min(cap, max(0, attachments-1)) * per_extra`) |
| `scrapbox_start_date` | `2026-06-01` | この日付以降のみ Scrapbox 集計対象 |

---

## 経済仕様

- 1pt ≒ 1円相当 / **正の整数のみ** (小数なし)
- 手数料: 5% (売り手負担・floor)。20pt 未満の取引は手数料 0
- ポイント発行は **SYSTEM 口座のみ** (初期配布・ラボインボーナス・タスク報酬・Scrapbox 寄稿ボーナス・admin 配布)
- 初期付与: 500pt
- ラボイン: `10 + min(10, max(0, streak-1))` → **10〜20 pt** / 1日1回 (11 日連続で天井)
  - 祝日・週末に来ても streak は進む / 来なくてもマイナスは無し
  - 平日 (workday) を逃した分だけ `-5` で減衰
- Scrapbox 寄稿: `5 + min(5, max(0, 更新回数-1))` → **5〜10 pt** / 1日上限
- 自己消費 (自分の出品を自分で減らす) はポイント移動なし・手数料なし、在庫だけ減る
- 全移転は 1 つの `Ledger::transfer()` 関数を通り、`BEGIN + FOR UPDATE + 残高チェック` で整合性を担保
- 台帳 (`ledger` テーブル) は**追記専用**。訂正は逆仕訳 (`type='reversal'`) で行う

### Admin の流通量ビュー

管理画面トップに「流通ポイント」サマリーカードがあり、`流通中 (admin + 一般) / Admin 保有 / 一般 保有 / 一般保有率 (%)` を一目で確認できます。インフレ防止のバランス監視用。

---

## マイグレーション履歴

| # | 内容 |
|---|---|
| 001 | 初期スキーマ + seed (system/escrow 口座、初期 config) |
| 002 | Presence (在室検知) テーブル |
| 003 | カレンダー overrides + Geo 座標フィールド |
| 004 | Streak 線形上限式へ変更 (milestone 表は廃止) |
| 005 | Presence first_seen_at 追加 |
| 006 | Presence infrastructure (機材 MAC 除外) |
| 007 | `users.avatar_url` 追加 |
| 008 | tasks / task_claims / transfers + grade 列 + 35人 bulk allowlist |
| 009 | tasks.deadline + streak 微調整 |
| 010 | streak 簡素化 + idempotency_keys PK 合成 + tasks.url/completion_message + listings.completion_message |
| 011 | listings.location (置き場所) |
| 012 | listings.display_name (出品者表示名スナップショット) |
| 013 | 無料 (`これどうぞ`) 出品 + 購入時お礼メッセージ |
| 014 | listings.resale_chain (転売経路) |
| 015 | presence_seen.session_start_at (連続在室セッション計測) |
| 016 | listings.expires_at (締切自動取消) |
| 017 | presence_sessions テーブル (閉じたセッションログ) |
| 018 | task_slots + task_claims.slot_id (時間枠分割) |
| 019 | user_scrapbox_handles + scrapbox_awards + ledger 'scrapbox_reward' 追加 |
| 020 | Scrapbox handle 22 件 seed |
| 021 | Scrapbox handle `Sakura` 追加 |
| 022 | Scrapbox handle `Member 03` 追加 |
| 023 | task_attachments (タスク添付ファイル) |
| 024 | 旧 Scrapbox 直接 API 関連 config row 削除 |
| 025 | Scrapbox 寄稿ルール変更 — any-edit + 自身研究ノートで +5 / +5 |
| 026 | feedback (バグ報告 / 機能要望) + activity_log (利用ログ) |
| 027 | wishlist (これ欲しい) |
| 028 | invitations + invitation_joins (募集機能) |
| 029 | roulettes (ルーレット履歴) |
| 030 | roulettes に reward / ledger_id 列追加 |

---

## 運用 cron

| 名前 | スケジュール | 役割 |
|---|---|---|
| `/etc/cron.d/labpay-scrapbox` | `59 23 * * *` | Scrapbox-via-Slack 当日分集計 → pt 配布 |
| `/etc/cron.d/labpay-backup` | `30 3 * * *` | `mysqldump --single-transaction` バックアップ (30 日保持) |
| `/etc/cron.d/certbot` | (certbot 自動生成) | Let's Encrypt 証明書更新 |

各部屋 scanner の cron / Task Scheduler 設定は [bin/README.md](bin/README.md) 参照。

---

## 開発スタイル

- **ビルドなし**: PHP / JS / CSS は配置で即反映。常駐プロセス無し
- **コメントは "WHY" のみ**: 何をしているかはコードで読める。なぜそうしたかは制約・過去のバグ・微妙な不変条件に対してのみ書く
- **エラーハンドリングは境界だけ**: 内部呼び出しは契約を信じる。`ApiException` でラップしてフロントコントローラが JSON で返す
- **追記専用台帳**: 残高は `ledger` 行の SUM(to) - SUM(from)。直接 UPDATE しない。修正は `reversal` 仕訳

---

## ライセンス・連絡先

- 内部運用想定の社内ツール。ライセンス未設定 (利用は研究室メンバー限定)
- 連絡先: [@nkmr-lab](https://github.com/nkmr-lab)

---

## 本番化前のセキュリティチェックリスト

- [ ] `config/config.php`: `auth.dev_login_enabled = false`
- [ ] Google OAuth `client_secret` を本番値に差し替え
- [ ] Rakuten `access_key`、Slack `webhook_url` / `bot_token` を本番値に差し替え
- [ ] `app.cookie_secure = true` を確認
- [ ] `bin/backup.sh` を cron 登録、復元手順を 1 回試す
- [ ] DB と config のオフサイトバックアップを別途構築
- [ ] `public/uploads/.htaccess` が反映されている (PHP 実行不可) ことを確認
- [ ] `/etc/php.d/99-labpay.ini` が配置されている (upload_max_filesize=60M 等)

### 既に実施済の堅牢化 (参考)

- 全 state-changing API は `X-Requested-With: labpay` ヘッダ強制 (CSRF)
- prepared statement + `escapeHtml` の徹底 (XSS / SQLi)
- avatar_url・タスク URL に同一オリジン / http(s) のみ許可するバリデーション + クライアント側 `safeHttpUrl` ガード
- アップロードは MIME 判定 + ファイル名 random + SVG 拒否 + 共通 `save_uploaded_file` ヘルパで一元化
- `idempotency_keys` の PK は `(ukey, user_id, endpoint)` 合成キー
- `public/uploads/.htaccess` で `.php` 等の実行・解釈を全て拒否
- 取引の取消は admin の「最近の取引から選ぶ」UI 経由 (ID 入力ミスを排除)
- scanner token は plaintext を返却するのは 1 回のみ、DB は sha256 ハッシュのみ保存
