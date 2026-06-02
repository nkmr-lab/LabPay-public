<?php
// /api/presence — in-lab presence detection via per-room WiFi scanner.
//
// Routes:
//   GET    /api/presence                  list current presence per room (auth: user)
//   GET    /api/presence/devices          list own registered devices (auth: user)
//   POST   /api/presence/devices          add device {mac, label?} (auth: user)
//   DELETE /api/presence/devices/{id}     remove (auth: user)
//   POST   /api/presence/scan             scanner upload (auth: Bearer scanner_token)

declare(strict_types=1);

function route_presence(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET')               { presence_list($pdo, $cfg); return; }
    if ($sub === 'devices' && $method === 'GET')        { presence_devices_list($pdo, $cfg); return; }
    if ($sub === 'devices' && $method === 'POST')       { presence_devices_add($pdo, $cfg); return; }
    if ($sub === 'devices' && isset($seg[2]) && $method === 'DELETE') {
        presence_devices_delete($pdo, $cfg, (int)$seg[2]); return;
    }
    if ($sub === 'unregistered_macs' && $method === 'GET') {
        presence_unregistered_macs($pdo, $cfg); return;
    }
    if ($sub === 'scan' && $method === 'POST')          { presence_scan($pdo, $cfg); return; }
    if ($sub === 'heatmap' && $method === 'GET')        { presence_heatmap($pdo, $cfg); return; }

    json_error('not_found', "no presence route for $method $sub", 404);
}

