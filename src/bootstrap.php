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
require_once __DIR__ . '/Achievements.php';

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
