<?php
// v538 #169 散歩に行きたくなるアプリ。現在地 (lat/lng) を受けて、周辺の食べある記
//   places からおすすめ散歩先を提案する。未訪 (足跡なし) を優先 + ランダムシャッフル
//   + 距離計算 (haversine)。仲間に頼らない個人向けの「ちょい散歩」を後押し。
//
//   GET /api/walk/suggestions?lat=&lng=&radius=2000   半径 m (default 2000m)

declare(strict_types=1);

function route_walk(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === 'suggestions' && $method === 'GET') {
        $lat = isset($_GET['lat']) && $_GET['lat'] !== '' ? (float)$_GET['lat'] : null;
        $lng = isset($_GET['lng']) && $_GET['lng'] !== '' ? (float)$_GET['lng'] : null;
        $radius = max(100, min(20000, (int)($_GET['radius'] ?? 2000)));
        if ($lat === null || $lng === null) {
            throw new ApiException('bad_request', 'lat / lng 必須', 400);
        }
        // 大雑把に bounding box で絞り込んだ後、 haversine で正確な距離計算。
        //   1 度 ≈ 111km なので radius_deg = radius_m / 111000
        $rDeg = $radius / 111000.0;
        $st = $pdo->prepare("
            SELECT p.id, p.title, p.category, p.address, p.lat, p.lng, p.image_url, p.description,
                   (SELECT COUNT(*) FROM place_visits v WHERE v.place_id = p.id) AS visit_count,
                   EXISTS(SELECT 1 FROM place_visits v WHERE v.place_id = p.id AND v.user_id = ?) AS visited_by_me
              FROM places p
             WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
               AND p.lat BETWEEN ? AND ?
               AND p.lng BETWEEN ? AND ?");
        $st->execute([$uid, $lat - $rDeg, $lat + $rDeg, $lng - $rDeg, $lng + $rDeg]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $out = [];
        foreach ($rows as $r) {
            $d = walk_haversine_m($lat, $lng, (float)$r['lat'], (float)$r['lng']);
            if ($d > $radius) continue;
            $out[] = [
                'id'              => (int)$r['id'],
                'title'           => $r['title'],
                'category'        => $r['category'],
                'address'         => $r['address'],
                'lat'             => (float)$r['lat'],
                'lng'             => (float)$r['lng'],
                'image_url'       => $r['image_url'],
                'image_thumb_url' => !empty($r['image_url']) ? thumb_url_for((string)$r['image_url']) : null,
                'description'     => $r['description'],
                'distance_m'      => (int)round($d),
                'walk_minutes'    => (int)max(1, round($d / 80)), // 約 80 m/分
                'visited_by_me'   => (bool)$r['visited_by_me'],
                'visit_count'     => (int)$r['visit_count'],
            ];
        }
        // 未訪を優先 → 距離順 → 同距離なら ID シャッフル
        usort($out, function ($a, $b) {
            if ($a['visited_by_me'] !== $b['visited_by_me']) {
                return $a['visited_by_me'] ? 1 : -1;
            }
            return $a['distance_m'] <=> $b['distance_m'];
        });
        json_response(['items' => array_slice($out, 0, 20)]);
        return;
    }
    // v589 散歩セッション (歩いた軌跡を記録)
    if ($sub === 'sessions' && $method === 'POST' && !isset($seg[2])) {
        walk_session_start($pdo, $uid);
        return;
    }
    if ($sub === 'sessions' && $method === 'GET' && !isset($seg[2])) {
        walk_session_list($pdo, $uid);
        return;
    }
    if ($sub === 'sessions' && isset($seg[2])) {
        $sid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($method === 'GET' && $action === '') { walk_session_get($pdo, $uid, $sid); return; }
        if ($method === 'POST' && $action === 'point') { walk_session_point($pdo, $uid, $sid); return; }
        if ($method === 'POST' && $action === 'end')   { walk_session_end($pdo, $uid, $sid); return; }
    }
    json_error('not_found', "no walk route for $method $sub", 404);
}

function walk_session_start(PDO $pdo, int $uid): void {
    $pdo->prepare("INSERT INTO walk_sessions (user_id, points_json) VALUES (?, '[]')")->execute([$uid]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function walk_session_point(PDO $pdo, int $uid, int $sid): void {
    $body = read_json_body();
    $lat = (float)($body['lat'] ?? 0);
    $lng = (float)($body['lng'] ?? 0);
    $steps = isset($body['steps']) ? (int)$body['steps'] : null;
    if ($lat === 0.0 && $lng === 0.0) throw new ApiException('bad_request', 'lat/lng 必須', 400);
    db_tx($pdo, function () use ($pdo, $uid, $sid, $lat, $lng, $steps) {
        $st = $pdo->prepare("SELECT user_id, points_json, total_meters, total_steps, ended_at FROM walk_sessions WHERE id=? FOR UPDATE");
        $st->execute([$sid]);
        $s = $st->fetch(PDO::FETCH_ASSOC);
        if (!$s) throw new ApiException('not_found', 'session not found', 404);
        if ((int)$s['user_id'] !== $uid) throw new ApiException('forbidden', 'not yours', 403);
        if ($s['ended_at'] !== null) throw new ApiException('bad_request', 'ended', 400);
        $pts = json_decode($s['points_json'] ?: '[]', true) ?: [];
        $totalM = (int)$s['total_meters'];
        if (!empty($pts)) {
            $last = end($pts);
            $totalM += (int)round(walk_haversine_m($last[0], $last[1], $lat, $lng));
        }
        $pts[] = [$lat, $lng, time()];
        // 上限: 1 セッション 5000 点まで
        if (count($pts) > 5000) array_shift($pts);
        $newSteps = $steps !== null ? max((int)$s['total_steps'], $steps) : (int)$s['total_steps'];
        $pdo->prepare("UPDATE walk_sessions SET points_json=?, total_meters=?, total_steps=? WHERE id=?")
            ->execute([json_encode($pts), $totalM, $newSteps, $sid]);
    });
    json_response(['ok' => true]);
}

function walk_session_end(PDO $pdo, int $uid, int $sid): void {
    $st = $pdo->prepare("UPDATE walk_sessions SET ended_at=NOW() WHERE id=? AND user_id=? AND ended_at IS NULL");
    $st->execute([$sid, $uid]);
    json_response(['ok' => true]);
}

function walk_session_get(PDO $pdo, int $uid, int $sid): void {
    $st = $pdo->prepare("SELECT * FROM walk_sessions WHERE id=? AND user_id=?");
    $st->execute([$sid, $uid]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) throw new ApiException('not_found', 'not found', 404);
    json_response([
        'id' => (int)$s['id'],
        'started_at' => $s['started_at'],
        'ended_at'   => $s['ended_at'],
        'points'     => json_decode($s['points_json'] ?: '[]', true) ?: [],
        'total_meters' => (int)$s['total_meters'],
        'total_steps'  => (int)$s['total_steps'],
    ]);
}

function walk_session_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT id, started_at, ended_at, total_meters, total_steps FROM walk_sessions WHERE user_id=? ORDER BY id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['total_meters'] = (int)$r['total_meters']; $r['total_steps'] = (int)$r['total_steps']; }
    json_response(['items' => $rows]);
}

function walk_haversine_m(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $R = 6371000.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return 2 * $R * asin(sqrt($a));
}
