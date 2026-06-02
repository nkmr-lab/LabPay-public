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

try {
    // CSRF guard for state-changing methods (skipped on OAuth callback because Google redirects via GET).
    require_csrf_header($method);

    // ---- Routing ----
    // /auth/*
    if (($seg[0] ?? '') === 'auth') {
        route_auth($PDO, $CFG, $method, $seg);
        return;
    }

    // /me, /me/*
    if (($seg[0] ?? '') === 'me') {
        route_me($PDO, $CFG, $method, $seg);
        return;
    }

    // /products, /products/{jan}
    if (($seg[0] ?? '') === 'products') {
        route_products($PDO, $CFG, $method, $seg);
        return;
    }

    // /listings, /listings/{id}
    if (($seg[0] ?? '') === 'listings') {
        route_listings($PDO, $CFG, $method, $seg);
        return;
    }

    // /purchases
    if (($seg[0] ?? '') === 'purchases') {
        route_purchases($PDO, $CFG, $method, $seg);
        return;
    }

    // /checkins
    if (($seg[0] ?? '') === 'checkins') {
        route_checkins($PDO, $CFG, $method, $seg);
        return;
    }

    // /sellers/{id}/stats
    if (($seg[0] ?? '') === 'sellers') {
        route_sellers($PDO, $CFG, $method, $seg);
        return;
    }

    // /notifications
    if (($seg[0] ?? '') === 'notifications') {
        route_notifications($PDO, $CFG, $method, $seg);
        return;
    }

    // /admin/*
    if (($seg[0] ?? '') === 'admin') {
        route_admin($PDO, $CFG, $method, $seg);
        return;
    }

    // /presence, /presence/*
    if (($seg[0] ?? '') === 'presence') {
        route_presence($PDO, $CFG, $method, $seg);
        return;
    }

    // /uploads/*
    if (($seg[0] ?? '') === 'uploads') {
        route_uploads($PDO, $CFG, $method, $seg);
        return;
    }

    // /tasks, /tasks/{id}/...
    if (($seg[0] ?? '') === 'tasks') {
        route_tasks($PDO, $CFG, $method, $seg);
        return;
    }

    // /transfers
    if (($seg[0] ?? '') === 'transfers') {
        route_transfers($PDO, $CFG, $method, $seg);
        return;
    }

    // /users (lightweight directory, used by transfer recipient picker)
    if (($seg[0] ?? '') === 'users') {
        route_users($PDO, $CFG, $method, $seg);
        return;
    }

    // /network (social graph aggregates for the #/network view)
    if (($seg[0] ?? '') === 'network') {
        route_network($PDO, $CFG, $method, $seg);
        return;
    }

    // /feedback (bug reports + feature requests)
    if (($seg[0] ?? '') === 'feedback') {
        route_feedback($PDO, $CFG, $method, $seg);
        return;
    }

    // /wishlist ('these I want' product requests)
    if (($seg[0] ?? '') === 'wishlist') {
        route_wishlist($PDO, $CFG, $method, $seg);
        return;
    }

    // /invitations (casual hangout board)
    if (($seg[0] ?? '') === 'invitations') {
        route_invitations($PDO, $CFG, $method, $seg);
        return;
    }

    // /roulettes (group lottery)
    if (($seg[0] ?? '') === 'roulettes') {
        route_roulettes($PDO, $CFG, $method, $seg);
        return;
    }

    // /nomikai (drinking-party split)
    if (($seg[0] ?? '') === 'nomikai') {
        route_nomikai($PDO, $CFG, $method, $seg);
        return;
    }

    // /groups (ad-hoc groups for short-lived contexts)
    if (($seg[0] ?? '') === 'groups') {
        route_groups($PDO, $CFG, $method, $seg);
        return;
    }

    // /scrapbox (read-only feed over #scrapbox Slack channel)
    if (($seg[0] ?? '') === 'scrapbox') {
        route_scrapbox($PDO, $CFG, $method, $seg);
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
