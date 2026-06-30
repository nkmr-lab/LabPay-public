<?php
// /api/bait — アルバイト申請依頼 (#244)。
// 依頼 (bait_requests) と各 worker への assignment (bait_assignments) を管理。
//
// 依頼者: 時間 (小数点) + 対象者 + 用途で依頼を作成、進捗確認 + 未処理者催促。
// 受け取った側 (worker): 自分宛ての依頼リストを月別で見て、申請処理後に done に。

declare(strict_types=1);

function route_bait(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    // v823 #416 list / detail の優先順が逆で「/api/bait/requests/<id>」まで list に
    //   食われていた (= detail が「{items: ...}」を返し client で r.title undefined)。
    //   先に detail 系をチェックして残った場合のみ list に落とす。
    if ($sub === 'requests' && ctype_digit((string)($seg[2] ?? ''))) {
        $rid = (int)$seg[2];
        $next = $seg[3] ?? '';
        if ($next === '' && $method === 'GET')           { bait_detail($pdo, $cfg, $rid);  return; }
        if ($next === '' && $method === 'DELETE')        { bait_delete($pdo, $cfg, $rid);  return; }
        if ($next === 'remind' && $method === 'POST')    { bait_remind($pdo, $cfg, $rid);  return; }
        if ($next === 'close'  && $method === 'PATCH')   { bait_close($pdo, $cfg, $rid);   return; }
    }
    if ($sub === 'requests' && $method === 'GET'  && !isset($seg[2])) { bait_list($pdo, $cfg);   return; }
    if ($sub === 'requests' && $method === 'POST' && !isset($seg[2])) { bait_create($pdo, $cfg); return; }
    if ($sub === 'my-assignments' && $method === 'GET') { bait_my_assignments($pdo, $cfg); return; }
    if ($sub === 'assignments' && ctype_digit((string)($seg[2] ?? ''))) {
        $aid = (int)$seg[2];
        $next = $seg[3] ?? '';
        if ($next === 'done'    && $method === 'PATCH') { bait_assignment_done($pdo, $cfg, $aid, true);  return; }
        if ($next === 'undone'  && $method === 'PATCH') { bait_assignment_done($pdo, $cfg, $aid, false); return; }
    }
    json_error('not_found', "no bait route for $method $sub", 404);
}

