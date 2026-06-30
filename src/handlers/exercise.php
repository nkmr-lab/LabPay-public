<?php
// /api/exercise — 運動 (歩数) セッション。 端末側で DeviceMotion を読んで
// 歩数をカウント → 終了時に 1 セッション分を POST。
// Routes:
//   GET    /api/exercise            自分のセッション履歴 + 集計
//   POST   /api/exercise            セッション記録
//   DELETE /api/exercise/:id        セッション削除 (自分のみ)
//   GET    /api/exercise/leaderboard  みんなの今週 step 合計

declare(strict_types=1);

function route_exercise(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { exercise_my($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { exercise_create($pdo, $cfg); return; }
    if ($sub === 'leaderboard' && $method === 'GET') { exercise_board($pdo, $cfg); return; }
    if (ctype_digit((string)$sub) && $method === 'DELETE') { exercise_delete($pdo, $cfg, (int)$sub); return; }
    json_error('not_found', "no exercise route for $method $sub", 404);
}

function exercise_my(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, step_count, duration_seconds, started_at, ended_at, note, created_at
                          FROM exercise_sessions WHERE user_id = ?
                         ORDER BY started_at DESC LIMIT 50");
    $st->execute([$uid]);
    $sessions = $st->fetchAll(PDO::FETCH_ASSOC);
    $totals = $pdo->prepare("SELECT
        COALESCE(SUM(CASE WHEN DATE(started_at)=CURDATE() THEN step_count END), 0) AS today,
        COALESCE(SUM(CASE WHEN YEARWEEK(started_at, 1)=YEARWEEK(CURDATE(), 1) THEN step_count END), 0) AS this_week,
        COALESCE(SUM(CASE WHEN DATE_FORMAT(started_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') THEN step_count END), 0) AS this_month,
        COALESCE(SUM(step_count), 0) AS lifetime
      FROM exercise_sessions WHERE user_id = ?");
    $totals->execute([$uid]);
    json_response([
        'sessions' => $sessions,
        'totals'   => $totals->fetch(PDO::FETCH_ASSOC),
    ]);
}

function exercise_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $stepCount = max(0, (int)($body['step_count'] ?? 0));
    $duration = max(0, (int)($body['duration_seconds'] ?? 0));
    // 不正/誤検出対策: 1 秒あたり 6 歩超は弾く (走っても 4 歩/秒くらい)。
    if ($duration > 0 && $stepCount / max(1, $duration) > 6) {
        throw new ApiException('bad_request', '歩数が異常に多い (検出ノイズ?)', 400);
    }
    if ($stepCount === 0 && $duration === 0) {
        throw new ApiException('bad_request', '歩数 / 時間ともに 0', 400);
    }
    $startedRaw = (string)($body['started_at'] ?? '');
    $endedRaw   = (string)($body['ended_at'] ?? '');
    $startedAt = $startedRaw !== '' ? str_replace('T', ' ', $startedRaw) : date('Y-m-d H:i:s', time() - $duration);
    $endedAt   = $endedRaw   !== '' ? str_replace('T', ' ', $endedRaw)   : date('Y-m-d H:i:s');
    // 30 分以上のセッションは 1 回として認めない (置きっぱなし防止)
    if ($duration > 30 * 60) {
        throw new ApiException('bad_request', '1 セッション 30 分まで', 400);
    }
    $note = mb_substr(trim((string)($body['note'] ?? '')), 0, 255);
    if ($note === '') $note = null;
    $st = $pdo->prepare("INSERT INTO exercise_sessions
        (user_id, step_count, duration_seconds, started_at, ended_at, note, created_at)
        VALUES (?,?,?,?,?,?, NOW())");
    $st->execute([(int)$u['id'], $stepCount, $duration, $startedAt, $endedAt, $note]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function exercise_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM exercise_sessions WHERE id=?");
    $st->execute([$id]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'session 無し', 404);
    if ($owner !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '自分のセッションのみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM exercise_sessions WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function exercise_board(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("
        SELECT u.id, u.display_name, u.avatar_url,
               COALESCE(SUM(es.step_count), 0) AS this_week
          FROM users u
          LEFT JOIN exercise_sessions es
            ON es.user_id = u.id
           AND YEARWEEK(es.started_at, 1) = YEARWEEK(CURDATE(), 1)
         WHERE u.kind = 'human'
         GROUP BY u.id, u.display_name, u.avatar_url
         HAVING this_week > 0
         ORDER BY this_week DESC LIMIT 30");
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}
