# LabPay

研究室ローカルポイントシステム。約35人規模の閉じたコミュニティ向けに「**買う・売る・タスク・送る**」を最小実装した PWA + バックエンド。

LabPay は **使い切りの軽さ**を最優先に設計されています:

- **フレームワークなし** — 素の PHP 8.x + Vanilla JS。React や Composer を入れない
- **ビルド工程なし** — `rsync` で配置するだけで動く
- **依存ゼロ** — npm パッケージは使わない (ZXing は静的ファイルとして同梱)
- **長期凍結耐性** — 10年後も同じコードが PHP 8.x + ブラウザで動く想定

## 機能

| 領域 | 内容 |
|---|---|
| 残高・取引 | 購入 / 販売 / 個人送金 (QR コード対応) |
| 来室チェックイン | ラボ WiFi で自動検知 + Geolocation フォールバック (50m 圏内) |
| 連続来室 streak | 祝日・休業日カレンダー対応、途切れ時は減衰 (リセットしない) |
| マーケット | バーコード読取 + 楽天 API で商品名・画像自動取得 |
| タスク | 依頼 → 受諾 → 承認、エスクロー預け、対象学年フィルタ、締切設定 |
| 実績 | 8 軸 × 4 段階のメダル (来室・販売・購入・タスク完了等) |
| Scrapbox 連携 | 日次の更新ページ数に応じてポイント付与 (cron) |
| 在室検知 | scanner 経由で部屋単位の MAC 観測 → アバター付きで「今ラボにいる人」表示 |
| PWA | オフライン shell / ホーム画面追加 / インストール可 |

## アーキテクチャ

```
LabPay/
├── public/                 ← Apache DocumentRoot
│   ├── index.html          ← SPA shell
│   ├── api/index.php       ← フロントコントローラ (全API入口)
│   ├── manifest.webmanifest, sw.js
│   ├── css/style.css
│   ├── img/                ← PWA アイコン
│   ├── js/                 ← ES Modules
│   │   ├── app.js, router.js, api.js, scan.js
│   │   └── views/          ← ページ毎の renderer
│   ├── vendor/             ← ZXing (バーコード/QR)
│   └── uploads/            ← ユーザアップロード (gitignore)
├── src/                    ← PHP (DocumentRoot 外推奨)
│   ├── bootstrap.php       ← config 読込・PDO 生成・ヘルパ
│   ├── Db.php, Ledger.php, Money.php, Auth.php, Calendar.php,
│   │   Notifier.php, ProductInfo.php, Achievements.php
│   └── handlers/           ← /api/* の各リソース
├── config/
│   ├── config.sample.php   ← 設定テンプレ
│   └── config.php          ← 実設定 (gitignore)
├── migrations/             ← 001…009 順に流す
├── bin/
│   ├── scanner.py          ← 部屋常駐スキャナ (Windows/Linux/Mac)
│   ├── scrapbox_sync.php   ← Scrapbox 同期 (cron)
│   ├── backup.sh           ← mysqldump バックアップ
│   └── make_icons.py       ← PWA アイコン生成 (Pillow)
└── docs/api.md             ← 自作クライアント向け API リファレンス
```

技術スタック:

- **OS**: Rocky Linux 10 (本番想定)
- **HTTP**: Apache 2.4 + mod_rewrite
- **DB**: MariaDB 10.11 (InnoDB)
- **言語**: PHP 8.3 + PDO
- **フロント**: ES Modules + 素 CSS
- **バーコード**: ZXing (`@zxing/library` UMD)
- **HTTPS**: Let's Encrypt (certbot)
- **認証**: Google OAuth + dev login (Cookie session)

---

## クイックスタート (ローカル開発)

PHP 8.x と MariaDB/MySQL が手元にあれば動きます。

```bash
git clone https://github.com/nkmr-lab/LabPay.git
cd LabPay

# DB
mysql -u root -p -e "CREATE DATABASE labpay CHARACTER SET utf8mb4;"
mysql -u root -p -e "CREATE USER 'labpay'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';"
mysql -u root -p -e "GRANT ALL ON labpay.* TO 'labpay'@'127.0.0.1';"
for f in migrations/*.sql; do mysql -u labpay -p labpay < "$f"; done

# 設定
cp config/config.sample.php config/config.php
$EDITOR config/config.php   # DB pass / base_url / bootstrap_admin_email を編集

# ZXing (バーコード/QR)
mkdir -p public/vendor
curl -sL -o public/vendor/zxing.min.js https://unpkg.com/@zxing/library@latest/umd/index.min.js

# 起動 (開発用 PHP ビルトインサーバ)
php -S 127.0.0.1:8080 -t public public/api/index.php
# → http://127.0.0.1:8080/ にアクセス
```

> 開発用ビルトインサーバには `.htaccess` の rewrite が無いので、`public/api/index.php` をルータとして渡しています。ブラウザのカメラ機能 (バーコード読取) は HTTPS 必須なので、本格的に試すなら本番デプロイか `mkcert` で TLS を張ってください。

---