// ─── LIST (自分が requester or worker) ────────────────────
function bait_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT r.id, r.title, r.period, r.notes, r.requester_user_id, r.created_at, r.closed_at,
               ur.display_name AS requester_name,
               (SELECT COUNT(*) FROM bait_assignments a WHERE a.bait_request_id=r.id) AS total_n,
               (SELECT COUNT(*) FROM bait_assignments a WHERE a.bait_request_id=r.id AND a.status='done') AS done_n,
               (SELECT SUM(hours) FROM bait_assignments a WHERE a.bait_request_id=r.id) AS total_hours,
               EXISTS(SELECT 1 FROM bait_assignments a WHERE a.bait_request_id=r.id AND a.worker_user_id=?) AS i_am_worker
          FROM bait_requests r
          JOIN users ur ON ur.id = r.requester_user_id
         WHERE r.requester_user_id=?
            OR EXISTS(SELECT 1 FROM bait_assignments a WHERE a.bait_request_id=r.id AND a.worker_user_id=?)
         ORDER BY r.period DESC, r.id DESC
         LIMIT 200");
    $st->execute([$uid, $uid, $uid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── MY ASSIGNMENTS (worker 視点で月別で全部見える) ────────────
function bait_my_assignments(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT a.id, a.bait_request_id, a.hours, a.status, a.processed_at, a.worker_note,
               r.title, r.period, r.notes, r.requester_user_id,
               ur.display_name AS requester_name
          FROM bait_assignments a
          JOIN bait_requests   r  ON r.id = a.bait_request_id
          JOIN users           ur ON ur.id = r.requester_user_id
         WHERE a.worker_user_id = ?
         ORDER BY r.period DESC, r.id DESC, a.id DESC
         LIMIT 500");
    $st->execute([$uid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── CREATE ─────────────────────────────────────────────
function bait_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $period = (string)($body['period'] ?? '');
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period)) {
        throw new ApiException('bad_request', 'period は YYYY-MM 形式', 400);
    }
    $notes = isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 2000) : null;
    if ($notes === '') $notes = null;
    // assignments[] = [{user_id, hours}]
    $assignments = $body['assignments'] ?? [];
    if (!is_array($assignments) || !count($assignments)) {
        throw new ApiException('bad_request', 'assignments は 1 件以上', 400);
    }
    if (count($assignments) > 100) {
        throw new ApiException('bad_request', 'assignments は 100 件以下', 400);
    }
    // validate
    $normalized = [];
    foreach ($assignments as $a) {
        $wid = (int)($a['user_id'] ?? 0);
        $h   = (float)($a['hours'] ?? 0);
        if ($wid <= 0)               throw new ApiException('bad_request', 'user_id 不正', 400);
        if ($h <= 0 || $h > 999.99)  throw new ApiException('bad_request', 'hours は 0 超 〜 999.99', 400);
        $normalized[] = ['user_id' => $wid, 'hours' => round($h, 2)];
    }
    // user 存在 chk
    $uids = array_column($normalized, 'user_id');
    $in = implode(',', array_fill(0, count($uids), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in) AND kind='human'");
    $stU->execute($uids);
    if ((int)$stU->fetchColumn() !== count($uids)) {
        throw new ApiException('bad_request', '存在しない user_id が含まれています', 400);
    }
    $rid = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $period, $notes, $normalized, &$rid) {
        $ins = $pdo->prepare("INSERT INTO bait_requests (requester_user_id, title, period, notes) VALUES (?, ?, ?, ?)");
        $ins->execute([(int)$u['id'], $title, $period, $notes]);
        $rid = (int)$pdo->lastInsertId();
        $stA = $pdo->prepare("INSERT INTO bait_assignments (bait_request_id, worker_user_id, hours) VALUES (?, ?, ?)");
        foreach ($normalized as $a) {
            $stA->execute([$rid, $a['user_id'], $a['hours']]);
        }
    });
    // 通知 (各 worker に「アルバイト申請が来ました」)
    foreach ($normalized as $a) {
        try {
            Notifier::notify($pdo, $cfg, $a['user_id'], 'admin_notice',
                "💼 アルバイト申請が届きました: 「{$title}」 ({$a['hours']} h) / 期間 {$period}",
                'bait_request', $rid);
        } catch (Throwable $_) {}
    }
    json_response(['id' => $rid]);
}

