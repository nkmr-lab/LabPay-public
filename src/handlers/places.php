<?php
// /api/places — お店情報 (タイトル + 住所 + lat/lng + 紹介文) + 口コミ。
// 食べログ的な 共有。 ラボメンバー 誰でも 投稿可、 削除は 投稿者 + admin。
// 画像は /api/uploads/image で 先 に 上げ、 返ってきた URL を image_url に。

declare(strict_types=1);

function route_places(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { places_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { places_create($pdo, $cfg); return; }
    // v471 URL (tabelog / Retty) から JSON-LD で 店名 / 住所 / 緯度経度 を 取得
    if ($sub === 'import_url' && $method === 'POST') { places_import_url($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''         && $method === 'GET')    { places_detail($pdo, $cfg, $id); return; }
        if ($next === ''         && $method === 'DELETE') { places_delete($pdo, $cfg, $id); return; }
        if ($next === ''         && $method === 'PATCH')  { places_edit($pdo, $cfg, $id);   return; }
        if ($next === 'comments' && $method === 'POST')   { places_comment_create($pdo, $cfg, $id); return; }
        if ($next === 'comments' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            places_comment_delete($pdo, $cfg, $id, (int)$seg[3]);
            return;
        }
        // v486 #80 いいね トグル
        if ($next === 'like' && $method === 'POST')   { places_like_toggle($pdo, $cfg, $id, true);  return; }
        if ($next === 'like' && $method === 'DELETE') { places_like_toggle($pdo, $cfg, $id, false); return; }
    }
    json_error('not_found', "no places route for $method $sub", 404);
}

function places_like_toggle(PDO $pdo, array $cfg, int $id, bool $on): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT 1 FROM places WHERE id=?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'お店 が ありません', 404);
    if ($on) {
        $pdo->prepare("INSERT IGNORE INTO place_likes (place_id, user_id, created_at)
                       VALUES (?, ?, NOW())")
            ->execute([$id, (int)$u['id']]);
    } else {
        $pdo->prepare("DELETE FROM place_likes WHERE place_id=? AND user_id=?")
            ->execute([$id, (int)$u['id']]);
    }
    $stC = $pdo->prepare("SELECT COUNT(*) FROM place_likes WHERE place_id=?");
    $stC->execute([$id]);
    json_response(['ok' => true, 'like_count' => (int)$stC->fetchColumn(), 'liked_by_me' => $on]);
}