## 本番デプロイ (Rocky Linux 10)

### 1. パッケージ + DB

```bash
sudo dnf install -y epel-release
sudo dnf install -y httpd mod_ssl php php-mysqlnd php-pdo php-mbstring php-json \
                    mariadb-server certbot python3-certbot-apache git rsync
sudo systemctl enable --now mariadb httpd
sudo mysql_secure_installation

DBPASS=$(python3 -c "import secrets; print(secrets.token_hex(16))")
sudo mysql <<SQL
CREATE DATABASE labpay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'labpay'@'127.0.0.1' IDENTIFIED BY '$DBPASS';
GRANT ALL ON labpay.* TO 'labpay'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo "DBPASS=$DBPASS" | sudo tee /root/.labpay_dbpass   # 控えておく
```

### 2. ソース配置

```bash
sudo git clone https://github.com/nkmr-lab/LabPay.git /var/www/labpay
cd /var/www/labpay
sudo chown -R apache:apache .
sudo find . -type d -exec chmod 755 {} +
sudo find . -type f -exec chmod 644 {} +
sudo chmod 750 src config migrations bin
```

### 3. 設定ファイル

```bash
sudo cp config/config.sample.php config/config.php
sudo chmod 640 config/config.php
sudoedit config/config.php   # 後述の「設定リファレンス」を参照
```

### 4. マイグレーション

```bash
for f in /var/www/labpay/migrations/*.sql; do
  sudo bash -c "mysql labpay < $f"
done
```

### 5. Apache vhost

`/etc/httpd/conf.d/labpay.conf`:

```apache
<VirtualHost *:80>
    ServerName pay.example.ac.jp
    DocumentRoot /var/www/labpay/public
    <Directory /var/www/labpay/public>
        AllowOverride All
        Require all granted
    </Directory>
    <DirectoryMatch "/var/www/labpay/(src|config|migrations|bin)">
        Require all denied
    </DirectoryMatch>
    ErrorLog  logs/labpay_error.log
    CustomLog logs/labpay_access.log combined
</VirtualHost>
```

```bash
sudo httpd -t && sudo systemctl reload httpd
```

### 6. HTTPS (PWA・カメラ・Cookie Secure に必須)

```bash
sudo certbot --apache -d pay.example.ac.jp --redirect \
  --non-interactive --agree-tos -m you@example.com
```

### 7. ZXing 配置

```bash
sudo curl -sL -o /var/www/labpay/public/vendor/zxing.min.js \
  https://unpkg.com/@zxing/library@latest/umd/index.min.js
sudo chown apache:apache /var/www/labpay/public/vendor/zxing.min.js
```

### 8. firewalld / SELinux

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload

sudo setsebool -P httpd_can_network_connect 1   # 外部 API 呼出 (Rakuten 等)
sudo restorecon -Rv /var/www/labpay
```

### 9. 動作確認

ブラウザで `https://pay.example.ac.jp/` → 「dev ログイン」もしくは Google で入る → 残高に初期 500pt が付与されていれば成功。

---

## 設定リファレンス (`config/config.php`)

| キー | 用途 |
|---|---|
| `db.dsn / user / pass` | MariaDB 接続情報 |
| `app.base_url` | 公開 URL (末尾 `/` なし)。OAuth redirect の組立に使う |
| `app.cookie_secure` | 本番は `true`、HTTPS 前提 |
| `auth.google_oauth_enabled` | Google OAuth を使うか |
| `auth.google_client_id / client_secret` | Google Cloud Console で発行 |
| `auth.dev_login_enabled` | 許可リスト email を選ぶだけでログイン。**本番は false** |
| `auth.bootstrap_admin_email` | 起動時に許可リストへ admin として自動登録される |
| `mail.enabled` | 通知メール (`mail()` 経由) を送るか |
| `rakuten.application_id / access_key` | 楽天 Ichiba 商品検索 API (任意。空なら手動入力フロー) |
| `exposure.*` | 各機能の有効化トグル (`public_read`, `listings_write`, `purchase`) |

DB 上のランタイム設定 (admin UI から変更可) は `config` テーブル:

| キー | デフォルト | 意味 |
|---|---|---|
| `fee_rate` | 0.05 | 取引手数料率 (売り手負担、floor) |
| `initial_points` | 500 | 初回ログイン時の付与額 |
| `checkin_base` | 10 | 来室1回の基本ポイント |
| `streak_bonus_cap` | 10 | streak ボーナス計算の上限 |
| `streak_bonus_divisor` | 2 | `points = base + floor(min(cap, streak-1) / divisor)` |
| `streak_decay_per_missed_workday` | 5 | 連続が途切れた時の減衰量 |
| `presence_window_minutes` | 5 | 在室判定の有効秒 |
| `geo_default_radius_m` | 50 | 位置情報チェックインの許容距離 |
| `scrapbox_project` | (空) | Scrapbox 連携先 project 名 |
| `scrapbox_pt_per_page / daily_cap` | 3 / 20 | 1ページあたり/1日あたりのポイント |

---

## Scanner セットアップ (在室検知用)

