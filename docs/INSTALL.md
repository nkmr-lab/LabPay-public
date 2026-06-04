# LabPay サーバ導入手順

研究室の新しいサーバに LabPay を一から立てる手順です。学部生がコピペで進めて完了することを想定しています。

**想定環境:** Rocky Linux 10 / Ubuntu 22.04 (どちらも対応コマンドを併記)、メモリ 1GB 以上、ストレージ 20GB 以上、独自ドメインを 1 つ持っていること (例: `pay.example.ac.jp`)。

---

## 全体像

LabPay は 3 つの層からできています:

```
[ユーザのスマホ/PC]
   ↓ HTTPS
[Web サーバ (Apache + PHP)]
   ↓ ローカル接続
[DB (MariaDB)]

[ラボの各部屋に置く Scanner マシン] —HTTPS→ [Web サーバ]
```

このドキュメントでは Web サーバと DB のセットアップを扱います。Scanner マシンの設置は最後の章 + [bin/README.md](../bin/README.md) を参照してください。

---

## ステップ 0: 事前準備

### 必要なもの

- **サーバ**: クラウド VPS (さくら / AWS Lightsail / DigitalOcean 等) もしくは物理マシンに Rocky Linux 10 か Ubuntu 22.04 をクリーンインストールしたもの
- **ドメイン**: `pay.example.ac.jp` のような独自ホスト名。A レコードをサーバの IP に向けておくこと
- **メールアドレス**: Let's Encrypt 証明書の通知用
- **Google Cloud アカウント**: OAuth クライアントを発行する (5 分でできる)
- **Slack ワークスペース** (オプション): 通知連携を使うなら

### サーバ初期化

```bash
# Rocky Linux 10
sudo dnf update -y
sudo timedatectl set-timezone Asia/Tokyo
sudo hostnamectl set-hostname pay.example.ac.jp

# Ubuntu 22.04
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Tokyo
sudo hostnamectl set-hostname pay.example.ac.jp
```

SSH 鍵認証だけ受け付ける設定にしておくこと (パスワード認証 OFF) を強く推奨。

---

## ステップ 1: パッケージのインストール

### Rocky Linux 10

```bash
sudo dnf install -y epel-release
sudo dnf install -y httpd mod_ssl \
                    php php-mysqlnd php-pdo php-mbstring php-json \
                    php-curl php-fileinfo php-zip \
                    mariadb-server \
                    certbot python3-certbot-apache \
                    git curl tar
sudo systemctl enable --now mariadb httpd
```

### Ubuntu 22.04

```bash
sudo apt install -y apache2 libapache2-mod-php \
                    php php-mysql php-mbstring php-json php-curl php-zip php-xml \
                    mariadb-server \
                    certbot python3-certbot-apache \
                    git curl
sudo systemctl enable --now mariadb apache2
sudo a2enmod rewrite ssl
```

---

## ステップ 2: データベース

### 2.1 MariaDB の初期セットアップ

```bash
sudo mysql_secure_installation
```

聞かれる項目:
- root password → 設定する (`/root/.mysql_root` などに控える)
- anonymous users / remote root login / test database → 全部 Y で削除
- reload privilege tables → Y

### 2.2 LabPay 用のデータベースとユーザを作る

```bash
DBPASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
echo "DBPASS=$DBPASS" | sudo tee /root/.labpay_dbpass    # あとで config.php に転記

sudo mysql <<SQL
CREATE DATABASE labpay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'labpay'@'127.0.0.1' IDENTIFIED BY '$DBPASS';
GRANT ALL ON labpay.* TO 'labpay'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

---

## ステップ 3: ソースコードを置く

```bash
sudo git clone https://github.com/nkmr-lab/LabPay.git /var/www/labpay
cd /var/www/labpay
```

### 3.1 所有者・権限

```bash
# Rocky だと apache:apache、Ubuntu だと www-data:www-data
WWWUSER=apache; [ -f /etc/debian_version ] && WWWUSER=www-data

