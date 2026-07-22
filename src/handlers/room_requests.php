<?php
// v1230 fb#502 /api/room-requests — 教室予約依頼 (発表練習などで教室を押さえてほしい時)
//   * 依頼者: 用途 + 日時 + 想定人数 + 条件 (プロジェクター/大人数/階など) で依頼を投げる
//   * 一覧は全メンバー閲覧可 (「今どの教室が押さえられているか」を全員で見られる)
//   * 「教室押さえた / 却下」の状態変更は admin (中村さん) のみ
//   * 依頼者本人は「取消」できる (自分の pending な依頼のみ)
//   * LabPay 台帳のお金は動かさない (buy_requests と同じ設計)
//   * 教室番号は依頼側で指定しない代わりに条件を並べる (中野キャンパスフロア情報を
//     見て中村さんが最適な教室を押さえる)

declare(strict_types=1);

function route_room_requests(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { room_requests_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { room_requests_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { room_requests_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { room_requests_patch ($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { room_requests_cancel($pdo, $cfg, $id); return; }
        if ($next === 'confirm' && $method === 'PATCH') { room_requests_confirm ($pdo, $cfg, $id); return; }
        if ($next === 'decline' && $method === 'PATCH') { room_requests_decline ($pdo, $cfg, $id); return; }
        if ($next === 'reopen'  && $method === 'PATCH') { room_requests_reopen  ($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no room-requests route for $method $sub", 404);
}

// 依頼者側から送られてくる条件フィールドを配列化
function _room_req_flags_from_body(array $b): array {
    return [
        'needs_projector'  => !empty($b['needs_projector'])  ? 1 : 0,
        'needs_whiteboard' => !empty($b['needs_whiteboard']) ? 1 : 0,
        'needs_screen'     => !empty($b['needs_screen'])     ? 1 : 0,
        'needs_pc'         => !empty($b['needs_pc'])         ? 1 : 0,
        'needs_mic'        => !empty($b['needs_mic'])        ? 1 : 0,
        'needs_camera'     => !empty($b['needs_camera'])     ? 1 : 0,
    ];
}

// DB row を返却用に整形 (数値型のキャストと bool 化)
function _room_req_shape(array $r, int $meId, string $meRole): array {
    $r['id']                = (int)$r['id'];
    $r['requester_user_id'] = (int)$r['requester_user_id'];
    $r['expected_participants'] = $r['expected_participants'] !== null ? (int)$r['expected_participants'] : null;
    $r['min_capacity']      = $r['min_capacity'] !== null ? (int)$r['min_capacity'] : null;
    foreach (['needs_projector','needs_whiteboard','needs_screen','needs_pc','needs_mic','needs_camera'] as $k) {
        $r[$k] = !empty($r[$k]) ? 1 : 0;
    }
    $r['resolved_by_user_id'] = $r['resolved_by_user_id'] !== null ? (int)$r['resolved_by_user_id'] : null;
    $r['is_mine']  = ($r['requester_user_id'] === $meId);
    $r['is_admin'] = ($meRole === 'admin');
    return $r;
}

// ─── LIST ────────────────────────────────────────────────────
// query params: ?status=pending|confirmed|declined|cancelled|all (デフォルト all)、
//               ?mine=1、?limit=200
function room_requests_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $status = (string)($_GET['status'] ?? 'all');
    $mine   = !empty($_GET['mine']);
    $limit  = max(1, min(500, (int)($_GET['limit'] ?? 200)));

    $where = [];
    $params = [];
    if (in_array($status, ['pending','confirmed','declined','cancelled'], true)) {
        $where[] = 'r.status = ?';
        $params[] = $status;
    }
    if ($mine) {
        $where[] = 'r.requester_user_id = ?';
        $params[] = (int)$u['id'];
    }
    $sql = "SELECT r.*,
                   ur.display_name AS requester_name, ur.avatar_url AS requester_avatar,
                   ua.display_name AS resolver_name
              FROM room_requests r
              JOIN users ur ON ur.id = r.requester_user_id
         LEFT JOIN users ua ON ua.id = r.resolved_by_user_id";
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    // pending → 近い日付順、それ以外は 新しい順
    $sql .= " ORDER BY (r.status='pending') DESC, "
          . " CASE WHEN r.status='pending' THEN r.event_date END ASC, "
          . " r.created_at DESC LIMIT " . $limit;

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $meId   = (int)$u['id'];
    $meRole = (string)$u['role'];
    foreach ($rows as &$r) $r = _room_req_shape($r, $meId, $meRole);

    // 集計 (どのタブに何件あるか)
    $counts = ['pending' => 0, 'confirmed' => 0, 'declined' => 0, 'cancelled' => 0];
    $stC = $pdo->query("SELECT status, COUNT(*) c FROM room_requests GROUP BY status");
    foreach ($stC as $c) $counts[$c['status']] = (int)$c['c'];
    json_response(['items' => $rows, 'counts' => $counts, 'is_admin' => $u['role'] === 'admin']);
}

// ─── CREATE ──────────────────────────────────────────────────
function room_requests_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();

    $purpose   = trim((string)require_field($body, 'purpose'));
    $eventDate = trim((string)require_field($body, 'event_date'));
    $timeStart = trim((string)require_field($body, 'time_start'));
    $timeEnd   = trim((string)require_field($body, 'time_end'));

    if ($purpose === '' || mb_strlen($purpose) > 200) {
        throw new ApiException('bad_request', '用途は 1〜200 文字で入力してください', 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $eventDate)) {
        throw new ApiException('bad_request', '日付は YYYY-MM-DD 形式', 400);
    }
    if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $timeStart) || !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $timeEnd)) {
        throw new ApiException('bad_request', '時刻は HH:MM 形式', 400);
    }
    if (strcmp(substr($timeStart, 0, 5), substr($timeEnd, 0, 5)) >= 0) {
        throw new ApiException('bad_request', '終了時刻は開始時刻より後にしてください', 400);
    }

    $participants = isset($body['expected_participants']) && $body['expected_participants'] !== ''
        ? max(1, min(9999, (int)$body['expected_participants'])) : null;
    $minCapacity  = isset($body['min_capacity']) && $body['min_capacity'] !== ''
        ? max(1, min(9999, (int)$body['min_capacity'])) : null;
    $floor  = trim((string)($body['preferred_floor'] ?? ''));
    $others = trim((string)($body['other_conditions'] ?? ''));
    $notes  = trim((string)($body['notes'] ?? ''));
    if (mb_strlen($floor)  > 40)   throw new ApiException('bad_request', '希望階は 40 文字以下', 400);
    if (mb_strlen($others) > 1000) throw new ApiException('bad_request', '追加条件は 1000 文字以下', 400);
    if (mb_strlen($notes)  > 2000) throw new ApiException('bad_request', '補足は 2000 文字以下', 400);

    $flags = _room_req_flags_from_body($body);

    $ins = $pdo->prepare("INSERT INTO room_requests
        (requester_user_id, purpose, event_date, time_start, time_end, expected_participants,
         needs_projector, needs_whiteboard, needs_screen, needs_pc, needs_mic, needs_camera,
         min_capacity, preferred_floor, other_conditions, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([
        $u['id'], $purpose, $eventDate, $timeStart, $timeEnd, $participants,
        $flags['needs_projector'], $flags['needs_whiteboard'], $flags['needs_screen'],
        $flags['needs_pc'], $flags['needs_mic'], $flags['needs_camera'],
        $minCapacity, ($floor === '' ? null : $floor),
        ($others === '' ? null : $others), ($notes === '' ? null : $notes),
    ]);
    $id = (int)$pdo->lastInsertId();

    // 通知: 全 admin に in-app + Slack
    $condBits = [];
    if ($flags['needs_projector'])  $condBits[] = 'プロジェクター';
    if ($flags['needs_whiteboard']) $condBits[] = 'ホワイトボード';
    if ($flags['needs_screen'])     $condBits[] = 'スクリーン';
    if ($flags['needs_pc'])         $condBits[] = 'PC';
    if ($flags['needs_mic'])        $condBits[] = 'マイク';
    if ($flags['needs_camera'])     $condBits[] = 'カメラ';
    if ($minCapacity)  $condBits[] = "収容 {$minCapacity}人以上";
    if ($floor !== '') $condBits[] = "階: {$floor}";
    $condLine = $condBits ? "\n条件: " . implode(' / ', $condBits) : '';
    $pplLine  = $participants ? " ({$participants}人)" : '';
    $body_notify = "🏫 {$u['display_name']} さんが教室予約依頼: 「{$purpose}」 {$eventDate} "
                 . substr($timeStart, 0, 5) . '〜' . substr($timeEnd, 0, 5) . $pplLine . $condLine;
    notify_admins($pdo, $cfg, 'admin_notice', $body_notify, 'room_request', $id);
    slack_notify($cfg, $body_notify, null, '#/room-requests');

    json_response(['ok' => true, 'id' => $id]);
}

// ─── DETAIL ──────────────────────────────────────────────────
function room_requests_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT r.*,
                                ur.display_name AS requester_name, ur.avatar_url AS requester_avatar,
                                ua.display_name AS resolver_name
                           FROM room_requests r
                           JOIN users ur ON ur.id = r.requester_user_id
                      LEFT JOIN users ua ON ua.id = r.resolved_by_user_id
                          WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    json_response(_room_req_shape($r, (int)$u['id'], (string)$u['role']));
}

// ─── PATCH (依頼者本人 or admin: pending な間だけ内容編集) ─────
function room_requests_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM room_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '編集できるのは依頼者本人か admin のみ', 403);
    }
    if ($r['status'] !== 'pending') {
        throw new ApiException('bad_request', 'pending な依頼のみ編集可能', 400);
    }
    $body = read_json_body();
    $sets = []; $params = [];
    if (isset($body['purpose'])) {
        $p = trim((string)$body['purpose']);
        if ($p === '' || mb_strlen($p) > 200) throw new ApiException('bad_request', '用途は 1〜200 文字', 400);
        $sets[] = 'purpose = ?'; $params[] = $p;
    }
    if (isset($body['event_date'])) {
        $d = trim((string)$body['event_date']);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) throw new ApiException('bad_request', '日付は YYYY-MM-DD', 400);
        $sets[] = 'event_date = ?'; $params[] = $d;
    }
    if (isset($body['time_start'])) {
        $t = trim((string)$body['time_start']);
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $t)) throw new ApiException('bad_request', '時刻は HH:MM', 400);
        $sets[] = 'time_start = ?'; $params[] = $t;
    }
    if (isset($body['time_end'])) {
        $t = trim((string)$body['time_end']);
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $t)) throw new ApiException('bad_request', '時刻は HH:MM', 400);
        $sets[] = 'time_end = ?'; $params[] = $t;
    }
    if (array_key_exists('expected_participants', $body)) {
        $v = $body['expected_participants'];
        $sets[] = 'expected_participants = ?';
        $params[] = ($v === '' || $v === null) ? null : max(1, min(9999, (int)$v));
    }
    if (array_key_exists('min_capacity', $body)) {
        $v = $body['min_capacity'];
        $sets[] = 'min_capacity = ?';
        $params[] = ($v === '' || $v === null) ? null : max(1, min(9999, (int)$v));
    }
    if (array_key_exists('preferred_floor', $body)) {
        $v = trim((string)$body['preferred_floor']);
        if (mb_strlen($v) > 40) throw new ApiException('bad_request', '希望階は 40 文字以下', 400);
        $sets[] = 'preferred_floor = ?'; $params[] = ($v === '' ? null : $v);
    }
    if (array_key_exists('other_conditions', $body)) {
        $v = trim((string)$body['other_conditions']);
        if (mb_strlen($v) > 1000) throw new ApiException('bad_request', '追加条件は 1000 文字以下', 400);
        $sets[] = 'other_conditions = ?'; $params[] = ($v === '' ? null : $v);
    }
    if (array_key_exists('notes', $body)) {
        $v = trim((string)$body['notes']);
        if (mb_strlen($v) > 2000) throw new ApiException('bad_request', '補足は 2000 文字以下', 400);
        $sets[] = 'notes = ?'; $params[] = ($v === '' ? null : $v);
    }
    foreach (['needs_projector','needs_whiteboard','needs_screen','needs_pc','needs_mic','needs_camera'] as $k) {
        if (array_key_exists($k, $body)) {
            $sets[] = "$k = ?"; $params[] = !empty($body[$k]) ? 1 : 0;
        }
    }
    if (!$sets) { json_response(['ok' => true, 'unchanged' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE room_requests SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    json_response(['ok' => true]);
}

// ─── CANCEL (依頼者本人 or admin による取消) ─────────────────
function room_requests_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM room_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '取消できるのは依頼者本人か admin のみ', 403);
    }
    if ($r['status'] !== 'pending') {
        throw new ApiException('bad_request', 'pending な依頼のみ取消可能', 400);
    }
    $pdo->prepare("UPDATE room_requests SET status='cancelled', resolved_by_user_id=?, resolved_at=NOW() WHERE id=?")
        ->execute([$u['id'], $id]);
    json_response(['ok' => true]);
}

