<?php
// /api/fx?currency=XXX — 為替レート (1 単位 = ? JPY) を取得。
// open.er-api.com の無料エンドポイント (1 JPY → 全通貨) を叩いて
// 1/rate を返す。snapshot 用途なのでキャッシュは持たない (1 セッションに
// 数回程度の呼び出ししか発生しない)。
//
// 内部関数 fx_rate_to_jpy() はワリカの POST で rate_to_jpy が省略された
// 時にサーバー側で同じ値を snapshot するためにも使われる。

declare(strict_types=1);

function route_fx(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    if ($method !== 'GET') {
        json_error('not_found', "use GET /api/fx", 404);
        return;
    }
    $ccy = strtoupper(trim((string)($_GET['currency'] ?? '')));
    if (!preg_match('/^[A-Z]{3}$/', $ccy)) {
        throw new ApiException('bad_request', 'currency must be a 3-letter ISO code', 400);
    }
    if ($ccy === 'JPY') {
        json_response(['currency' => 'JPY', 'rate_to_jpy' => 1.0, 'source' => 'identity']);
        return;
    }
    $rate = fx_rate_to_jpy($ccy);
    if ($rate === null) {
        throw new ApiException('bad_gateway',
            "為替レートを取得できませんでした (currency=$ccy)。手動で入力するか時間を置いて再試行してください", 502);
    }
    json_response([
        'currency'    => $ccy,
        'rate_to_jpy' => round($rate, 6),
        'source'      => 'open.er-api.com',
        'fetched_at'  => date('c'),
    ]);
}

// Reusable: returns "1 ccy = ? JPY" or null on failure. Used by both
// /api/fx and the wari POST handler (server-side snapshot fallback).
function fx_rate_to_jpy(string $ccy): ?float {
    $ccy = strtoupper($ccy);
    if ($ccy === 'JPY') return 1.0;
    $url = 'https://open.er-api.com/v6/latest/JPY';
    $ch = curl_init($url);
    if (!$ch) return null;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_USERAGENT      => 'labpay/1.0',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !$body) return null;
    $data = json_decode((string)$body, true);
    if (!is_array($data) || (($data['result'] ?? '') !== 'success')) return null;
    $rates = $data['rates'] ?? [];
    if (!isset($rates[$ccy])) return null;
    $r = (float)$rates[$ccy];
    if ($r <= 0) return null;
    // open.er-api gives 1 JPY = r CCY → 1 CCY = 1/r JPY
    return 1.0 / $r;
}
