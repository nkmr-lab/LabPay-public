<?php
// LabPay bootstrap. Loaded by public/api/index.php (front controller).
// Sets up config, PDO, helpers, and registers handler files.

declare(strict_types=1);

// Global safety net: convert otherwise-fatal errors during bootstrap (e.g. DB connection failure)
// into a clean JSON 500 instead of a blank page.
set_exception_handler(function (Throwable $e): void {
    error_log('[labpay/bootstrap] ' . $e::class . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => ['code' => 'server_error', 'message' => 'internal server error']]);
    exit;
});

// ---------------- Config ----------------
$cfgPath = __DIR__ . '/../config/config.php';
if (!is_file($cfgPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['code' => 'config_missing',
        'message' => 'config/config.php not found. Copy config/config.sample.php and edit.']]);
    exit;
}
$CFG = require $cfgPath;

date_default_timezone_set($CFG['app']['timezone'] ?? 'Asia/Tokyo');

// ---------------- Includes ----------------
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Money.php';
require_once __DIR__ . '/Ledger.php';
require_once __DIR__ . '/Notifier.php';
require_once __DIR__ . '/ProductInfo.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Calendar.php';
require_once __DIR__ . '/GoogleCalendar.php';
require_once __DIR__ . '/Zoom.php';
require_once __DIR__ . '/Achievements.php';
require_once __DIR__ . '/Labels.php';

// ---------------- API exception ----------------
class ApiException extends RuntimeException {
    public string $errCode;
    public int $httpStatus;
    public ?array $details;
    public function __construct(string $code, string $message, int $http = 400, ?array $details = null) {
        parent::__construct($message);
        $this->errCode = $code;
        $this->httpStatus = $http;
        $this->details = $details;
    }
}

// ---------------- DB ----------------
$DB = new Db($CFG['db']);
$PDO = $DB->pdo();

// MySQL session timezone matches PHP (so DATE/NOW are consistent)
try { $PDO->exec("SET time_zone = '+09:00'"); } catch (Throwable $e) { /* ignore */ }

// ---------------- Bootstrap admin (idempotent) ----------------
Auth::bootstrapAdmin($PDO, $CFG);

// ---------------- Response helpers ----------------
function json_response($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function json_error(string $code, string $message, int $status = 400, ?array $details = null): void {
    $payload = ['error' => ['code' => $code, 'message' => $message]];
    if ($details !== null) $payload['error']['details'] = $details;
    json_response($payload, $status);
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new ApiException('bad_json', 'invalid JSON body', 400);
    return $data;
}

function require_field(array $arr, string $key) {
    if (!array_key_exists($key, $arr) || $arr[$key] === null || $arr[$key] === '') {
        throw new ApiException('bad_request', "missing field: $key", 400);
    }
    return $arr[$key];
}

function require_int_positive($v, string $name): int {
    if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
        throw new ApiException('bad_request', "$name must be a positive integer", 400);
    }
    $n = (int)$v;
    if ($n <= 0) throw new ApiException('bad_request', "$name must be > 0", 400);
    return $n;
}

function require_int_nonneg($v, string $name): int {
    if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
        throw new ApiException('bad_request', "$name must be a non-negative integer", 400);
    }
    $n = (int)$v;
    if ($n < 0) throw new ApiException('bad_request', "$name must be >= 0", 400);
    return $n;
}

// Read an optional free-text field from a parsed JSON body. Returns null when the key
// is missing, the value is null, or trimming leaves it empty. Otherwise trims and caps to $maxLen.
// Use for fields where "" and whitespace should both collapse to NULL in the DB
// (memo, completion_message, location, notes, etc).
function optional_text_field(array $body, string $key, int $maxLen): ?string {
    if (!array_key_exists($key, $body) || $body[$key] === null) return null;
    $v = trim((string)$body[$key]);
    if ($v === '') return null;
    return mb_substr($v, 0, $maxLen);
}

// PATCH-style: three-state read for an optional free-text field.
//   key absent  → keep $current
//   key present → null-out when empty/whitespace, else trimmed & capped
function patch_text_field(array $body, string $key, int $maxLen, ?string $current): ?string {
    if (!array_key_exists($key, $body)) return $current;
    return optional_text_field($body, $key, $maxLen);
}

