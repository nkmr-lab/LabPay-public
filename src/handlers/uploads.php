<?php
// /api/uploads — image upload for product photos.
// Stores under public/uploads/products/<random>.<ext> and returns a relative URL.

declare(strict_types=1);

function route_uploads(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'image' && $method === 'POST') {
        uploads_image($pdo, $cfg);
        return;
    }
    json_error('not_found', "no uploads route for $method $sub", 404);
}

function uploads_image(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);

    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        throw new ApiException('no_file', 'multipart field "file" is required', 400);
    }
    $f = $_FILES['file'];
    if ((int)$f['error'] !== UPLOAD_ERR_OK) {
        throw new ApiException('upload_error', 'upload error code ' . (int)$f['error'], 400);
    }
    $maxBytes = 8 * 1024 * 1024;   // 8MB
    if ((int)$f['size'] > $maxBytes) {
        throw new ApiException('too_large', 'file exceeds 8MB', 413);
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = (string)$finfo->file($f['tmp_name']);
    $ext   = match ($mime) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
        'image/heic' => 'heic',
        'image/heif' => 'heif',
        default      => null,
    };
    if ($ext === null) {
        throw new ApiException('bad_mime', "unsupported image type: $mime", 415);
    }

    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $uploadDir = $publicDir . '/uploads/products';
    if (!is_dir($uploadDir)) {
        if (!mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            throw new ApiException('mkdir_failed', 'could not create upload dir', 500);
        }
    }
    if (!is_writable($uploadDir)) {
        throw new ApiException('not_writable', "upload dir not writable: $uploadDir", 500);
    }

    $name = bin2hex(random_bytes(12)) . '.' . $ext;
    $dest = $uploadDir . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $dest)) {
        throw new ApiException('save_failed', 'could not save file', 500);
    }
    @chmod($dest, 0644);

    $rel = '/uploads/products/' . $name;
    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    json_response([
        'url'  => $baseUrl !== '' ? ($baseUrl . $rel) : $rel,
        'path' => $rel,
        'mime' => $mime,
        'size' => (int)$f['size'],
    ]);
}
