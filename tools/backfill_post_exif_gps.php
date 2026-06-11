<?php
// v537 #195 既存の posts のうち image_url があるものを走査して、 元画像の EXIF GPS から
//   緯度経度を取り出し、 DB の posts.lat / lng を上書き (= EXIF が真の撮影地として優先)。
//   既に lat/lng が入っていても、 EXIF が読めた場合は EXIF で上書きする (= ユーザ要望
//   どおり EXIF を真実とする)。
//   EXIF が読めない投稿 (= 画像が PNG / WebP / GIF / EXIF タグなし JPEG) は触らない。
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO;

// 全 posts (image_url があるもの) を id 昇順で。 deleted_at NULL は OK。 size による
//   制限はしない (= 全部)。
$st = $pdo->query("SELECT id, image_url, lat, lng FROM posts WHERE image_url IS NOT NULL AND image_url <> '' ORDER BY id");
$rows = $st->fetchAll(PDO::FETCH_ASSOC);
echo count($rows) . " posts with image_url\n";

$publicDir = realpath(__DIR__ . '/../public');
$updated = 0; $skipped_noexif = 0; $skipped_notfile = 0; $errors = 0;

$upd = $pdo->prepare("UPDATE posts SET lat = ?, lng = ? WHERE id = ?");

foreach ($rows as $r) {
    $url = (string)$r['image_url'];
    // URL → ローカルパス (同一ホスト前提)
    $path = $url;
    if (preg_match('#^https?://[^/]+(/.*)$#', $url, $m)) {
        $path = $m[1];
    }
    if (!preg_match('#^/uploads/#', $path)) {
        $skipped_notfile++;
        continue;
    }
    $local = $publicDir . $path;
    if (!is_readable($local)) {
        $skipped_notfile++;
        continue;
    }
    // JPEG のみ EXIF サポート
    if (!preg_match('/\.jpe?g$/i', $path)) {
        $skipped_noexif++;
        continue;
    }
    try {
        $exif = @exif_read_data($local, 'GPS', false);
        if (!$exif || empty($exif['GPSLatitude']) || empty($exif['GPSLongitude'])) {
            $skipped_noexif++;
            continue;
        }
        $lat = exif_to_decimal($exif['GPSLatitude'], $exif['GPSLatitudeRef'] ?? 'N');
        $lng = exif_to_decimal($exif['GPSLongitude'], $exif['GPSLongitudeRef'] ?? 'E');
        if ($lat === null || $lng === null) { $skipped_noexif++; continue; }
        // 同じ値ならスキップ
        if ((float)$r['lat'] === $lat && (float)$r['lng'] === $lng) continue;
        $upd->execute([$lat, $lng, (int)$r['id']]);
        $updated++;
        echo "post#{$r['id']} → ({$lat}, {$lng})\n";
    } catch (Throwable $e) {
        $errors++;
        echo "post#{$r['id']} ERROR: " . $e->getMessage() . "\n";
    }
}

echo "\nDONE: updated={$updated} skipped_noexif={$skipped_noexif} skipped_notfile={$skipped_notfile} errors={$errors}\n";

function exif_to_decimal($arr, $ref): ?float {
    if (!is_array($arr) || count($arr) < 3) return null;
    $d = gps_frac_to_float($arr[0]);
    $m = gps_frac_to_float($arr[1]);
    $s = gps_frac_to_float($arr[2]);
    if ($d === null || $m === null || $s === null) return null;
    $dec = $d + $m / 60.0 + $s / 3600.0;
    if (in_array($ref, ['S','W'], true)) $dec = -$dec;
    return round($dec, 7);
}
function gps_frac_to_float($v): ?float {
    if (is_numeric($v)) return (float)$v;
    if (is_string($v) && strpos($v, '/') !== false) {
        [$a, $b] = explode('/', $v, 2);
        $b = (float)$b;
        if ($b == 0.0) return 0.0;
        return (float)$a / $b;
    }
    return null;
}