sudo chown -R $WWWUSER:$WWWUSER /var/www/labpay
sudo find /var/www/labpay -type d -exec chmod 755 {} +
sudo find /var/www/labpay -type f -exec chmod 644 {} +
sudo chmod 750 /var/www/labpay/src /var/www/labpay/config /var/www/labpay/migrations /var/www/labpay/bin
```

### 3.2 アップロードディレクトリ

```bash
sudo install -o $WWWUSER -g $WWWUSER -d -m 755 \
    /var/www/labpay/public/uploads/products \
    /var/www/labpay/public/uploads/tasks
```

`public/uploads/.htaccess` はリポジトリに同梱されており、PHP 実行を多段防御で無効化しています。

---

## ステップ 4: ベンダライブラリ (ZXing と d3)

ブラウザ機能 (バーコード読取 / 関係グラフ) を使うのに必要です。git 管理外なので個別に取得します。

```bash
sudo install -o $WWWUSER -g $WWWUSER -d /var/www/labpay/public/vendor

sudo -u $WWWUSER curl -sL -o /var/www/labpay/public/vendor/zxing.min.js \
    https://unpkg.com/@zxing/library@latest/umd/index.min.js

sudo -u $WWWUSER curl -sL -o /var/www/labpay/public/vendor/d3.min.js \
    https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js
