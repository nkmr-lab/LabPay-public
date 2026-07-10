<?php
// /api/album-thumbs — Google Photos 等 の 共有 URL の og:image / 写真枚数 を 取り出して
//   ローカル 保存、 認証済 ユーザ に だけ サムネ 返却。 v964, v969 で バックグラウンド化。
//
//   POST /api/album-thumbs body: {urls: [url1, url2, ...]}
//     → { thumbs: {url1: '/api/album-thumbs/photo/<hash>' or null, ...},
//         counts: {url1: N or null, ...} }
//     v969: 同期 fetch は 一切 しない。 DB キャッシュ の 素引き のみ。
//     未取得 URL は cron (bin/album_thumbs_cron.php) が 増分 で 取りに行く。
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

    // v967 conditional GET + immutable。 hash が 変わら ない 限り 中身 は 不変 なので、
    //   304 応答 と immutable キャッシュ で ブラウザ の 再 fetch を 完全 に 抑止。
    $mtime = filemtime($path);
    $size  = filesize($path);
    $etag  = '"' . dechex($mtime) . '-' . dechex($size) . '"';

    $ifNoneMatch    = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    $ifModSince     = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '';
    $ifModSinceTs   = $ifModSince ? strtotime($ifModSince) : 0;
    $matchesEtag    = ($ifNoneMatch !== '' && $ifNoneMatch === $etag);
    $matchesModSince= ($ifModSinceTs > 0 && $ifModSinceTs >= $mtime);

    header_remove('Cache-Control');
    header('Cache-Control: private, max-age=2592000, immutable');   // 30 日、 再検証も 無し
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');

    if ($matchesEtag || $matchesModSince) {
        http_response_code(304);
        exit;
    }

    header('Content-Type: image/jpeg');
    header('Content-Length: ' . $size);
    readfile($path);
    exit;
}

function album_thumbs_batch(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $urls = $body['urls'] ?? [];
    if (!is_array($urls)) throw new ApiException('bad_request', 'urls 配列', 400);

    $urls = array_values(array_unique(array_filter(array_map('strval', $urls))));
    // v970.4 上限 を 300 → 1000 に (DB 素引き のみ なので 安全)。
    //   従来 300 で アルバム 334 件 の うち 下位 34 件 の サムネ が 落ちて 「表示 されない」 と 誤解 された。
    if (count($urls) > 1000) $urls = array_slice($urls, 0, 1000);

    // v969 DB キャッシュ を 素引き するだけ。 同期 fetch は 廃止。
    //   未取得 URL は cron (bin/album_thumbs_cron.php) が 差分 で 埋める。
    $hashByUrl = [];
    foreach ($urls as $u) $hashByUrl[$u] = hash('sha256', $u);
    $cache = [];
    if ($hashByUrl) {
        $in = implode(',', array_fill(0, count($hashByUrl), '?'));
        $st = $pdo->prepare("SELECT url_hash, thumb_filename, photo_count FROM album_thumbs WHERE url_hash IN ($in)");
        $st->execute(array_values($hashByUrl));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cache[$r['url_hash']] = $r;
        }
    }

    $thumbs = [];
    $counts = [];
    foreach ($urls as $u) {
        $h = $hashByUrl[$u];
        $row = $cache[$h] ?? null;
        $thumbs[$u] = ($row && !empty($row['thumb_filename']))
                        ? ('/api/album-thumbs/photo/' . $h) : null;
        $counts[$u] = ($row && $row['photo_count'] !== null)
                        ? (int)$row['photo_count'] : null;
    }
    json_response(['thumbs' => $thumbs, 'counts' => $counts]);
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

    // v969 写真枚数 抽出。 2026 現在 の Google Photos は og:description に 件数 を
    //   もう 出さ ない (「共有アルバム · タップすると表示できます」 の定型のみ) ので、
    //   HTML 内 に embedded された 各写真 の 一意な トークン (lh3.googleusercontent.com/pw/...)
    //   を dedup で 数える。 lazy load 前 の 初期 markup に 全枚数 分 が 入ってる ケース が
    //   多い ので 実用 的、 ただし 巨大 アルバム で は 過小 に なり得る (許容)。
    $photoCount = null;
    if (preg_match_all('#https://lh3\.googleusercontent\.com/pw/([A-Za-z0-9_-]{50,})#', $html, $mmp)) {
        $tokens = array_unique(array_map(function ($s) {
            return preg_replace('/=.*/', '', $s);   // suffix (=w600...) を 落とす
        }, $mmp[1]));
        $n = count($tokens);
        if ($n > 0 && $n < 100000) $photoCount = $n;
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

    $pdo->prepare("UPDATE album_thumbs SET thumb_filename = ?, photo_count = ?, error_msg = NULL WHERE url_hash = ?")
        ->execute([$fn, $photoCount, $hash]);
    return true;
}

// v969 photo_count だけ を 埋め直す 軽量 版。 画像 は 再 DL しない (HTML fetch のみ)。
//   既に thumb が ある が count が NULL の 行 の バックフィル 用。 成功 で true。
function album_thumbs_backfill_count(PDO $pdo, string $url, string $hash): bool {
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
    if ($html === false || $http !== 200 || !is_string($html)) return false;

    $photoCount = null;
    if (preg_match_all('#https://lh3\.googleusercontent\.com/pw/([A-Za-z0-9_-]{50,})#', $html, $mmp)) {
        $tokens = array_unique(array_map(function ($s) {
            return preg_replace('/=.*/', '', $s);
        }, $mmp[1]));
        $n = count($tokens);
        if ($n > 0 && $n < 100000) $photoCount = $n;
    }
    if ($photoCount === null) return false;

    $pdo->prepare("UPDATE album_thumbs SET photo_count = ? WHERE url_hash = ?")
        ->execute([$photoCount, $hash]);
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
