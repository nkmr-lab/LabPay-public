<?php
// v740 BingoFit background-removal worker (cron */1)。
//   bingofit_items WHERE bg_status='pending' を 5 件ずつ rembg にかけ、
//   public/uploads/bingofit_bg/HASH.png に保存。 完了で bg_status='done' + URL を埋める。
//   失敗は bg_status='failed' + bg_error にメッセージ。
//
// 実行: sudo -u apache php /var/www/labpay/scripts/bingofit_worker.php
// cron: /etc/cron.d/labpay-bingofit が */1 で flock 付き で 上記を呼ぶ。

declare(strict_types=1);

chdir('/var/www/labpay');
require_once '/var/www/labpay/src/bootstrap.php';

global $PDO;

$st = $PDO->prepare("SELECT id, image_url FROM bingofit_items WHERE bg_status='pending' ORDER BY id ASC LIMIT 5");
$st->execute();
$items = $st->fetchAll(PDO::FETCH_ASSOC);
if (!$items) {
    exit(0);
}

$publicDir = '/var/www/labpay/public';
$outDir = $publicDir . '/uploads/bingofit_bg';
if (!is_dir($outDir) && !mkdir($outDir, 0775, true) && !is_dir($outDir)) {
    fwrite(STDERR, "could not create outDir $outDir\n");
    exit(1);
}

foreach ($items as $item) {
    $id = (int)$item['id'];
    try {
        $relPath = parse_url((string)$item['image_url'], PHP_URL_PATH);
        if (!$relPath) throw new RuntimeException('invalid image_url');
        $imgPath = $publicDir . $relPath;
        if (!is_file($imgPath)) throw new RuntimeException("source file missing: $imgPath");

        $hash = bin2hex(random_bytes(8));
        $outFile = $outDir . '/' . $hash . '.png';
        $cmd = sprintf(
            'U2NET_HOME=/opt/labpay-bgremove/u2net /opt/labpay-bgremove/venv/bin/python /opt/labpay-bgremove/bgremove.py %s %s 2>&1',
            escapeshellarg($imgPath), escapeshellarg($outFile)
        );
        $output = [];
        $rc = 0;
        exec($cmd, $output, $rc);
        if ($rc !== 0 || !is_file($outFile)) {
            throw new RuntimeException('rembg rc=' . $rc . ': ' . substr(implode("\n", $output), 0, 400));
        }
        @chmod($outFile, 0644);
        $url = '/uploads/bingofit_bg/' . $hash . '.png';
        $PDO->prepare("UPDATE bingofit_items SET image_url_transparent=?, bg_status='done', bg_error=NULL WHERE id=?")
            ->execute([$url, $id]);
        fwrite(STDOUT, "[" . date('c') . "] ok #$id -> $url\n");
    } catch (Throwable $e) {
        $PDO->prepare("UPDATE bingofit_items SET bg_status='failed', bg_error=? WHERE id=?")
            ->execute([substr($e->getMessage(), 0, 500), $id]);
        fwrite(STDERR, "[" . date('c') . "] fail #$id: " . $e->getMessage() . "\n");
    }
}
