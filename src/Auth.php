<?php
// Auth: Google OAuth + dev login + cookie sessions + allowlist + bootstrap admin.
// Sessions are server-side rows; the cookie only carries the random id.

declare(strict_types=1);

class Auth {
    // Ensure bootstrap admin exists in allowlist. Idempotent.
    public static function bootstrapAdmin(PDO $pdo, array $cfg): void {
        $email = trim((string)($cfg['auth']['bootstrap_admin_email'] ?? ''));
        if ($email === '') return;
        $st = $pdo->prepare('SELECT email FROM allowlist WHERE email=?');
        $st->execute([$email]);
        if ($st->fetchColumn() === false) {
            $ins = $pdo->prepare('INSERT INTO allowlist (email, display_name, role, active)
                VALUES (?,?,?,1)');
            $ins->execute([$email, self::guessDisplayName($email), 'admin']);
        }
    }

    private static function guessDisplayName(string $email): string {
        $local = explode('@', $email, 2)[0] ?? $email;
        return $local;
    }

    // ------------- Session helpers -------------

    public static function newSessionId(): string {
        return bin2hex(random_bytes(32));
    }

    public static function setSessionCookie(array $cfg, string $sid, ?int $ttlDays = null): void {
        $name = $cfg['app']['cookie_name'] ?? 'labpay_sid';
        $ttl  = $ttlDays ?? 30;
        $opts = [
            'expires'  => time() + 86400 * $ttl,
            'path'     => '/',
            'secure'   => (bool)($cfg['app']['cookie_secure'] ?? true),
            'httponly' => true,
            'samesite' => $cfg['app']['cookie_samesite'] ?? 'None',  // v932 別サブドメイン (*.nkmr.io) から の fetch で cookie を 送る ため
        ];
        setcookie($name, $sid, $opts);
    }

    public static function clearSessionCookie(array $cfg): void {
        $name = $cfg['app']['cookie_name'] ?? 'labpay_sid';
        $opts = [
            'expires'  => time() - 3600,
            'path'     => '/',
            'secure'   => (bool)($cfg['app']['cookie_secure'] ?? true),
            'httponly' => true,
            'samesite' => $cfg['app']['cookie_samesite'] ?? 'None',  // v932 別サブドメイン (*.nkmr.io) から の fetch で cookie を 送る ため
        ];
        setcookie($name, '', $opts);
    }

    public static function readSessionId(array $cfg): ?string {
        $name = $cfg['app']['cookie_name'] ?? 'labpay_sid';
        $sid = $_COOKIE[$name] ?? null;
        if (!is_string($sid) || !preg_match('/^[0-9a-f]{64}$/', $sid)) return null;
        return $sid;
    }

    // Returns user row or null. Touches last_seen_at when found.
    public static function currentUser(PDO $pdo, array $cfg): ?array {
        $sid = self::readSessionId($cfg);
        if ($sid === null) return null;
        $st = $pdo->prepare(
            'SELECT s.id AS sid, s.user_id, s.expires_at,
                    u.email, u.display_name, u.role, u.kind
               FROM sessions s JOIN users u ON u.id=s.user_id
              WHERE s.id=? LIMIT 1'
        );
        $st->execute([$sid]);
        $row = $st->fetch();
        if (!$row) return null;
        if (strtotime((string)$row['expires_at']) < time()) {
            $del = $pdo->prepare('DELETE FROM sessions WHERE id=?');
            $del->execute([$sid]);
            return null;
        }
        $upd = $pdo->prepare('UPDATE sessions SET last_seen_at=NOW() WHERE id=?');
        $upd->execute([$sid]);
        return [
            'id'           => (int)$row['user_id'],
            'email'        => (string)$row['email'],
            'display_name' => (string)$row['display_name'],
            'role'         => (string)$row['role'],
            'kind'         => (string)$row['kind'],
        ];
    }

    public static function requireUser(PDO $pdo, array $cfg): array {
        $u = self::currentUser($pdo, $cfg);
        if (!$u) throw new ApiException('unauthorized', 'login required', 401);
        if ($u['kind'] !== 'human') throw new ApiException('forbidden', 'non-human cannot call', 403);
        return $u;
    }

    public static function requireAdmin(PDO $pdo, array $cfg): array {
        $u = self::requireUser($pdo, $cfg);
        if ($u['role'] !== 'admin') throw new ApiException('forbidden', 'admin only', 403);
        return $u;
    }

    // ------------- Login flow (login completion) -------------

    // Common login completion: given a verified email, create or update the user,
    // ensure account, send initial points if first time, issue a session.
    // Returns ['user' => userRow, 'sid' => sid, 'first_login' => bool, 'initial_points' => int|null].
    public static function completeLogin(PDO $pdo, array $cfg, string $emailRaw): array {
        $email = strtolower(trim($emailRaw));
        if ($email === '') throw new ApiException('bad_request', 'empty email', 400);

        $st = $pdo->prepare('SELECT email, display_name, role, grade, active FROM allowlist WHERE email=?');
        $st->execute([$email]);
        $al = $st->fetch();
        if (!$al || (int)$al['active'] !== 1) {
            throw new ApiException('not_allowed', 'this email is not on the allowlist', 403);
        }

        $pdo->beginTransaction();
        try {
            // Upsert user
            $u = $pdo->prepare('SELECT id, role, display_name FROM users WHERE email=?');
            $u->execute([$email]);
            $userRow = $u->fetch();
            $firstLogin = false;
            if ($userRow) {
                $userId = (int)$userRow['id'];
                // v919 fb#467 「名前を 設定 しても 毎回 nakamura.satoshi に 戻る」 修正。
                //   従来: 毎ログインで display_name も allowlist から 上書き していたため、 PATCH /api/me で 変えても
                //   次のログインで リセット。 権限 (role/grade) は allowlist authoritative の まま、 表示名は 本人が
                //   PATCH /api/me で 変えられる ので、 ここでは 同期しない (初回登録時 は 下の INSERT で 使う)。
                $upd = $pdo->prepare('UPDATE users
                    SET role=?, grade=?, last_login_at=NOW() WHERE id=?');
                $upd->execute([$al['role'], $al['grade'] ?? null, $userId]);
            } else {
                $ins = $pdo->prepare('INSERT INTO users (email, display_name, role, kind, grade, last_login_at)
                    VALUES (?,?,?,?,?,NOW())');
                $ins->execute([$email, $al['display_name'], $al['role'], 'human', $al['grade'] ?? null]);
                $userId = (int)$pdo->lastInsertId();
                $firstLogin = true;
            }

            // Ensure account
            $accountId = Ledger::ensureUserAccount($pdo, $userId);

            // Initial point grant on first login
            $initialPts = null;
            if ($firstLogin) {
                $amount = (int)cfg_get($pdo, 'initial_points', '1000');
                if ($amount > 0) {
                    $sysAcc = Ledger::accountIdByCode($pdo, 'SYSTEM');
                    Ledger::transfer($pdo, $sysAcc, $accountId, $amount, 'initial',
                        'initial', $userId, '初期配布');
                    $initialPts = $amount;
                }
            }

            // Issue session
            $ttlDays = (int)cfg_get($pdo, 'session_ttl_days', '30');
            $sid = self::newSessionId();
            $sIns = $pdo->prepare('INSERT INTO sessions (id, user_id, expires_at)
                VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))');
            $sIns->execute([$sid, $userId, $ttlDays]);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        self::setSessionCookie($cfg, $sid, $ttlDays);

        // Re-read user
        $u2 = $pdo->prepare('SELECT id, email, display_name, role, kind FROM users WHERE id=?');
        $u2->execute([$userId]);
        $user = $u2->fetch();

        return [
            'user' => [
                'id' => (int)$user['id'],
                'email' => $user['email'],
                'display_name' => $user['display_name'],
                'role' => $user['role'],
                'kind' => $user['kind'],
            ],
            'sid' => $sid,
            'first_login' => $firstLogin,
            'initial_points' => $initialPts,
        ];
    }

    // ------------- OAuth helpers -------------

    public static function oauthAuthorizeUrl(array $cfg, string $state): string {
        $redirect = rtrim((string)$cfg['app']['base_url'], '/') . '/api/auth/callback';
        $params = [
            'client_id'     => (string)$cfg['auth']['google_client_id'],
            'response_type' => 'code',
            'scope'         => 'openid email profile',
            'redirect_uri'  => $redirect,
            'state'         => $state,
            'access_type'   => 'online',
            'prompt'        => 'select_account',
        ];
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
    }

    public static function oauthExchange(array $cfg, string $code): array {
        $redirect = rtrim((string)$cfg['app']['base_url'], '/') . '/api/auth/callback';
        $post = http_build_query([
            'code'          => $code,
            'client_id'     => (string)$cfg['auth']['google_client_id'],
            'client_secret' => (string)$cfg['auth']['google_client_secret'],
            'redirect_uri'  => $redirect,
            'grant_type'    => 'authorization_code',
        ]);
        $ch = curl_init('https://oauth2.googleapis.com/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $post,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_TIMEOUT => 15,
        ]);
        $res = curl_exec($ch);
        $code_http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false || $code_http >= 400) {
            throw new ApiException('oauth_error', "token exchange failed: $err / $res", 502);
        }
        $tok = json_decode($res, true);
        if (!is_array($tok) || empty($tok['access_token'])) {
            throw new ApiException('oauth_error', 'no access_token', 502);
        }

        // Fetch userinfo
        $ch2 = curl_init('https://openidconnect.googleapis.com/v1/userinfo');
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok['access_token']],
            CURLOPT_TIMEOUT => 15,
        ]);
        $info = curl_exec($ch2);
        $info_http = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);
        if ($info === false || $info_http >= 400) {
            throw new ApiException('oauth_error', "userinfo failed: $info", 502);
        }
        $u = json_decode($info, true);
        if (!is_array($u) || empty($u['email'])) {
            throw new ApiException('oauth_error', 'no email in userinfo', 502);
        }
        if (isset($u['email_verified']) && $u['email_verified'] === false) {
            throw new ApiException('oauth_error', 'email not verified', 403);
        }
        return ['email' => (string)$u['email'], 'name' => (string)($u['name'] ?? '')];
    }
}
