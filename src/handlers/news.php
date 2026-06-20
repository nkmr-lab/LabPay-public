<?php
// /api/news/it — IT 系 ニュース (はてな ブックマーク IT 人気 + Hacker News) を 集めて 返す。
// v700 #290 ホーム widget 用。 file cache (1 時間) で 外部 API への 負荷 と
// レスポンス を 抑える。 失敗 時 は 空 list を 返す (widget 側 で 「取得 失敗」 表示)。
//
// data source:
//   - はてな ブックマーク テクノロジー RSS:  https://b.hatena.ne.jp/hotentry/it.rss
//   - Hacker News best stories (JSON):     https://hacker-news.firebaseio.com/v0/beststories.json
//                                          + /v0/item/<id>.json

declare(strict_types=1);

const NEWS_CACHE_DIR = '/tmp/labpay_news';
const NEWS_CACHE_TTL = 3600; // 1 hour

function route_news(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === 'it' && $method === 'GET') { news_it(); return; }
    json_error('not_found', "no news route for $method $sub", 404);
}

function news_it(): void {
    $limit = max(1, min(30, (int)($_GET['limit'] ?? 10)));
    $cacheFile = NEWS_CACHE_DIR . '/it.json';
    if (!is_dir(NEWS_CACHE_DIR)) @mkdir(NEWS_CACHE_DIR, 0775, true);
    $items = null;
    if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < NEWS_CACHE_TTL) {
        $raw = @file_get_contents($cacheFile);
        if ($raw) $items = json_decode($raw, true);
    }
    if (!is_array($items)) {
        $items = news_fetch_all();
        @file_put_contents($cacheFile, json_encode($items, JSON_UNESCAPED_UNICODE));
    }
    json_response([
        'items'     => array_slice($items, 0, $limit),
        'cached_at' => is_file($cacheFile) ? date('c', filemtime($cacheFile)) : null,
    ]);
}

function news_fetch_all(): array {
    $out = [];
    foreach (news_fetch_hatena() as $it) $out[] = $it;
    foreach (news_fetch_hn() as $it)     $out[] = $it;
    // 新しい もの 順 で sort
    usort($out, fn($a, $b) => strcmp((string)($b['published_at'] ?? ''), (string)($a['published_at'] ?? '')));
    return $out;
}

function news_http_get(string $url, int $timeout = 6): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_USERAGENT      => 'LabPay-News/1.0',
        CURLOPT_HTTPHEADER     => ['Accept: */*'],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($body !== false && $code >= 200 && $code < 300) ? $body : null;
}

function news_fetch_hatena(): array {
    $xml = news_http_get('https://b.hatena.ne.jp/hotentry/it.rss');
    if (!$xml) return [];
    libxml_use_internal_errors(true);
    $doc = @simplexml_load_string($xml);
    libxml_clear_errors();
    if (!$doc) return [];
    // RSS 1.0 (RDF): items は 直下 / Dublin Core extension で date
    $ns = $doc->getNamespaces(true);
    $items = [];
    foreach ($doc->item ?? [] as $it) {
        $title = (string)$it->title;
        $link  = (string)$it->link;
        $date  = '';
        if (isset($ns['dc'])) {
            $dc = $it->children($ns['dc']);
            if ($dc && $dc->date) $date = (string)$dc->date;
        }
        if (!$title || !$link) continue;
        $items[] = [
            'title'        => mb_substr($title, 0, 200),
            'url'          => $link,
            'source'       => 'はてな IT',
            'published_at' => $date,
        ];
        if (count($items) >= 15) break;
    }
    return $items;
}

function news_fetch_hn(): array {
    $idsRaw = news_http_get('https://hacker-news.firebaseio.com/v0/beststories.json');
    if (!$idsRaw) return [];
    $ids = json_decode($idsRaw, true);
    if (!is_array($ids)) return [];
    $items = [];
    foreach (array_slice($ids, 0, 10) as $id) {
        $raw = news_http_get('https://hacker-news.firebaseio.com/v0/item/' . (int)$id . '.json', 3);
        if (!$raw) continue;
        $it = json_decode($raw, true);
        if (!is_array($it) || empty($it['title']) || empty($it['url'])) continue;
        $items[] = [
            'title'        => mb_substr((string)$it['title'], 0, 200),
            'url'          => (string)$it['url'],
            'source'       => 'Hacker News',
            'published_at' => isset($it['time']) ? date('c', (int)$it['time']) : '',
        ];
    }
    return $items;
}
