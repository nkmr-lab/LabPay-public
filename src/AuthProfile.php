<?php
// LabPay ↔ auth.nkmr.io の user profile (slack_member_id / cosense_pat 等) 連携ヘルパ。
//
// 3 系統の呼び出しを提供する:
//   ・ slackMemberId($pdo, $cfg, $uid)  — 【他人分】サービス鍵で lookup_ok な field のみ取得。
//                                          中村 admin → メンバー宛 Slack DM や、 cron 一斉通知 で
//                                          「相手のブラウザセッションが無い」ケース向け。
//                                          返るのは slack_member_id のみ (auth 側 profile_lookup)。
//   ・ selfProfile($cfg)                — 【本人分】NKMRID クッキーを Bearer で auth に転送 →
//                                          全 profile field (cosense_pat 含む) を復号済みで取得。
//                                          呼び出し元にログイン済み SSO cookie が必要。
//   ・ patchSelf($cfg, $fields)         — 【本人分 書換】NKMRID Bearer で auth に PATCH JSON API を叩く。
//                                          部分更新: 指定 field のみ 上書き、他は現状維持。
//
// 全てリクエストスコープでメモ化(同じリクエスト中の複数呼び出しは 1 回 curl 相当)。

declare(strict_types=1);

class AuthProfile {
    /** @var array<int, array<string,string>> uid => lookup profile (slack_member_id 等) */
    private static array $lookupCache = [];
    /** @var array<string, ?array> Bearer token → self profile (このリクエストの間のみ) */
    private static array $selfCache = [];
    /** @var array<int, ?string> uid → email */
    private static array $emailCache = [];

    public static function slackMemberId(PDO $pdo, array $cfg, int $uid): ?string {
        $prof = self::lookup($pdo, $cfg, $uid);
        $v = trim((string)($prof['slack_member_id'] ?? ''));
        return $v !== '' ? $v : null;
    }

    /** @return array<string,string> lookup_ok な field のみ (現状: slack_member_id) */
    public static function lookup(PDO $pdo, array $cfg, int $uid): array {
        if (isset(self::$lookupCache[$uid])) return self::$lookupCache[$uid];
        $email = self::emailOf($pdo, $uid);
        if (!$email) return self::$lookupCache[$uid] = [];
        $svcKey = (string)($cfg['auth']['service_key'] ?? '');
        if ($svcKey === '') return self::$lookupCache[$uid] = [];
        $url = self::base($cfg) . '/?action=profile_lookup&email=' . rawurlencode($email);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['X-Service-Key: ' . $svcKey],
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_CONNECTTIMEOUT => 2,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code < 200 || $code >= 300) {
            error_log("[AuthProfile::lookup] HTTP {$code} for email={$email}");
            return self::$lookupCache[$uid] = [];
        }
        $data = json_decode((string)$body, true);
        $prof = is_array($data['profile'] ?? null) ? $data['profile'] : [];
        return self::$lookupCache[$uid] = $prof;
    }

    /** 本人分 (Bearer 経由)。 全 profile field を復号済みで返す。 */
    public static function selfProfile(array $cfg): ?array {
        $tok = self::selfToken();
        if ($tok === '') return null;
        if (array_key_exists($tok, self::$selfCache)) return self::$selfCache[$tok];
        $ch = curl_init(self::base($cfg) . '/?action=profile');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $tok,
                'Content-Type: application/json',   // JSON API モードに入るためのフラグ
                'Accept: application/json',
            ],
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_CONNECTTIMEOUT => 2,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code < 200 || $code >= 300) {
            error_log("[AuthProfile::selfProfile] HTTP {$code}");
            return self::$selfCache[$tok] = null;
        }
        return self::$selfCache[$tok] = (json_decode((string)$body, true) ?: null);
    }

    public static function selfSlackMemberId(array $cfg): ?string {
        $p = self::selfProfile($cfg);
        $v = trim((string)($p['profile']['slack_member_id'] ?? ''));
        return $v !== '' ? $v : null;
    }

    public static function cosensePat(array $cfg): ?string {
        $p = self::selfProfile($cfg);
        $v = trim((string)($p['profile']['cosense_pat'] ?? ''));
        return $v !== '' ? $v : null;
    }

    /**
     * 本人分の部分更新。 $fields のキーだけ auth 側に PATCH する。
     * @param array<string,string|null> $fields   e.g. ['slack_member_id' => 'U01ABCD']
     * @return array{ok:bool, http:int, changed?:array}
     */
    public static function patchSelf(array $cfg, array $fields): array {
        $tok = self::selfToken();
        if ($tok === '') return ['ok' => false, 'http' => 401];
        $ch = curl_init(self::base($cfg) . '/?action=profile');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => 'PATCH',
            CURLOPT_POSTFIELDS     => json_encode($fields, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $tok,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_CONNECTTIMEOUT => 2,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        // キャッシュ無効化 (以降 selfProfile で 最新 を 引き直させる)
        unset(self::$selfCache[$tok]);
        if ($code < 200 || $code >= 300) {
            error_log("[AuthProfile::patchSelf] HTTP {$code} body={$body}");
            return ['ok' => false, 'http' => $code];
        }
        $data = json_decode((string)$body, true) ?: [];
        return ['ok' => true, 'http' => $code, 'changed' => $data['changed'] ?? []];
    }

    // ------------- 内部 -------------

    private static function base(array $cfg): string {
        return rtrim((string)($cfg['auth']['base_url'] ?? 'https://auth.nkmr.io'), '/');
    }

    /** リクエストに乗ってきた NKMRID (auth の SSO cookie) を Bearer 用に取り出す。 */
    private static function selfToken(): string {
        return (string)($_COOKIE['NKMRID'] ?? '');
    }

    private static function emailOf(PDO $pdo, int $uid): ?string {
        if (array_key_exists($uid, self::$emailCache)) return self::$emailCache[$uid];
        $st = $pdo->prepare('SELECT email FROM users WHERE id=?');
        $st->execute([$uid]);
        $e = $st->fetchColumn();
        return self::$emailCache[$uid] = ($e ? (string)$e : null);
    }
}
