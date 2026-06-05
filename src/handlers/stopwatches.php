<?php
// /api/stopwatches — 共有 ストップウォッチ (カウントアップ)。
//   - status: running / paused / stopped
//   - 経過時間 = elapsed_offset_seconds + (running なら NOW - started_at)
//   - participants = 表示権限 (creator + 招待した メンバー)
//   - 操作権限: 開始/停止/リセット は creator も participants も 全員 可

declare(strict_types=1);

function route_stopwatches(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET')  { stopwatches_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { stopwatches_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $op = $seg[2] ?? '';
        if ($op === '' && $method === 'GET')    { stopwatches_detail($pdo, $cfg, $id); return; }
        if ($op === '' && $method === 'DELETE') { stopwatches_delete($pdo, $cfg, $id); return; }
        if ($op === 'start' && $method === 'POST') { stopwatches_start($pdo, $cfg, $id); return; }
        if ($op === 'pause' && $method === 'POST') { stopwatches_pause($pdo, $cfg, $id); return; }
        if ($op === 'reset' && $method === 'POST') { stopwatches_reset($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no stopwatches route for $method $sub", 404);
}

function stopwatches_assert_access(PDO $pdo, int $id, int $userId): array {
    $st = $pdo->prepare("SELECT * FROM stopwatches WHERE id=?");
    $st->execute([$id]);
    $sw = $st->fetch(PDO::FETCH_ASSOC);
    if (!$sw) throw new ApiException('not_found', 'stopwatch not found', 404);
    if ((int)$sw['creator_user_id'] !== $userId) {
        $stP = $pdo->prepare("SELECT 1 FROM stopwatch_participants WHERE stopwatch_id=? AND user_id=?");
        $stP->execute([$id, $userId]);
        if (!$stP->fetchColumn()) {
            throw new ApiException('forbidden', '参加者ではありません', 403);
        }
    }
    return $sw;
}

// 経過秒数 を server 視点で 計算。 status='running' の場合 NOW - started_at を足す。
function stopwatch_elapsed(array $sw): int {
    $base = (int)$sw['elapsed_offset_seconds'];
    if ($sw['status'] === 'running' && $sw['started_at']) {
        $base += max(0, time() - strtotime((string)$sw['started_at']));
    }
    return $base;
}

function stopwatches_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 自分が creator または participant の もの。
    $st = $pdo->prepare("
        SELECT DISTINCT s.id, s.title, s.status, s.started_at, s.elapsed_offset_seconds,
               s.creator_user_id, s.ended_at, s.created_at, s.updated_at,
               uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url,
               (SELECT COUNT(*) FROM stopwatch_participants WHERE stopwatch_id = s.id) AS participant_count
          FROM stopwatches s
          JOIN users uc ON uc.id = s.creator_user_id
          LEFT JOIN stopwatch_participants sp ON sp.stopwatch_id = s.id
         WHERE s.creator_user_id = ? OR sp.user_id = ?
         ORDER BY (s.status = 'running') DESC, s.updated_at DESC
         LIMIT 50");
    $st->execute([$u['id'], $u['id']]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']                       = (int)$r['id'];
        $r['elapsed_offset_seconds']   = (int)$r['elapsed_offset_seconds'];
        $r['participant_count']        = (int)$r['participant_count'];
        $r['elapsed_seconds']          = stopwatch_elapsed($r);
        $r['is_mine']                  = (int)$r['creator_user_id'] === (int)$u['id'];
    }
    unset($r);
    json_response(['items' => $rows, 'server_now' => date('c')]);
}

function stopwatches_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $partIds = $body['participant_ids'] ?? [];
    if (!is_array($partIds)) $partIds = [];
    $partIds = array_values(array_unique(array_filter(array_map('intval', $partIds))));
    // creator 自身は participants に 入れる (重複なら DUP KEY で 弾く)
    $partIds[] = (int)$u['id'];
    $partIds = array_values(array_unique($partIds));
    // 存在チェック
    if ($partIds) {
        $place = implode(',', array_fill(0, count($partIds), '?'));
        $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($place) AND kind='human'");
        $stU->execute($partIds);
        if ((int)$stU->fetchColumn() !== count($partIds)) {
            throw new ApiException('bad_request', 'unknown user_id in participant_ids', 400);
        }
    }
    $id = db_tx($pdo, function () use ($pdo, $u, $title, $partIds) {
        $pdo->prepare("INSERT INTO stopwatches (title, creator_user_id) VALUES (?, ?)")
            ->execute([$title, (int)$u['id']]);
        $newId = (int)$pdo->lastInsertId();
        $stP = $pdo->prepare("INSERT INTO stopwatch_participants (stopwatch_id, user_id) VALUES (?, ?)");
        foreach ($partIds as $uid) $stP->execute([$newId, $uid]);
        return $newId;
    });
    json_response(['ok' => true, 'id' => $id]);
}

function stopwatches_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    // 作者情報
    $stC = $pdo->prepare("SELECT display_name, avatar_url FROM users WHERE id=?");
    $stC->execute([$sw['creator_user_id']]);
    $c = $stC->fetch(PDO::FETCH_ASSOC) ?: [];
    // 参加者
    $stP = $pdo->prepare("
        SELECT u.id, u.display_name, u.avatar_url, sp.added_at
          FROM stopwatch_participants sp
          JOIN users u ON u.id = sp.user_id
         WHERE sp.stopwatch_id = ?
         ORDER BY sp.added_at, u.id");
    $stP->execute([$id]);
    $participants = $stP->fetchAll(PDO::FETCH_ASSOC);
    $sw['id']                     = (int)$sw['id'];
    $sw['elapsed_offset_seconds'] = (int)$sw['elapsed_offset_seconds'];
    $sw['creator_user_id']        = (int)$sw['creator_user_id'];
    $sw['creator_name']           = $c['display_name'] ?? '';
    $sw['creator_avatar_url']     = $c['avatar_url'] ?? null;
    $sw['participants']           = $participants;
    $sw['elapsed_seconds']        = stopwatch_elapsed($sw);
    $sw['is_mine']                = (int)$sw['creator_user_id'] === (int)$u['id'];
    $sw['server_now']             = date('c');
    json_response($sw);
}

function stopwatches_start(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    if ($sw['status'] === 'running') {
        json_response(['ok' => true, 'noop' => true, 'elapsed_seconds' => stopwatch_elapsed($sw)]);
        return;
    }
    $pdo->prepare("UPDATE stopwatches SET status='running', started_at=NOW(), ended_at=NULL WHERE id=?")
        ->execute([$id]);
    json_response(['ok' => true]);
}

function stopwatches_pause(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    if ($sw['status'] !== 'running') {
        json_response(['ok' => true, 'noop' => true]);
        return;
    }
    $accumulated = stopwatch_elapsed($sw);
    $pdo->prepare("UPDATE stopwatches SET status='paused', elapsed_offset_seconds=?, started_at=NULL WHERE id=?")
        ->execute([$accumulated, $id]);
    json_response(['ok' => true, 'elapsed_seconds' => $accumulated]);
}

function stopwatches_reset(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    $pdo->prepare("UPDATE stopwatches SET status='stopped', elapsed_offset_seconds=0, started_at=NULL, ended_at=NOW() WHERE id=?")
        ->execute([$id]);
    json_response(['ok' => true]);
}

function stopwatches_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM stopwatches WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'stopwatch not found', 404);
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '作成者のみ削除できます', 403);
    }
    $pdo->prepare("DELETE FROM stopwatches WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