// ─── DETAIL ─────────────────────────────────────────────
function bait_detail(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT r.*, ur.display_name AS requester_name
                           FROM bait_requests r JOIN users ur ON ur.id=r.requester_user_id
                          WHERE r.id=?");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼がありません', 404);
    $isReq = (int)$r['requester_user_id'] === $uid;
    $stA = $pdo->prepare("SELECT a.id, a.worker_user_id, a.hours, a.status, a.processed_at, a.worker_note,
                                 u.display_name AS worker_name, u.avatar_url, u.grade
                            FROM bait_assignments a
                            JOIN users u ON u.id = a.worker_user_id
                           WHERE a.bait_request_id = ?
                           ORDER BY (a.status='done') ASC,
                                    CASE u.grade
                                      WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                      WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                      WHEN 'D'  THEN 5 ELSE 99 END,
                                    u.display_name");
    $stA->execute([$rid]);
    $assignments = $stA->fetchAll(PDO::FETCH_ASSOC);
    $isWorker = false;
    foreach ($assignments as $a) {
        if ((int)$a['worker_user_id'] === $uid) $isWorker = true;
    }
    if (!$isReq && !$isWorker) {
        throw new ApiException('forbidden', '依頼者か対象者のみ閲覧可', 403);
    }
    json_response([
        'request' => [
            'id'                => (int)$r['id'],
            'title'             => $r['title'],
            'period'            => $r['period'],
            'notes'             => $r['notes'],
            'requester_user_id' => (int)$r['requester_user_id'],
            'requester_name'    => $r['requester_name'],
            'created_at'        => $r['created_at'],
            'closed_at'         => $r['closed_at'],
        ],
        'i_am_requester' => $isReq,
        'i_am_worker'    => $isWorker,
        'assignments'    => array_map(fn($a) => [
            'id'             => (int)$a['id'],
            'worker_user_id' => (int)$a['worker_user_id'],
            'worker_name'    => $a['worker_name'],
            'avatar_url'     => $a['avatar_url'],
            'grade'          => $a['grade'] ?? '',
            'hours'          => (float)$a['hours'],
            'status'         => $a['status'],
            'processed_at'   => $a['processed_at'],
            'worker_note'    => $a['worker_note'],
        ], $assignments),
    ]);
}

// ─── WORKER: 自分の assignment を done / undone に ──────────────
function bait_assignment_done(PDO $pdo, array $cfg, int $aid, bool $done): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $note = isset($body['note']) ? mb_substr((string)$body['note'], 0, 500) : null;
    if ($note === '') $note = null;
    $st = $pdo->prepare("SELECT worker_user_id, bait_request_id FROM bait_assignments WHERE id=?");
    $st->execute([$aid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'assignment がありません', 404);
    if ((int)$row['worker_user_id'] !== $uid) {
        throw new ApiException('forbidden', '自分の assignment のみ更新可', 403);
    }
    if ($done) {
        $pdo->prepare("UPDATE bait_assignments SET status='done', processed_at=NOW(), worker_note=? WHERE id=?")
            ->execute([$note, $aid]);
    } else {
        $pdo->prepare("UPDATE bait_assignments SET status='pending', processed_at=NULL WHERE id=?")
            ->execute([$aid]);
    }
    json_response(['ok' => true]);
}

// ─── REMIND (依頼者が未処理者に催促) ──────────────────────
function bait_remind(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT title, period, requester_user_id FROM bait_requests WHERE id=?");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼がありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '依頼者のみ催促可', 403);
    }
    $stP = $pdo->prepare("SELECT worker_user_id, hours FROM bait_assignments WHERE bait_request_id=? AND status='pending'");
    $stP->execute([$rid]);
    $pending = $stP->fetchAll(PDO::FETCH_ASSOC);
    $sent = 0;
    foreach ($pending as $p) {
        try {
            Notifier::notify($pdo, $cfg, (int)$p['worker_user_id'], 'admin_notice',
                "💼 アルバイト申請まだです: 「{$r['title']}」 ({$p['hours']} h) / 期間 {$r['period']}",
                'bait_request', $rid);
            $sent++;
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'sent' => $sent, 'pending' => count($pending)]);
}

// ─── CLOSE (依頼自体を完了マーク) ─────────────────────────
function bait_close(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT requester_user_id, closed_at FROM bait_requests WHERE id=?");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼がありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '依頼者のみクローズ可', 403);
    }
    if ($r['closed_at']) { json_response(['ok' => true, 'already' => true]); return; }
    $pdo->prepare("UPDATE bait_requests SET closed_at=NOW() WHERE id=?")->execute([$rid]);
    json_response(['ok' => true]);
}

// ─── DELETE ─────────────────────────────────────────────
function bait_delete(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT requester_user_id FROM bait_requests WHERE id=?");
    $st->execute([$rid]);
    $reqId = (int)$st->fetchColumn();
    if (!$reqId) throw new ApiException('not_found', '依頼がありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($reqId !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '依頼者のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM bait_requests WHERE id=?")->execute([$rid]);
    json_response(['ok' => true]);
}
