<?php
// /api/sounds — 効果音の管理 (admin) + 各自のオーバーライド (user)。
// Routes:
//   GET    /api/sounds/clips                  全 clip 一覧 (誰でも)
//   POST   /api/sounds/clips                  upload clip (admin)
//   DELETE /api/sounds/clips/:id              clip 削除 (admin)
//   GET    /api/sounds/defaults               event 規定値一覧 (誰でも、 既知 event を返す)
//   PATCH  /api/sounds/defaults/:event_key    規定値変更 (admin)
//   GET    /api/sounds/my                     自分のオーバーライド + 解決済 (再生に必要な情報)
//   PATCH  /api/sounds/my/:event_key          オーバーライド設定

declare(strict_types=1);

// 既知イベント。 追加するときはここに 1 行 + sound_event_defaults INSERT IGNORE で済む。
const SOUND_EVENTS = [
    'payment'       => ['label' => '決済 (送金 / 購入成功時)'],
    'roulette_spin' => ['label' => 'ルーレット回転開始時'],
];
const SOUND_UPLOAD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB / clip
const SOUND_UPLOAD_MIMES = [
    'audio/mpeg'  => 'mp3',
    'audio/mp3'   => 'mp3',
    'audio/ogg'   => 'ogg',
    'audio/wav'   => 'wav',
    'audio/x-wav' => 'wav',
    'audio/wave'  => 'wav',
    'audio/webm'  => 'webm',
    'audio/mp4'   => 'm4a',
    'audio/aac'   => 'aac',
];

function route_sounds(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    $arg = $seg[2] ?? '';
    if ($sub === 'clips') {
        if ($arg === '' && $method === 'GET')  { sounds_clips_list($pdo, $cfg); return; }
        if ($arg === '' && $method === 'POST') { sounds_clips_upload($pdo, $cfg); return; }
        if (ctype_digit((string)$arg) && $method === 'DELETE') { sounds_clip_delete($pdo, $cfg, (int)$arg); return; }
    }
    if ($sub === 'defaults') {
        if ($arg === '' && $method === 'GET')  { sounds_defaults_list($pdo, $cfg); return; }
        if ($arg !== '' && $method === 'PATCH') { sounds_default_patch($pdo, $cfg, $arg); return; }
    }
    if ($sub === 'my') {
        if ($arg === '' && $method === 'GET')   { sounds_my_get($pdo, $cfg); return; }
        if ($arg !== '' && $method === 'PATCH') { sounds_my_patch($pdo, $cfg, $arg); return; }
    }
    json_error('not_found', "no sounds route for $method $sub/$arg", 404);
}

// ── helpers ─────────────────────────────────────────────────────
function sounds_require_admin(PDO $pdo, array $cfg): array {
    $u = Auth::requireUser($pdo, $cfg);
    if ((string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', 'admin のみ', 403);
    }
    return $u;
}

function sounds_assert_event(string $key): void {
    if (!array_key_exists($key, SOUND_EVENTS)) {
        throw new ApiException('bad_request', "unknown event: {$key}", 400);
    }
}

// ── clips ───────────────────────────────────────────────────────
function sounds_clips_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT id, slug, label, file_url, mime, file_size,
                              uploaded_by_user_id, created_at
                         FROM sound_clips ORDER BY created_at DESC, id DESC");
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function sounds_clips_upload(PDO $pdo, array $cfg): void {
    $u = sounds_require_admin($pdo, $cfg);
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        throw new ApiException('no_file', 'multipart field "file" 必須', 400);
    }
    $label = trim((string)($_POST['label'] ?? ''));
    if ($label === '') $label = '無題の音';
    if (mb_strlen($label) > 120) $label = mb_substr($label, 0, 120);
    $slug = trim((string)($_POST['slug'] ?? ''));
    if ($slug === '' || !preg_match('/^[a-z0-9_-]{1,64}$/', $slug)) {
        $slug = bin2hex(random_bytes(6));
    }
    $st = $pdo->prepare("SELECT 1 FROM sound_clips WHERE slug = ?");
    $st->execute([$slug]);
    if ($st->fetchColumn()) {
        $slug .= '-' . bin2hex(random_bytes(3));
    }
    $saved = save_uploaded_file($_FILES['file'], 'uploads/sounds',
        SOUND_UPLOAD_MAX_BYTES, SOUND_UPLOAD_MIMES);
    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    $fileUrl = $baseUrl !== '' ? ($baseUrl . $saved['path']) : $saved['path'];
    $ins = $pdo->prepare("INSERT INTO sound_clips
        (slug, label, file_url, mime, file_size, uploaded_by_user_id, created_at)
        VALUES (?,?,?,?,?,?, NOW())");
    $ins->execute([$slug, $label, $fileUrl, $saved['mime'], $saved['size'], (int)$u['id']]);
    json_response(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug, 'file_url' => $fileUrl]);
}