// Compose " — <truncated text>" when text is non-empty, otherwise empty string.
// Used to glue user-provided notes/messages onto a notification body without trailing dashes.
function notification_quote(?string $text, int $maxLen = 180): string {
    if ($text === null) return '';
    $t = trim($text);
    if ($t === '') return '';
    return "\n— " . mb_substr($t, 0, $maxLen);
}

// Render an optional Japanese parenthetical suffix for admin/transfer memos.
// Returns "（$memo）" when present, else empty string.
function format_memo_suffix(?string $memo): string {
    if ($memo === null) return '';
    $m = trim($memo);
    return $m === '' ? '' : "（{$m}）";
}

// Validate a product image URL: optional, http(s) only, OR a local /uploads/...<ext> path.
// External http(s) is allowed (Rakuten serves product photos from its CDN). Path traversal
// and weird schemes (javascript:, data:, file:, etc) are rejected.
// Returns the trimmed URL or null when empty. Throws on invalid input.
function validate_product_image_url($url): ?string {
    if ($url === null) return null;
    $u = trim((string)$url);
    if ($u === '') return null;
    // Local upload path: /uploads/<dir>?/<file>.<ext> with the same restrictive charset as me.php.
    if (preg_match('#^/uploads/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?\.[A-Za-z0-9]{1,8}$#', $u)) {
        return $u;
    }
    // External: http(s) URL only, validated by PHP, no embedded credentials.
    if (filter_var($u, FILTER_VALIDATE_URL)
        && (str_starts_with($u, 'http://') || str_starts_with($u, 'https://'))
        && parse_url($u, PHP_URL_USER) === null) {
        return $u;
    }
    throw new ApiException('bad_request',
        'image_url must be http(s) URL or /uploads/<file>.<ext>', 400);
}

// Normalize a JAN-like input: strip non-digits and validate length. Throws on bad input.
// Hyphens/spaces from sloppy scanner reads are silently stripped so retries don't desync.
function normalize_jan(string $raw): string {
    $jan = preg_replace('/\D+/', '', $raw);
    if (!preg_match('/^[0-9]{8,20}$/', $jan)) {
        throw new ApiException('bad_request', "JAN は数字 8〜20 桁です (受領: '$jan')", 400);
    }
    return $jan;
}

// ---------------- Config (runtime, DB-backed) ----------------
function cfg_get(PDO $pdo, string $key, $default = null) {
    $st = $pdo->prepare('SELECT v FROM config WHERE k=?');
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : $v;
}

function cfg_set(PDO $pdo, string $key, string $value): void {
    $st = $pdo->prepare('INSERT INTO config (k,v) VALUES (?,?)
        ON DUPLICATE KEY UPDATE v=VALUES(v)');
    $st->execute([$key, $value]);
}

function cfg_get_json(PDO $pdo, string $key, $default = null) {
    $raw = cfg_get($pdo, $key, null);
    if ($raw === null) return $default;
    $d = json_decode((string)$raw, true);
    return $d === null ? $default : $d;
}

// ---------------- Exposure guard ----------------
function require_exposure(array $CFG, string $key): void {
    if (empty($CFG['exposure'][$key])) {
        throw new ApiException('feature_disabled', "feature '$key' is disabled", 403);
    }
}

// ---------------- CSRF (custom header) ----------------
// Skip when Authorization header is present — Bearer-token auth is not
// vulnerable to CSRF (browsers don't auto-attach Authorization).
function require_csrf_header(string $method): void {
    if (!in_array($method, ['POST', 'PATCH', 'PUT', 'DELETE'], true)) return;
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) return;
    $h = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
    if ($h !== 'labpay') {
        throw new ApiException('csrf', 'missing X-Requested-With: labpay header', 403);
    }
}

