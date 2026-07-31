<?php
// /api/uploads/image — image upload for product photos and avatars.
// Stores under public/uploads/products/<random>.<ext> and returns a relative URL.

declare(strict_types=1);

// v1257 中村さん 環境 で iPhone HEIC / Live Photo で アップロード 失敗 が 頻発 (400 no_file
//   と 出る の は Content-Length が post_max_size 超え で PHP が silently drop する ケース、
//   or 単純 に クライアント 事故)。 8MB は 現代 iPhone に は 小さすぎ の で 24MB に 拡大。
const UPLOAD_IMAGE_MAX_BYTES = 24 * 1024 * 1024;
const UPLOAD_IMAGE_MIME = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
    'image/heic' => 'heic',
    'image/heif' => 'heif',
];

function _uploads_parse_ini_bytes(string $val): int {
    $val = trim($val);
    if ($val === '') return 0;
    $last = strtolower(substr($val, -1));
    $n = (int)$val;
    return match ($last) {
        'g' => $n * 1024 * 1024 * 1024,
        'm' => $n * 1024 * 1024,
        'k' => $n * 1024,
        default => $n,
    };
}

function route_uploads(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'image' && $method === 'POST') {
        uploads_image($pdo, $cfg);
        return;
    }
    json_error('not_found', "no uploads route for $method $sub", 404);
}

function uploads_image(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        // v1257 診断: no_file の 真因 (Content-Length 過大 で PHP が silently drop / FormData 空 等)
        //   を 突き止める ため、 発生時 の 情報 を error_log に 残し、 レスポンス も 分かり易く。
        $cl  = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        $ct  = (string)($_SERVER['CONTENT_TYPE'] ?? '');
        $pms = ini_get('post_max_size');
        $umf = ini_get('upload_max_filesize');
        $keys = implode(',', array_keys($_FILES));
        $post_keys = implode(',', array_keys($_POST));
        error_log("[labpay/uploads.php] no_file uid={$u['id']} cl={$cl} ct={$ct} post_max_size={$pms} upload_max_filesize={$umf} FILES_keys=[{$keys}] POST_keys=[{$post_keys}]");
        // Content-Length が 大きい (post_max_size 相当) なら PHP が sile ntly drop した 可能性 大
        $pmsBytes = _uploads_parse_ini_bytes($pms);
        if ($cl > 0 && $pmsBytes > 0 && $cl >= $pmsBytes * 0.95) {
            throw new ApiException('too_large',
                sprintf('画像が大きすぎて受け付けられませんでした (アップロード%sMB / サーバ上限%s)。小さい画像をお選びください。',
                    number_format($cl / 1048576, 1), $pms),
                413);
        }
        // それ以外 (FormData 空 / ネットワーク切断 / iOS Safari FormData 挙動 等)
        throw new ApiException('no_file',
            "画像の送信が途中で途切れました。もう一度お試しください (Content-Length={$cl})",
            400);
    }
    $saved = save_uploaded_file($_FILES['file'], 'uploads/products',
        UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_MIME);

    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    $resp = [
        'url'  => $baseUrl !== '' ? ($baseUrl . $saved['path']) : $saved['path'],
        'path' => $saved['path'],
        'mime' => $saved['mime'],
        'size' => $saved['size'],
    ];
    if (!empty($saved['thumb_path'])) {
        $resp['thumb_url']  = $baseUrl !== '' ? ($baseUrl . $saved['thumb_path']) : $saved['thumb_path'];
        $resp['thumb_path'] = $saved['thumb_path'];
    }
    json_response($resp);
}
