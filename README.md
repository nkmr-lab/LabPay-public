# LabPay

研究室ローカルPay (約35人規模、Rocky Linux + Apache + 素の PHP + MariaDB)。

## 構成
- `public/` Apache の DocumentRoot (`index.html`, `api/index.php`, SPA assets)
- `src/` PHP コア (Web から直接見えない位置に置くか `.htaccess` で deny)
- `config/` 設定 (`config.php` は gitignore)
- `migrations/` 初期スキーマ + シード
- `docs/api.md` 学生クライアント向け API ドキュメント
- `bin/backup.sh` 日次バックアップ

詳細設計は仕様書 (LabPay 実装仕様書) を参照。

## セットアップ (Rocky Linux 10)

```bash
sudo dnf install -y httpd php php-mysqlnd php-pdo php-mbstring php-json mariadb-server
sudo systemctl enable --now mariadb httpd
sudo mysql_secure_installation

sudo mysql -e "CREATE DATABASE labpay CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'labpay'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';"
sudo mysql -e "GRANT ALL ON labpay.* TO 'labpay'@'127.0.0.1'; FLUSH PRIVILEGES;"

# 配置
sudo mkdir -p /var/www
sudo git clone <repo> /var/www/labpay     # または rsync で展開
cd /var/www/labpay
sudo cp config/config.sample.php config/config.php
sudo vi config/config.php                  # DB pass / base_url / bootstrap_admin_email を編集
mysql -u labpay -p labpay < migrations/001_init.sql

# Apache: DocumentRoot を /var/www/labpay/public に設定
# (sample vhost は下記)
sudo systemctl reload httpd

# SELinux
sudo setsebool -P httpd_can_network_connect 1
sudo restorecon -Rv /var/www/labpay

# firewalld
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload

# HTTPS (PWA / カメラ / Cookie Secure に必須)
sudo certbot --apache -d pay.example.ac.jp

# ZXing (バーコード) を public/vendor に配置
cd /var/www/labpay/public/vendor
sudo curl -L -o zxing.min.js https://unpkg.com/@zxing/browser@latest/umd/index.min.js
sudo restorecon -v zxing.min.js
```

### vhost 最小例 `/etc/httpd/conf.d/labpay.conf`

```apache
<VirtualHost *:443>
    ServerName pay.example.ac.jp
    DocumentRoot /var/www/labpay/public
    <Directory /var/www/labpay/public>
        AllowOverride All
        Require all granted
    </Directory>
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/pay.example.ac.jp/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/pay.example.ac.jp/privkey.pem
</VirtualHost>
```

### Apache が `src/`・`config/`・`migrations/` を見える位置に配置する場合

`DocumentRoot` を `/var/www/labpay/public` にしておけば、これらは外から見えません。
もし諸事情で `/var/www/labpay` を直接公開する場合は、ルートに以下を追加します:

```apacheconf
<DirectoryMatch "/var/www/labpay/(src|config|migrations|bin)">
    Require all denied
</DirectoryMatch>
```

## 起動確認の流れ

1. `bootstrap_admin_email` を自分のメールに設定 → `migrations/001_init.sql` 適用。
2. 初回アクセス: bootstrap が自動で許可リストに `role=admin` で登録。
3. `https://<ドメイン>/#/login` → dev ログイン or Google で入る → 初期 1000pt が配布される。
4. `#/sell` でバーコード入力 → 商品名を入力 → 出品。
5. もう1人 (許可リストに追加) でログイン → `#/market` → 購入。
6. 元の出品者のホームで「売れました」通知を確認。

## ローカル検証 (Windows / 開発用)

このプロジェクトは Rocky 本番を想定していますが、`php -S` でも動きます (`mod_rewrite` は使えないので
リライト相当を手で組むか、Apache を使ってください)。

## デプロイ更新 (Git pull 方式)

```bash
cd /var/www/labpay
sudo git pull
# migration を追加した回のみ
mysql -u labpay -p labpay < migrations/00X_*.sql
sudo systemctl reload httpd
```

PHP は配置で即反映。常駐プロセスはありません。

## バックアップ

`bin/backup.sh` を cron に登録 (環境変数 `LABPAY_DB_PASS` を渡す)。30 日保持。

## 経済仕様 (一行)

1pt = 1円相当 / 正の整数のみ / 手数料 5% (売り手負担・floor) / 発行は SYSTEM のみ /
初期 1000pt + 来室 10pt + streak ボーナス (3日:+5, 5日:+10, 10日:+30) / 取消は逆仕訳。

詳細は仕様書を参照。
