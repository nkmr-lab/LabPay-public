<?php
// /api/news/it — IT 系ニュース (はてなブックマーク IT 人気 + Hacker News) を集めて返す。
// v700 #290 ホーム widget 用。 file cache (1 時間) で外部 API への負荷と
// レスポンスを抑える。失敗時は空 list を返す (widget 側で「取得失敗」表示)。
//
// data source:
//   - はてなブックマークテクノロジー RSS:  https://b.hatena.ne.jp/hotentry/it.rss
//   - Hacker News best stories (JSON):     https://hacker-news.firebaseio.com/v0/beststories.json
//                                          + /v0/item/<id>.json

declare(strict_types=1);

const NEWS_CACHE_DIR = '/tmp/labpay_news';
const NEWS_CACHE_TTL = 3600; // 1 hour

function route_news(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === 'it'        && $method === 'GET')  { news_it($cfg); return; }
    if ($sub === 'history'   && $method === 'GET')  { news_history($cfg); return; }
    if ($sub === 'summarize' && $method === 'POST') { news_summarize_one($cfg); return; }
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
    // v705 #297 履歴を累積 (初出日付付き)
    news_update_history($items);
    // v704 #293 #295 各 item に GPT 要約 (日本語) を添付。既 cache は流用、
    //   未生成のものはこのリクエストで最大 N 個だけ即時生成 (時間 budget 厳守)。
    //   HN 等海外 source も自動で日本語要約兼翻訳される。
    $summaries = [];
    if (is_file($sumFile)) {
        $sraw = @file_get_contents($sumFile);
        $summaries = $sraw ? (json_decode($sraw, true) ?: []) : [];
    }
    $apiKey = (string)($cfg['openai']['api_key'] ?? '');
    // v705 #296 1 request で 4 件まで新規要約 (旧 2 件 → 倍増)。全 8 件が 2 回の
    //   request で揃う。 1 request あたりのレイテンシは増えるが、「要約出ない」
    //   印象を防ぐほうを優先。
    $budget = 4;
    // v715 #310 ホーム widget で「古い記事ばかり」と見える不具合修正。
    //   原因: はてなの hot entry は一旦人気になった古い記事が上位に残り続け、
    //          news_fetch_all が published_at desc で sort しても「初出が数日前」の
    //          記事が上に来る。一方 news app の /api/news/history は first_seen_at desc。
    //   対処: news_it も history.json を引いて「LabPay で初めて見た順」 (= 新着順)
    //         に sort し、 news app の並びと同じに。これで「アプリでは新しいのが
    //         見えるのに home は古い」の印象ズレを解消。
    $histFile = NEWS_CACHE_DIR . '/history.json';
    $hist = is_file($histFile)
        ? (json_decode((string)@file_get_contents($histFile), true) ?: [])
        : [];
    // 候補を history と現在 fetch の union に。 history 側は first_seen_at で並ぶ、
    // 現在 fetch にはまだ history に反映されない一瞬の new も含む。
    $byUrl = [];
    foreach ($items as $it) {
        $u = (string)($it['url'] ?? '');
        if ($u === '') continue;
        $byUrl[$u] = $it;
    }
    foreach ($hist as $u => $h) {
        if (!isset($byUrl[$u])) {
            $byUrl[$u] = [
                'title'        => (string)($h['title'] ?? ''),
                'url'          => $u,
                'source'       => (string)($h['source'] ?? ''),
                'published_at' => (string)($h['first_seen_at'] ?? ''),
            ];
        }
    }
    $merged = array_values($byUrl);
    usort($merged, function ($a, $b) use ($hist) {
        $ka = (string)($a['url'] ?? '');
        $kb = (string)($b['url'] ?? '');
        $ta = (string)($hist[$ka]['first_seen_at'] ?? ($a['published_at'] ?? ''));
        $tb = (string)($hist[$kb]['first_seen_at'] ?? ($b['published_at'] ?? ''));
        return strcmp($tb, $ta);
    });
    $sliced = array_slice($merged, 0, $limit);
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
        // 古いエントリ (> 7 日) を掃除
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

