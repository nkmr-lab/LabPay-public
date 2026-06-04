<?php
// /api/timers — 共有タイマー。 参加者全員で 同じカウントダウンを見る。
// サーバが started_at / ends_at の真実を持つ。 detail は server_now を返し、
// client が ローカル時計とのオフセットを取って カウントダウン表示する。

declare(strict_types=1);

function route_timers(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { timers_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { timers_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { timers_detail($pdo, $cfg, $id); return; }
        if ($next === ''       && $method === 'DELETE') { timers_delete($pdo, $cfg, $id); return; }
        if ($next === 'cancel' && $method === 'PATCH')  { timers_cancel($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no timers route for $method $sub", 404);
}

function timers_autoclose(PDO $pdo): void {
    $pdo->exec("UPDATE timers SET status='done', closed_at=NOW()
                 WHERE status='running' AND ends_at <= NOW()");
}

function timers_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    timers_autoclose($pdo);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT t.id, t.title, t.duration_seconds, t.started_at, t.ends_at, t.status,
               t.creator_user_id, u.display_name AS creator_name,
               EXISTS(SELECT 1 FROM timer_participants tp WHERE tp.timer_id=t.id AND tp.user_id=?) AS is_participant
          FROM timers t
          JOIN users u ON u.id = t.creator_user_id
         WHERE t.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM timer_participants tp2 WHERE tp2.timer_id=t.id AND tp2.user_id=?)
         ORDER BY (t.status='running') DESC, t.ends_at DESC, t.id DESC
         LIMIT 100");
    $st->execute([$uid, $uid, $uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    json_response([
        'items' => $items,
        'server_now' => date('Y-m-d H:i:s'),
    ]);
}

function timers_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $dur = (int)($body['duration_seconds'] ?? 0);
    if ($dur < 5 || $dur > 24 * 3600) {
        throw new ApiException('bad_request', 'duration_seconds 5..86400', 400);
    }
    $participantIds = $body['participant_ids'] ?? [];
    if (!is_array($participantIds)) {
        throw new ApiException('bad_request', 'participant_ids 配列', 400);
    }
    $participantIds = array_values(array_unique(array_filter(array_map('intval', $participantIds))));
    // 起案者も自動で参加者に。
    if (!in_array((int)$u['id'], $participantIds, true)) $participantIds[] = (int)$u['id'];
    if (count($participantIds) > 200) {
        throw new ApiException('bad_request', '参加者数 200 まで', 400);
    }
    $in = implode(',', array_fill(0, count($participantIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
    $stU->execute($participantIds);
    if ((int)$stU->fetchColumn() !== count($participantIds)) {
        throw new ApiException('bad_request', '存在しない user_id が含まれます', 400);
    }
    $started = date('Y-m-d H:i:s');
    $ends    = date('Y-m-d H:i:s', time() + $dur);
    $tid = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $dur, $started, $ends, $participantIds, &$tid) {
        $ins = $pdo->prepare("INSERT INTO timers
            (title, creator_user_id, duration_seconds, started_at, ends_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'running', NOW())");
        $ins->execute([$title, (int)$u['id'], $dur, $started, $ends]);
        $tid = (int)$pdo->lastInsertId();
        $stP = $pdo->prepare("INSERT INTO timer_participants (timer_id, user_id) VALUES (?, ?)");
        foreach ($participantIds as $uid) $stP->execute([$tid, $uid]);
    });
    // 通知 (自分以外の参加者へ)
    foreach ($participantIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'timer',
                "⏱️ タイマー: 「{$title}」 (" . timer_fmt_short($dur) . ")",
                'timer', $tid);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['id' => $tid]);
}

function timer_fmt_short(int $sec): string {
    if ($sec >= 3600) return floor($sec / 3600) . "h" . str_pad((string)(floor(($sec % 3600) / 60)), 2, "0", STR_PAD_LEFT) . "m";
    if ($sec >= 60) return floor($sec / 60) . "分";
    return "{$sec}秒";
}

function timers_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    timers_autoclose($pdo);
    $st = $pdo->prepare("SELECT t.*, u.display_name AS creator_name
                           FROM timers t
                           JOIN users u ON u.id = t.creator_user_id
                          WHERE t.id = ?");
    $st->execute([$id]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isCreator = (int)$t['creator_user_id'] === (int)$u['id'];
    $stP = $pdo->prepare("SELECT tp.user_id, us.display_name, us.avatar_url, us.grade
                           FROM timer_participants tp
                           JOIN users us ON us.id = tp.user_id
                          WHERE tp.timer_id = ?
                          ORDER BY CASE us.grade
                                     WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                     WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                     WHEN 'D'  THEN 5 ELSE 99 END,
                                   us.display_name");
    $stP->execute([$id]);
    $participants = $stP->fetchAll(PDO::FETCH_ASSOC);
    $isParticipant = false;
    foreach ($participants as $p) if ((int)$p['user_id'] === (int)$u['id']) { $isParticipant = true; break; }
    if (!$isCreator && !$isParticipant) {
        throw new ApiException('forbidden', 'このタイマーの参加者または起案者のみ閲覧可', 403);
    }
    json_response([
        'timer' => [
            'id'               => (int)$t['id'],
            'title'            => $t['title'],
            'creator_user_id'  => (int)$t['creator_user_id'],
            'creator_name'     => $t['creator_name'],
            'duration_seconds' => (int)$t['duration_seconds'],
            'started_at'       => $t['started_at'],
            'ends_at'          => $t['ends_at'],
            'status'           => $t['status'],
            'created_at'       => $t['created_at'],
            'closed_at'        => $t['closed_at'],
        ],
        'is_creator'     => $isCreator,
        'is_participant' => $isParticipant,
        'participants'   => array_map(fn($p) => [
            'user_id'      => (int)$p['user_id'],
            'display_name' => $p['display_name'],
            'avatar_url'   => $p['avatar_url'],
            'grade'        => $p['grade'] ?? '',
        ], $participants),
        'server_now'     => date('Y-m-d H:i:s'),
    ]);
}

function timers_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status FROM timers WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ停止可', 403);
    }
    if ((string)$row['status'] !== 'running') {
        json_response(['ok' => true, 'already' => true]); return;
    }
    $pdo->prepare("UPDATE timers SET status='cancelled', closed_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function timers_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM timers WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM timers WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
