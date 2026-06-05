<?php
// /api/places — お店情報 (タイトル + 住所 + lat/lng + 紹介文) + 口コミ。
// 食べログ的な 共有。 ラボメンバー 誰でも 投稿可、 削除は 投稿者 + admin。
// 画像は /api/uploads/image で 先 に 上げ、 返ってきた URL を image_url に。

declare(strict_types=1);

function route_places(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { places_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { places_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''         && $method === 'GET')    { places_detail($pdo, $cfg, $id); return; }
        if ($next === ''         && $method === 'DELETE') { places_delete($pdo, $cfg, $id); return; }
        if ($next === 'comments' && $method === 'POST')   { places_comment_create($pdo, $cfg, $id); return; }
        if ($next === 'comments' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            places_comment_delete($pdo, $cfg, $id, (int)$seg[3]);
            return;
        }
    }
    json_error('not_found', "no places route for $method $sub", 404);
}

function places_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("
        SELECT p.id, p.title, p.category, p.address, p.lat, p.lng, p.description,
               p.creator_user_id, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               p.created_at,
               (SELECT COUNT(*) FROM place_comments c WHERE c.place_id=p.id) AS comment_count,
               (SELECT AVG(c.rating) FROM place_comments c WHERE c.place_id=p.id AND c.rating IS NOT NULL) AS avg_rating,
               (SELECT c.image_url FROM place_comments c WHERE c.place_id=p.id AND c.image_url IS NOT NULL
                 ORDER BY c.created_at DESC LIMIT 1) AS latest_image
          FROM places p
          JOIN users u ON u.id = p.creator_user_id
         ORDER BY p.created_at DESC
         LIMIT 200");
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['comment_count']   = (int)$r['comment_count'];
        $r['avg_rating']      = $r['avg_rating'] !== null ? (float)$r['avg_rating'] : null;
        $r['lat']             = $r['lat'] !== null ? (float)$r['lat'] : null;
        $r['lng']             = $r['lng'] !== null ? (float)$r['lng'] : null;
    }
    unset($r);
    json_response(['items' => $rows]);
}

function places_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $category = trim((string)($body['category'] ?? ''));
    if (mb_strlen($category) > 50) $category = mb_substr($category, 0, 50);
    $address = trim((string)($body['address'] ?? ''));
    if (mb_strlen($address) > 500) $address = mb_substr($address, 0, 500);
    $description = trim((string)($body['description'] ?? ''));
    if (mb_strlen($description) > 4000) $description = mb_substr($description, 0, 4000);
    $lat = isset($body['lat']) && $body['lat'] !== '' ? (float)$body['lat'] : null;
    $lng = isset($body['lng']) && $body['lng'] !== '' ? (float)$body['lng'] : null;
    if ($lat !== null && ($lat < -90 || $lat > 90))   throw new ApiException('bad_request', 'lat 範囲外', 400);
    if ($lng !== null && ($lng < -180 || $lng > 180)) throw new ApiException('bad_request', 'lng 範囲外', 400);
    $ins = $pdo->prepare("INSERT INTO places
        (title, category, address, lat, lng, description, creator_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$title, $category, $address ?: null, $lat, $lng,
                   $description ?: null, (int)$u['id']]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function places_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT p.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url
          FROM places p
          JOIN users u ON u.id = p.creator_user_id
         WHERE p.id = ?");
    $st->execute([$id]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', '見つかりません', 404);
    $stC = $pdo->prepare("
        SELECT c.id, c.body, c.image_url, c.rating, c.user_id, c.created_at,
               u.display_name, u.avatar_url
          FROM place_comments c
          JOIN users u ON u.id = c.user_id
         WHERE c.place_id = ?
         ORDER BY c.created_at DESC");
    $stC->execute([$id]);
    $comments = array_map(fn($r) => [
        'id'           => (int)$r['id'],
        'body'         => $r['body'],
        'image_url'    => $r['image_url'],
        'rating'       => $r['rating'] !== null ? (int)$r['rating'] : null,
        'user_id'      => (int)$r['user_id'],
        'display_name' => $r['display_name'],
        'avatar_url'   => $r['avatar_url'],
        'created_at'   => $r['created_at'],
    ], $stC->fetchAll(PDO::FETCH_ASSOC));
    $avgRating = null;
    $rated = array_filter($comments, fn($c) => $c['rating'] !== null);
    if ($rated) $avgRating = array_sum(array_map(fn($c) => $c['rating'], $rated)) / count($rated);
    json_response([
        'place' => [
            'id'                 => (int)$p['id'],
            'title'              => $p['title'],
            'category'           => $p['category'],
            'address'            => $p['address'],
            'lat'                => $p['lat'] !== null ? (float)$p['lat'] : null,
            'lng'                => $p['lng'] !== null ? (float)$p['lng'] : null,
            'description'        => $p['description'],
            'creator_user_id'    => (int)$p['creator_user_id'],
            'creator_name'       => $p['creator_name'],
            'creator_avatar_url' => $p['creator_avatar_url'],
            'created_at'         => $p['created_at'],
            'avg_rating'         => $avgRating,
            'comment_count'      => count($comments),
        ],
        'comments' => $comments,
    ]);
}

function places_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM places WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM places WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function places_comment_create(PDO $pdo, array $cfg, int $placeId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT 1 FROM places WHERE id=?");
    $st->execute([$placeId]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'お店が 見つかりません', 404);
    $body = read_json_body();
    $bodyText = trim((string)($body['body'] ?? ''));
    if (mb_strlen($bodyText) > 4000) $bodyText = mb_substr($bodyText, 0, 4000);
    $imageUrl = trim((string)($body['image_url'] ?? ''));
    if ($imageUrl !== '' && mb_strlen($imageUrl) > 500) $imageUrl = mb_substr($imageUrl, 0, 500);
    $rating = null;
    if (isset($body['rating']) && $body['rating'] !== '' && $body['rating'] !== null) {
        $rating = (int)$body['rating'];
        if ($rating < 1 || $rating > 5) throw new ApiException('bad_request', 'rating 1..5', 400);
    }
    if ($bodyText === '' && $imageUrl === '' && $rating === null) {
        throw new ApiException('bad_request', '本文 / 画像 / 評価 の どれか は 必要', 400);
    }
    $ins = $pdo->prepare("INSERT INTO place_comments
        (place_id, user_id, body, image_url, rating, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())");
    $ins->execute([$placeId, (int)$u['id'],
        $bodyText !== '' ? $bodyText : null,
        $imageUrl !== '' ? $imageUrl : null,
        $rating]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function places_comment_delete(PDO $pdo, array $cfg, int $placeId, int $commentId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM place_comments WHERE id=? AND place_id=?");
    $st->execute([$commentId, $placeId]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', '口コミ が 見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cuid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM place_comments WHERE id=?")->execute([$commentId]);
    json_response(['ok' => true]);
}
