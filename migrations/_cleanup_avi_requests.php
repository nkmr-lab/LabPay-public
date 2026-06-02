<?php
// 直近 (24時間以内) で creator_user_id != 3 かつ created_by_user_id IS NULL
// or created_by_user_id = 3 の money_requests を candidate として一覧。
// (v152 で誤って代理生成された結果、生成者 = 3 だが creator は別 user)。
require_once '/var/www/labpay/src/bootstrap.php';

$st = $PDO->query("SELECT id, creator_user_id, created_by_user_id, title, created_at,
    (SELECT GROUP_CONCAT(user_id) FROM money_request_recipients WHERE request_id = money_requests.id) AS recipients
    FROM money_requests
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    ORDER BY id DESC");
$rows = $st->fetchAll(PDO::FETCH_ASSOC);
echo "Last 24h money_requests: " . count($rows) . "\n";
foreach ($rows as $r) {
    printf("  id=%d  creator=%d  created_by=%s  title=%s  at=%s  recipients=%s\n",
        $r['id'], $r['creator_user_id'], $r['created_by_user_id'] ?? 'NULL',
        $r['title'], $r['created_at'], $r['recipients'] ?? '');
}
