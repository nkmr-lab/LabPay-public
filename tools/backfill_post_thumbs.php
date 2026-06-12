<?php
// v545 #202 らぼったー (posts) の image_url があるのに サムネ (.thumb.jpg) が無い投稿を
//   全件走査して、 GD で 320px サムネを生成。 失敗は黙殺。 EXIF orientation 補正も行う。
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO;

$publicDir = realpath(__DIR__ . '/../public');
$st = $pdo->query("SELECT id, image_url FROM posts WHERE image_url IS NOT NULL AND image_url <> '' ORDER BY id");
$rows = $st->fetchAll(PDO::FETCH_ASSOC);
echo count($rows) . " posts with image_url\n";

$generated = 0; $already = 0; $missing_orig = 0; $skipped_ext = 0; $errors = 0;

foreach ($rows as $r) {
    $url = (string)$r['image_url'];
    $path = $url;
    if (preg_match('#^https?://[^/]+(/.*)$#', $url, $m)) $path = $m[1];
    if (!preg_match('#^(/uploads/(?:[^/]+/)*)([^/.]+)\.([A-Za-z0-9]+)$#', $path, $m)) {
        $missing_orig++;
        continue;
    }
    $subdir   = $m[1];
    $base     = $m[2];
    $ext      = strtolower($m[3]);
    $origLocal = $publicDir . $subdir . $base . '.' . $m[3];
    $thumbLocal = $publicDir . $subdir . $base . '.thumb.jpg';
    if (!is_file($origLocal)) {
        echo "post#{$r['id']} ORIG MISSING: $subdir$base.$ext\n";
        $missing_orig++;
        continue;
    }
    if (is_file($thumbLocal) && filesize($thumbLocal) > 0) {
        $already++;
        continue;
    }
    // 拡張子で MIME 推定。 GD が読めない形式 (svg 等) はスキップ。
    $mime = match ($ext) {
        'jpg','jpeg' => 'image/jpeg',
        'png'        => 'image/png',
        'webp'       => 'image/webp',
        'gif'        => 'image/gif',
        default      => null,
    };
    if (!$mime) { $skipped_ext++; continue; }
    if (!function_exists('imagecreatefromstring')) { $errors++; continue; }
    try {
        $raw = @file_get_contents($origLocal);
        $src = $raw ? @imagecreatefromstring($raw) : false;
        if (!$src) { echo "post#{$r['id']} DECODE FAIL\n"; $errors++; continue; }
        if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
            $exif = @exif_read_data($origLocal);
            $ori = isset($exif['Orientation']) ? (int)$exif['Orientation'] : 1;
            if ($ori === 3) $src = imagerotate($src, 180, 0);
            else if ($ori === 6) $src = imagerotate($src, -90, 0);
            else if ($ori === 8) $src = imagerotate($src, 90, 0);
        }
        $sw = imagesx($src); $sh = imagesy($src);
        $maxDim = 320;
        $ratio = min($maxDim / $sw, $maxDim / $sh, 1.0);
        $tw = max(1, (int)round($sw * $ratio));
        $th = max(1, (int)round($sh * $ratio));
        $thumb = imagecreatetruecolor($tw, $th);
        imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh);
        if (imagejpeg($thumb, $thumbLocal, 82)) {
            @chmod($thumbLocal, 0644);
            $generated++;
            if ($generated % 10 === 0) echo "$generated thumbs generated...\n";
        } else {
            echo "post#{$r['id']} WRITE FAIL: $thumbLocal\n";
            $errors++;
        }
        imagedestroy($thumb); imagedestroy($src);
    } catch (Throwable $e) {
        echo "post#{$r['id']} ERR: " . $e->getMessage() . "\n";
        $errors++;
    }
}

echo "\nDONE: generated=$generated already=$already missing_orig=$missing_orig skipped_ext=$skipped_ext errors=$errors\n";
