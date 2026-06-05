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
        // v447 ラップ。 client が 観測した 累計 ms を 送ってくる (タップ瞬間 を 正確に
        // 反映 するため)。 サーバは バリデーション (prev_lap 以上 / 現在 elapsed_ms 以下)
        // 後 insert。
        if ($op === 'lap'   && $method === 'POST') { stopwatches_lap($pdo, $cfg, $id);   return; }
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

// v447 ms 精度 で 計算。 ms が primary、 秒は floor 後方互換用。
// running 中: elapsed_offset_ms + (now_ms - started_at_ms)。 started_at_ms が 落ちて
// いる 古いデータ では started_at (秒精度) に フォールバック。
function stopwatch_elapsed_ms(array $sw): int {
    $base = (int)($sw['elapsed_offset_ms'] ?? 0);
    if (!$base && (int)($sw['elapsed_offset_seconds'] ?? 0) > 0) {
        $base = (int)$sw['elapsed_offset_seconds'] * 1000;
    }
    if ($sw['status'] === 'running') {
        $nowMs = (int) floor(microtime(true) * 1000);
        if (!empty($sw['started_at_ms'])) {
            $base += max(0, $nowMs - (int)$sw['started_at_ms']);
        } elseif (!empty($sw['started_at'])) {
            // 旧データ 用 フォールバック (秒精度)
            $base += max(0, ($nowMs - strtotime((string)$sw['started_at']) * 1000));
        }
    }
    return $base;
}
function stopwatch_elapsed(array $sw): int {
    return (int) floor(stopwatch_elapsed_ms($sw) / 1000);
}

function stopwatches_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 自分が creator または participant の もの。 v447 ms 列 も 返す。
    $st = $pdo->prepare("
        SELECT DISTINCT s.id, s.title, s.status,
               s.started_at, s.started_at_ms,
               s.elapsed_offset_seconds, s.elapsed_offset_ms,
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
        $r['elapsed_offset_ms']        = (int)$r['elapsed_offset_ms'];
        $r['started_at_ms']            = isset($r['started_at_ms']) ? (int)$r['started_at_ms'] : null;
        $r['participant_count']        = (int)$r['participant_count'];
        $r['elapsed_ms']               = stopwatch_elapsed_ms($r);
        $r['elapsed_seconds']          = (int) floor($r['elapsed_ms'] / 1000);
        $r['is_mine']                  = (int)$r['creator_user_id'] === (int)$u['id'];
    }
    unset($r);
    json_response([
        'items' => $rows,
        'server_now' => date('c'),
        'server_now_ms' => (int) floor(microtime(true) * 1000),
    ]);
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
    // v447 ラップ (新しい順)
    $stL = $pdo->prepare("
        SELECT l.id, l.lap_index, l.elapsed_ms, l.split_ms, l.recorded_at,
               l.recorded_by_user_id, u.display_name AS recorded_by_name
          FROM stopwatch_laps l
          LEFT JOIN users u ON u.id = l.recorded_by_user_id
         WHERE l.stopwatch_id = ?
         ORDER BY l.lap_index DESC
         LIMIT 200");
    $stL->execute([$id]);
    $laps = $stL->fetchAll(PDO::FETCH_ASSOC);
    foreach ($laps as &$lap) {
        $lap['id']         = (int)$lap['id'];
        $lap['lap_index']  = (int)$lap['lap_index'];
        $lap['elapsed_ms'] = (int)$lap['elapsed_ms'];
        $lap['split_ms']   = (int)$lap['split_ms'];
        $lap['recorded_by_user_id'] = (int)$lap['recorded_by_user_id'];
    }
    unset($lap);
    $sw['id']                     = (int)$sw['id'];
    $sw['elapsed_offset_seconds'] = (int)$sw['elapsed_offset_seconds'];
    $sw['elapsed_offset_ms']      = (int)$sw['elapsed_offset_ms'];
    $sw['started_at_ms']          = isset($sw['started_at_ms']) ? (int)$sw['started_at_ms'] : null;
    $sw['creator_user_id']        = (int)$sw['creator_user_id'];
    $sw['creator_name']           = $c['display_name'] ?? '';
    $sw['creator_avatar_url']     = $c['avatar_url'] ?? null;
    $sw['participants']           = $participants;
    $sw['laps']                   = $laps;
    $sw['elapsed_ms']             = stopwatch_elapsed_ms($sw);
    $sw['elapsed_seconds']        = (int) floor($sw['elapsed_ms'] / 1000);
    $sw['is_mine']                = (int)$sw['creator_user_id'] === (int)$u['id'];
    $sw['server_now']             = date('c');
    $sw['server_now_ms']          = (int) floor(microtime(true) * 1000);
    json_response($sw);
}

