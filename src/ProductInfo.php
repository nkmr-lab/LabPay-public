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
            $it = $w['Item'] ?? null;
            if (!is_array($it)) continue;
            $name = trim((string)($it['itemName'] ?? ''));
            if ($name === '') continue;
            $img = (string)($it['mediumImageUrls'][0]['imageUrl']
                ?? $it['smallImageUrls'][0]['imageUrl']
                ?? '');
            $hay = $name . ' ' . (string)($it['itemCaption'] ?? '');
            $high = strpos($hay, $jan) !== false;
            if ($high) {
                return [
                    'name'       => mb_substr($name, 0, 200),
                    'image_url'  => $img !== '' ? $img : null,
                    'confidence' => 'high',
                ];
            }
            if ($best === null) $best = ['name' => $name, 'img' => $img];
        }
        if ($best === null) return null;
        return [
            'name'       => mb_substr($best['name'], 0, 200),
            'image_url'  => $best['img'] !== '' ? $best['img'] : null,
            'confidence' => 'low',
        ];
    }
}
