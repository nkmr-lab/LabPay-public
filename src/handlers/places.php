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
    // v719 #315 キーワードから tabelog URL を引いてくる
    if ($sub === 'search_url' && $method === 'POST') { places_search_url($pdo, $cfg); return; }
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
        // v529 #164 行った (足跡) トグル
        if ($next === 'visit' && $method === 'POST')   { places_visit_toggle($pdo, $cfg, $id, true);  return; }
        if ($next === 'visit' && $method === 'DELETE') { places_visit_toggle($pdo, $cfg, $id, false); return; }
    }
    json_error('not_found', "no places route for $method $sub", 404);
}

function places_visit_toggle(PDO $pdo, array $cfg, int $id, bool $on): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT 1 FROM places WHERE id=?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'お店 が ありません', 404);
    if ($on) {
        $pdo->prepare("INSERT IGNORE INTO place_visits (place_id, user_id, visited_at) VALUES (?, ?, NOW())")
            ->execute([$id, (int)$u['id']]);
    } else {
        $pdo->prepare("DELETE FROM place_visits WHERE place_id=? AND user_id=?")
            ->execute([$id, (int)$u['id']]);
    }
    $stC = $pdo->prepare("SELECT COUNT(*) FROM place_visits WHERE place_id=?");
    $stC->execute([$id]);
    json_response(['ok' => true, 'visit_count' => (int)$stC->fetchColumn(), 'visited_by_me' => $on]);
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
               EXISTS(SELECT 1 FROM place_likes l WHERE l.place_id=p.id AND l.user_id=?) AS liked_by_me,
               -- v529 #164 行った (足跡) count + 自分が行ったか
               (SELECT COUNT(*) FROM place_visits v WHERE v.place_id=p.id) AS visit_count,
               EXISTS(SELECT 1 FROM place_visits v WHERE v.place_id=p.id AND v.user_id=?) AS visited_by_me
          FROM places p
          JOIN users u ON u.id = p.creator_user_id
         ORDER BY p.created_at DESC
         LIMIT 200");
    $st->execute([$meId, $meId]);
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
        $r['visit_count']     = (int)$r['visit_count'];
        $r['visited_by_me']   = (bool)$r['visited_by_me'];
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
    // v722 #318 元 URL (tabelog / Retty 等) を そのまま 保存。
    $sourceUrl = isset($body['source_url']) ? trim((string)$body['source_url']) : '';
    if ($sourceUrl !== '' && !preg_match('#^https?://#', $sourceUrl)) $sourceUrl = '';
    if (mb_strlen($sourceUrl) > 500) $sourceUrl = mb_substr($sourceUrl, 0, 500);
    // v725 #327 電話番号 / 営業時間
    $phone = isset($body['phone']) ? trim((string)$body['phone']) : '';
    if (mb_strlen($phone) > 50) $phone = mb_substr($phone, 0, 50);
    $hours = isset($body['hours']) ? trim((string)$body['hours']) : '';
    if (mb_strlen($hours) > 2000) $hours = mb_substr($hours, 0, 2000);
    $ins = $pdo->prepare("INSERT INTO places
        (title, category, address, lat, lng, description, source_url, phone, hours, image_url, creator_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$title, $category, $address ?: null, $lat, $lng,
                   $description ?: null,
                   $sourceUrl !== '' ? $sourceUrl : null,
                   $phone !== '' ? $phone : null,
                   $hours !== '' ? $hours : null,
                   $imageUrl !== '' ? $imageUrl : null, (int)$u['id']]);
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
    // v529 #164 訪問 (足跡)
    $stV = $pdo->prepare("SELECT COUNT(*) FROM place_visits WHERE place_id=?");
    $stV->execute([$id]);
    $visitCount = (int)$stV->fetchColumn();
    $stMV = $pdo->prepare("SELECT 1 FROM place_visits WHERE place_id=? AND user_id=?");
    $stMV->execute([$id, $meId]);
    $visitedByMe = (bool)$stMV->fetchColumn();
    $stC = $pdo->prepare("
        SELECT c.id, c.body, c.image_url, c.image_urls, c.rating, c.user_id, c.created_at,
               u.display_name, u.avatar_url
          FROM place_comments c
          JOIN users u ON u.id = c.user_id
         WHERE c.place_id = ?
         ORDER BY c.created_at DESC");
    $stC->execute([$id]);
    $comments = array_map(function ($r) {
        // v716 #311 image_urls (JSON 配列) を 返す。 旧 単数 image_url も そのまま 返して
        //   旧 client 互換 を 維持。
        $urls = [];
        if (!empty($r['image_urls'])) {
            $decoded = json_decode((string)$r['image_urls'], true);
            if (is_array($decoded)) $urls = array_values(array_filter($decoded, fn($x) => is_string($x) && $x !== ''));
        }
        if (!$urls && !empty($r['image_url'])) $urls = [(string)$r['image_url']];
        return [
            'id'           => (int)$r['id'],
            'body'         => $r['body'],
            'image_url'    => $r['image_url'],
            'image_urls'   => $urls,
            'rating'       => $r['rating'] !== null ? (int)$r['rating'] : null,
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'created_at'   => $r['created_at'],
        ];
    }, $stC->fetchAll(PDO::FETCH_ASSOC));
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
            'source_url'         => $p['source_url'] ?? null,
            'phone'              => $p['phone'] ?? null,
            'hours'              => $p['hours'] ?? null,
            'image_url'          => $p['image_url'] ?? null,
            'image_thumb_url'    => !empty($p['image_url']) ? thumb_url_for((string)$p['image_url']) : null, // v512 詳細ヒーロー用
            'creator_user_id'    => (int)$p['creator_user_id'],
            'creator_name'       => $p['creator_name'],
            'creator_avatar_url' => $p['creator_avatar_url'],
            'created_at'         => $p['created_at'],
            'avg_rating'         => $avgRating,
            'comment_count'      => count($comments),
            'like_count'         => $likeCount,
            'liked_by_me'        => $likedByMe,
            'visit_count'        => $visitCount,   // v529 #164
            'visited_by_me'      => $visitedByMe,  // v529 #164
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
    if (array_key_exists('source_url', $body)) {
        $su = trim((string)$body['source_url']);
        if ($su !== '' && !preg_match('#^https?://#', $su)) $su = '';
        $su = mb_substr($su, 0, 500);
        $sets[] = 'source_url = ?'; $args[] = $su !== '' ? $su : null;
    }
    if (array_key_exists('phone', $body)) {
        $ph = mb_substr(trim((string)$body['phone']), 0, 50);
        $sets[] = 'phone = ?'; $args[] = $ph !== '' ? $ph : null;
    }
    if (array_key_exists('hours', $body)) {
        $hr = mb_substr(trim((string)$body['hours']), 0, 2000);
        $sets[] = 'hours = ?'; $args[] = $hr !== '' ? $hr : null;
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
    // v716 #311 複数 画像 対応。 image_urls (配列) を 受理、 image_url (旧 互換) は 先頭 を 入れる。
    $imageUrls = [];
    if (isset($body['image_urls']) && is_array($body['image_urls'])) {
        foreach ($body['image_urls'] as $u_) {
            $s = trim((string)$u_);
            if ($s === '') continue;
            if (mb_strlen($s) > 500) $s = mb_substr($s, 0, 500);
            $imageUrls[] = $s;
            if (count($imageUrls) >= 10) break;
        }
    }
    // 単数 image_url (旧 client) も 受理 して 配列 に 統合
    $singleUrl = trim((string)($body['image_url'] ?? ''));
    if ($singleUrl !== '') {
        if (mb_strlen($singleUrl) > 500) $singleUrl = mb_substr($singleUrl, 0, 500);
        if (!in_array($singleUrl, $imageUrls, true)) array_unshift($imageUrls, $singleUrl);
    }
    $imageUrl = $imageUrls[0] ?? '';
    $imageUrlsJson = $imageUrls ? json_encode($imageUrls, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
    $rating = null;
    if (isset($body['rating']) && $body['rating'] !== '' && $body['rating'] !== null) {
        $rating = (int)$body['rating'];
        if ($rating < 1 || $rating > 5) throw new ApiException('bad_request', 'rating 1..5', 400);
    }
    if ($bodyText === '' && !$imageUrls && $rating === null) {
        throw new ApiException('bad_request', '本文 / 画像 / 評価 の どれか は 必要', 400);
    }
    $ins = $pdo->prepare("INSERT INTO place_comments
        (place_id, user_id, body, image_url, image_urls, rating, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$placeId, (int)$u['id'],
        $bodyText !== '' ? $bodyText : null,
        $imageUrl !== '' ? $imageUrl : null,
        $imageUrlsJson,
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
    $phone = ''; $hours = '';

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
                // v725 #327 電話番号 / 営業時間
                if ($phone === '' && !empty($node['telephone'])) $phone = (string)$node['telephone'];
                if ($hours === '') {
                    if (!empty($node['openingHours'])) {
                        $oh = $node['openingHours'];
                        $hours = is_array($oh) ? implode("\n", array_map('strval', $oh)) : (string)$oh;
                    } elseif (!empty($node['openingHoursSpecification']) && is_array($node['openingHoursSpecification'])) {
                        $lines = [];
                        foreach ($node['openingHoursSpecification'] as $spec) {
                            if (!is_array($spec)) continue;
                            $day  = $spec['dayOfWeek'] ?? '';
                            if (is_array($day)) $day = implode(',', array_map('strval', $day));
                            $open = $spec['opens'] ?? '';
                            $close = $spec['closes'] ?? '';
                            $lines[] = trim(((string)$day) . ' ' . (string)$open . '-' . (string)$close);
                        }
                        $hours = implode("\n", array_filter($lines, fn($x) => trim($x) !== ''));
                    }
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
        'phone'       => $phone,
        'hours'       => $hours,
        'source_url'  => $url,
    ]);
}

// v719 #315 キーワードから tabelog URL を探す。
//   tabelog の検索結果ページ (https://tabelog.com/rstLst/?sw=...) を取って、
//   検索結果内の店舗 URL (/<prefecture>/A<area>/A<sub>/<id>/) パターンを抽出する。
//   ヒットしたら上位 5 件と top を返す。 client はその URL をそのまま import_url に流す。
function places_search_url(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $q = trim((string)($body['q'] ?? ''));
    if ($q === '' || mb_strlen($q) > 200) throw new ApiException('bad_request', 'q 1..200', 400);
    $url = 'https://tabelog.com/rstLst/?sw=' . urlencode($q);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        CURLOPT_ENCODING => '',
    ]);
    $html = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$html || $code !== 200) {
        throw new ApiException('fetch_failed', "tabelog 検索失敗 (HTTP {$code})", 502);
    }
    $candidates = [];
    if (preg_match_all('@https?://tabelog\.com/[a-z]+/A\d+/A\d+/\d+/?@', (string)$html, $m)) {
        foreach ($m[0] as $u) {
            $clean = rtrim($u, '/') . '/';
            if (!in_array($clean, $candidates, true)) $candidates[] = $clean;
        }
    }
    if (!$candidates) throw new ApiException('not_found', '結果が見つかりませんでした', 404);
    json_response([
        'top'        => $candidates[0],
        'candidates' => array_slice($candidates, 0, 5),
        'search_url' => $url,
    ]);
}
