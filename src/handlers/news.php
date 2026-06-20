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
    if ($sub === 'it' && $method === 'GET') { news_it($cfg); return; }
    json_error('not_found', "no news route for $method $sub", 404);
}

function news_it(array $cfg): void {
    $limit = max(1, min(30, (int)($_GET['limit'] ?? 10)));
    $cacheFile = NEWS_CACHE_DIR . '/it.json';
    $sumFile   = NEWS_CACHE_DIR . '/summaries.json';
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
    // v704 #293 #295 各 item に GPT 要約 (日本語) を 添付。 既 cache は 流用、
    //   未生成 の もの は この リクエスト で 最大 N 個 だけ 即時 生成 (時間 budget 厳守)。
    //   HN 等 海外 source も 自動 で 日本語 要約 兼 翻訳 さ れる。
    $summaries = [];
    if (is_file($sumFile)) {
        $sraw = @file_get_contents($sumFile);
        $summaries = $sraw ? (json_decode($sraw, true) ?: []) : [];
    }
    $apiKey = (string)($cfg['openai']['api_key'] ?? '');
    $budget = 2; // 1 request で OpenAI を 叩く 上限
    $sliced = array_slice($items, 0, $limit);
    $sumDirty = false;
    foreach ($sliced as &$it) {
        $key = md5((string)($it['url'] ?? ''));
        if (isset($summaries[$key]['text'])) {
            $it['summary_jp'] = $summaries[$key]['text'];
            continue;
        }
        if ($budget > 0 && $apiKey !== '') {
            $s = news_summarize_url((string)($it['url'] ?? ''), (string)($it['title'] ?? ''), $apiKey);
            if ($s !== null) {
                $summaries[$key] = ['text' => $s, 'created_at' => time()];
                $it['summary_jp'] = $s;
                $budget--;
                $sumDirty = true;
            }
        }
    }
    unset($it);
    if ($sumDirty) {
        // 古い エントリ (> 7 日) を 掃除
        $now = time();
        foreach ($summaries as $k => $v) {
            if (!is_array($v) || (int)($v['created_at'] ?? 0) < $now - 7 * 86400) unset($summaries[$k]);
        }
        @file_put_contents($sumFile, json_encode($summaries, JSON_UNESCAPED_UNICODE));
    }
    json_response([
        'items'     => $sliced,
        'cached_at' => is_file($cacheFile) ? date('c', filemtime($cacheFile)) : null,
    ]);
}

function news_summarize_url(string $url, string $title, string $apiKey): ?string {
    if ($url === '') return null;
    $html = news_http_get($url, 6);
    if (!$html) return null;
    // HTML から script / style を 削って plain text 化
    $text = preg_replace('/<script[\s\S]*?<\/script>/i', '', $html) ?: $html;
    $text = preg_replace('/<style[\s\S]*?<\/style>/i', '', $text) ?: $text;
    $text = strip_tags($text);
    $text = preg_replace('/\s+/u', ' ', $text) ?: $text;
    $text = mb_substr(trim($text), 0, 3000);
    if (mb_strlen($text) < 80) return null;
    try {
        $payload = json_encode([
            'model' => 'gpt-4o-mini',
            'messages' => [
                ['role' => 'system', 'content' => 'あなたは IT ニュース 編集者 です。 与えられた 記事 を 日本語 で 2-3 文 (合計 100-150 字 目安) に 要約 して ください。 英語 記事 でも 必ず 日本語 で。 結論 と トピック を 端的 に、 文末 は 体言止め か です/ます 調。'],
                ['role' => 'user',   'content' => "タイトル: {$title}\n\n本文 (抜粋):\n{$text}"],
            ],
            'temperature' => 0.3,
            'max_tokens' => 300,
        ], JSON_UNESCAPED_UNICODE);
        $r = ai_openai_call($payload, $apiKey);
        $s = trim((string)($r['choices'][0]['message']['content'] ?? ''));
        return $s !== '' ? mb_substr($s, 0, 300) : null;
    } catch (Throwable $e) {
        error_log('[news_summarize_url] ' . $e->getMessage());
        return null;
    }
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
