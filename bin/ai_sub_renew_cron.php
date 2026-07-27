<?php
// v1251 AI サブスク の 自動更新 cron。 hourly で 呼ばれ、 期限 切れ の auto_renew=1 な
//   契約 に つき 500pt を 引き落し + 期限 +7 日。 残高 不足 は 自動 解約 + 通知。
//
// 使い方 (as apache):
//   sudo -u apache php bin/ai_sub_renew_cron.php
//
// cron 推奨 (/etc/cron.d/labpay-ai-sub-renew):
//   5 * * * * apache /usr/bin/php /var/www/labpay/bin/ai_sub_renew_cron.php >> /var/log/labpay-ai-sub-renew.log 2>&1

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$cfg = require __DIR__ . '/../config/config.php';
$pdo = new PDO(
    $cfg['db']['dsn'],
    $cfg['db']['user'],
    $cfg['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$ts = date('Y-m-d H:i:s');

try {
    $r = ai_sub_run_renewals($pdo, $cfg);
    echo "[$ts] ai-sub renew: renewed={$r['renewed']}, failed={$r['failed']}, skipped={$r['skipped']}\n";
} catch (Throwable $e) {
    echo "[$ts] ai-sub renew: FATAL: " . $e->getMessage() . "\n";
    exit(1);
}
