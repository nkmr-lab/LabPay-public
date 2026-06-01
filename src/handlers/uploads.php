<?php
// /api/uploads/image — image upload for product photos and avatars.
// Stores under public/uploads/products/<random>.<ext> and returns a relative URL.

declare(strict_types=1);

const UPLOAD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_IMAGE_MIME = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
    'image/heic' => 'heic',
    'image/heif' => 'heif',
];

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
    $saved = save_uploaded_file($_FILES['file'], 'uploads/products',
        UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_MIME);

    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    json_response([
        'url'  => $baseUrl !== '' ? ($baseUrl . $saved['path']) : $saved['path'],
        'path' => $saved['path'],
        'mime' => $saved['mime'],
        'size' => $saved['size'],
    ]);
}