```

---

## ステップ 5: 設定ファイル

```bash
sudo cp /var/www/labpay/config/config.sample.php /var/www/labpay/config/config.php
sudo chown $WWWUSER:$WWWUSER /var/www/labpay/config/config.php
sudo chmod 640 /var/www/labpay/config/config.php
sudo -e /var/www/labpay/config/config.php   # 編集
```

最低限編集が必要な項目:

```php
return [
    'db' => [
        'dsn'  => 'mysql:host=127.0.0.1;dbname=labpay;charset=utf8mb4',
        'user' => 'labpay',
        'pass' => '<ステップ 2.2 の DBPASS>',
    ],
    'app' => [
        'base_url'      => 'https://pay.example.ac.jp',  // 末尾 / なし
        'cookie_secure' => true,
        'timezone'      => 'Asia/Tokyo',
    ],
    'auth' => [
        'google_oauth_enabled' => true,    // ステップ 7 で有効化
        'google_client_id'     => '',      // ステップ 7 で埋める
        'google_client_secret' => '',
        'dev_login_enabled'    => false,   // 本番は必ず false
        'bootstrap_admin_email'=> 'you@example.ac.jp',  // 自分のメール
    ],
    // ... 他はそのままで OK
];
```

---

## ステップ 6: マイグレーション (DB スキーマ)

```bash
for f in /var/www/labpay/migrations/*.sql; do
  sudo -u $WWWUSER php /var/www/labpay/bin/run_migration.php "$f"
done
```

各ファイルが `applied: ...` と表示されれば成功。エラーが出たら止まるので、ログを見て該当箇所を修正してから再実行 (マイグレーションは `IF NOT EXISTS` / `ON DUPLICATE KEY` で冪等)。

---

## ステップ 7: Google OAuth 設定

LabPay はパスワード認証を持たず、Google アカウントだけでログインします。

1. https://console.cloud.google.com/ で **新規プロジェクト**作成 (名前は何でも OK、例: `LabPay`)
2. 左メニュー **API とサービス → OAuth 同意画面**:
   - ユーザータイプ: **内部** (G Suite/Workspace を使ってる場合) または **外部**
   - アプリ名: `LabPay`
   - サポートメール: 自分のメール
   - スコープは追加不要 (デフォルトの `email` / `profile` で足りる)
3. **認証情報 → 認証情報を作成 → OAuth クライアント ID**:
   - アプリの種類: **ウェブアプリケーション**
   - 名前: `LabPay`
   - 承認済みのリダイレクト URI: `https://pay.example.ac.jp/api/auth/google/callback`
4. 表示される **クライアント ID** と **クライアントシークレット** を控える
5. `config/config.php` の `auth.google_client_id` / `auth.google_client_secret` に転記:

```bash
sudo -e /var/www/labpay/config/config.php
```

---

## ステップ 8: Apache vhost (HTTP 版)

最初は HTTP で動作確認、次のステップで HTTPS 化します。

### Rocky Linux

```bash
sudo tee /etc/httpd/conf.d/labpay.conf > /dev/null <<'CONF'
<VirtualHost *:80>
    ServerName pay.example.ac.jp
    DocumentRoot /var/www/labpay/public

    <Directory /var/www/labpay/public>
        AllowOverride All
        Require all granted
    </Directory>

    # src/config/migrations/bin は外から見せない
    <DirectoryMatch "/var/www/labpay/(src|config|migrations|bin)">
        Require all denied
    </DirectoryMatch>

    ErrorLog  logs/labpay_error.log
    CustomLog logs/labpay_access.log combined
</VirtualHost>
CONF

sudo httpd -t && sudo systemctl reload httpd
```

### Ubuntu

```bash
sudo tee /etc/apache2/sites-available/labpay.conf > /dev/null <<'CONF'
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

    ErrorLog  ${APACHE_LOG_DIR}/labpay_error.log
    CustomLog ${APACHE_LOG_DIR}/labpay_access.log combined
</VirtualHost>
CONF

sudo a2ensite labpay
sudo a2dissite 000-default 2>/dev/null
sudo apache2ctl configtest && sudo systemctl reload apache2
```

ここまでで `http://pay.example.ac.jp/` にアクセスして LabPay のログインページが見えれば OK。

---

## ステップ 9: HTTPS (Let's Encrypt)

LabPay は HTTPS 必須です (PWA / Service Worker / カメラ / Cookie Secure 全部に必要)。

```bash
sudo certbot --apache \
    -d pay.example.ac.jp \
    --redirect \
    --non-interactive --agree-tos \
    -m you@example.ac.jp
```

成功すると `https://pay.example.ac.jp/` でアクセスできるようになり、HTTP は自動で HTTPS にリダイレクトされます。証明書は cert bot が自動更新します (`sudo certbot renew --dry-run` でテスト可)。

---

## ステップ 10: PHP の上限を引き上げる (タスク添付用)

デフォルトは 2MB / 8MB なので、タスク添付ファイル (最大 50MB) に対応するため上げます。

```bash
sudo tee /etc/php.d/99-labpay.ini > /dev/null <<'INI'
; LabPay overrides — allow task attachments up to 50MB.
upload_max_filesize = 60M
post_max_size       = 80M
max_file_uploads    = 20
INI
sudo systemctl reload httpd     # Ubuntu の場合は apache2
```

確認:

```bash
php -i | grep -E 'upload_max_filesize|post_max_size'
# upload_max_filesize => 60M => 60M
# post_max_size       => 80M => 80M
```

---

## ステップ 11: ファイアウォール

### Rocky Linux (firewalld)

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

### Ubuntu (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Apache Full'
sudo ufw --force enable
```

### SELinux (Rocky のみ)

```bash
sudo setsebool -P httpd_can_network_connect 1   # 外部 API 呼出 (Rakuten / Slack / Google) 用
sudo restorecon -Rv /var/www/labpay
```

---

## ステップ 12: 動作確認

1. ブラウザで `https://pay.example.ac.jp/` を開く
2. 「Google でログイン」を押す
3. Google 認証 → 戻ってきて残高画面に **500pt** が表示されていれば成功

`auth.bootstrap_admin_email` に設定したメールでログインすると、自動的に admin 権限が付き、トップバーに「管理」リンクが出ます。

うまくいかない時:

```bash
# Apache のエラーログ
sudo tail -50 /var/log/httpd/labpay_error.log         # Rocky
sudo tail -50 /var/log/apache2/labpay_error.log       # Ubuntu

# PHP 起因のエラー (DB 接続失敗など) は API レスポンスの JSON にも出ます
curl https://pay.example.ac.jp/api/auth/me
```

---

## ステップ 13: バックアップを設定する

データベース が消えると pt 残高がぶっ飛ぶので必ず設定すること。

```bash
sudo tee /etc/cron.d/labpay-backup > /dev/null <<'CRON'
# Daily LabPay DB backup at 03:30 JST. Keeps last 30 days under /var/backups/labpay/.
30 3 * * * root LABPAY_DB_PASS="<step 2.2 の DBPASS>" /var/www/labpay/bin/backup.sh
CRON

sudo mkdir -p /var/backups/labpay
sudo chmod 700 /var/backups/labpay

# 一度手動で走らせて成功するか確認
sudo LABPAY_DB_PASS="<step 2.2 の DBPASS>" /var/www/labpay/bin/backup.sh
ls -la /var/backups/labpay
```

復元手順を **必ず一度試す**こと:

```bash
sudo gunzip -c /var/backups/labpay/labpay-YYYY-MM-DD.sql.gz | \
    sudo mysql labpay
```

---

## ステップ 14: Slack 通知 (任意)

### 14.1 出力 (入荷・新規タスク等)

`#labpay` などお知らせ用チャンネルを作って、Slack の **Incoming Webhook** を有効化。発行された URL を:

```php
'slack' => [
    'webhook_url' => 'https://hooks.slack.com/services/T0XXX/B0XXX/yyy',
],
```

に貼って `sudo systemctl reload httpd`。

### 14.2 入力 (Scrapbox-via-Slack 集計) + 通知 DM

Scrapbox の `#scrapbox` 通知から寄稿者を読み取って pt 配布、 さらに 各ユーザに 通知を Slack DM で 飛ばすなら:

1. https://api.slack.com/apps → **Create New App** (From scratch)
2. **OAuth & Permissions** → Bot Token Scopes に 以下を追加:
   - `channels:history` (private チャンネルなら `groups:history`) — Scrapbox feed 読み取り
   - `chat:write` — ユーザに DM 送信 (通知の Slack 連携)
   - `im:write` — DM チャンネルを 自動オープン (推奨。 なくても user が bot の Home タブを 1 度開けば動く)
3. **Install to Workspace** → `xoxb-…` トークンをコピー
4. Slack で `/invite @<bot 名>` を `#scrapbox` チャンネルで実行
5. `#scrapbox` のチャンネル ID (`Cxxxxxxx`) を確認 (Slack 詳細画面の下部)
6. `config/config.php` に転記:

```php
'slack' => [
    'webhook_url'         => '...',
    'bot_token'           => 'xoxb-...',
    'scrapbox_channel_id' => 'Cxxxxxxx',
],
```

7. 各ユーザは 設定 → プロフィール の 「Slack member ID」 (`U01ABCD2345`) を 埋める。 未設定なら DM はサイレント skip。

8. admin から 動作確認: `/#/admin` → 「Slack 通知 診断」 → 「⚙ 接続確認 (auth.test)」 で OK か、 「✉ テスト DM 送信」 で 自分宛に届くか。 `missing_scope` などのエラー時は hint で 対処法を表示。

7. cron 登録 (日次 23:59 JST):

```bash
sudo tee /etc/cron.d/labpay-scrapbox > /dev/null <<'CRON'
59 23 * * * apache /usr/bin/php /var/www/labpay/bin/scrapbox_slack_sync.php $(/bin/date +\%Y-\%m-\%d) >> /var/log/labpay-scrapbox-sync.log 2>&1
CRON
```

Ubuntu の場合は `apache` を `www-data` に変える。

8. 手動テスト:

```bash
sudo -u apache php /var/www/labpay/bin/scrapbox_slack_sync.php $(date +%Y-%m-%d) --dry-run
```

`unmapped` リストに出てくる Scrapbox 表示名は、メンバーが LabPay の設定画面 (「Scrapbox 連携」セクション) で自己申告するか、admin が DB に直接マッピングを入れる必要があります。

---

## ステップ 15: 部屋ごとに Scanner を置く

ラボ Wi-Fi で在室検知をするための仕組み。各部屋に常時起動するマシン (Raspberry Pi / 余ったノート PC / mini PC 何でも) を 1 台置きます。

### 15.1 部屋を登録

LabPay の管理画面 (`https://pay.example.ac.jp/#/admin` → 詳細管理 → 部屋を追加):

- id: `10F` のようなアルファベット/数字短い文字列
- 表示名: `10階研究室`

作成すると **scanner_token** が 1 回だけ表示されるのでコピー (**画面を閉じると二度と取得不可。失くしたら token 再発行**)。

### 15.2 Scanner マシンへインストール

Windows (PowerShell):

```powershell
# bin/install_scanner.ps1 を実行
.\install_scanner.ps1
# 対話的にトークンと subnet を聞かれる
```

Linux / Mac:

```bash
sudo ./install_scanner.sh
```

詳しくは [bin/README.md](../bin/README.md) を参照。

### 15.3 動作確認

部屋に居て自分のスマホが Wi-Fi に繋がっている状態で、LabPay のホーム画面の「今ラボにいる人」に自分のアバターが出れば成功。最初は MAC が未登録なので「私はこれ」リンクから自分の MAC を claim してください。

---

## ステップ 16: 本番化前の最終チェックリスト

- [ ] `config/config.php`: `auth.dev_login_enabled = false`
- [ ] `config/config.php`: `app.cookie_secure = true`
- [ ] HTTPS が有効、HTTP → HTTPS リダイレクトが効いている
- [ ] `https://pay.example.ac.jp/` のソース表示で `dev login` ボタンが出ていない
- [ ] バックアップ cron が動いている (`ls /var/backups/labpay`)
- [ ] バックアップから復元する手順を 1 回試した
- [ ] `public/uploads/.htaccess` が反映されている (`curl https://pay.example.ac.jp/uploads/.htaccess` で 403 になる)
- [ ] `https://pay.example.ac.jp/config/config.php` が外から見れない (403/404 が返る)
- [ ] `https://pay.example.ac.jp/src/bootstrap.php` が外から見れない (同上)

---

## アップデート手順 (運用に入った後)

```bash
cd /var/www/labpay
sudo -u apache git pull   # Rocky / sudo -u www-data git pull  # Ubuntu

# 新しい migration が増えていた回のみ
for f in /var/www/labpay/migrations/*.sql; do
  # 既適用分は冪等なのでスキップしてもエラーにならない (IF NOT EXISTS / ON DUPLICATE KEY)
  sudo -u apache php /var/www/labpay/bin/run_migration.php "$f"
done

sudo systemctl reload httpd   # opcache クリア
```

PHP / JS / CSS は配置で即反映。Service Worker のキャッシュは `public/sw.js` 内の `CACHE_NAME` を bump すると強制更新されます (普段 git pull に含まれる)。

---

## トラブルシューティング

### 「config_missing」が出る
`config/config.php` が無いか、Apache から読めない権限になっている。`ls -la /var/www/labpay/config/` で `apache:apache` (or `www-data:www-data`) 所有・`640` 以上の権限を確認。

### Google OAuth で「redirect_uri_mismatch」
Google Cloud Console の **承認済みリダイレクト URI** と `app.base_url + /api/auth/google/callback` が完全一致していない。プロトコル (http/https)・末尾スラッシュ・大文字小文字を確認。

### 「アップロード失敗 / 413 Request Entity Too Large」
ステップ 10 の `/etc/php.d/99-labpay.ini` を入れ忘れているか、`systemctl reload httpd` していない。

### scanner が POST しても admin の「部屋」一覧の「最終スキャン」が更新されない
scanner_token が間違っているか、部屋 id を取り違えている。`/var/log/labpay-scanner.log` (scanner マシン側) を確認。

### Scrapbox sync が走ったのに `unmapped` ばかりで pt が配られない
LabPay 側で自分の Scrapbox 表示名を **設定 → Scrapbox 連携** で登録する必要がある。各メンバーに案内してください。

### 「Slack notification not arriving」
`config/config.php` の `slack.webhook_url` が空、もしくは webhook が無効化されている。Slack の App 管理画面で webhook を再有効化して URL を貼り直す。`bot_token` (xoxb-) と混同しないこと、別物。

---

## 参考: 関連ドキュメント

- [README.md](../README.md) — プロジェクト全体の概要
- [docs/HACKATHON.md](HACKATHON.md) — API を使って何か作る人向け
- [docs/api.md](api.md) — エンドポイントリファレンス
- [bin/README.md](../bin/README.md) — Scanner 詳細
