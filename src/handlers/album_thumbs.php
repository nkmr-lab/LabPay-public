<?php
// /api/album-thumbs — Google Photos 等 の 共有 URL の og:image を 取り出して
//   ローカル 保存、 認証済 ユーザ に だけ サムネ 返却。 v964。
//
//   POST /api/album-thumbs body: {urls: [url1, url2, ...], fetch_max?: 3}
//     → { thumbs: {url1: '/api/album-thumbs/photo/<hash>' or null, ...} }
//     未取得 は 最大 fetch_max 件 まで 同期 で 取りに行く (残り は 次回 呼び出し で 進行)
//   GET /api/album-thumbs/photo/{hash}
//     → 画像 バイナリ (要 LabPay 認証)

declare(strict_types=1);

const ALBUM_THUMBS_DIR = '/var/www/labpay/public/uploads/album_thumbs';

function route_album_thumbs(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === 'photo' && ($seg[2] ?? '') !== '' && $method === 'GET') {
        album_thumbs_serve($pdo, $cfg, (string)$seg[2]);
        return;
    }
    if ($sub === '' && $method === 'POST') {
        album_thumbs_batch($pdo, $cfg);
        return;
    }
    throw new ApiException('not_found', "no album-thumbs route for $method $sub", 404);
}

function album_thumbs_serve(PDO $pdo, array $cfg, string $hash): void {
    Auth::requireUser($pdo, $cfg);   // 認証 済 だけ
    if (!preg_match('/^[0-9a-f]{64}$/', $hash)) {
        throw new ApiException('bad_request', 'invalid hash', 400);
    }
    $st = $pdo->prepare("SELECT thumb_filename FROM album_thumbs WHERE url_hash = ?");
    $st->execute([$hash]);
    $fn = $st->fetchColumn();
    if (!$fn) throw new ApiException('not_found', 'no thumb', 404);
    // v966 ?size=large で 大きい版 (=w600-h315、 ~80KB) を返す。 デフォルト は 小 (~14KB)。
    $size = (string)($_GET['size'] ?? 'small');
    $file = $fn;
    if ($size === 'large') {
        $lg = preg_replace('/\.jpg$/', '_lg.jpg', $fn);
        $lgPath = ALBUM_THUMBS_DIR . '/' . $lg;
        if (is_file($lgPath)) $file = $lg;
        // 大きい版 が 未生成 なら small で fallback
    }
    $path = ALBUM_THUMBS_DIR . '/' . $file;
    if (!is_file($path)) throw new ApiException('not_found', 'file missing', 404);
    header_remove('Cache-Control');
    header('Cache-Control: private, max-age=86400');   // 1 日
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

function album_thumbs_batch(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $urls = $body['urls'] ?? [];
    if (!is_array($urls)) throw new ApiException('bad_request', 'urls 配列', 400);
    $fetchMax = min(5, max(0, (int)($body['fetch_max'] ?? 3)));

    $urls = array_values(array_unique(array_filter(array_map('strval', $urls))));
    if (count($urls) > 300) $urls = array_slice($urls, 0, 300);

    // まず 全部 の キャッシュ 状態 を 引く
    $hashByUrl = [];
    foreach ($urls as $u) $hashByUrl[$u] = hash('sha256', $u);
    $hashes = array_values($hashByUrl);
    $cache = [];
    if ($hashes) {
        $in = implode(',', array_fill(0, count($hashes), '?'));
        $st = $pdo->prepare("SELECT url_hash, thumb_filename, fetched_at FROM album_thumbs WHERE url_hash IN ($in)");
        $st->execute($hashes);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cache[$r['url_hash']] = $r;
        }
    }

    // 未 fetched を fetchMax 件 まで 同期 fetch
    $fetched = 0;
    foreach ($urls as $u) {
        if ($fetched >= $fetchMax) break;
        $h = $hashByUrl[$u];
        if (isset($cache[$h]) && $cache[$h]['fetched_at']) continue;  // 既に 試行済
        $ok = album_thumbs_try_fetch($pdo, $u, $h);
        if ($ok) {
            // cache 更新
            $st = $pdo->prepare("SELECT url_hash, thumb_filename, fetched_at FROM album_thumbs WHERE url_hash = ?");
            $st->execute([$h]);
            $cache[$h] = $st->fetch(PDO::FETCH_ASSOC);
        } else {
            $cache[$h] = ['url_hash' => $h, 'thumb_filename' => null, 'fetched_at' => date('Y-m-d H:i:s')];
        }
        $fetched++;
    }

    // 結果 マップ
    $out = [];
    foreach ($urls as $u) {
        $h = $hashByUrl[$u];
        if (isset($cache[$h]) && !empty($cache[$h]['thumb_filename'])) {
            $out[$u] = '/api/album-thumbs/photo/' . $h;
        } else {
            $out[$u] = null;
        }
    }
    json_response(['thumbs' => $out, 'fetched' => $fetched]);
}

