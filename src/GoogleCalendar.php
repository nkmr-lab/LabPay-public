<?php
// GoogleCalendar: Google Calendar 連携の薄い helper。
// 既存の Calendar.php (lab_closed / workday 判定) と名前が衝突するので
// クラス名を GoogleCalendar にしてある。
// * incremental authorization で取得した access_token / refresh_token を users
//   テーブルに保存 (migration 045 参照)。
// * 期限切れなら refresh_token で透過更新 (ensureValidAccessToken)。
// * Google API は同期 GET のみ (一覧 + イベント取得)。
// * トークンは DB だけに残し、ログには絶対に出さない。

declare(strict_types=1);

class GoogleCalendar {
    public const READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

    // 既存セッションに対して追加 scope を要求する認可 URL。access_type=offline +
    // prompt=consent で refresh_token を必ず受け取る。
    public static function authorizeUrl(array $cfg, string $loginHint, string $state): string {
        $redirect = rtrim((string)$cfg['app']['base_url'], '/') . '/api/auth/calendar/callback';
        $params = [
            'client_id'     => (string)$cfg['auth']['google_client_id'],
            'response_type' => 'code',
            'scope'         => self::READONLY_SCOPE,
            'redirect_uri'  => $redirect,
            'state'         => $state,
            'access_type'   => 'offline',
            'prompt'        => 'consent',
            'include_granted_scopes' => 'true',
            'login_hint'    => $loginHint,
        ];
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
    }

