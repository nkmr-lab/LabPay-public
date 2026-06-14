<?php
// v598 既存の thumb.jpg を 新ルール (640px / quality 90) で 再生成。
//   元画像 (オリジナル) が 残っている前提。 サムネだけ 上書き更新。
//   実行: sudo -u apache php tools/regen_thumbs.php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';

$publicDir = realpath(__DIR__ . '/../public') ?: (__DIR__ . '/../public');
$uploadsDir = $publicDir . '/uploads/products';
if (!is_dir($uploadsDir)) { fwrite(STDERR, "uploads/products not found\n"); exit(1); }

$count = 0; $skip = 0; $err = 0;
$files = scandir($uploadsDir);
foreach ($files as $f) {
    if ($f === '.' || $f === '..') continue;
    if (str_contains($f, '.thumb.')) continue;
    $orig = $uploadsDir . '/' . $f;
    if (!is_file($orig)) continue;
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) continue;
    try {
        $raw = @file_get_contents($orig);
        $src = $raw ? @imagecreatefromstring($raw) : false;
        if (!$src) { $skip++; continue; }
        if (in_array($ext, ['jpg','jpeg'], true) && function_exists('exif_read_data')) {
            $exif = @exif_read_data($orig);
            $ori = isset($exif['Orientation']) ? (int)$exif['Orientation'] : 1;
            if ($ori === 3) $src = imagerotate($src, 180, 0);
            else if ($ori === 6) $src = imagerotate($src, -90, 0);
            else if ($ori === 8) $src = imagerotate($src, 90, 0);
        }
        $sw = imagesx($src); $sh = imagesy($src);
        $maxDim = 640;
        $ratio = min($maxDim / $sw, $maxDim / $sh, 1.0);
        $tw = max(1, (int)round($sw * $ratio));
        $th = max(1, (int)round($sh * $ratio));
        $thumb = imagecreatetruecolor($tw, $th);
        imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh);
        $thumbName = preg_replace('/\.[^.]+$/', '', $f) . '.thumb.jpg';
        imagejpeg($thumb, $uploadsDir . '/' . $thumbName, 90);
        @chmod($uploadsDir . '/' . $thumbName, 0644);
        imagedestroy($thumb); imagedestroy($src);
        $count++;
        if ($count % 50 === 0) fprintf(STDERR, "regen %d…\n", $count);
    } catch (Throwable $e) {
        $err++;
        fprintf(STDERR, "err on %s: %s\n", $f, $e->getMessage());
    }
}
echo "regenerated: {$count}, skipped: {$skip}, errors: {$err}\n";