function sounds_clip_delete(PDO $pdo, array $cfg, int $id): void {
    sounds_require_admin($pdo, $cfg);
    $st = $pdo->prepare("SELECT file_url FROM sound_clips WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'clip 無し', 404);
    // ファイル本体も削除 (URL からパスを推定。 public/ 配下のみ)。
    $url = (string)$row['file_url'];
    if (preg_match('#/uploads/sounds/([A-Za-z0-9_.-]+)$#', $url, $m)) {
        $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
        $path = $publicDir . '/uploads/sounds/' . $m[1];
        if (is_file($path)) @unlink($path);
    }
    $pdo->prepare("DELETE FROM sound_clips WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// ── defaults (admin) ────────────────────────────────────────────
function sounds_defaults_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $rows = [];
    $st = $pdo->query("SELECT event_key, clip_id, volume FROM sound_event_defaults");
    $byKey = [];
    foreach ($st as $r) $byKey[(string)$r['event_key']] = $r;
    foreach (SOUND_EVENTS as $key => $meta) {
        $r = $byKey[$key] ?? null;
        $rows[] = [
            'event_key' => $key,
            'label'     => $meta['label'],
            'clip_id'   => $r ? (int)$r['clip_id'] ?: null : null,
            'volume'    => $r ? (int)$r['volume'] : 70,
        ];
    }
    json_response(['items' => $rows]);
}

function sounds_default_patch(PDO $pdo, array $cfg, string $key): void {
    sounds_require_admin($pdo, $cfg);
    sounds_assert_event($key);
    $body = read_json_body();
    $clipIdRaw = $body['clip_id'] ?? null;
    $clipId = ($clipIdRaw === null || $clipIdRaw === '' || (int)$clipIdRaw === 0) ? null : (int)$clipIdRaw;
    $volume = isset($body['volume']) ? max(0, min(100, (int)$body['volume'])) : 70;
    if ($clipId !== null) {
        $st = $pdo->prepare("SELECT 1 FROM sound_clips WHERE id = ?");
        $st->execute([$clipId]);
        if (!$st->fetchColumn()) throw new ApiException('bad_request', 'clip_id 存在せず', 400);
    }
    $st = $pdo->prepare("INSERT INTO sound_event_defaults (event_key, clip_id, volume)
                         VALUES (?, ?, ?)
                         ON DUPLICATE KEY UPDATE clip_id = VALUES(clip_id), volume = VALUES(volume)");
    $st->execute([$key, $clipId, $volume]);
    json_response(['ok' => true]);
}

// ── user prefs ──────────────────────────────────────────────────
// 各イベントについて解決された (resolve された) 値を返す。
//   resolved = mode === 'mute' ? muted
//           : mode === 'custom' ? (custom clip + volume)
//           : (admin の default clip + volume)
// clip URL も同時に返すのでフロントは fetch 1 回で再生できる。
function sounds_my_get(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $defs = [];
    $st = $pdo->query("SELECT event_key, clip_id, volume FROM sound_event_defaults");
    foreach ($st as $r) $defs[(string)$r['event_key']] = $r;
    $prefs = [];
    $st = $pdo->prepare("SELECT event_key, mode, clip_id, volume FROM sound_user_prefs WHERE user_id = ?");
    $st->execute([$uid]);
    foreach ($st as $r) $prefs[(string)$r['event_key']] = $r;
    // clip 情報を一気に拾う。
    $clipIds = [];
    foreach ($defs  as $r) if (!empty($r['clip_id'])) $clipIds[(int)$r['clip_id']] = true;
    foreach ($prefs as $r) if (!empty($r['clip_id'])) $clipIds[(int)$r['clip_id']] = true;
    $clips = [];
    if ($clipIds) {
        $in = implode(',', array_fill(0, count($clipIds), '?'));
        $st = $pdo->prepare("SELECT id, slug, label, file_url FROM sound_clips WHERE id IN ($in)");
        $st->execute(array_keys($clipIds));
        foreach ($st as $r) $clips[(int)$r['id']] = $r;
    }
    $rows = [];
    foreach (SOUND_EVENTS as $key => $meta) {
        $def = $defs[$key]  ?? null;
        $pr  = $prefs[$key] ?? null;
        $mode = $pr['mode'] ?? 'default';
        $resolvedClip = null; $resolvedVol = 70;
        if ($mode === 'mute') {
            // 無音
        } elseif ($mode === 'custom' && !empty($pr['clip_id'])) {
            $resolvedClip = $clips[(int)$pr['clip_id']] ?? null;
            $resolvedVol = isset($pr['volume']) && $pr['volume'] !== null ? (int)$pr['volume'] : 70;
        } else {
            // default モード (もしくは custom 指定なのに clip 欠落) → admin の規定。
            if ($def && !empty($def['clip_id'])) {
                $resolvedClip = $clips[(int)$def['clip_id']] ?? null;
            }
            $resolvedVol = $def ? (int)$def['volume'] : 70;
        }
        $rows[] = [
            'event_key' => $key,
            'label'     => $meta['label'],
            'mode'      => $mode,
            'pref_clip_id'  => $pr ? (int)$pr['clip_id'] ?: null : null,
            'pref_volume'   => $pr && $pr['volume'] !== null ? (int)$pr['volume'] : null,
            'default_clip_id' => $def ? (int)$def['clip_id'] ?: null : null,
            'default_volume'  => $def ? (int)$def['volume'] : 70,
            'resolved' => $resolvedClip ? [
                'file_url' => (string)$resolvedClip['file_url'],
                'label'    => (string)$resolvedClip['label'],
                'volume'   => $resolvedVol,
            ] : null,
        ];
    }
    json_response(['items' => $rows]);
}

function sounds_my_patch(PDO $pdo, array $cfg, string $key): void {
    $u = Auth::requireUser($pdo, $cfg);
    sounds_assert_event($key);
    $body = read_json_body();
    $mode = (string)($body['mode'] ?? 'default');
    if (!in_array($mode, ['default','custom','mute'], true)) {
        throw new ApiException('bad_request', 'mode は default/custom/mute', 400);
    }
    $clipId = null;
    $volume = null;
    if ($mode === 'custom') {
        $clipId = isset($body['clip_id']) ? (int)$body['clip_id'] : 0;
        if ($clipId <= 0) throw new ApiException('bad_request', 'custom には clip_id 必須', 400);
        $st = $pdo->prepare("SELECT 1 FROM sound_clips WHERE id = ?");
        $st->execute([$clipId]);
        if (!$st->fetchColumn()) throw new ApiException('bad_request', 'clip_id 存在せず', 400);
        if (isset($body['volume'])) $volume = max(0, min(100, (int)$body['volume']));
    }
    $st = $pdo->prepare("INSERT INTO sound_user_prefs (user_id, event_key, mode, clip_id, volume)
                         VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE mode=VALUES(mode), clip_id=VALUES(clip_id), volume=VALUES(volume)");
    $st->execute([(int)$u['id'], $key, $mode, $clipId, $volume]);
    json_response(['ok' => true]);
}
