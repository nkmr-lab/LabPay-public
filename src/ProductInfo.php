<?php
// ProductInfo: JAN -> product metadata. Calls Rakuten Ichiba Item Search API when
// applicationId + accessKey are configured. Result is consumed by products.php and
// surfaced to the client as auto-filled name/image during the listing flow.

declare(strict_types=1);

class ProductInfo {
    // Returns ['name' => string, 'image_url' => string|null] or null when unknown / not configured.
    // Today: Rakuten Ichiba Item Search (newer openapi.rakuten.co.jp endpoint with applicationId + accessKey).
    public static function fetch(string $jan, array $cfg): ?array {
        $appId  = (string)($cfg['rakuten']['application_id'] ?? '');
        $access = (string)($cfg['rakuten']['access_key']     ?? '');
        if ($appId === '' || $access === '') return null;
        if (!preg_match('/^[0-9]{8,20}$/', $jan)) return null;

        $url = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401'
             . '?' . http_build_query([
                 'applicationId' => $appId,
                 'accessKey'     => $access,
                 'keyword'       => $jan,
                 'hits'          => 10,      // pull a few so JAN-substring filter has candidates
                 'availability'  => 1,
             ]);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_USERAGENT => 'labpay/1.0',
        ]);
        $res  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($res === false || $code >= 400) {
            error_log("[labpay/productinfo] rakuten HTTP $code for jan=$jan");
            return null;
        }

        $d = json_decode($res, true);
        if (!is_array($d) || empty($d['Items'])) return null;

        // Prefer a hit whose itemName/itemCaption contains the JAN literally (high confidence).
        // Otherwise fall back to the top hit (Rakuten matched it via some internal index even if
        // the JAN doesn't appear in the public fields). UI surfaces this as "needs confirmation".
        $best = null;        // [name, img, confidence]
        foreach ($d['Items'] as $w) {
            // Older Ichiba endpoint wraps each item in {"Item": {...}};
            // the new openapi endpoint sometimes returns the Item fields at the top level.
            $it = $w['Item'] ?? $w;
            if (!is_array($it)) continue;
            $name = trim((string)($it['itemName'] ?? ''));
            if ($name === '') continue;
            $img = self::extractImage($it);
            $hay = $name . ' ' . (string)($it['itemCaption'] ?? '');
            $high = strpos($hay, $jan) !== false;
            if ($high) {
                return [
                    'name'       => mb_substr($name, 0, 200),
                    'image_url'  => $img,
                    'confidence' => 'high',
                ];
            }
            if ($best === null) $best = ['name' => $name, 'img' => $img];
        }
        if ($best === null) return null;
        if ($best['img'] === null) {
            // Log raw response once so the admin can adjust the extractor if Rakuten changes shape.
            error_log("[labpay/productinfo] no image extracted for jan=$jan; raw item="
                . substr(json_encode($d['Items'][0] ?? null, JSON_UNESCAPED_UNICODE), 0, 500));
        }
        return [
            'name'       => mb_substr($best['name'], 0, 200),
            'image_url'  => $best['img'],
            'confidence' => 'low',
        ];
    }

    // Pull an image URL out of a Rakuten item record. Handles both response shapes we've seen:
    //   legacy:  mediumImageUrls => [ {imageUrl: "..."}, ... ]
    //   openapi: mediumImageUrls => [ "...", ... ]   OR images => [ {imageUrl: "..."} ]
    // Returns null when no usable URL is found.
    private static function extractImage(array $it): ?string {
        $tryKeys = ['mediumImageUrls', 'smallImageUrls', 'largeImageUrls', 'images'];
        foreach ($tryKeys as $k) {
            if (!isset($it[$k]) || !is_array($it[$k]) || empty($it[$k])) continue;
            $first = $it[$k][0];
            if (is_string($first) && $first !== '') return self::normalizeRakutenImageUrl($first);
            if (is_array($first)) {
                $u = (string)($first['imageUrl'] ?? $first['url'] ?? '');
                if ($u !== '') return self::normalizeRakutenImageUrl($u);
            }
        }
        // Top-level fallback: some openapi variants put a single string at 'imageUrl'.
        if (isset($it['imageUrl']) && is_string($it['imageUrl']) && $it['imageUrl'] !== '') {
            return self::normalizeRakutenImageUrl($it['imageUrl']);
        }
        return null;
    }

    // Rakuten image URLs often arrive with "?_ex=128x128" thumbnail params. Strip them
    // so we display the largest version the CDN serves.
    private static function normalizeRakutenImageUrl(string $url): string {
        $url = trim($url);
        if ($url === '') return $url;
        // Force https
        if (str_starts_with($url, 'http://')) $url = 'https://' . substr($url, 7);
        // Drop "?_ex=NxN" thumbnail-size query
        return preg_replace('/[?&]_ex=\d+x\d+/', '', $url) ?? $url;
    }
}
