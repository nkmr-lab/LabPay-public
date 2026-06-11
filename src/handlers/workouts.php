<?php
// v533 #162 筋トレ記録 + 仲間 (mutual follow)。
//   GET    /api/workouts/records?days=N&scope=mine|friends|all (default mine)
//   POST   /api/workouts/record   { exercise, reps?, weight_kg?, sets?, memo?, recorded_at? }
//   DELETE /api/workouts/record/:id
//   GET    /api/workouts/summary  自分の 7日間累計 + 全期間累計 (種目別)
//   GET    /api/workouts/friends  自分が追加してる相手 + 相手が自分を追加してるか
//   POST   /api/workouts/friend   { user_id } を追加
//   DELETE /api/workouts/friend/:user_id  解除

declare(strict_types=1);

function route_workouts(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === 'records' && $method === 'GET') {
        $days  = max(1, min(365, (int)($_GET['days'] ?? 30)));
        $scope = (string)($_GET['scope'] ?? 'mine');
        // mutual friend = 自分も相手も互いに友達追加してる人
        $stMu = $pdo->prepare("SELECT a.friend_user_id AS uid FROM workout_friends a
                                JOIN workout_friends b ON b.user_id = a.friend_user_id AND b.friend_user_id = a.user_id
                               WHERE a.user_id = ?");
        $stMu->execute([$uid]);
        $mutuals = array_map(fn($r) => (int)$r['uid'], $stMu->fetchAll(PDO::FETCH_ASSOC));
        $userIds = [];
        if ($scope === 'mine') $userIds = [$uid];
        else if ($scope === 'friends') $userIds = $mutuals;
        else $userIds = array_unique(array_merge([$uid], $mutuals));
        if (!$userIds) { json_response(['items' => []]); return; }
        $place = implode(',', array_fill(0, count($userIds), '?'));
        $sql = "SELECT w.id, w.user_id, w.recorded_at, w.exercise, w.reps, w.weight_kg, w.sets, w.memo,
                       u.display_name, u.avatar_url
                  FROM workouts w
                  JOIN users u ON u.id = w.user_id
                 WHERE w.user_id IN ($place) AND w.recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 ORDER BY w.recorded_at DESC LIMIT 200";
        $args = array_merge($userIds, [$days]);
        $st = $pdo->prepare($sql);
        $st->execute($args);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['id']        = (int)$r['id'];
            $r['user_id']   = (int)$r['user_id'];
            $r['reps']      = $r['reps']      !== null ? (int)$r['reps']        : null;
            $r['sets']      = $r['sets']      !== null ? (int)$r['sets']        : null;
            $r['weight_kg'] = $r['weight_kg'] !== null ? (float)$r['weight_kg'] : null;
            $r['is_mine']   = (int)$r['user_id'] === $uid;
        }
        unset($r);
        json_response(['items' => $rows]);
        return;
    }

    if ($sub === 'record' && $method === 'POST') {
        $body = read_json_body();
        $exercise = mb_substr(trim((string)($body['exercise'] ?? '')), 0, 60);
        if ($exercise === '') throw new ApiException('bad_request', 'exercise 必須', 400);
        $reps   = (isset($body['reps'])      && $body['reps']      !== '') ? (int)$body['reps']      : null;
        $weight = (isset($body['weight_kg']) && $body['weight_kg'] !== '') ? (float)$body['weight_kg'] : null;
        $sets   = (isset($body['sets'])      && $body['sets']      !== '') ? max(1, (int)$body['sets']) : 1;
        $memo   = isset($body['memo']) ? mb_substr(trim((string)$body['memo']), 0, 200) : null;
        if ($memo === '') $memo = null;
        if ($reps !== null && ($reps < 1 || $reps > 10000)) throw new ApiException('bad_request', 'reps 範囲外', 400);
        if ($weight !== null && ($weight < 0 || $weight > 1000)) throw new ApiException('bad_request', 'weight_kg 範囲外', 400);
        if ($sets > 1000) throw new ApiException('bad_request', 'sets 範囲外', 400);
        $recordedAt = null;
        if (!empty($body['recorded_at'])) {
            try {
                $dt = new DateTime((string)$body['recorded_at']);
                $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
                $recordedAt = $dt->format('Y-m-d H:i:s');
            } catch (Throwable $_) {}
        }
        if ($recordedAt === null) $recordedAt = date('Y-m-d H:i:s');
        $st = $pdo->prepare("INSERT INTO workouts (user_id, recorded_at, exercise, reps, weight_kg, sets, memo)
                             VALUES (?, ?, ?, ?, ?, ?, ?)");
        $st->execute([$uid, $recordedAt, $exercise, $reps, $weight, $sets, $memo]);
        json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
        return;
    }

    if ($sub === 'record' && $method === 'DELETE' && isset($seg[2])) {
        $rid = (int)$seg[2];
        $st = $pdo->prepare("SELECT user_id FROM workouts WHERE id = ?");
        $st->execute([$rid]);
        $owner = (int)$st->fetchColumn();
        if (!$owner) throw new ApiException('not_found', 'record not found', 404);
        if ($owner !== $uid) throw new ApiException('forbidden', '本人のみ削除可', 403);
        $pdo->prepare("DELETE FROM workouts WHERE id = ?")->execute([$rid]);
        json_response(['ok' => true]);
        return;
    }

    if ($sub === 'summary' && $method === 'GET') {
        // 自分の7日間 種目別合計 reps + sets
        $st = $pdo->prepare("SELECT exercise,
                                    COALESCE(SUM(reps), 0) AS total_reps,
                                    COALESCE(SUM(sets), 0) AS total_sets,
                                    COUNT(*) AS log_count
                               FROM workouts
                              WHERE user_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                              GROUP BY exercise
                              ORDER BY log_count DESC");
        $st->execute([$uid]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['total_reps'] = (int)$r['total_reps'];
            $r['total_sets'] = (int)$r['total_sets'];
            $r['log_count']  = (int)$r['log_count'];
        }
        unset($r);
        json_response(['week_by_exercise' => $rows]);
        return;
    }

    if ($sub === 'friends' && $method === 'GET') {
        // 自分が追加した相手 + 相手が自分を追加してるか
        $st = $pdo->prepare("
            SELECT u.id, u.display_name, u.avatar_url,
                   (SELECT 1 FROM workout_friends wb WHERE wb.user_id = u.id AND wb.friend_user_id = ?) AS they_added_me
              FROM workout_friends wf JOIN users u ON u.id = wf.friend_user_id
             WHERE wf.user_id = ?
             ORDER BY u.display_name");
        $st->execute([$uid, $uid]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['id']            = (int)$r['id'];
            $r['they_added_me'] = (bool)$r['they_added_me'];
        }
        unset($r);
        json_response(['items' => $rows]);
        return;
    }

    if ($sub === 'friend' && $method === 'POST') {
        $body = read_json_body();
        $fid = (int)($body['user_id'] ?? 0);
        if ($fid <= 0 || $fid === $uid) throw new ApiException('bad_request', 'user_id 不正', 400);
        $stU = $pdo->prepare("SELECT 1 FROM users WHERE id = ? AND kind='human'");
        $stU->execute([$fid]);
        if (!$stU->fetchColumn()) throw new ApiException('not_found', 'user not found', 404);
        $pdo->prepare("INSERT IGNORE INTO workout_friends (user_id, friend_user_id) VALUES (?, ?)")
            ->execute([$uid, $fid]);
        // 相手にも通知
        try {
            global $CFG;
            notify_safely($pdo, $CFG, $fid, 'admin_notice',
                "🤝 筋トレ仲間に追加されました ({$u['display_name']})。 自分も追加すると 互いの記録が見えるように なります。",
                'workout', null);
        } catch (Throwable $_) {}
        json_response(['ok' => true]);
        return;
    }

    if ($sub === 'friend' && $method === 'DELETE' && isset($seg[2])) {
        $fid = (int)$seg[2];
        $pdo->prepare("DELETE FROM workout_friends WHERE user_id = ? AND friend_user_id = ?")->execute([$uid, $fid]);
        json_response(['ok' => true]);
        return;
    }

    json_error('not_found', "no workouts route for $method $sub", 404);
}