// ─── CONFIRM (admin のみ: 教室押さえたよ + room_assigned + note) ─
function room_requests_confirm(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM room_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    if ($r['status'] !== 'pending') {
        throw new ApiException('bad_request', 'pending な依頼のみ確定可', 400);
    }
    $body = read_json_body();
    $room = trim((string)require_field($body, 'room_assigned'));
    $note = trim((string)($body['admin_note'] ?? ''));
    if ($room === '' || mb_strlen($room) > 120) throw new ApiException('bad_request', '教室名は 1〜120 文字', 400);
    if (mb_strlen($note) > 2000) throw new ApiException('bad_request', 'note は 2000 文字以下', 400);

    $pdo->prepare("UPDATE room_requests
                      SET status='confirmed', room_assigned=?, admin_note=?,
                          resolved_by_user_id=?, resolved_at=NOW() WHERE id=?")
        ->execute([$room, ($note === '' ? null : $note), $u['id'], $id]);

    $noteLine = $note !== '' ? " / {$note}" : '';
    $dateLine = $r['event_date'] . ' ' . substr($r['time_start'], 0, 5) . '〜' . substr($r['time_end'], 0, 5);
    notify_safely($pdo, $cfg, (int)$r['requester_user_id'], 'admin_notice',
        "🏫✅ 教室確定: 「{$r['purpose']}」 {$dateLine} → {$room}{$noteLine}",
        'room_request', $id);
    slack_notify($cfg, "🏫✅ 教室確定: 「{$r['purpose']}」 {$dateLine} → {$room}{$noteLine}", null, '#/room-requests');

    json_response(['ok' => true]);
}

// ─── DECLINE (admin のみ) ────────────────────────────────────
function room_requests_decline(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM room_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    if ($r['status'] !== 'pending') {
        throw new ApiException('bad_request', 'pending な依頼のみ却下可', 400);
    }
    $body = read_json_body();
    $note = trim((string)($body['admin_note'] ?? ''));
    if (mb_strlen($note) > 2000) throw new ApiException('bad_request', 'note は 2000 文字以下', 400);

    $pdo->prepare("UPDATE room_requests
                      SET status='declined', admin_note=?, resolved_by_user_id=?, resolved_at=NOW()
                    WHERE id=?")
        ->execute([($note === '' ? null : $note), $u['id'], $id]);

    $noteLine = $note !== '' ? "\n理由: {$note}" : '';
    notify_safely($pdo, $cfg, (int)$r['requester_user_id'], 'admin_notice',
        "🏫❌ 教室予約 却下: 「{$r['purpose']}」{$noteLine}", 'room_request', $id);

    json_response(['ok' => true]);
}

// ─── REOPEN (admin: 確定/却下/取消 を pending に戻す) ────────
function room_requests_reopen(PDO $pdo, array $cfg, int $id): void {
    Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT status FROM room_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "room_request $id not found", 404);
    if ($r['status'] === 'pending') { json_response(['ok' => true, 'unchanged' => true]); return; }
    $pdo->prepare("UPDATE room_requests SET status='pending', room_assigned=NULL, admin_note=NULL,
                                             resolved_by_user_id=NULL, resolved_at=NULL WHERE id=?")
        ->execute([$id]);
    json_response(['ok' => true]);
}