// ---------------- DB transaction helper ----------------
// handler 全体で `$pdo->beginTransaction(); try {...} commit(); catch { rollBack; throw }`
// の boilerplate が散らかっていたので集約。callable の戻り値をそのまま返すので
// `$id = db_tx($pdo, fn() => ...)` で透過的に書ける。
// 例外時は inTransaction チェックの上で rollBack して例外を再 throw。
function db_tx(PDO $pdo, callable $fn) {
    $pdo->beginTransaction();
    try {
        $r = $fn();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// ---------------- Idempotency ----------------
function idempotency_get(PDO $pdo, string $ukey, int $userId, string $endpoint): ?array {
    $st = $pdo->prepare('SELECT response_json, status_code FROM idempotency_keys
        WHERE ukey=? AND user_id=? AND endpoint=?');
    $st->execute([$ukey, $userId, $endpoint]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    $body = json_decode($row['response_json'], true);
    return ['status' => (int)$row['status_code'], 'body' => $body];
}

function idempotency_save(PDO $pdo, string $ukey, int $userId, string $endpoint, array $body, int $status): void {
    $st = $pdo->prepare('INSERT INTO idempotency_keys (ukey,user_id,endpoint,response_json,status_code)
        VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE response_json=VALUES(response_json), status_code=VALUES(status_code)');
    $st->execute([$ukey, $userId, $endpoint, json_encode($body, JSON_UNESCAPED_UNICODE), $status]);
}

// ---------------- File upload helper ----------------
// Common spine for /api/uploads/image and /api/tasks/{id}/attachments.
// Validates a $_FILES[...] entry, picks the extension from a MIME allowlist
// (so we never trust the client-supplied filename for the on-disk name), and
// moves it into public/{subDir}/{random}.{ext}. Returns metadata; the caller
// decides whether to record a DB row or just return the URL.
//
// $mimeAllowlist: ['mime/type' => 'ext', ...] — keys that match get accepted.
function save_uploaded_file(array $f, string $subDir, int $maxBytes, array $mimeAllowlist): array {
    if ((int)$f['error'] !== UPLOAD_ERR_OK) {
        throw new ApiException('upload_error', 'upload error code ' . (int)$f['error'], 400);
    }
    if ((int)$f['size'] > $maxBytes) {
        $mb = (int)round($maxBytes / 1024 / 1024);
        throw new ApiException('too_large', "file exceeds {$mb}MB", 413);
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = (string)$finfo->file($f['tmp_name']);
    if (!isset($mimeAllowlist[$mime])) {
        throw new ApiException('bad_mime', "unsupported type: $mime", 415);
    }
    $ext = $mimeAllowlist[$mime];

    $publicDir = realpath(__DIR__ . '/../public') ?: (__DIR__ . '/../public');
    $sub = trim($subDir, '/');
    $dir = $publicDir . '/' . $sub;
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new ApiException('mkdir_failed', 'could not create upload dir', 500);
    }
    if (!is_writable($dir)) {
        throw new ApiException('not_writable', "upload dir not writable: $dir", 500);
    }

    $stored = bin2hex(random_bytes(12)) . '.' . $ext;
    $dest = $dir . '/' . $stored;
    if (!move_uploaded_file($f['tmp_name'], $dest)) {
        throw new ApiException('save_failed', 'could not save file', 500);
    }
    @chmod($dest, 0644);

    // 画像ならサムネ (一辺最大 320px) を作って横に置く: <stored>.thumb.jpg
    // GD が無い / 失敗しても本体は成功扱い (サムネはオプション)。
    // v505 #131 (ユーザ報告) EXIF の Orientation を無視していたため iPhone の縦写真等が
    //   サムネで横倒しになっていた。 JPEG なら exif_read_data で orientation を読み、
    //   imagerotate で正しい向きに直してからリサイズする。
    $thumbPath = null;
    if (in_array($mime, ['image/jpeg','image/png','image/webp','image/gif'], true) && function_exists('imagecreatefromstring')) {
        try {
            $raw = @file_get_contents($dest);
            $src = $raw ? @imagecreatefromstring($raw) : false;
            if ($src) {
                // EXIF orientation 補正 (JPEG のみ)
                if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
                    $exif = @exif_read_data($dest);
                    $ori = isset($exif['Orientation']) ? (int)$exif['Orientation'] : 1;
                    if ($ori >= 2 && $ori <= 8) {
                        // 1=normal, 3=180, 6=CW90, 8=CCW90, その他は鏡像なので簡略
                        if ($ori === 3) $src = imagerotate($src, 180, 0);
                        else if ($ori === 6) $src = imagerotate($src, -90, 0);
                        else if ($ori === 8) $src = imagerotate($src, 90, 0);
                    }
                }
                $sw = imagesx($src); $sh = imagesy($src);
                // v598 サムネ品質改善: 320px → 640px、JPEG 82 → 90。
                // PC で らぼったー ウィジェット の 画像が 荒く見えていた問題対応。
                // ファイルサイズ 影響: linear 4x (面積)、JPEG 圧縮で 実質 2-3x 増。
                $maxDim = 640;
                $ratio = min($maxDim / $sw, $maxDim / $sh, 1.0);
                $tw = max(1, (int)round($sw * $ratio));
                $th = max(1, (int)round($sh * $ratio));
                $thumb = imagecreatetruecolor($tw, $th);
                imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh);
                $thumbName = preg_replace('/\.[^.]+$/', '', $stored) . '.thumb.jpg';
                imagejpeg($thumb, $dir . '/' . $thumbName, 90);
                @chmod($dir . '/' . $thumbName, 0644);
                imagedestroy($thumb); imagedestroy($src);
                $thumbPath = '/' . $sub . '/' . $thumbName;
            }
        } catch (Throwable $_) { /* サムネ失敗は無視 */ }
    }

    return [
        'stored_name' => $stored,
        'mime'        => $mime,
        'ext'         => $ext,
        'size'        => (int)$f['size'],
        'path'        => '/' . $sub . '/' . $stored,  // relative URL, suitable for public href
        'thumb_path'  => $thumbPath,                  // 画像のみ。 失敗時は null
    ];
}

// 既存画像 URL から サムネ URL を推定するヘルパ。 サムネが実在すればそのURL、
// 存在しなければ オリジナル URL を返す。 v494 サブディレクトリ
// (/uploads/products/<hash>.jpg) と 絶対 URL (https://.../uploads/...) の両方に対応。
function thumb_url_for(string $imageUrl): string {
    // 絶対 URL なら パス成分だけ取り出す。 同一ホスト前提。
    $path = $imageUrl;
    if (preg_match('#^https?://[^/]+(/.*)$#', $imageUrl, $m)) {
        $path = $m[1];
    }
    if (!preg_match('#^(/uploads/(?:[^/]+/)*)([^/.]+)\.([A-Za-z0-9]+)$#', $path, $m)) {
        return $imageUrl;
    }
    $thumbRel = $m[1] . $m[2] . '.thumb.jpg';
    $publicDir = realpath(__DIR__ . '/../public') ?: (__DIR__ . '/../public');
    if (is_file($publicDir . $thumbRel)) return $thumbRel;
    return $imageUrl;
}

// ---------------- Slack Web API (Bot Token GET) ----------------
// Synchronous GET against api.slack.com. Used by the Scrapbox-via-Slack bridge
// to pull conversation history. Returns the decoded JSON array. Throws on
// transport failure or {ok:false}; callers may catch and report.
// Bot Token lives in $cfg['slack']['bot_token'] (production config only).
// v794 Slack Web API GET。 第 4 引数 で token override (= 別 アプリ の bot token を 使い たい
//   場合 用、 例 え ば Scrapbox Reader の bot token)。 省略 時 は 既定 の slack.bot_token。
function slack_api_get(array $cfg, string $endpoint, array $params = [], ?string $tokenOverride = null): array {
    $tok = $tokenOverride !== null && $tokenOverride !== ''
        ? $tokenOverride
        : (string)($cfg['slack']['bot_token'] ?? '');
    if ($tok === '') throw new RuntimeException('slack token is empty');
    $url = 'https://slack.com/api/' . ltrim($endpoint, '/');
    if ($params) $url .= '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $tok],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException("slack curl failed: $err");
    $data = json_decode($resp, true);
    if (!is_array($data)) throw new RuntimeException("slack response not JSON: " . substr($resp, 0, 200));
    if (empty($data['ok'])) throw new RuntimeException("slack error: " . ($data['error'] ?? 'unknown'));
    return $data;
}

// Slack Web API POST (chat.postMessage 等)。 JSON body + Bearer。
// v794 第 4 引数 で token override (上 と 同様)。
function slack_api_post(array $cfg, string $endpoint, array $body, ?string $tokenOverride = null): array {
    $tok = $tokenOverride !== null && $tokenOverride !== ''
        ? $tokenOverride
        : (string)($cfg['slack']['bot_token'] ?? '');
    if ($tok === '') throw new RuntimeException('slack token is empty');
    $url = 'https://slack.com/api/' . ltrim($endpoint, '/');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $tok,
            'Content-Type: application/json; charset=utf-8',
        ],
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException("slack curl failed: $err");
    $data = json_decode($resp, true);
    if (!is_array($data)) throw new RuntimeException("slack response not JSON: " . substr($resp, 0, 200));
    if (empty($data['ok'])) throw new RuntimeException("slack error: " . ($data['error'] ?? 'unknown'));
    return $data;
}

// ---------------- Activity log ----------------
// Cheap append-only log of every API request. user_id is best-effort: we look
// up the session cookie without forcing auth (so anonymous requests still get
// rows with NULL user). For high-volume scanner POSTs this is one extra INSERT
// per scan tick, which is acceptable given the table's minimal index footprint.
function activity_log_write(PDO $pdo, array $cfg, string $method, string $path,
                            int $status, int $durationMs): void {
    // Skip the log itself for our own health-check / static-y stuff to keep
    // analysis cleaner; keep everything else including 4xx/5xx so error patterns
    // are preserved.
    if ($path === '/' || $path === '/favicon.ico') return;

    // Best-effort user resolution — don't throw if no session.
    $userId = null;
    try {
        $u = Auth::currentUser($pdo, $cfg);
        if ($u && isset($u['id'])) $userId = (int)$u['id'];
    } catch (Throwable $_) { /* swallow */ }

    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
    $st = $pdo->prepare("INSERT INTO activity_log
        (user_id, method, path, status, duration_ms, ip, user_agent)
        VALUES (?,?,?,?,?,?,?)");
    $st->execute([$userId, $method, mb_substr($path, 0, 255), $status, $durationMs, $ip, $ua ?: null]);
}

// ---------------- Notification helpers ----------------
// Wrapper around Notifier::notify that catches any exception. Use this when a
// notification is a "nice-to-have" — never let an email/template failure tank
// the underlying ledger transaction the caller just committed.
function notify_safely(PDO $pdo, array $cfg, int $userId, string $type,
                       string $body, ?string $refType = null, ?int $refId = null): void {
    try { Notifier::notify($pdo, $cfg, $userId, $type, $body, $refType, $refId); }
    catch (Throwable $e) { /* swallow on purpose */ }
}

// 全 admin に同じ通知をブロードキャスト。バグ報告等の「誰でもいいから admin に
// 届かせたい」用途。1 通でも届けば運用回るので 1 人ずつ swallow しながら
// 進む (notify_safely と同じスタンス)。
function notify_admins(PDO $pdo, array $cfg, string $type, string $body,
                       ?string $refType = null, ?int $refId = null): void {
    foreach ($pdo->query("SELECT id FROM users WHERE kind='human' AND role='admin'") as $r) {
        notify_safely($pdo, $cfg, (int)$r['id'], $type, $body, $refType, $refId);
    }
}

// ---------------- Slack notifications (incoming webhook) ----------------
// Fire-and-forget POST to Slack. Silently no-ops when slack.webhook_url is empty,
// and swallows all errors — Slack being down must never break a listing/scan/etc.
// v456 link 引数 を 追加。 渡すと 本文末尾に LabPay の 該当 URL を 追記する
// (Slack 上 で 「どこ に 行けば 良い か」 が 一目で 分かる ように)。
//   $link は フラグメント (例: "#/feedback-admin") か、 もしくは 完全URL。
function slack_notify(array $cfg, string $text, ?array $blocks = null, ?string $link = null): void {
    $url = (string)($cfg['slack']['webhook_url'] ?? '');
    if ($url === '') return;
    if ($link !== null && $link !== '') {
        $fullUrl = $link;
        if (strpos($link, 'http') !== 0) {
            $base = rtrim((string)($cfg['app']['base_url'] ?? 'https://pay.nkmr.io'), '/');
            $fullUrl = $base . '/' . ltrim($link, '/');
        }
        $text = $text . "\n→ " . $fullUrl;
    }
    $payload = ['text' => $text];
    if ($blocks !== null) $payload['blocks'] = $blocks;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

// ---------------- Path helpers ----------------
function path_segments(string $path): array {
    $p = trim($path, '/');
    if ($p === '') return [];
    return explode('/', $p);
}

// ---------------- Load handlers ----------------
require_once __DIR__ . '/handlers/auth.php';
require_once __DIR__ . '/handlers/me.php';
require_once __DIR__ . '/handlers/products.php';
require_once __DIR__ . '/handlers/listings.php';
require_once __DIR__ . '/handlers/purchases.php';
require_once __DIR__ . '/handlers/checkins.php';
require_once __DIR__ . '/handlers/sellers.php';
require_once __DIR__ . '/handlers/notifications.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/presence.php';
require_once __DIR__ . '/handlers/uploads.php';
require_once __DIR__ . '/handlers/tasks.php';
require_once __DIR__ . '/handlers/transfers.php';
require_once __DIR__ . '/handlers/network.php';
require_once __DIR__ . '/handlers/feedback.php';
require_once __DIR__ . '/handlers/wishlist.php';
require_once __DIR__ . '/handlers/invitations.php';
require_once __DIR__ . '/handlers/roulettes.php';
require_once __DIR__ . '/handlers/nomikai.php';
require_once __DIR__ . '/handlers/adhoc_groups.php';
require_once __DIR__ . '/handlers/scrapbox_feed.php';
require_once __DIR__ . '/handlers/cosense.php';
require_once __DIR__ . '/handlers/fx.php';
require_once __DIR__ . '/handlers/random_groups.php';
require_once __DIR__ . '/handlers/orderings.php';
require_once __DIR__ . '/handlers/regions.php';
require_once __DIR__ . '/handlers/health.php';
require_once __DIR__ . '/handlers/workouts.php';
require_once __DIR__ . '/handlers/walk.php';
require_once __DIR__ . '/handlers/shiritori.php';
require_once __DIR__ . '/handlers/tierlists.php';
require_once __DIR__ . '/MahjongEngine.php';
require_once __DIR__ . '/GameLobby.php';
require_once __DIR__ . '/handlers/mahjong.php';
require_once __DIR__ . '/handlers/ito.php';
require_once __DIR__ . '/handlers/jinrou.php';
require_once __DIR__ . '/handlers/money_requests.php';
require_once __DIR__ . '/handlers/bait.php';
require_once __DIR__ . '/handlers/custom_widgets.php';
require_once __DIR__ . '/handlers/cg2.php';
require_once __DIR__ . '/handlers/chat.php';
require_once __DIR__ . '/handlers/conf_deadlines.php';
require_once __DIR__ . '/handlers/polls.php';
require_once __DIR__ . '/handlers/rollcalls.php';
require_once __DIR__ . '/handlers/timers.php';
require_once __DIR__ . '/handlers/notices.php';
require_once __DIR__ . '/handlers/meetups.php';
require_once __DIR__ . '/handlers/places.php';
require_once __DIR__ . '/handlers/posts.php';
require_once __DIR__ . '/handlers/todos.php';
require_once __DIR__ . '/handlers/sounds.php';
require_once __DIR__ . '/handlers/auctions.php';
require_once __DIR__ . '/handlers/exercise.php';
require_once __DIR__ . '/handlers/playlists.php';
require_once __DIR__ . '/handlers/stopwatches.php';
require_once __DIR__ . '/handlers/ai.php';
require_once __DIR__ . '/handlers/predictions.php';
require_once __DIR__ . '/handlers/fortune.php';
require_once __DIR__ . '/handlers/othello.php';
require_once __DIR__ . '/handlers/bingo.php';
require_once __DIR__ . '/handlers/bingofit.php';
require_once __DIR__ . '/handlers/daifugo.php';
require_once __DIR__ . '/handlers/score_predictions.php';
require_once __DIR__ . '/handlers/custom_games.php';
require_once __DIR__ . '/handlers/drafts.php';
require_once __DIR__ . '/handlers/quizzes.php';
require_once __DIR__ . '/handlers/quotes.php';   // v804 名言
require_once __DIR__ . '/handlers/news.php';
require_once __DIR__ . '/handlers/screen_shares.php';
require_once __DIR__ . '/handlers/file_transfers.php';
require_once __DIR__ . '/handlers/zemi_videos.php';  // v843 #426 ゼミ動画
require_once __DIR__ . '/handlers/share.php';        // v853 共有 (タイトル+URL をメンバーに送信)
