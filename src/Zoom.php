<?php
// Zoom 連携: User-managed OAuth で各ユーザの代理権限を預かり、 LabPay から
// Zoom MTG を生成する。 構造は GoogleCalendar.php に揃えてあり、 違うのは
// (1) token endpoint が HTTP Basic 認証 (Google は form パラメータ)、
// (2) refresh で新しい refresh_token も返ってくる (rotate するので毎回 DB 更新)、
// (3) 必要 scope は meeting:write:meeting + user:read:user。

declare(strict_types=1);

class Zoom {
    // 認可 URL を組み立てる。 state は CSRF 用のランダム文字列を呼び出し側で。
    public static function authorizeUrl(array $cfg, string $state): string {
        $redirect = self::redirectUri($cfg);
        $params = [
            'response_type' => 'code',
            'client_id'     => (string)$cfg['zoom']['client_id'],
            'redirect_uri'  => $redirect,
            'state'         => $state,
        ];
        return 'https://zoom.us/oauth/authorize?' . http_build_query($params);
    }

    public static function redirectUri(array $cfg): string {
        return rtrim((string)$cfg['app']['base_url'], '/') . '/api/auth/zoom/callback';
    }

    // 認可コード → access/refresh トークン。 Zoom は token endpoint で
    // HTTP Basic 認証 (base64(client_id:client_secret)) を要求するので
    // Authorization ヘッダで投げる。
    public static function exchangeCode(array $cfg, string $code): array {
        $redirect = self::redirectUri($cfg);
        $post = http_build_query([
            'code'         => $code,
            'grant_type'   => 'authorization_code',
            'redirect_uri' => $redirect,
        ]);
        return self::tokenRequest($cfg, $post);
    }

    public static function refreshAccessToken(array $cfg, string $refreshToken): array {
        $post = http_build_query([
            'refresh_token' => $refreshToken,
            'grant_type'    => 'refresh_token',
        ]);
        return self::tokenRequest($cfg, $post);
    }