// v706 #298 個別記事の要約を on-demand で生成 (UI の「要約を取得」ボタン)。
//   キャッシュにあればそのまま返す、無ければ新規生成して保存。
function news_summarize_one(array $cfg): void {
    $body = read_json_body();
    $url   = (string)($body['url']   ?? '');
    $title = (string)($body['title'] ?? '');
    if ($url === '') throw new ApiException('bad_request', 'url 必須', 400);
    $sumFile = NEWS_CACHE_DIR . '/summaries.json';
    if (!is_dir(NEWS_CACHE_DIR)) @mkdir(NEWS_CACHE_DIR, 0775, true);
    $summaries = is_file($sumFile)
        ? (json_decode((string)@file_get_contents($sumFile), true) ?: [])
        : [];
    $key = md5($url);
    if (isset($summaries[$key]['text'])) {
        json_response(['summary_jp' => $summaries[$key]['text'], 'cached' => true]);
        return;
    }
    $apiKey = (string)($cfg['openai']['api_key'] ?? '');
    if ($apiKey === '') throw new ApiException('not_configured', 'OpenAI API key 未設定', 503);
    $s = news_summarize_url($url, $title, $apiKey);
    if ($s === null) throw new ApiException('failed', '要約生成に失敗 (記事取得不可 or OpenAI エラー)', 502);
    $summaries[$key] = ['text' => $s, 'created_at' => time()];
    @file_put_contents($sumFile, json_encode($summaries, JSON_UNESCAPED_UNICODE));
    json_response(['summary_jp' => $s, 'cached' => false]);
}

function news_summarize_url(string $url, string $title, string $apiKey): ?string {
    if ($url === '') return null;
    $html = news_http_get($url, 6);
    if (!$html) return null;
    // HTML から script / style を削って plain text 化
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
                ['role' => 'system', 'content' => 'あなたは IT ニュース編集者です。与えられた記事を日本語で 2-3 文 (合計 100-150 字目安) に要約してください。英語記事でも必ず日本語で。結論とトピックを端的に、文末は体言止めかです/ます調。'],
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
    // 新しいもの順で sort
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
    // RSS 1.0 (RDF): items は直下 / Dublin Core extension で date
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

// v705 #297 履歴累積 (URL をキーに初出日付を保存)。 30 日ローテーション。
function news_update_history(array $items): void {
    $histFile = NEWS_CACHE_DIR . '/history.json';
    $hist = is_file($histFile)
        ? (json_decode((string)@file_get_contents($histFile), true) ?: [])
        : [];
    foreach ($items as $it) {
        $url = (string)($it['url'] ?? '');
        if ($url === '') continue;
        if (!isset($hist[$url])) {
            $hist[$url] = [
                'url'           => $url,
                'title'         => (string)($it['title'] ?? ''),
                'source'        => (string)($it['source'] ?? ''),
                'first_seen_at' => date('c'),
            ];
        }
    }
    $cutoff = time() - 30 * 86400;
    foreach ($hist as $url => $v) {
        if (strtotime((string)($v['first_seen_at'] ?? '')) < $cutoff) unset($hist[$url]);
    }
    @file_put_contents($histFile, json_encode($hist, JSON_UNESCAPED_UNICODE));
}

function news_history(array $cfg): void {
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $histFile = NEWS_CACHE_DIR . '/history.json';
    $sumFile  = NEWS_CACHE_DIR . '/summaries.json';
    $hist = is_file($histFile)
        ? (json_decode((string)@file_get_contents($histFile), true) ?: [])
        : [];
    $summaries = is_file($sumFile)
        ? (json_decode((string)@file_get_contents($sumFile), true) ?: [])
        : [];
    $items = array_values($hist);
    foreach ($items as &$it) {
        $k = md5((string)($it['url'] ?? ''));
        if (isset($summaries[$k]['text'])) $it['summary_jp'] = $summaries[$k]['text'];
    }
    unset($it);
    usort($items, fn($a, $b) => strcmp((string)($b['first_seen_at'] ?? ''), (string)($a['first_seen_at'] ?? '')));
    json_response(['items' => array_slice($items, 0, $limit)]);
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
