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
        // v615 birthday_md / birthday_year も同梱 (state.me で誕生日バナー判定するため)
        $av = $pdo->prepare('SELECT avatar_url, birthday_md, birthday_year FROM users WHERE id=?');
        $av->execute([$u['id']]);
        $row = $av->fetch();
        $u['avatar_url']    = $row['avatar_url']    ?? null;
        $u['birthday_md']   = $row['birthday_md']   ?? null;
        $u['birthday_year'] = $row['birthday_year'] ?? null;
        // Mac-registration flag drives a home-screen onboarding banner: the
        // user can't be auto-detected at all until at least one MAC is
        // attached to their account.
        $stMac = $pdo->prepare('SELECT COUNT(*) FROM presence_devices WHERE user_id=?');
        $stMac->execute([$u['id']]);
        $hasMac = (int)$stMac->fetchColumn() > 0;
        // in_lab is the buy-button gate: client greys out 購入 when false.
        // Defined in purchases.php (loaded by bootstrap).
        json_response(['user' => $u, 'balance' => $bal,
            'in_lab' => user_is_in_lab($pdo, (int)$u['id']),
            'has_registered_mac' => $hasMac]);
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

    // ─── Google Calendar incremental authorization ────────────────────
    // /api/auth/calendar/connect (GET): 既存ログイン中ユーザーに対して追加 scope
    //   (calendar.readonly) を要求するため Google の認可画面にリダイレクト。
    // /api/auth/calendar/callback (GET): code を access/refresh token に交換して
    //   users テーブルに保存、Settings ページに戻す。
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'connect' && $method === 'GET') {
        $u = Auth::requireUser($pdo, $cfg);
        $state = bin2hex(random_bytes(16));
        setcookie('labpay_calendar_state', $state, [
            'expires'  => time() + 600,
            'path'     => '/',
            'secure'   => (bool)($cfg['app']['cookie_secure'] ?? true),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $url = GoogleCalendar::authorizeUrl($cfg, (string)$u['email'], $state);
        header('Location: ' . $url, true, 302);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'callback' && $method === 'GET') {
        $u = Auth::requireUser($pdo, $cfg);
        $code  = $_GET['code']  ?? '';
        $state = $_GET['state'] ?? '';
        $cookieState = $_COOKIE['labpay_calendar_state'] ?? '';
        if (!$code || !$state || !$cookieState || !hash_equals($cookieState, (string)$state)) {
            json_error('oauth_state', 'invalid calendar OAuth state', 400);
            return;
        }
        setcookie('labpay_calendar_state', '', ['expires' => time() - 3600, 'path' => '/']);
        $exch = GoogleCalendar::exchangeCode($cfg, (string)$code);
        GoogleCalendar::storeTokens($pdo, (int)$u['id'], $exch);
        // Settings に戻す。
        $back = rtrim((string)$cfg['app']['base_url'], '/') . '/#/settings?calendar=connected';
        header('Location: ' . $back, true, 302);
        return;
    }

    // ─── Zoom OAuth (User-managed) ────────────────────────────────────
    // /api/auth/zoom/connect  (GET): 認可画面へリダイレクト。 CSRF state を cookie に。
    // /api/auth/zoom/callback (GET): code → token、 users 更新、設定ページへ戻す。
    if ($sub === 'zoom' && ($seg[2] ?? '') === 'connect' && $method === 'GET') {
        $u = Auth::requireUser($pdo, $cfg);
        if (empty($cfg['zoom']['client_id'])) {
            json_error('zoom_disabled', 'Zoom 連携の設定がされていません (config.zoom)', 503);
            return;
        }
        $state = bin2hex(random_bytes(16));
        setcookie('labpay_zoom_state', $state, [
            'expires'  => time() + 600,
            'path'     => '/',
            'secure'   => (bool)($cfg['app']['cookie_secure'] ?? true),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        header('Location: ' . Zoom::authorizeUrl($cfg, $state), true, 302);
        return;
    }
    if ($sub === 'zoom' && ($seg[2] ?? '') === 'callback' && $method === 'GET') {
        $u = Auth::requireUser($pdo, $cfg);
        $code  = $_GET['code']  ?? '';
        $state = $_GET['state'] ?? '';
        $cookieState = $_COOKIE['labpay_zoom_state'] ?? '';
        if (!$code || !$state || !$cookieState || !hash_equals($cookieState, (string)$state)) {
            json_error('oauth_state', 'invalid zoom OAuth state', 400);
            return;
        }
        setcookie('labpay_zoom_state', '', ['expires' => time() - 3600, 'path' => '/']);
        $exch = Zoom::exchangeCode($cfg, (string)$code);
        Zoom::storeTokens($pdo, (int)$u['id'], $exch, /*keepIdentity=*/false);
        $back = rtrim((string)$cfg['app']['base_url'], '/') . '/#/settings?zoom=connected';
        header('Location: ' . $back, true, 302);
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