    private static function tokenRequest(array $cfg, string $postBody): array {
        $basic = base64_encode(((string)$cfg['zoom']['client_id']) . ':' . ((string)$cfg['zoom']['client_secret']));
        $ch = curl_init('https://zoom.us/oauth/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $postBody,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Basic ' . $basic,
                'Content-Type: application/x-www-form-urlencoded',
            ],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch);
        $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $http !== 200) {
            throw new ApiException('oauth_exchange', 'zoom token request failed (http=' . $http . ')', 502);
        }
        $data = json_decode((string)$resp, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new ApiException('oauth_exchange', 'no access_token in zoom response', 502);
        }
        return $data;
    }

    // 取り出した token が期限切れなら refresh して DB に保存、 最新の access_token を返す。
    // Zoom は refresh するたびに 新しい refresh_token も返してくる (rotate 方式) ので
    // 古いのを残さないよう必ず両方更新。
    public static function ensureValidAccessToken(PDO $pdo, array $cfg, int $userId): string {
        $st = $pdo->prepare('SELECT zoom_access_token, zoom_refresh_token, zoom_token_expires_at
                             FROM users WHERE id=?');
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row || empty($row['zoom_access_token'])) {
            throw new ApiException('zoom_not_connected', 'Zoom 連携されていません', 409);
        }
        $expiresAt = $row['zoom_token_expires_at'] ? strtotime($row['zoom_token_expires_at']) : 0;
        if ($expiresAt > time() + 60) {
            return (string)$row['zoom_access_token'];
        }
        if (empty($row['zoom_refresh_token'])) {
            throw new ApiException('zoom_reauth', 'Zoom 再連携が必要です', 409);
        }
        try {
            $data = self::refreshAccessToken($cfg, (string)$row['zoom_refresh_token']);
        } catch (ApiException $e) {
            // refresh_token が失効してたら DB をクリアして 再連携を促す。
            self::disconnect($pdo, $userId);
            throw new ApiException('zoom_reauth', 'Zoom 再連携が必要です (refresh 失敗)', 409);
        }
        self::storeTokens($pdo, $userId, $data, /*keepIdentity=*/true);
        return (string)$data['access_token'];
    }

    // exchange / refresh のレスポンスを users に保存する共通ルーチン。
    // 初回 (exchange) は zoom_user_id/email も埋める。 refresh の時は token だけ更新。
    public static function storeTokens(PDO $pdo, int $userId, array $tokenResp, bool $keepIdentity = false): void {
        $access  = (string)($tokenResp['access_token']  ?? '');
        $refresh = (string)($tokenResp['refresh_token'] ?? '');
        $ttl     = (int)($tokenResp['expires_in']       ?? 3600);
        if ($access === '') {
            throw new ApiException('oauth_exchange', 'empty access_token', 502);
        }
        $exp = date('Y-m-d H:i:s', time() + $ttl);
        if ($keepIdentity) {
            // refresh: token 系だけ更新 (refresh_token は rotate されるので必須上書き)。
            if ($refresh !== '') {
                $pdo->prepare('UPDATE users
                    SET zoom_access_token=?, zoom_refresh_token=?, zoom_token_expires_at=?
                    WHERE id=?')->execute([$access, $refresh, $exp, $userId]);
            } else {
                $pdo->prepare('UPDATE users
                    SET zoom_access_token=?, zoom_token_expires_at=?
                    WHERE id=?')->execute([$access, $exp, $userId]);
            }
            return;
        }
        // 初回 exchange: identity も拾って保存。
        $me = self::getMe($access);
        $pdo->prepare('UPDATE users
            SET zoom_access_token=?, zoom_refresh_token=?, zoom_token_expires_at=?,
                zoom_user_id=?, zoom_email=?
            WHERE id=?')->execute([
            $access, $refresh, $exp,
            (string)($me['id']    ?? ''),
            (string)($me['email'] ?? ''),
            $userId,
        ]);
    }

    public static function disconnect(PDO $pdo, int $userId): void {
        $pdo->prepare('UPDATE users
            SET zoom_access_token=NULL, zoom_refresh_token=NULL,
                zoom_token_expires_at=NULL, zoom_user_id=NULL, zoom_email=NULL
            WHERE id=?')->execute([$userId]);
    }

    public static function getMe(string $accessToken): array {
        return self::apiRequest('GET', 'https://api.zoom.us/v2/users/me', $accessToken, null);
    }

    // POST /users/me/meetings  type=2 (scheduled). Zoom 側は時刻を ISO8601 と
    // timezone で受ける (start_time は timezone 上のローカル時刻、 末尾 Z なし)。
    // 戻り値はそのまま Zoom の meeting オブジェクト。 主に join_url を使う。
    public static function createMeeting(string $accessToken, array $params): array {
        $body = [
            'topic'      => (string)($params['topic']      ?? 'Meeting'),
            'type'       => 2,
            'start_time' => (string)($params['start_time'] ?? gmdate('Y-m-d\TH:i:s')),
            'duration'   => max(1, (int)($params['duration'] ?? 30)),
            'timezone'   => (string)($params['timezone']   ?? 'Asia/Tokyo'),
            'settings'   => [
                'host_video'        => true,
                'participant_video' => true,
                'join_before_host'  => true,
                'waiting_room'      => false,
                'mute_upon_entry'   => false,
            ],
        ];
        return self::apiRequest('POST', 'https://api.zoom.us/v2/users/me/meetings',
            $accessToken, json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    private static function apiRequest(string $method, string $url, string $accessToken, ?string $jsonBody): array {
        $ch = curl_init($url);
        $headers = [
            'Authorization: Bearer ' . $accessToken,
            'Accept: application/json',
        ];
        if ($jsonBody !== null) {
            $headers[] = 'Content-Type: application/json';
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 20,
        ]);
        if ($jsonBody !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonBody);
        }
        $resp = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false) {
            throw new ApiException('zoom_api', 'zoom API transport failed', 502);
        }
        if ($http === 401) {
            throw new ApiException('zoom_unauthorized', 'zoom access token rejected', 401);
        }
        if ($http < 200 || $http >= 300) {
            $msg = "zoom API error: $http";
            $data = json_decode((string)$resp, true);
            if (is_array($data) && !empty($data['message'])) {
                $msg .= ' — ' . (string)$data['message'];
            }
            throw new ApiException('zoom_api', $msg, 502);
        }
        $data = json_decode((string)$resp, true);
        if (!is_array($data)) {
            throw new ApiException('zoom_api', 'zoom API non-JSON response', 502);
        }
        return $data;
    }
}
