<?php
// v538 #169 散歩に行きたくなるアプリ。 現在地 (lat/lng) を受けて、 周辺の 食べある記
//   places から おすすめ散歩先を提案する。 未訪 (足跡なし) を優先 + ランダムシャッフル
//   + 距離計算 (haversine)。 仲間に頼らない 個人向けの「ちょい散歩」 を後押し。
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
    json_error('not_found', "no walk route for $method $sub", 404);
}

function walk_haversine_m(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $R = 6371000.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return 2 * $R * asin(sqrt($a));
}
