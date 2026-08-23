<?php
// /api/joint-events — 合同研究会用の投票 (v941)。
//   別ラボとの合同研究会でセッションごとに相手ラボの発表に投票してもらい、
//   優秀発表者を決める。外部参加者 (未 login) も public_token 経由で
//   匿名投票できる (anon cookie で 1 人 1 票 / セッション)。
//
// 認証系ルート (route_joint_events) と公開系サブルート (/public/{token})
// を同じハンドラで捌く。公開系は Auth::requireUser を通さない。

declare(strict_types=1);

const JOINT_ANON_COOKIE = 'joint_anon';   // 32 hex
const JOINT_ANON_TTL_DAYS = 90;

function route_joint_events(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    // 公開系: 未認証で叩ける。 /api/joint-events/public/{token} / vote
    if ($sub === 'public') {
        $token = $seg[2] ?? '';
        $tail  = $seg[3] ?? '';
        if ($token === '' || !ctype_alnum($token) || strlen($token) < 8 || strlen($token) > 32) {
            throw new ApiException('bad_request', 'token 不正', 400);
        }
        if ($tail === '' && $method === 'GET')  { joint_public_get($pdo, $cfg, $token); return; }
        if ($tail === 'vote' && $method === 'POST') { joint_public_vote($pdo, $cfg, $token); return; }
        throw new ApiException('not_found', "no public route for $method $token/$tail", 404);
    }

    // 以下認証必須。
    if ($sub === '' && $method === 'GET')  { joint_events_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { joint_events_create($pdo, $cfg); return; }

    if ($sub === 'sessions') {
        $sid = (int)($seg[2] ?? 0);
        if ($sid <= 0) throw new ApiException('bad_request', 'session id 不正', 400);
        if ($method === 'PATCH')  { joint_session_update($pdo, $cfg, $sid); return; }
        if ($method === 'DELETE') { joint_session_delete($pdo, $cfg, $sid); return; }
        throw new ApiException('not_found', "no route for sessions/$sid $method", 404);
    }

    if ($sub === 'presenters') {
        $pid = (int)($seg[2] ?? 0);
        if ($pid <= 0) throw new ApiException('bad_request', 'presenter id 不正', 400);
        if ($method === 'PATCH')  { joint_presenter_update($pdo, $cfg, $pid); return; }
        if ($method === 'DELETE') { joint_presenter_delete($pdo, $cfg, $pid); return; }
        throw new ApiException('not_found', "no route for presenters/$pid $method", 404);
    }

    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { joint_event_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { joint_event_update($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { joint_event_delete($pdo, $cfg, $id); return; }
        if ($next === 'rotate-token' && $method === 'POST') { joint_event_rotate_token($pdo, $cfg, $id); return; }
        if ($next === 'results'      && $method === 'GET')  { joint_event_results($pdo, $cfg, $id); return; }
        if ($next === 'finalize'     && $method === 'POST') { joint_event_finalize($pdo, $cfg, $id); return; }
        // presenters 追加は sessions/{sid}/presenters 形式 (先に judge、順序注意)
        if ($next === 'sessions' && ctype_digit((string)($seg[3] ?? ''))) {
            $sid = (int)$seg[3];
            $next2 = $seg[4] ?? '';
            $next3 = $seg[5] ?? '';
            if ($next2 === 'presenters' && $next3 === 'bulk' && $method === 'POST') {
                joint_presenter_bulk_create($pdo, $cfg, $sid); return;
            }
            if ($next2 === 'presenters' && $next3 === '' && $method === 'POST') {
                joint_presenter_create($pdo, $cfg, $sid); return;
            }
        }
        if ($next === 'sessions' && !isset($seg[3]) && $method === 'POST') {
            joint_session_create($pdo, $cfg, $id); return;
        }
    }
    throw new ApiException('not_found', "no joint-events route for $method $sub", 404);
}

// ---------- helpers ----------

function joint_require_event_owner(PDO $pdo, int $eventId, int $userId): array {
    $st = $pdo->prepare("SELECT * FROM joint_events WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$eventId]);
    $ev = $st->fetch(PDO::FETCH_ASSOC);
    if (!$ev) throw new ApiException('not_found', 'event なし', 404);
    if ((int)$ev['creator_user_id'] !== $userId) {
        throw new ApiException('forbidden', '起案者のみ', 403);
    }
    return $ev;
}

function joint_require_session_owner(PDO $pdo, int $sessionId, int $userId): array {
    $st = $pdo->prepare("
        SELECT s.*, e.creator_user_id
          FROM joint_sessions s
          JOIN joint_events e ON e.id = s.event_id
         WHERE s.id = ? AND e.deleted_at IS NULL");
    $st->execute([$sessionId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'session なし', 404);
    if ((int)$row['creator_user_id'] !== $userId) {
        throw new ApiException('forbidden', '起案者のみ', 403);
    }
    return $row;
}

function joint_require_presenter_owner(PDO $pdo, int $presenterId, int $userId): array {
    $st = $pdo->prepare("
        SELECT p.*, e.creator_user_id, e.id AS event_id
          FROM joint_presenters p
          JOIN joint_sessions s ON s.id = p.session_id
          JOIN joint_events e   ON e.id = s.event_id
         WHERE p.id = ? AND e.deleted_at IS NULL");
    $st->execute([$presenterId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'presenter なし', 404);
    if ((int)$row['creator_user_id'] !== $userId) {
        throw new ApiException('forbidden', '起案者のみ', 403);
    }
    return $row;
}

function joint_parse_dt(?string $raw): ?string {
    if ($raw === null) return null;
    $raw = trim($raw);
    if ($raw === '') return null;
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
    if (!$dt) throw new ApiException('bad_request', "日時形式が不正: $raw", 400);
    return $dt->format('Y-m-d H:i:s');
}

// event に紐づく全 session + 全 presenter を 1 発で取ってきて構造化。
function joint_load_event_tree(PDO $pdo, int $eventId): array {
    $st = $pdo->prepare("SELECT * FROM joint_events WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$eventId]);
    $ev = $st->fetch(PDO::FETCH_ASSOC);
    if (!$ev) throw new ApiException('not_found', 'event なし', 404);
    $sessions = $pdo->prepare("SELECT * FROM joint_sessions WHERE event_id = ? ORDER BY sort_order, id");
    $sessions->execute([$eventId]);
    $sessions = $sessions->fetchAll(PDO::FETCH_ASSOC);
    if ($sessions) {
        $sids = array_column($sessions, 'id');
        $in = implode(',', array_fill(0, count($sids), '?'));
        $stP = $pdo->prepare("SELECT * FROM joint_presenters WHERE session_id IN ($in) ORDER BY session_id, sort_order, id");
        $stP->execute($sids);
        $presenters = $stP->fetchAll(PDO::FETCH_ASSOC);
        $pBySid = [];
        foreach ($presenters as $p) $pBySid[(int)$p['session_id']][] = $p;
        foreach ($sessions as &$s) {
            $s['presenters'] = $pBySid[(int)$s['id']] ?? [];
        }
        unset($s);
    }
    $ev['sessions'] = $sessions;
    return $ev;
}

// anon cookie を取り出す (無ければ発行)。 public 系で使う。
function joint_ensure_anon_id(): string {
    $anon = $_COOKIE[JOINT_ANON_COOKIE] ?? '';
    if (!is_string($anon) || !preg_match('/^[0-9a-f]{32}$/', $anon)) {
        $anon = bin2hex(random_bytes(16));
        // 90日 TTL。 SameSite=Lax で足りる (投票 UI から fetch する)。 secure は https 前提。
        setcookie(JOINT_ANON_COOKIE, $anon, [
            'expires'  => time() + 86400 * JOINT_ANON_TTL_DAYS,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    return $anon;
}

// ---------- 認証付き handlers ----------

function joint_events_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT e.id, e.title, e.host_lab, e.guest_lab, e.starts_at, e.ends_at,
               e.finalized_at, e.public_token, e.created_at,
               (SELECT COUNT(*) FROM joint_sessions s WHERE s.event_id = e.id) AS session_count,
               (SELECT COUNT(*) FROM joint_presenters p
                  JOIN joint_sessions s2 ON s2.id = p.session_id
                 WHERE s2.event_id = e.id) AS presenter_count,
               (SELECT COUNT(*) FROM joint_votes v
                  JOIN joint_sessions s3 ON s3.id = v.session_id
                 WHERE s3.event_id = e.id) AS vote_count
          FROM joint_events e
         WHERE e.creator_user_id = ? AND e.deleted_at IS NULL
         ORDER BY e.id DESC");
    $st->execute([(int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function joint_events_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    $host  = trim((string)($body['host_lab']  ?? ''));
    $guest = trim((string)($body['guest_lab'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) throw new ApiException('bad_request', 'title 1..300', 400);
    if ($host === '' || $guest === '')            throw new ApiException('bad_request', 'host_lab / guest_lab 必須', 400);
    if (mb_strlen($host) > 100 || mb_strlen($guest) > 100) throw new ApiException('bad_request', 'lab 名 <=100', 400);
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > 5000) $desc = mb_substr($desc, 0, 5000);
    $startsAt = joint_parse_dt($body['starts_at'] ?? null);
    $endsAt   = joint_parse_dt($body['ends_at']   ?? null);
    // v945 URL が長すぎるユーザ指摘対応。 32 桁 → 8 桁 (32bit) に短縮。
    //   soft privacy (URL 共有前提) なので 32bit で十分。
    $token = bin2hex(random_bytes(4));

    $ins = $pdo->prepare("INSERT INTO joint_events
        (creator_user_id, title, description, host_lab, guest_lab, public_token, starts_at, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([(int)$u['id'], $title, $desc ?: null, $host, $guest, $token, $startsAt, $endsAt]);
    $eventId = (int)$pdo->lastInsertId();
    // 4 桁短縮コードを割当 (/joint.html?t=xxx へ飛ばす)
    $code = public_codes_allocate($pdo, 'joint', $eventId, '/joint.html?t=' . $token, (int)$u['id']);
    json_response(['id' => $eventId, 'public_token' => $token, 'public_code' => $code]);
}

function joint_event_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $ev = joint_require_event_owner($pdo, $id, (int)$u['id']);
    $ev = joint_load_event_tree($pdo, $id);
    $ev['public_code'] = public_codes_lookup_by_ref($pdo, 'joint', $id);
    json_response($ev);
}

function joint_event_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 300) throw new ApiException('bad_request', 'title 1..300', 400);
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        if (mb_strlen($d) > 5000) $d = mb_substr($d, 0, 5000);
        $sets[] = 'description = ?'; $args[] = $d ?: null;
    }
    if (array_key_exists('host_lab', $body)) {
        $h = trim((string)$body['host_lab']);
        if ($h === '' || mb_strlen($h) > 100) throw new ApiException('bad_request', 'host_lab 1..100', 400);
        $sets[] = 'host_lab = ?'; $args[] = $h;
    }
    if (array_key_exists('guest_lab', $body)) {
        $g = trim((string)$body['guest_lab']);
        if ($g === '' || mb_strlen($g) > 100) throw new ApiException('bad_request', 'guest_lab 1..100', 400);
        $sets[] = 'guest_lab = ?'; $args[] = $g;
    }
    if (array_key_exists('starts_at', $body)) {
        $sets[] = 'starts_at = ?'; $args[] = joint_parse_dt($body['starts_at']);
    }
    if (array_key_exists('ends_at', $body)) {
        $sets[] = 'ends_at = ?'; $args[] = joint_parse_dt($body['ends_at']);
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE joint_events SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function joint_event_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $id, (int)$u['id']);
    $pdo->prepare("UPDATE joint_events SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

function joint_event_rotate_token(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $id, (int)$u['id']);
    // v945 URL が長すぎるユーザ指摘対応。 32 桁 → 8 桁 (32bit) に短縮。
    //   soft privacy (URL 共有前提) なので 32bit で十分。
    $token = bin2hex(random_bytes(4));
    $pdo->prepare("UPDATE joint_events SET public_token = ? WHERE id = ?")->execute([$token, $id]);
    json_response(['public_token' => $token]);
}

// ---------- sessions ----------

function joint_session_create(PDO $pdo, array $cfg, int $eventId): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $eventId, (int)$u['id']);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 200) throw new ApiException('bad_request', 'name 1..200', 400);
    $sortOrder = (int)($body['sort_order'] ?? 0);
    $startsAt = joint_parse_dt($body['starts_at'] ?? null);
    $endsAt   = joint_parse_dt($body['ends_at']   ?? null);
    $ins = $pdo->prepare("INSERT INTO joint_sessions
        (event_id, name, starts_at, ends_at, sort_order) VALUES (?, ?, ?, ?, ?)");
    $ins->execute([$eventId, $name, $startsAt, $endsAt, $sortOrder]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function joint_session_update(PDO $pdo, array $cfg, int $sessionId): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_session_owner($pdo, $sessionId, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body)) {
        $n = trim((string)$body['name']);
        if ($n === '' || mb_strlen($n) > 200) throw new ApiException('bad_request', 'name 1..200', 400);
        $sets[] = 'name = ?'; $args[] = $n;
    }
    if (array_key_exists('starts_at', $body)) { $sets[] = 'starts_at = ?'; $args[] = joint_parse_dt($body['starts_at']); }
    if (array_key_exists('ends_at',   $body)) { $sets[] = 'ends_at = ?';   $args[] = joint_parse_dt($body['ends_at']); }
    if (array_key_exists('sort_order', $body)) { $sets[] = 'sort_order = ?'; $args[] = (int)$body['sort_order']; }
    // v1351 fb#524 中村さん要望「セッションごとに投票を締め切れるように」
    //   closed=true → closed_at=NOW()、 closed=false → NULL (受付再開)
    if (array_key_exists('closed', $body)) {
        $sets[] = 'closed_at = ?';
        $args[] = $body['closed'] ? date('Y-m-d H:i:s') : null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $sessionId;
    $pdo->prepare("UPDATE joint_sessions SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function joint_session_delete(PDO $pdo, array $cfg, int $sessionId): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_session_owner($pdo, $sessionId, (int)$u['id']);
    $pdo->prepare("DELETE FROM joint_sessions WHERE id = ?")->execute([$sessionId]);
    json_response(['ok' => true]);
}

// ---------- presenters ----------

function joint_presenter_create(PDO $pdo, array $cfg, int $sessionId): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_session_owner($pdo, $sessionId, (int)$u['id']);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 200) throw new ApiException('bad_request', 'name 1..200', 400);
    $aff = (string)($body['affiliation'] ?? '');
    if (!in_array($aff, ['host','guest'], true)) throw new ApiException('bad_request', "affiliation は host/guest", 400);
    $title = trim((string)($body['title'] ?? ''));
    if (mb_strlen($title) > 300) $title = mb_substr($title, 0, 300);
    $abs = trim((string)($body['abstract'] ?? ''));
    if (mb_strlen($abs) > 5000) $abs = mb_substr($abs, 0, 5000);
    $sortOrder = (int)($body['sort_order'] ?? 0);
    $ins = $pdo->prepare("INSERT INTO joint_presenters
        (session_id, name, affiliation, title, abstract, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
    $ins->execute([$sessionId, $name, $aff, $title ?: null, $abs ?: null, $sortOrder]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

// v943 1 行 1 発表者のテキストをまとめて追加。既存発表者は触らず純粋に append。
//   body: {affiliation: 'host'|'guest', entries: ['名前', '名前: 発表タイトル', ...]}
//   entries の各行は「name」か「name: title」 (最初のコロンで split)。
function joint_presenter_bulk_create(PDO $pdo, array $cfg, int $sessionId): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_session_owner($pdo, $sessionId, (int)$u['id']);
    $body = read_json_body();
    $aff = (string)($body['affiliation'] ?? '');
    if (!in_array($aff, ['host','guest'], true)) {
        throw new ApiException('bad_request', "affiliation は host/guest", 400);
    }
    $entries = $body['entries'] ?? [];
    if (!is_array($entries)) throw new ApiException('bad_request', 'entries 配列', 400);
    if (count($entries) > 100) throw new ApiException('bad_request', 'entries 100 個まで', 400);

    // 既存 sort_order の最大を取ってその続きから追加
    $st = $pdo->prepare("SELECT COALESCE(MAX(sort_order), -1) FROM joint_presenters WHERE session_id = ?");
    $st->execute([$sessionId]);
    $baseOrder = (int)$st->fetchColumn() + 1;

    $created = [];
    db_tx($pdo, function () use ($pdo, $sessionId, $aff, $entries, $baseOrder, &$created) {
        $ins = $pdo->prepare("INSERT INTO joint_presenters
            (session_id, name, affiliation, title, sort_order) VALUES (?, ?, ?, ?, ?)");
        $i = 0;
        foreach ($entries as $line) {
            $line = trim((string)$line);
            if ($line === '') continue;
            // 「name: title」形式 (最初のコロンで split)。半角 / 全角コロンどちらも対応。
            $name = $line; $title = null;
            if (preg_match('/^(.+?)\s*[：:]\s*(.+)$/u', $line, $m)) {
                $name  = trim($m[1]);
                $title = trim($m[2]);
            }
            if ($name === '') continue;
            if (mb_strlen($name)  > 200) $name  = mb_substr($name, 0, 200);
            if ($title !== null && mb_strlen($title) > 300) $title = mb_substr($title, 0, 300);
            $ins->execute([$sessionId, $name, $aff, $title, $baseOrder + $i]);
            $created[] = (int)$pdo->lastInsertId();
            $i++;
        }
    });
    json_response(['ok' => true, 'created' => $created]);
}

function joint_presenter_update(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_presenter_owner($pdo, $pid, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body)) {
        $n = trim((string)$body['name']);
        if ($n === '' || mb_strlen($n) > 200) throw new ApiException('bad_request', 'name 1..200', 400);
        $sets[] = 'name = ?'; $args[] = $n;
    }
    if (array_key_exists('affiliation', $body)) {
        $a = (string)$body['affiliation'];
        if (!in_array($a, ['host','guest'], true)) throw new ApiException('bad_request', "affiliation は host/guest", 400);
        $sets[] = 'affiliation = ?'; $args[] = $a;
    }
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if (mb_strlen($t) > 300) $t = mb_substr($t, 0, 300);
        $sets[] = 'title = ?'; $args[] = $t ?: null;
    }
    if (array_key_exists('abstract', $body)) {
        $a2 = trim((string)$body['abstract']);
        if (mb_strlen($a2) > 5000) $a2 = mb_substr($a2, 0, 5000);
        $sets[] = 'abstract = ?'; $args[] = $a2 ?: null;
    }
    if (array_key_exists('sort_order', $body)) { $sets[] = 'sort_order = ?'; $args[] = (int)$body['sort_order']; }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $pid;
    $pdo->prepare("UPDATE joint_presenters SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function joint_presenter_delete(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_presenter_owner($pdo, $pid, (int)$u['id']);
    $pdo->prepare("DELETE FROM joint_presenters WHERE id = ?")->execute([$pid]);
    json_response(['ok' => true]);
}

// ---------- results / finalize ----------

function joint_event_results(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $id, (int)$u['id']);
    $tree = joint_load_event_tree($pdo, $id);
    // 各 presenter の得票数 + affiliation 別内訳を集計。
    if (!empty($tree['sessions'])) {
        $sids = array_map(fn($s) => (int)$s['id'], $tree['sessions']);
        $in = implode(',', array_fill(0, count($sids), '?'));
        $stT = $pdo->prepare("
            SELECT presenter_id, voter_affiliation, COUNT(*) AS cnt
              FROM joint_votes
             WHERE session_id IN ($in)
             GROUP BY presenter_id, voter_affiliation");
        $stT->execute($sids);
        $counts = [];
        foreach ($stT->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $pid = (int)$r['presenter_id'];
            $counts[$pid][$r['voter_affiliation']] = (int)$r['cnt'];
            $counts[$pid]['total'] = ($counts[$pid]['total'] ?? 0) + (int)$r['cnt'];
        }
        foreach ($tree['sessions'] as &$s) {
            foreach ($s['presenters'] as &$p) {
                $pid = (int)$p['id'];
                $p['votes'] = [
                    'host'  => (int)($counts[$pid]['host']  ?? 0),
                    'guest' => (int)($counts[$pid]['guest'] ?? 0),
                    'other' => (int)($counts[$pid]['other'] ?? 0),
                    'total' => (int)($counts[$pid]['total'] ?? 0),
                ];
            }
            unset($p);
        }
        unset($s);
    }
    json_response($tree);
}

// finalize: 各 session ごとに最多得票を is_best=1 に。同票 or 明示指定は overrides で。
//   body: {overrides: {session_id: presenter_id, ...}} (省略時は全 session 自動)
function joint_event_finalize(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    joint_require_event_owner($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $overrides = is_array($body['overrides'] ?? null) ? $body['overrides'] : [];

    $sessions = $pdo->prepare("SELECT id FROM joint_sessions WHERE event_id = ?");
    $sessions->execute([$id]);
    $sids = array_map(fn($r) => (int)$r['id'], $sessions->fetchAll(PDO::FETCH_ASSOC));

    // v947 各 session で host / guest それぞれの 1 位を is_best に (2 賞 / セッション)。
    //   overrides は {session_id: {host: pid, guest: pid}} 形式で個別上書き可。
    db_tx($pdo, function () use ($pdo, $id, $sids, $overrides) {
        // 一旦全 presenter の is_best を 0 に (再 finalize 対応)。
        $pdo->prepare("UPDATE joint_presenters p
                        JOIN joint_sessions s ON s.id = p.session_id
                          SET p.is_best = 0
                        WHERE s.event_id = ?")->execute([$id]);
        foreach ($sids as $sid) {
            foreach (['host', 'guest'] as $aff) {
                $bestPid = null;
                // overrides: {session_id: {host: pid, guest: pid}} or {session_id: pid} (旧互換)
                if (isset($overrides[$sid][$aff])) $bestPid = (int)$overrides[$sid][$aff];
                else if (isset($overrides[(string)$sid][$aff])) $bestPid = (int)$overrides[(string)$sid][$aff];
                if ($bestPid !== null) {
                    $chk = $pdo->prepare("SELECT id FROM joint_presenters WHERE id = ? AND session_id = ? AND affiliation = ?");
                    $chk->execute([$bestPid, $sid, $aff]);
                    if (!$chk->fetchColumn()) $bestPid = null;
                }
                if ($bestPid === null) {
                    // 最多得票 (同票 first)
                    $stB = $pdo->prepare("
                        SELECT p.id, COUNT(v.id) AS cnt
                          FROM joint_presenters p
                     LEFT JOIN joint_votes v ON v.presenter_id = p.id AND v.session_id = ?
                         WHERE p.session_id = ? AND p.affiliation = ?
                         GROUP BY p.id
                         ORDER BY cnt DESC, p.sort_order, p.id
                         LIMIT 1");
                    $stB->execute([$sid, $sid, $aff]);
                    $r = $stB->fetch(PDO::FETCH_ASSOC);
                    if ($r && (int)$r['cnt'] > 0) $bestPid = (int)$r['id'];
                }
                if ($bestPid !== null) {
                    $pdo->prepare("UPDATE joint_presenters SET is_best = 1 WHERE id = ?")->execute([$bestPid]);
                }
            }
        }
        $pdo->prepare("UPDATE joint_events SET finalized_at = NOW() WHERE id = ?")->execute([$id]);
    });
    json_response(['ok' => true]);
}

// ---------- 公開系 (未認証) ----------

// GET /api/joint-events/public/{token} — event + sessions + presenters
//   + 自分 (anon cookie) の投票済み session_id → presenter_id マップ
function joint_public_get(PDO $pdo, array $cfg, string $token): void {
    $st = $pdo->prepare("SELECT * FROM joint_events WHERE public_token = ? AND deleted_at IS NULL");
    $st->execute([$token]);
    $ev = $st->fetch(PDO::FETCH_ASSOC);
    if (!$ev) throw new ApiException('not_found', 'event なし', 404);
    // 公開情報だけ返す (creator_user_id 等は隠す)
    $tree = joint_load_event_tree($pdo, (int)$ev['id']);
    $out = [
        'id'           => (int)$tree['id'],
        'title'        => $tree['title'],
        'description'  => $tree['description'],
        'host_lab'     => $tree['host_lab'],
        'guest_lab'    => $tree['guest_lab'],
        'starts_at'    => $tree['starts_at'],
        'ends_at'      => $tree['ends_at'],
        'finalized_at' => $tree['finalized_at'],
        'sessions'     => array_map(function ($s) use ($tree) {
            return [
                'id'         => (int)$s['id'],
                'name'       => $s['name'],
                'starts_at'  => $s['starts_at'],
                'ends_at'    => $s['ends_at'],
                'presenters' => array_map(function ($p) use ($tree) {
                    $out = [
                        'id'          => (int)$p['id'],
                        'name'        => $p['name'],
                        'affiliation' => $p['affiliation'],
                        'title'       => $p['title'],
                        'abstract'    => $p['abstract'],
                    ];
                    // finalize 済なら is_best も見せる (優秀発表者公開のため)
                    if ($tree['finalized_at']) $out['is_best'] = (int)$p['is_best'] === 1;
                    return $out;
                }, $s['presenters']),
            ];
        }, $tree['sessions']),
    ];
    // 自分の投票状況
    $anon = joint_ensure_anon_id();
    $stV = $pdo->prepare("
        SELECT v.session_id, v.presenter_id
          FROM joint_votes v
          JOIN joint_sessions s ON s.id = v.session_id
         WHERE s.event_id = ? AND v.voter_anon_id = ?");
    $stV->execute([(int)$tree['id'], $anon]);
    $my = [];
    foreach ($stV->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $my[(int)$r['session_id']] = (int)$r['presenter_id'];
    }
    $out['my_votes'] = $my;
    json_response($out);
}

// POST /api/joint-events/public/{token}/vote
//   body: {session_id, presenter_id, affiliation, name?}
function joint_public_vote(PDO $pdo, array $cfg, string $token): void {
    $st = $pdo->prepare("SELECT id, finalized_at FROM joint_events WHERE public_token = ? AND deleted_at IS NULL");
    $st->execute([$token]);
    $ev = $st->fetch(PDO::FETCH_ASSOC);
    if (!$ev) throw new ApiException('not_found', 'event なし', 404);
    if ($ev['finalized_at']) throw new ApiException('closed', '投票は既に締め切られています', 400);

    $body = read_json_body();
    $sessionId   = (int)($body['session_id']   ?? 0);
    $presenterId = (int)($body['presenter_id'] ?? 0);
    $aff         = (string)($body['affiliation'] ?? '');
    $voterName   = trim((string)($body['voter_name'] ?? ''));
    if ($sessionId <= 0 || $presenterId <= 0) throw new ApiException('bad_request', 'session_id / presenter_id 必須', 400);
    if (!in_array($aff, ['host','guest','other'], true)) throw new ApiException('bad_request', 'affiliation は host/guest/other', 400);
    if (mb_strlen($voterName) > 100) $voterName = mb_substr($voterName, 0, 100);

    // presenter と session の整合性、 event 一致、クロスラボ制約チェック
    // v1351 fb#524 session.closed_at セット済みなら投票拒否
    $stP = $pdo->prepare("
        SELECT p.id, p.affiliation AS p_aff, s.event_id, s.closed_at
          FROM joint_presenters p
          JOIN joint_sessions s ON s.id = p.session_id
         WHERE p.id = ? AND p.session_id = ?");
    $stP->execute([$presenterId, $sessionId]);
    $p = $stP->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('bad_request', 'presenter が session に属していません', 400);
    if ((int)$p['event_id'] !== (int)$ev['id']) throw new ApiException('bad_request', 'event 不一致', 400);
    if (!empty($p['closed_at'])) throw new ApiException('closed', 'このセッションの投票は締め切られています', 400);
    // クロスラボ制約: host 投票者は guest 発表者のみ、 guest 投票者は host 発表者のみ。 other は制約なし。
    if ($aff === 'host'  && $p['p_aff'] !== 'guest') throw new ApiException('bad_request', '自ラボ発表には投票できません', 400);
    if ($aff === 'guest' && $p['p_aff'] !== 'host')  throw new ApiException('bad_request', '自ラボ発表には投票できません', 400);

    $anon = joint_ensure_anon_id();
    // UPSERT: 同じ session に再投票したら差し替え (1 人 1 票、変更可)
    $pdo->prepare("
        INSERT INTO joint_votes (session_id, presenter_id, voter_anon_id, voter_affiliation, voter_name)
             VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
             presenter_id = VALUES(presenter_id),
             voter_affiliation = VALUES(voter_affiliation),
             voter_name = VALUES(voter_name),
             created_at = CURRENT_TIMESTAMP")
        ->execute([$sessionId, $presenterId, $anon, $aff, $voterName ?: null]);
    json_response(['ok' => true]);
}
