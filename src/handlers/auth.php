<?php
// /api/auth/* — login (Google OAuth), dev-login, callback, logout, me.

declare(strict_types=1);

function route_auth(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === 'me' && $method === 'GET') {
        $u = Auth::currentUser($pdo, $cfg);
        if (!$u) { json_error('unauthorized', 'not logged in', 401); return; }
        $accId = Ledger::accountIdForUser($pdo, $u['id']);
        $bal = Ledger::balanceOf($pdo, $accId);
        $av = $pdo->prepare('SELECT avatar_url FROM users WHERE id=?');
        $av->execute([$u['id']]);
        $u['avatar_url'] = $av->fetchColumn() ?: null;
        json_response(['user' => $u, 'balance' => $bal]);
        return;
    }

    if ($sub === 'login' && $method === 'GET') {
        if (empty($cfg['auth']['google_oauth_enabled'])) {
            json_error('oauth_disabled', 'use POST /api/auth/dev-login instead', 400);
            return;
        }
        // Generate state and stash it in a short-lived signed cookie (no PHP session needed).
        $state = bin2hex(random_bytes(16));
        $opts = [
            'expires'  => time() + 600,
            'path'     => '/',
            'secure'   => (bool)($cfg['app']['cookie_secure'] ?? true),
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        setcookie('labpay_oauth_state', $state, $opts);
        $url = Auth::oauthAuthorizeUrl($cfg, $state);
        header('Location: ' . $url, true, 302);
        return;
    }

    if ($sub === 'callback' && $method === 'GET') {
        $code  = $_GET['code']  ?? '';
        $state = $_GET['state'] ?? '';
        $cookieState = $_COOKIE['labpay_oauth_state'] ?? '';
        if (!$code || !$state || !$cookieState || !hash_equals($cookieState, (string)$state)) {
            json_error('oauth_state', 'invalid OAuth state', 400);
            return;
        }
        // Clear state cookie
        setcookie('labpay_oauth_state', '', ['expires' => time() - 3600, 'path' => '/']);

        $info = Auth::oauthExchange($cfg, (string)$code);
        $res = Auth::completeLogin($pdo, $cfg, $info['email']);

        // Redirect to SPA home
        $home = rtrim((string)$cfg['app']['base_url'], '/') . '/#/';
        header('Location: ' . $home, true, 302);
        return;
    }

    if ($sub === 'dev-login' && $method === 'POST') {
        if (empty($cfg['auth']['dev_login_enabled'])) {
            json_error('dev_login_disabled', 'dev login is disabled', 403);
            return;
        }
        $body = read_json_body();
        $email = (string)require_field($body, 'email');
        $res = Auth::completeLogin($pdo, $cfg, $email);
        json_response([
            'ok' => true,
            'user' => $res['user'],
            'first_login' => $res['first_login'],
            'initial_points' => $res['initial_points'],
        ]);
        return;
    }

    if ($sub === 'logout' && $method === 'POST') {
        $sid = Auth::readSessionId($cfg);
        if ($sid) {
            $del = $pdo->prepare('DELETE FROM sessions WHERE id=?');
            $del->execute([$sid]);
        }
        Auth::clearSessionCookie($cfg);
        json_response(['ok' => true]);
        return;
    }

    json_error('not_found', "no auth route for $method $sub", 404);
}