function stopwatches_start(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    if ($sw['status'] === 'running') {
        json_response(['ok' => true, 'noop' => true, 'elapsed_ms' => stopwatch_elapsed_ms($sw)]);
        return;
    }
    $nowMs = (int) floor(microtime(true) * 1000);
    $pdo->prepare("UPDATE stopwatches
                      SET status='running', started_at=NOW(), started_at_ms=?, ended_at=NULL
                    WHERE id=?")
        ->execute([$nowMs, $id]);
    json_response(['ok' => true]);
}

function stopwatches_pause(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    if ($sw['status'] !== 'running') {
        json_response(['ok' => true, 'noop' => true]);
        return;
    }
    $accMs = stopwatch_elapsed_ms($sw);
    $accSec = (int) floor($accMs / 1000);
    $pdo->prepare("UPDATE stopwatches
                      SET status='paused',
                          elapsed_offset_ms=?, elapsed_offset_seconds=?,
                          started_at=NULL, started_at_ms=NULL
                    WHERE id=?")
        ->execute([$accMs, $accSec, $id]);
    json_response(['ok' => true, 'elapsed_ms' => $accMs, 'elapsed_seconds' => $accSec]);
}

function stopwatches_reset(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    db_tx($pdo, function () use ($pdo, $id) {
        $pdo->prepare("UPDATE stopwatches
                          SET status='stopped',
                              elapsed_offset_seconds=0, elapsed_offset_ms=0,
                              started_at=NULL, started_at_ms=NULL,
                              ended_at=NOW()
                        WHERE id=?")->execute([$id]);
        // v447 ラップ も 0 戻し に 合わせ 全削除。
        $pdo->prepare("DELETE FROM stopwatch_laps WHERE stopwatch_id=?")->execute([$id]);
    });
    json_response(['ok' => true]);
}

// v447 ラップ 記録。 動作中 のみ 受付。 client_elapsed_ms が 付いて 来たら
// 「タップ瞬間 を 正確に」 用に それ を 採用 (送信遅延 を 補正)。 妥当性:
// 0 以上 / 直前ラップ 以上 / サーバ算定 elapsed_ms + 200ms 以下 (改竄防止)。
function stopwatches_lap(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sw = stopwatches_assert_access($pdo, $id, (int)$u['id']);
    if ($sw['status'] !== 'running') {
        throw new ApiException('bad_state', '動作中 のみ ラップ 可能 です', 400);
    }
    $body = read_json_body();
    $serverElapsedMs = stopwatch_elapsed_ms($sw);
    $useMs = $serverElapsedMs;
    if (isset($body['client_elapsed_ms']) && is_numeric($body['client_elapsed_ms'])) {
        $candidate = (int)$body['client_elapsed_ms'];
        if ($candidate >= 0 && $candidate <= $serverElapsedMs + 200) {
            $useMs = $candidate;
        }
    }
    $st = $pdo->prepare("SELECT COALESCE(MAX(elapsed_ms), 0) AS prev,
                                COALESCE(MAX(lap_index), 0) AS prev_idx
                           FROM stopwatch_laps
                          WHERE stopwatch_id=?");
    $st->execute([$id]);
    $prev = $st->fetch(PDO::FETCH_ASSOC) ?: ['prev'=>0, 'prev_idx'=>0];
    $prevMs  = (int)$prev['prev'];
    $prevIdx = (int)$prev['prev_idx'];
    if ($useMs < $prevMs) $useMs = $prevMs;  // 安全マージン
    $splitMs = $useMs - $prevMs;
    $pdo->prepare("INSERT INTO stopwatch_laps
        (stopwatch_id, lap_index, elapsed_ms, split_ms, recorded_by_user_id, recorded_at)
        VALUES (?, ?, ?, ?, ?, NOW())")
        ->execute([$id, $prevIdx + 1, $useMs, $splitMs, (int)$u['id']]);
    json_response([
        'ok' => true,
        'lap_index'  => $prevIdx + 1,
        'elapsed_ms' => $useMs,
        'split_ms'   => $splitMs,
    ]);
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