// 1 URL 分 の og:image 抽出 → 画像 ダウンロード → 保存。 成功 で true。
function album_thumbs_try_fetch(PDO $pdo, string $url, string $hash): bool {
    @mkdir(ALBUM_THUMBS_DIR, 0775, true);
    // 直接 HTTP アクセス 禁止 (認証 済 endpoint 経由 のみ)
    $htaccess = ALBUM_THUMBS_DIR . '/.htaccess';
    if (!file_exists($htaccess)) @file_put_contents($htaccess, "Require all denied\n");
    // まず DB に 「試行中」 行 (fetched_at + null image) を upsert して 二重 fetch を 抑制
    $upsert = $pdo->prepare("
        INSERT INTO album_thumbs (url_hash, source_url, fetched_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE fetched_at = NOW()");
    $upsert->execute([$hash, mb_substr($url, 0, 500)]);

    // HTML fetch
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (labpay-album-thumbs) AppleWebKit/537.36',
        CURLOPT_HTTPHEADER     => ['Accept: text/html'],
    ]);
    $html = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($html === false || $http !== 200 || !is_string($html)) {
        $pdo->prepare("UPDATE album_thumbs SET error_msg = ? WHERE url_hash = ?")
            ->execute(['fetch page failed http=' . $http, $hash]);
        return false;
    }

    // og:image / twitter:image を 抽出
    $ogUrl = null;
    if (preg_match('/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $m)) {
        $ogUrl = $m[1];
    } elseif (preg_match('/<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $m)) {
        $ogUrl = $m[1];
    } elseif (preg_match('/<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']/i', $html, $m)) {
        // 属性 順 が 逆 の パターン
        $ogUrl = $m[1];
    }
    if (!$ogUrl) {
        $pdo->prepare("UPDATE album_thumbs SET error_msg = ? WHERE url_hash = ?")
            ->execute(['no og:image', $hash]);
        return false;
    }

    // v966 Google Photos CDN の URL 末尾 「=w<W>-h<H>」 で サイズ 指定 可能。
    //   小 (=w192-h144-p-k-no、 ~14KB): サムネ 表示 用。
    //   大 (=w600-h315-p-k-no、 ~80KB): 将来 の プレビュー / モーダル 表示 用。
    //   両方 DL して 保存 (デフォルト は 小 を 返す、 ?size=large で 大 を 返す)。
    $isGoogle = preg_match('#^(https://[^=?]+)#', $ogUrl, $mat)
              && strpos($ogUrl, 'googleusercontent.com') !== false;
    $smallUrl = $isGoogle ? ($mat[1] . '=w192-h144-p-k-no') : $ogUrl;
    $largeUrl = $isGoogle ? ($mat[1] . '=w600-h315-p-k-no') : null;

    // 小 画像 DL
    $img = album_thumbs_download($smallUrl);
    if ($img === null) {
        $pdo->prepare("UPDATE album_thumbs SET error_msg = ? WHERE url_hash = ?")
            ->execute(['small image DL failed', $hash]);
        return false;
    }
    $fn = $hash . '.jpg';
    $path = ALBUM_THUMBS_DIR . '/' . $fn;
    if (@file_put_contents($path, $img) === false) {
        $pdo->prepare("UPDATE album_thumbs SET error_msg = ? WHERE url_hash = ?")
            ->execute(['file write failed', $hash]);
        return false;
    }
    @chmod($path, 0640);

    // 大 画像 も DL (失敗 しても 小 だけ 保存 済 なので OK、 エラー は 無視)
    if ($largeUrl !== null) {
        $imgLg = album_thumbs_download($largeUrl);
        if ($imgLg !== null) {
            $lgFn = $hash . '_lg.jpg';
            $lgPath = ALBUM_THUMBS_DIR . '/' . $lgFn;
            if (@file_put_contents($lgPath, $imgLg) !== false) @chmod($lgPath, 0640);
        }
    }

    $pdo->prepare("UPDATE album_thumbs SET thumb_filename = ?, error_msg = NULL WHERE url_hash = ?")
        ->execute([$fn, $hash]);
    return true;
}

// 単発 の 画像 DL ヘルパ。 成功 で バイナリ、 失敗 で null。
function album_thumbs_download(string $url): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $img = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($img === false || $http !== 200 || !is_string($img) || strlen($img) < 500) return null;
    return $img;
}
