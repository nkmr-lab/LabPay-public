<?php
// LabPay front controller. Apache rewrites /api/* to this file.

declare(strict_types=1);

require_once __DIR__ . '/../../src/bootstrap.php';
// $CFG, $PDO, helpers, and handlers are all available.

// Wall clock for activity_log duration_ms.
$reqStart = microtime(true);

// Parse request
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// Strip leading /api
$prefix = '/api';
if (strpos($uri, $prefix) === 0) {
    $path = substr($uri, strlen($prefix));
} else {
    $path = $uri;
}
if ($path === '' || $path === false) $path = '/';
$seg = path_segments($path);

// CORS is intentionally not configured: same-origin only.
// Always JSON.
header('Content-Type: application/json; charset=utf-8');

// Dispatch table — URL 第1セグメント → route_* 関数。新しいリソースは
// ここに 1 行追加するだけで生える。複雑な権限/前処理が要るときは route_*
// 関数の中で済ませる方針 (front controller には残さない)。
$routes = [
    'auth'           => 'route_auth',
    'me'             => 'route_me',
    'users'          => 'route_users',           // me.php に居る軽い一覧
    'products'       => 'route_products',
    'listings'       => 'route_listings',
    'purchases'      => 'route_purchases',
    'checkins'       => 'route_checkins',
    'sellers'        => 'route_sellers',
    'notifications'  => 'route_notifications',
    'admin'          => 'route_admin',
    'presence'       => 'route_presence',
    'uploads'        => 'route_uploads',
    'tasks'          => 'route_tasks',
    'transfers'      => 'route_transfers',
    'network'        => 'route_network',
    'feedback'       => 'route_feedback',
    'wishlist'       => 'route_wishlist',
    'invitations'    => 'route_invitations',
    'roulettes'      => 'route_roulettes',
    'nomikai'        => 'route_nomikai',
    'groups'         => 'route_groups',          // ad-hoc groups
    'scrapbox'       => 'route_scrapbox',
    'fx'             => 'route_fx',
    'random-groups'  => 'route_random_groups',
    'orderings'      => 'route_orderings',
    'regions'        => 'route_regions',
    'health'         => 'route_health',
    'workouts'       => 'route_workouts',
    'walk'           => 'route_walk',
    'money-requests' => 'route_money_requests',
    'polls'          => 'route_polls',
    'rollcalls'      => 'route_rollcalls',
    'timers'         => 'route_timers',
    'notices'        => 'route_notices',
    'meetups'        => 'route_meetups',
    'places'         => 'route_places',
    'posts'          => 'route_posts',
    'todos'          => 'route_todos',
    'sounds'         => 'route_sounds',
    'auctions'       => 'route_auctions',
    'exercise'       => 'route_exercise',
    'playlists'      => 'route_playlists',
    'stopwatches'    => 'route_stopwatches',
    'ai'             => 'route_ai',
];

try {
    // CSRF guard for state-changing methods (skipped on OAuth callback because Google redirects via GET).
    require_csrf_header($method);

    $first = $seg[0] ?? '';
    if (isset($routes[$first])) {
        $routes[$first]($PDO, $CFG, $method, $seg);
        return;
    }

    throw new ApiException('not_found', "no route for $method $path", 404);

} catch (ApiException $e) {
    json_error($e->errCode, $e->getMessage(), $e->httpStatus, $e->details);
} catch (Throwable $e) {
    // Hide internals from clients; logs still get the real message.
    error_log('[labpay] ' . $e::class . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    json_error('server_error', 'internal server error', 500);
} finally {
    // Activity log — written after the response is dispatched so a slow insert
    // never blocks the user. Failures are swallowed (logging must never break
    // the API).
    try {
        activity_log_write($PDO, $CFG, $method, $path, http_response_code() ?: 200,
            (int)round((microtime(true) - $reqStart) * 1000));
    } catch (Throwable $_) { /* swallow */ }
}
