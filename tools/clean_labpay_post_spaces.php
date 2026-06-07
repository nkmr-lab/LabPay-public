<?php
// v493 #93 LabPay 公式 SNS 投稿 から 日本語 文中 の 不要 な 半角 / 全角 スペース を 除去。
//   日本語 (ひらがな / カタカナ / 漢字 / 全角 記号) 同士 の 間 の スペース を 削る。
//   英字 / 数字 が 絡む 箇所 は 残す (URL や ハッシュタグ の 視認性 を 維持)。
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
/** @var PDO $PDO */
$pdo = $PDO;

$rx = '/([\x{3000}-\x{30FF}\x{3400}-\x{9FFF}\x{FF00}-\x{FFEF}])[ \x{3000}]+([\x{3000}-\x{30FF}\x{3400}-\x{9FFF}\x{FF00}-\x{FFEF}])/u';

$st = $pdo->prepare("SELECT p.id, p.body FROM posts p
                       JOIN users u ON u.id = p.user_id
                      WHERE u.display_name = 'LabPay' AND u.kind = 'system'
                        AND p.body IS NOT NULL");
$st->execute();
$updated = 0;
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $orig = (string)$r['body'];
    $body = $orig;
    do {
        $prev = $body;
        $body = preg_replace($rx, '$1$2', $body);
    } while ($body !== $prev);
    if ($body !== $orig) {
        $pdo->prepare("UPDATE posts SET body = ? WHERE id = ?")
            ->execute([$body, (int)$r['id']]);
        echo "updated #{$r['id']}: " . mb_substr($body, 0, 60) . "\n";
        $updated++;
    }
}
echo "DONE: $updated post(s) cleaned\n";