各部屋に1台、常時起動のマシン (Windows / Mac / Linux 何でも) を置き、ローカル subnet を ARP スキャンして見えた MAC を `/api/presence/scan` に POST します。

### 部屋登録

ブラウザの管理画面 (`#/admin` → 詳細管理 → 部屋) で部屋を作成 → 表示される `scanner_token` を控える (**一度しか出ません**)。

### Scanner 配置 (例: 10階)

```bash
# 配置先マシンに bin/ 一式をコピー
cp -r LabPay/bin/scanner.py LabPay/bin/scanner.config.sample.json .

# 設定ファイル
cp scanner.config.sample.json scanner.config.json
# scanner.config.json を編集:
# {
#   "labpay_url": "https://pay.nkmr.io",
#   "room_id": "10F",
#   "scanner_token": "<管理画面で表示されたトークン>",
#   "subnet": "192.168.50.0/24"
# }

# テスト実行
python3 scanner.py
# → [scanner] room=10F subnet=192.168.50.0/24 observed=N -> HTTP 200
```

### 定期実行

- **Windows**: 添付の `scanner_run.bat` を Task Scheduler に 1分間隔で登録 (`bin/README.md` 参照)
- **Linux / Mac**: cron `* * * * * /usr/bin/python3 /path/to/scanner.py >> /var/log/labpay-scanner.log 2>&1`

### 別の部屋 (例: 7階)

同じ scanner.py を 7F 側の常時起動マシンに置き、`room_id` と `scanner_token` だけ差し替えれば OK。Scanner 同士の通信は不要なのでネットワークセグメントは分かれていて構いません。

---

## 運用

### バックアップ

```bash
# /etc/cron.d/labpay-backup
30 3 * * * root LABPAY_DB_PASS="..." /var/www/labpay/bin/backup.sh
```

30日保持。`mysqldump --single-transaction` で整合性を保ちます。

### Scrapbox 同期

```bash
# /etc/cron.d/labpay-scrapbox
30 4 * * * apache /usr/bin/php /var/www/labpay/bin/scrapbox_sync.php >> /var/log/labpay-scrapbox.log 2>&1
```

前日の更新を翌朝に集計してポイント付与。同じ日に対する重複付与は `scrapbox_credits` テーブルで防いでいます。手動同期は admin 画面から `POST /api/admin/scrapbox/sync` でも可能。

### Let's Encrypt 自動更新

certbot が `/etc/cron.d/certbot` を作るので追加作業不要。`sudo certbot renew --dry-run` で確認可。

### ログ

- Apache: `/var/log/httpd/labpay_*.log`
- PHP の `error_log`: Apache の error.log に流れる
- Scanner: 各部屋のローカルログ (`bin/scanner.log`)
- Scrapbox sync: cron でリダイレクト先

---

## 更新 (Git pull デプロイ)

```bash
cd /var/www/labpay
sudo -u apache git pull
# migration を追加した回のみ
for f in migrations/00X_*.sql; do
  sudo bash -c "mysql labpay < $f"
done
sudo systemctl reload httpd
```

PHP は配置で即反映。常駐プロセス無し。SW のキャッシュは `sw.js` 内の `CACHE_NAME` を bump すると強制更新されます。

---

## 本番化前のセキュリティチェックリスト

- [ ] `config/config.php`: `dev_login_enabled = false`
- [ ] Google OAuth `client_secret` を Google Cloud Console で再発行 → 設定差し替え
- [ ] Rakuten `access_key` を Web Service Console で再発行 → 設定差し替え
- [ ] deploy 用に sudo NOPASSWD を入れている場合は解除 (`sudo rm /etc/sudoers.d/<user>`)
- [ ] `bin/backup.sh` を cron 登録、復元手順を1回試す
- [ ] DB と config の オフサイトバックアップを別途構築
- [ ] Apache の `mod_security` または `fail2ban` を入れて bruteforce 対策

---

## 経済仕様

- 1pt = 1円相当 / **正の整数のみ** (小数なし)
- 手数料 5% (売り手負担・floor)
- ポイント発行は **SYSTEM 口座のみ** (初期配布・来室ボーナス・タスク報酬・Scrapbox 更新)
- 初期付与: 500pt
- 来室: 10pt + 連続 streak ボーナス (`+ floor(min(10, streak-1) / 2)`、上限 +5pt → 1日最大15pt)
- 手数料の SYSTEM 口座への戻入で経済をクローズ
- 全移転は 1 つの `Ledger::transfer()` 関数を通り、`BEGIN + FOR UPDATE + 残高チェック` で整合性を担保
- 台帳 (`ledger` テーブル) は**追記専用**。訂正は逆仕訳 (`type='reversal'`) で行う

---

## ライセンス・連絡先

- 内部運用想定の社内ツール。ライセンス未設定 (利用は研究室メンバー限定)
- 連絡先: [@nkmr-lab](https://github.com/nkmr-lab)
- API 仕様は [docs/api.md](docs/api.md)
- Scanner セットアップ詳細は [bin/README.md](bin/README.md)