// GET /api/presence/heatmap?days=7
// Returns, for each room, a 7x24 matrix of "average distinct users present in
// that (weekday, hour) bucket" over the requested past window. Buckets collapse
// dates with the same weekday so the more days of history we accumulate, the
// finer the weekly pattern becomes.
//
// Methodology: each closed presence_session contributes 1 to every (weekday, hour)
// bucket it overlaps; then we divide by how many distinct calendar dates we observed
// for that weekday in the window. Multiple overlapping sessions from the same user
// in the same hour collapse to 1 (set semantics).
function presence_heatmap(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $days = max(1, min(365, (int)($_GET['days'] ?? 7)));
    $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
    $end   = new DateTimeImmutable('tomorrow midnight', $tz); // exclusive upper bound
    $start = $end->modify("-{$days} days");

    // Rooms (so the response keeps empty rooms in the result, easier UI)
    $rooms = $pdo->query("SELECT id, display_name FROM rooms ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);

    // Combine two data sources so morning/late-night activity isn't lost:
    //   1) presence_sessions — CLOSED sessions (recorded when someone "leaves")
    //   2) presence_seen     — currently-open sessions (latest observation still fresh)
    // Without merging (2), anyone sitting in the lab right now would be missing
    // from today's heatmap because their session row only gets written when their
    // phone stops being observed (the "close" event).
    $stmt = $pdo->prepare("
        SELECT user_id, room_id, started_at, ended_at FROM presence_sessions
         WHERE user_id IS NOT NULL AND started_at < ? AND ended_at > ?
        UNION ALL
        SELECT pd.user_id, ps.room_id,
               ps.session_start_at AS started_at,
               ps.last_seen_at AS ended_at
          FROM presence_seen ps
          JOIN presence_devices pd ON pd.mac = ps.mac
         WHERE ps.session_start_at IS NOT NULL
           AND ps.session_start_at < ?
           AND ps.last_seen_at > ?");
    $endStr   = $end->format('Y-m-d H:i:s');
    $startStr = $start->format('Y-m-d H:i:s');
    $stmt->execute([$endStr, $startStr, $endStr, $startStr]);

    // bucket[room][weekday(0=Sun..6=Sat)][hour(0..23)] = set of user_ids
    // PHP 0=Sun..6=Sat (date('w')); UI converts to Mon-first labels.
    $bucket = [];
    foreach ($rooms as $r) {
        $bucket[$r['id']] = array_fill(0, 7, array_fill(0, 24, []));
    }
    $startTs = $start->getTimestamp();
    $endTs   = $end->getTimestamp();
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
        $room = $s['room_id'];
        if (!isset($bucket[$room])) continue;
        $a = max(strtotime($s['started_at']), $startTs);
        $b = min(strtotime($s['ended_at']),   $endTs);
        if ($b <= $a) continue;
        // Walk hour boundaries inside [a, b)
        $h = $a - ($a % 3600);
        while ($h < $b) {
            $w = (int)date('w', $h);
            $hr = (int)date('G', $h);
            $bucket[$room][$w][$hr][(int)$s['user_id']] = true;
            $h += 3600;
        }
    }

    // Count distinct calendar dates per weekday in the window (the denominator
    // for averaging — one Monday in a 7-day window contributes once, three
    // Mondays in a 21-day window contribute thrice).
    $daysOfWeek = array_fill(0, 7, 0);
    for ($t = $startTs; $t < $endTs; $t += 86400) {
        $daysOfWeek[(int)date('w', $t)]++;
    }

    // Convert sets to averages.
    $out = [];
    foreach ($bucket as $room => $weekdays) {
        $matrix = [];
        foreach ($weekdays as $w => $hours) {
            $row = [];
            foreach ($hours as $hr => $set) {
                $denom = max(1, $daysOfWeek[$w]);
                $row[$hr] = round(count($set) / $denom, 2);
            }
            $matrix[$w] = $row;
        }
        $out[$room] = $matrix;
    }

    json_response([
        'days'        => $days,
        'range_from'  => $start->format('Y-m-d H:i:s'),
        'range_to'    => $end->format('Y-m-d H:i:s'),
        'days_of_week' => $daysOfWeek, // [Sun..Sat] count of dates sampled
        'rooms'       => array_map(fn($r) => [
            'id' => $r['id'], 'display_name' => $r['display_name'],
            'matrix' => $out[$r['id']] ?? array_fill(0, 7, array_fill(0, 24, 0)),
        ], $rooms),
    ]);
}

// Normalize a MAC string to canonical lowercase aa:bb:cc:dd:ee:ff.
// Returns null when input is invalid.
function presence_normalize_mac(?string $mac): ?string {
    if ($mac === null) return null;
    $s = strtolower(preg_replace('/[^0-9a-fA-F]/', '', $mac));
    if (strlen($s) !== 12) return null;
    return implode(':', str_split($s, 2));
}

function presence_is_excluded_mac(string $mac): bool {
    // All-zeros, broadcast, IPv4/IPv6 multicast prefixes
    if ($mac === '00:00:00:00:00:00' || $mac === 'ff:ff:ff:ff:ff:ff') return true;
    if (str_starts_with($mac, '01:00:5e')) return true;
    if (str_starts_with($mac, '33:33:'))   return true;
    return false;
}

// Tiny OUI lookup: a few well-known prefixes that appear on lab WiFi. Extend as needed.
const PRESENCE_KNOWN_OUI = [
    '60:cf:84' => ['Buffalo',  'ルータ?'],
    '00:11:32' => ['Synology', 'NAS'],
    '00:24:8c' => ['ASUSTek',  ''],
    '94:65:9c' => ['Brother',  'プリンタ?'],
    '00:80:77' => ['Brother',  'プリンタ?'],
    '00:1b:78' => ['Canon',    'プリンタ?'],
    '00:00:48' => ['Seiko Epson', 'プリンタ?'],
    'bc:89:a6' => ['HP',       ''],
    '3c:5a:b4' => ['Google',   ''],
    'd0:e7:82' => ['Apple',    ''],
    'a4:97:b1' => ['Qualcomm Atheros', 'PC?'],
];

// Returns a short human-readable hint: "📱 スマホ?", "🖨 プリンタ?", "💻 PC?" etc.
// Falls back to '' when nothing useful is known. Pure heuristic — UX hint, not authoritative.
function presence_mac_hint(string $mac): string {
    $first = (int)hexdec(substr($mac, 0, 2));
    // 2nd-LSB of the first byte = "locally administered" — modern iOS/Android per-SSID random MAC
    $isRandom = ($first & 0x02) !== 0;
    if ($isRandom) return '📱 スマホ?';

    $oui = substr($mac, 0, 8); // "xx:xx:xx"
    if (isset(PRESENCE_KNOWN_OUI[$oui])) {
        [$vendor, $note] = PRESENCE_KNOWN_OUI[$oui];
        $icon = $note === 'プリンタ?' ? '🖨' : ($note === 'ルータ?' ? '🌐' : '💻');
        return trim("$icon $vendor" . ($note ? " ($note)" : ''));
    }
    return '💻 デバイス';
}

// Append one row per observation to var/log/presence/YYYY-MM-DD.csv.
// Columns: timestamp, room_id, mac, ip, user_id, user_display_name. Empty for unregistered.
// File-locked; safe under concurrent scanners.
function presence_append_csv_log(PDO $pdo, string $now, string $roomId, array $obs, array $candidateMacs): void {
    if (!$obs) return;
    // Resolve MAC -> {user_id, display_name} for registered macs in this scan.
    $macInfo = [];
    if ($candidateMacs) {
        $place = implode(',', array_fill(0, count($candidateMacs), '?'));
        $st = $pdo->prepare("SELECT pd.mac, u.id, u.display_name
            FROM presence_devices pd JOIN users u ON u.id = pd.user_id
            WHERE pd.mac IN ($place)");
        $st->execute($candidateMacs);
        foreach ($st->fetchAll() as $r) {
            $macInfo[$r['mac']] = ['id' => (int)$r['id'], 'name' => $r['display_name']];
        }
    }

    $logDir = realpath(__DIR__ . '/../../var/log/presence');
    if (!$logDir) {
        $logDir = __DIR__ . '/../../var/log/presence';
        if (!is_dir($logDir)) @mkdir($logDir, 0750, true);
        $logDir = realpath($logDir) ?: $logDir;
    }
    $day = substr($now, 0, 10);
    $path = $logDir . '/' . $day . '.csv';

    $fh = @fopen($path, 'ab');
    if (!$fh) return;
    if (flock($fh, LOCK_EX)) {
        if (ftell($fh) === 0) {
            fputcsv($fh, ['timestamp', 'room_id', 'mac', 'ip', 'user_id', 'user_display_name']);
        }
        foreach ($obs as $o) {
            $mac = presence_normalize_mac($o['mac'] ?? null);
            if ($mac === null || presence_is_excluded_mac($mac)) continue;
            $ip = isset($o['ip']) ? (string)$o['ip'] : '';
            $u  = $macInfo[$mac] ?? null;
            fputcsv($fh, [$now, $roomId, $mac, $ip, $u['id'] ?? '', $u['name'] ?? '']);
        }
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
}

// ---------------- GET /api/presence ----------------
// A user is rendered in *at most one* room: the room where their device was most
// recently observed. When two rooms scan the same /24 (or signal leaks between
// floors), the older sighting silently loses. Window: presence_window_minutes.
function presence_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $window = (int)cfg_get($pdo, 'presence_window_minutes', '5');
    if ($window < 1) $window = 5;

    $rooms = $pdo->query('SELECT id, display_name, last_scan_at FROM rooms ORDER BY id')->fetchAll();

    // For every (user, room) pair within the window, compute the latest sighting and the
    // earliest session_start_at across the user's devices in that room (so a user with
    // multiple registered MACs gets the earliest one — they've been there at least that long).
    // session_start_at は migration 015 以前の行で NULL のことがある。
    // first_seen_at も NULL なら最終手段として last_seen_at で代用
    // (= 「ちょうど来たばかり」扱い、0分相当)。これでどう転んでも「-」
    // にはならない。
    // ※ WHERE は「直近 ${window} 分以内に検知された行」だけに絞ってから
    //   GROUP BY するので、別 room の古い NULL 行が紛れ込まないように
    //   先に session_start_at を埋めてから MIN を取る。
    $st = $pdo->prepare("
        SELECT u.id AS user_id, u.display_name, u.avatar_url,
               ps.room_id,
               MAX(ps.last_seen_at) AS last_seen_at,
               MIN(COALESCE(ps.session_start_at, ps.first_seen_at, ps.last_seen_at)) AS session_start_at
          FROM presence_seen ps
          JOIN presence_devices pd ON pd.mac = ps.mac
          JOIN users u ON u.id = pd.user_id AND u.kind = 'human'
         WHERE ps.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
         GROUP BY u.id, u.display_name, u.avatar_url, ps.room_id
    ");
    $st->execute([$window]);
    $rows = $st->fetchAll();

    // Reduce: for each user keep only the row with the latest last_seen_at.
    $bestPerUser = [];
    foreach ($rows as $r) {
        $uid = (int)$r['user_id'];
        if (!isset($bestPerUser[$uid]) || $r['last_seen_at'] > $bestPerUser[$uid]['last_seen_at']) {
            $bestPerUser[$uid] = $r;
        }
    }

    // Bucket users back into their winning room.
    $usersByRoom = [];
    foreach ($bestPerUser as $r) {
        $usersByRoom[$r['room_id']][] = [
            'id'               => (int)$r['user_id'],
            'display_name'     => $r['display_name'],
            'avatar_url'       => $r['avatar_url'] ?? null,
            'last_seen_at'     => $r['last_seen_at'],
            'session_start_at' => $r['session_start_at'],
        ];
    }
    foreach ($usersByRoom as &$list) {
        usort($list, fn($a, $b) => strcmp($b['last_seen_at'], $a['last_seen_at']));
    }

    $out = [];
    foreach ($rooms as $r) {
        $out[] = [
            'id'           => $r['id'],
            'display_name' => $r['display_name'],
            'last_scan_at' => $r['last_scan_at'],
            'users'        => $usersByRoom[$r['id']] ?? [],
        ];
    }
    json_response(['rooms' => $out, 'window_minutes' => $window]);
}

// ---------------- GET /api/presence/devices ----------------
function presence_devices_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare('SELECT id, mac, label, created_at FROM presence_devices WHERE user_id=? ORDER BY id');
    $st->execute([$u['id']]);
    json_response(['items' => $st->fetchAll()]);
}

// ---------------- POST /api/presence/devices ----------------
function presence_devices_add(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $rawMac = (string)require_field($body, 'mac');
    $mac = presence_normalize_mac($rawMac);
    if ($mac === null) throw new ApiException('bad_request', 'invalid MAC address', 400);
    if (presence_is_excluded_mac($mac))
        throw new ApiException('bad_request', 'broadcast/multicast MACs not allowed', 400);

    $label = isset($body['label']) ? mb_substr((string)$body['label'], 0, 100) : null;

    // Block hijack: another user already owns this MAC
    $chk = $pdo->prepare('SELECT user_id FROM presence_devices WHERE mac=?');
    $chk->execute([$mac]);
    $owner = $chk->fetchColumn();
    if ($owner !== false && (int)$owner !== (int)$u['id']) {
        throw new ApiException('mac_taken', 'this MAC is already registered to another user', 409);
    }

    $ins = $pdo->prepare('INSERT INTO presence_devices (user_id, mac, label) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE label=VALUES(label)');
    $ins->execute([$u['id'], $mac, $label]);

    $get = $pdo->prepare('SELECT id, mac, label, created_at FROM presence_devices WHERE user_id=? AND mac=?');
    $get->execute([$u['id'], $mac]);
    json_response($get->fetch(), 200);
}

// ---------------- DELETE /api/presence/devices/{id} ----------------
function presence_devices_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare('DELETE FROM presence_devices WHERE id=? AND user_id=?');
    $st->execute([$id, $u['id']]);
    json_response(['ok' => true, 'deleted' => $st->rowCount()]);
}

// ---------------- GET /api/presence/unregistered_macs ----------------
// For "auto MAC detection" UX in settings: list MACs seen recently in any room
// that are not yet linked to a user. Caller picks theirs from the (typically short) list.
//
// Earlier we tried matching the caller's REMOTE_ADDR against the scanner-observed IP,
// but the LabPay server lives off the lab network and the request is NAT'd, so the
// server only sees the campus public egress, never the phone's LAN IP. The
// "WiFi off then on, hit reload" workflow + first_seen_at sorting is what we have.
function presence_unregistered_macs(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $window = (int)cfg_get($pdo, 'presence_window_minutes', '5');
    if ($window < 1) $window = 5;
    $st = $pdo->prepare("
        SELECT ps.room_id, COALESCE(r.display_name, ps.room_id) AS room_name,
               ps.mac, ps.ip, ps.last_seen_at, ps.first_seen_at
          FROM presence_seen ps
          LEFT JOIN rooms r ON r.id = ps.room_id
         WHERE ps.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
           AND NOT EXISTS (SELECT 1 FROM presence_devices pd WHERE pd.mac = ps.mac)
           AND NOT EXISTS (SELECT 1 FROM presence_infrastructure pi WHERE pi.mac = ps.mac)
         ORDER BY ps.first_seen_at DESC, ps.last_seen_at DESC
         LIMIT 100
    ");
    $st->execute([$window]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['hint'] = presence_mac_hint((string)$r['mac']);
    }
    json_response(['items' => $rows, 'window_minutes' => $window]);
}

// ---------------- POST /api/presence/scan (scanner token) ----------------
function presence_scan(PDO $pdo, array $cfg): void {
    // Bearer token auth (no user session). Apache may surface the header under
    // either of these names depending on rewrite/SAPI; check both.
    $auth = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (!preg_match('/^Bearer\s+([A-Za-z0-9+\/=._\-]+)$/', $auth, $m)) {
        throw new ApiException('unauthorized', 'missing Bearer token', 401);
    }
    $token = $m[1];
    $tokenHash = hash('sha256', $token);

    $body = read_json_body();
    $roomId = (string)require_field($body, 'room_id');
    $obs = $body['observations'] ?? null;
    if (!is_array($obs)) throw new ApiException('bad_request', 'observations must be an array', 400);

    // Validate token against the named room
    $st = $pdo->prepare('SELECT scanner_token_hash FROM rooms WHERE id=?');
    $st->execute([$roomId]);
    $row = $st->fetch();
    if (!$row) throw new ApiException('unknown_room', "room $roomId not registered", 404);
    if (!hash_equals((string)$row['scanner_token_hash'], $tokenHash)) {
        throw new ApiException('unauthorized', 'bad scanner token', 401);
    }

    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    $accepted = 0;
    $skipped  = 0;

    // A "fresh entry" = gap >= threshold minutes since the (room, mac) was last observed
    // (or the row didn't exist). We use this both to start a new session and to gate
    // streak auto-checkin: leaving a phone in the lab overnight no longer counts as
    // "you showed up today" — you have to step out and come back.
    $threshold = (int)cfg_get($pdo, 'presence_reentry_threshold_minutes', '10');
    if ($threshold < 1) $threshold = 10;

    // first_seen_at is set only on initial INSERT; the ON DUPLICATE branch never touches it.
    // session_start_at is initialized on INSERT and only refreshed when the PREVIOUS
    // last_seen_at is older than $threshold minutes.
    //
    // CRITICAL: MySQL evaluates ON DUPLICATE KEY UPDATE assignments left-to-right and
    // later expressions see the already-updated values. We must compute session_start_at
    // BEFORE updating last_seen_at so the IF() sees the OLD last_seen_at; otherwise
    // the comparison reduces to NOW < NOW - 10min and never fires.
    $upsert = $pdo->prepare("INSERT INTO presence_seen
            (room_id, mac, ip, last_seen_at, first_seen_at, session_start_at)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
            session_start_at = IF(
                session_start_at IS NULL
                OR last_seen_at < DATE_SUB(VALUES(last_seen_at), INTERVAL ? MINUTE),
                VALUES(last_seen_at),
                session_start_at
            ),
            last_seen_at = VALUES(last_seen_at),
            ip = VALUES(ip)");

    // For each (room, mac) observed this scan, decide if it's a fresh entry. We collect
    // the macs (keyed) so we can later map back to registered users for auto-checkin.
    $freshMacs = []; // mac => true when this scan opens a new session

    $registeredUserIds = []; // user ids whose registered MAC was seen this scan
    $freshRegisteredUserIds = []; // user ids whose MAC just had a fresh entry
    $pdo->beginTransaction();
    try {
        // Look up the existing last_seen_at + session_start_at for each candidate mac
        // in this room so we can decide freshness AND log the closed session before
        // overwriting it.
        $candidateMacs = array_values(array_unique(array_filter(array_map(
            fn($o) => presence_normalize_mac($o['mac'] ?? null), $obs))));
        $prevSeen = [];
        if ($candidateMacs) {
            $place = implode(',', array_fill(0, count($candidateMacs), '?'));
            $params = array_merge([$roomId], $candidateMacs);
            $stPrev = $pdo->prepare("SELECT mac, last_seen_at, session_start_at FROM presence_seen
                WHERE room_id = ? AND mac IN ($place)");
            $stPrev->execute($params);
            foreach ($stPrev->fetchAll() as $r) {
                $prevSeen[$r['mac']] = [
                    'last'  => $r['last_seen_at'],
                    'start' => $r['session_start_at'],
                ];
            }
        }

        // Resolve macs -> registered user_id (for the session log + auto-checkin gate).
        $macToUser = [];
        if ($candidateMacs) {
            $place = implode(',', array_fill(0, count($candidateMacs), '?'));
            $stU = $pdo->prepare("SELECT mac, user_id FROM presence_devices WHERE mac IN ($place)");
            $stU->execute($candidateMacs);
            foreach ($stU->fetchAll() as $r) { $macToUser[$r['mac']] = (int)$r['user_id']; }
        }

        $sessionsToLog = [];
        foreach ($obs as $o) {
            $mac = presence_normalize_mac($o['mac'] ?? null);
            if ($mac === null || presence_is_excluded_mac($mac)) { $skipped++; continue; }
            $ip  = isset($o['ip']) ? mb_substr((string)$o['ip'], 0, 45) : null;
            $prev = $prevSeen[$mac] ?? null;
            $isFresh = $prev === null
                || strtotime($prev['last']) < strtotime($now) - $threshold * 60;
            // A fresh entry that had a prior session means that prior session is now
            // closing. Capture (start, end) so we can write it to presence_sessions
            // AFTER commit (so a slow insert can't slow down the scan path).
            if ($isFresh && $prev !== null && $prev['start'] !== null
                && strtotime($prev['last']) > strtotime($prev['start'])) {
                $sessionsToLog[] = [
                    'user_id' => $macToUser[$mac] ?? null,
                    'mac'     => $mac,
                    'room_id' => $roomId,
                    'start'   => $prev['start'],
                    'end'     => $prev['last'],
                ];
            }
            if ($isFresh) $freshMacs[$mac] = true;
            $upsert->execute([$roomId, $mac, $ip, $now, $now, $now, $threshold]);
            $accepted++;
        }
        $pdo->prepare('UPDATE rooms SET last_scan_at=? WHERE id=?')->execute([$now, $roomId]);

        // Map observed MACs to registered users — for auto-checkin (still inside TX).
        // (We already populated $macToUser earlier; reuse it.)
        foreach ($macToUser as $mac => $uid) {
            $registeredUserIds[$uid] = true;
            if (isset($freshMacs[$mac])) $freshRegisteredUserIds[$uid] = true;
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $registeredUserIds = array_keys($registeredUserIds);
    $freshRegisteredUserIds = array_keys($freshRegisteredUserIds);

    // Write any closed sessions to the log AFTER the main transaction so they can't
    // block the upsert. Per-row inserts in their own transaction; errors swallowed.
    if (!empty($sessionsToLog)) {
        try {
            $ins = $pdo->prepare("INSERT INTO presence_sessions
                (user_id, mac, room_id, started_at, ended_at, duration_minutes)
                VALUES (?,?,?,?,?, GREATEST(0, TIMESTAMPDIFF(MINUTE, ?, ?)))");
            foreach ($sessionsToLog as $s) {
                $ins->execute([$s['user_id'], $s['mac'], $s['room_id'],
                               $s['start'], $s['end'], $s['start'], $s['end']]);
            }
        } catch (Throwable $e) {
            error_log('[labpay/presence] session log failed: ' . $e->getMessage());
        }
    }

    // Append a row per observation to a daily CSV log. Append-only, no DB, no impact
    // on the response. Useful for "who was in the lab when" analysis later.
    try {
        presence_append_csv_log($pdo, $now, $roomId, $obs, $candidateMacs);
    } catch (Throwable $e) {
        error_log('[labpay/presence] csv log failed: ' . $e->getMessage());
    }

    // Auto-checkin AFTER commit (each in its own TX so a single failure doesn't break the scan).
    // do_checkin_for_user is idempotent thanks to the UNIQUE PK on (user_id, checkin_date),
    // so the FIRST scan that observes the user on any given calendar date is what fires the
    // reward — subsequent scans the same day are no-ops. We deliberately use ALL observed
    // registered users (not just the "fresh entry" subset) so that a phone that stayed in
    // the lab overnight still earns its owner the next day's bonus on the first scan after
    // midnight. Trade-off: a forgotten phone in the lab earns the owner pt while they're
    // physically away — accepted in exchange for not silently skipping the daily bonus.
    $auto_checked_in = 0;
    foreach ($registeredUserIds as $uid) {
        try {
            $r = do_checkin_for_user($pdo, $uid, 'presence:' . $roomId);
            if (!$r['already']) $auto_checked_in++;
        } catch (Throwable $e) {
            error_log('[labpay] auto-checkin failed for user ' . $uid . ': ' . $e->getMessage());
        }
    }

    json_response([
        'ok' => true,
        'accepted' => $accepted,
        'skipped' => $skipped,
        'auto_checked_in' => $auto_checked_in,
    ]);
}