    // 認可コードを access_token + refresh_token に交換。失敗時は ApiException。
    public static function exchangeCode(array $cfg, string $code): array {
        $redirect = rtrim((string)$cfg['app']['base_url'], '/') . '/api/auth/calendar/callback';
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
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $post,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch);
        $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $http !== 200) {
            throw new ApiException('oauth_exchange', 'calendar code exchange failed', 502);
        }
        $data = json_decode((string)$resp, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new ApiException('oauth_exchange', 'no access_token in response', 502);
        }
        return $data;
    }

    public static function refreshAccessToken(array $cfg, string $refreshToken): array {
        $post = http_build_query([
            'client_id'     => (string)$cfg['auth']['google_client_id'],
            'client_secret' => (string)$cfg['auth']['google_client_secret'],
            'refresh_token' => $refreshToken,
            'grant_type'    => 'refresh_token',
        ]);
        $ch = curl_init('https://oauth2.googleapis.com/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $post,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch);
        $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $http !== 200) {
            throw new ApiException('oauth_refresh', 'token refresh failed', 502);
        }
        $data = json_decode((string)$resp, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new ApiException('oauth_refresh', 'no access_token in refresh response', 502);
        }
        return $data;
    }

    // 取り出した token が期限切れなら refresh して DB に保存、最新の access_token を返す。
    public static function ensureValidAccessToken(PDO $pdo, array $cfg, int $userId): string {
        $st = $pdo->prepare('SELECT calendar_access_token, calendar_refresh_token,
                                    calendar_token_expires_at
                             FROM users WHERE id=?');
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row || empty($row['calendar_access_token'])) {
            throw new ApiException('calendar_not_connected', 'Google Calendar 連携されていません', 409);
        }
        $expiresAt = $row['calendar_token_expires_at'] ? strtotime($row['calendar_token_expires_at']) : 0;
        if ($expiresAt > time() + 60) {
            return (string)$row['calendar_access_token'];
        }
        if (empty($row['calendar_refresh_token'])) {
            throw new ApiException('calendar_reauth', '再連携が必要です', 409);
        }
        $data = self::refreshAccessToken($cfg, (string)$row['calendar_refresh_token']);
        $access = (string)$data['access_token'];
        $ttl    = (int)($data['expires_in'] ?? 3600);
        $exp    = date('Y-m-d H:i:s', time() + $ttl);
        $pdo->prepare('UPDATE users
            SET calendar_access_token=?, calendar_token_expires_at=? WHERE id=?')
            ->execute([$access, $exp, $userId]);
        return $access;
    }

    public static function storeTokens(PDO $pdo, int $userId, array $exchange): void {
        $access  = (string)($exchange['access_token']  ?? '');
        $refresh = (string)($exchange['refresh_token'] ?? '');
        $ttl     = (int)($exchange['expires_in']       ?? 3600);
        if ($access === '') {
            throw new ApiException('oauth_exchange', 'empty access_token', 502);
        }
        $exp = date('Y-m-d H:i:s', time() + $ttl);
        if ($refresh !== '') {
            $pdo->prepare('UPDATE users
                SET calendar_access_token=?, calendar_refresh_token=?,
                    calendar_token_expires_at=?, calendar_connected_at=NOW()
                WHERE id=?')
                ->execute([$access, $refresh, $exp, $userId]);
        } else {
            $pdo->prepare('UPDATE users
                SET calendar_access_token=?, calendar_token_expires_at=?,
                    calendar_connected_at=NOW()
                WHERE id=?')
                ->execute([$access, $exp, $userId]);
        }
    }

    public static function disconnect(PDO $pdo, int $userId): void {
        $pdo->prepare('UPDATE users
            SET calendar_access_token=NULL, calendar_refresh_token=NULL,
                calendar_token_expires_at=NULL, calendar_selected_ids=NULL,
                calendar_connected_at=NULL
            WHERE id=?')->execute([$userId]);
    }

    private static function get(string $url, string $accessToken): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $accessToken],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch);
        $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false) {
            throw new ApiException('calendar_api', 'calendar API transport failed', 502);
        }
        if ($http === 401) {
            throw new ApiException('calendar_unauthorized', 'access token rejected', 401);
        }
        if ($http !== 200) {
            throw new ApiException('calendar_api', "calendar API error: $http", 502);
        }
        $data = json_decode((string)$resp, true);
        if (!is_array($data)) {
            throw new ApiException('calendar_api', 'calendar API non-JSON response', 502);
        }
        return $data;
    }

    public static function listCalendars(string $accessToken): array {
        $url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?'
             . http_build_query(['maxResults' => 100, 'minAccessRole' => 'reader']);
        $data = self::get($url, $accessToken);
        $items = $data['items'] ?? [];
        return array_map(fn($c) => [
            'id'      => (string)($c['id'] ?? ''),
            'summary' => (string)($c['summary'] ?? ''),
            'primary' => !empty($c['primary']),
            'bg'      => (string)($c['backgroundColor'] ?? ''),
        ], $items);
    }

    public static function listEvents(string $accessToken, string $calendarId,
                                      string $timeMinIso, string $timeMaxIso): array {
        $url = 'https://www.googleapis.com/calendar/v3/calendars/'
             . rawurlencode($calendarId) . '/events?'
             . http_build_query([
                 'timeMin'      => $timeMinIso,
                 'timeMax'      => $timeMaxIso,
                 'singleEvents' => 'true',
                 'orderBy'      => 'startTime',
                 'maxResults'   => 50,
             ]);
        $data = self::get($url, $accessToken);
        return $data['items'] ?? [];
    }

    // event の description / location から Zoom / Meet URL を抽出。
    public static function extractMeetingUrl(array $event): ?string {
        $eps = $event['conferenceData']['entryPoints'] ?? [];
        foreach ($eps as $ep) {
            if (($ep['entryPointType'] ?? '') === 'video' && !empty($ep['uri'])) {
                return (string)$ep['uri'];
            }
        }
        $haystack = trim((string)($event['location'] ?? '') . "\n" . (string)($event['description'] ?? ''));
        if ($haystack === '') return null;
        if (preg_match('#https?://[^\s<>"\']+#u', $haystack, $m)) {
            return $m[0];
        }
        return null;
    }
}