function places_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $meId = (int)$u['id'];
    // v478 image_url (メイン写真) を 追加。 cover_image は image_url 優先 → 最新 review。
    // v486 #80 いいね カウント + 自分 が 押したか。
    $st = $pdo->prepare("
        SELECT p.id, p.title, p.category, p.address, p.lat, p.lng, p.description, p.image_url,
               p.creator_user_id, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               p.created_at,
               (SELECT COUNT(*) FROM place_comments c WHERE c.place_id=p.id) AS comment_count,
               (SELECT AVG(c.rating) FROM place_comments c WHERE c.place_id=p.id AND c.rating IS NOT NULL) AS avg_rating,
               (SELECT c.image_url FROM place_comments c WHERE c.place_id=p.id AND c.image_url IS NOT NULL
                 ORDER BY c.created_at DESC LIMIT 1) AS latest_image,
               (SELECT COUNT(*) FROM place_likes l WHERE l.place_id=p.id) AS like_count,
               EXISTS(SELECT 1 FROM place_likes l WHERE l.place_id=p.id AND l.user_id=?) AS liked_by_me
          FROM places p
          JOIN users u ON u.id = p.creator_user_id
         ORDER BY p.created_at DESC
         LIMIT 200");
    $st->execute([$meId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['comment_count']   = (int)$r['comment_count'];
        $r['avg_rating']      = $r['avg_rating'] !== null ? (float)$r['avg_rating'] : null;
        $r['lat']             = $r['lat'] !== null ? (float)$r['lat'] : null;
        $r['lng']             = $r['lng'] !== null ? (float)$r['lng'] : null;
        $r['like_count']      = (int)$r['like_count'];
        $r['liked_by_me']     = (bool)$r['liked_by_me'];
        // v478 cover_image: 店のメイン画像 を 優先、 なければ 最新の レビュー画像
        $r['cover_image'] = $r['image_url'] ?: $r['latest_image'];
        // v503 #127 タイル表示は重いオリジナル画像を使っていたので、 サムネ URL を
        //   別フィールドで返す (実在しなければ原画像 fallback)。
        $r['cover_image_thumb'] = $r['cover_image'] ? thumb_url_for((string)$r['cover_image']) : null;
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
    $imageUrl = isset($body['image_url']) ? trim((string)$body['image_url']) : '';
    if (mb_strlen($imageUrl) > 500) $imageUrl = mb_substr($imageUrl, 0, 500);
    $ins = $pdo->prepare("INSERT INTO places
        (title, category, address, lat, lng, description, image_url, creator_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$title, $category, $address ?: null, $lat, $lng,
                   $description ?: null, $imageUrl !== '' ? $imageUrl : null, (int)$u['id']]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function places_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $meId = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT p.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url
          FROM places p
          JOIN users u ON u.id = p.creator_user_id
         WHERE p.id = ?");
    $st->execute([$id]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', '見つかりません', 404);
    // v486 #80 いいね 集計
    $stL = $pdo->prepare("SELECT COUNT(*) FROM place_likes WHERE place_id=?");
    $stL->execute([$id]);
    $likeCount = (int)$stL->fetchColumn();
    $stM = $pdo->prepare("SELECT 1 FROM place_likes WHERE place_id=? AND user_id=?");
    $stM->execute([$id, $meId]);
    $likedByMe = (bool)$stM->fetchColumn();
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
            'image_url'          => $p['image_url'] ?? null,
            'creator_user_id'    => (int)$p['creator_user_id'],
            'creator_name'       => $p['creator_name'],
            'creator_avatar_url' => $p['creator_avatar_url'],
            'created_at'         => $p['created_at'],
            'avg_rating'         => $avgRating,
            'comment_count'      => count($comments),
            'like_count'         => $likeCount,
            'liked_by_me'        => $likedByMe,
        ],
        'comments' => $comments,
    ]);
}

// v472 編集 (起案者 + admin)。 title / category / address / lat / lng / description を 部分更新。
function places_edit(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM places WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = mb_substr(trim((string)$body['title']), 0, 200);
        if ($t === '') throw new ApiException('bad_request', 'title 1..200', 400);
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('category', $body)) {
        $c = mb_substr(trim((string)$body['category']), 0, 50);
        $sets[] = 'category = ?'; $args[] = $c;
    }
    if (array_key_exists('address', $body)) {
        $a = mb_substr(trim((string)$body['address']), 0, 500);
        $sets[] = 'address = ?'; $args[] = $a !== '' ? $a : null;
    }
    if (array_key_exists('description', $body)) {
        $d = mb_substr(trim((string)$body['description']), 0, 4000);
        $sets[] = 'description = ?'; $args[] = $d !== '' ? $d : null;
    }
    if (array_key_exists('lat', $body)) {
        $v = $body['lat'];
        $lat = ($v === '' || $v === null) ? null : (float)$v;
        if ($lat !== null && ($lat < -90 || $lat > 90))   throw new ApiException('bad_request', 'lat 範囲外', 400);
        $sets[] = 'lat = ?'; $args[] = $lat;
    }
    if (array_key_exists('lng', $body)) {
        $v = $body['lng'];
        $lng = ($v === '' || $v === null) ? null : (float)$v;
        if ($lng !== null && ($lng < -180 || $lng > 180)) throw new ApiException('bad_request', 'lng 範囲外', 400);
        $sets[] = 'lng = ?'; $args[] = $lng;
    }
    if (array_key_exists('image_url', $body)) {
        $i = mb_substr(trim((string)$body['image_url']), 0, 500);
        $sets[] = 'image_url = ?'; $args[] = $i !== '' ? $i : null;
    }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE places SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
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

// v471 URL (tabelog.com / retty.me) → 店名 / 住所 / 緯度経度 を 抽出。
// JSON-LD の Restaurant / FoodEstablishment / LocalBusiness ノード が
// あれば 採用 (両サイト とも schema.org の geo を 持っている)。
// fallback: og:title / og:description のみ。
function places_import_url(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $url = trim((string)($body['url'] ?? ''));
    if ($url === '') throw new ApiException('bad_request', 'url 必要', 400);
    if (!preg_match('#^https?://#', $url)) throw new ApiException('bad_request', 'http(s) URL のみ', 400);
    // ホワイトリスト: tabelog / Retty / hotpepper / Google Maps (短縮)
    $host = parse_url($url, PHP_URL_HOST) ?? '';
    $allowed = ['tabelog.com', 'retty.me', 'hotpepper.jp', 'goo.gl', 'maps.google.com',
                'maps.app.goo.gl', 'g.co'];
    $ok = false;
    foreach ($allowed as $h) {
        if ($host === $h || str_ends_with($host, '.' . $h)) { $ok = true; break; }
    }
    if (!$ok) throw new ApiException('bad_request', 'tabelog / Retty / hotpepper のみ 対応', 400);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        CURLOPT_ENCODING => '',
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$html || $code !== 200) {
        throw new ApiException('fetch_failed', "ページ取得 失敗 (HTTP {$code})", 502);
    }

    $title = ''; $address = ''; $lat = null; $lng = null; $desc = '';

    // 1) JSON-LD
    if (preg_match_all('#<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>#is', $html, $m)) {
        foreach ($m[1] as $raw) {
            $j = json_decode(html_entity_decode($raw, ENT_QUOTES|ENT_HTML5, 'UTF-8'), true);
            if (!is_array($j)) continue;
            $list = isset($j[0]) ? $j : [$j];
            foreach ($list as $node) {
                $type = $node['@type'] ?? '';
                if (is_array($type)) $type = implode(',', $type);
                if (!preg_match('/Restaurant|FoodEstablishment|LocalBusiness/i', (string)$type)) continue;
                $title = (string)($node['name'] ?? $title);
                $desc  = (string)($node['description'] ?? $desc);
                $addrRaw = $node['address'] ?? null;
                if (is_string($addrRaw)) $address = $addrRaw;
                elseif (is_array($addrRaw)) {
                    $address = trim(
                        ((string)($addrRaw['addressRegion']   ?? '')) .
                        ((string)($addrRaw['addressLocality'] ?? '')) .
                        ((string)($addrRaw['streetAddress']   ?? ''))
                    );
                }
                if (isset($node['geo']) && is_array($node['geo'])) {
                    if (isset($node['geo']['latitude']))  $lat = (float)$node['geo']['latitude'];
                    if (isset($node['geo']['longitude'])) $lng = (float)$node['geo']['longitude'];
                }
                if ($title !== '' && $lat !== null) break 2;  // 取れたら 抜ける
            }
        }
    }
    // 2) og:* フォールバック
    if ($title === '' && preg_match('#<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']#i', $html, $mm)) {
        $title = trim($mm[1]);
    }
    if ($desc === '' && preg_match('#<meta\s+(?:property|name)=["\']og:description["\']\s+content=["\']([^"\']+)["\']#i', $html, $mm)) {
        $desc = trim($mm[1]);
    }

    json_response([
        'title'       => $title,
        'address'     => $address,
        'lat'         => $lat,
        'lng'         => $lng,
        'description' => $desc,
        'source_url'  => $url,
    ]);
}
