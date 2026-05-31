ZXing (バーコード読取) をここに配置してください。

ファイル名: zxing.min.js

入手方法のひとつ:
  https://unpkg.com/@zxing/browser@latest/umd/index.min.js
  をダウンロードして zxing.min.js にリネーム。

サーバに直接置く例 (Rocky Linux):
  cd /var/www/labpay/public/vendor
  sudo curl -L -o zxing.min.js https://unpkg.com/@zxing/browser@latest/umd/index.min.js
  sudo chown apache:apache zxing.min.js
  sudo restorecon -v zxing.min.js

外部 CDN を使わずに配置することでオフライン/置くだけ運用を担保しています。
