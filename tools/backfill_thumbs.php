<?php
// v494 #101 既存の /uploads/<name>.<ext> でサムネがまだ作られていないものを
// バッチで生成する。 thumb_url_for() と同じ命名規約: <name>.thumb.jpg
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';

$publicDir = realpath(__DIR__ . '/../public') ?: (__DIR__ . '/../public');
$uploads = $publicDir . '/uploads';
if (!is_dir($uploads)) { fwrite(STDERR, "no uploads dir: $uploads\n"); exit(1); }

// v494 サブディレクトリ (uploads/products/, uploads/avatars/, ...) も含めて再帰探索。
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($uploads, FilesystemIterator::SKIP_DOTS));
$files = [];
foreach ($it as $f) { if ($f->isFile()) $files[] = $f->getPathname(); }
$ok = $skip = $err = 0;
foreach ($files as $path) {
    $base = basename($path);
    // .thumb.jpg は処理対象外。 拡張子のあるオリジナルだけ拾う。
    if (str_ends_with($base, '.thumb.jpg')) continue;
    if (!preg_match('/\.(jpe?g|png|webp|gif)$/i', $base)) continue;
    $thumb = preg_replace('/\.[^.]+$/', '', $path) . '.thumb.jpg';
    if (is_file($thumb)) { $skip++; continue; }
    try {
        $raw = @file_get_contents($path);
        if (!$raw) { $err++; echo "skip read fail: $base\n"; continue; }
        $src = @imagecreatefromstring($raw);
        if (!$src) { $err++; echo "skip decode fail: $base\n"; continue; }
        $sw = imagesx($src); $sh = imagesy($src);
        $maxDim = 320;
        $ratio = min($maxDim / $sw, $maxDim / $sh, 1.0);
        $tw = max(1, (int)round($sw * $ratio));
        $th = max(1, (int)round($sh * $ratio));
        $dst = imagecreatetruecolor($tw, $th);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh);
        imagejpeg($dst, $thumb, 82);
        @chmod($thumb, 0644);
        imagedestroy($dst); imagedestroy($src);
        $ok++;
    } catch (Throwable $e) {
        $err++;
        echo "skip $base: " . $e->getMessage() . "\n";
    }
}
echo "DONE: ok=$ok skip=$skip err=$err\n";
