<?php
// /api/places — お店情報 (タイトル + 住所 + lat/lng + 紹介文) + 口コミ。
// 食べログ的な共有。ラボメンバー誰でも投稿可、削除は投稿者 + admin。
// 画像は /api/uploads/image で先に上げ、返ってきた URL を image_url に。

declare(strict_types=1);

function route_places(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { places_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { places_create($pdo, $cfg); return; }
    // v471 URL (tabelog / Retty) から JSON-LD で店名 / 住所 / 緯度経度を取得
    if ($sub === 'import_url' && $method === 'POST') { places_import_url($pdo, $cfg); return; }
    // v719 #315 キーワードから tabelog URL を引いてくる
    if ($sub === 'search_url' && $method === 'POST') { places_search_url($pdo, $cfg); return; }
    // v731 #340 admin が 1 click で tabelog URL を自動補完 (1 回最大 10 件、繰返して全件)
    if ($sub === 'backfill_tabelog_urls' && $method === 'POST') { places_backfill_tabelog($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''         && $method === 'GET')    { places_detail($pdo, $cfg, $id); return; }
        if ($next === ''         && $method === 'DELETE') { places_delete($pdo, $cfg, $id); return; }
        if ($next === ''         && $method === 'PATCH')  { places_edit($pdo, $cfg, $id);   return; }
        // v761 #380 rotate-image を先にマッチさせる (旧版では POST /comments が
        //   先に places_comment_create に食われて「本文 / 画像 / 評価のどれかは必要」
        //   エラーが返っていた bug)。
        if ($next === 'comments' && ctype_digit((string)($seg[3] ?? '')) && ($seg[4] ?? '') === 'rotate-image' && $method === 'POST') {
            places_comment_rotate_image($pdo, $cfg, $id, (int)$seg[3]);
            return;
        }
        if ($next === 'comments' && !isset($seg[3]) && $method === 'POST') { places_comment_create($pdo, $cfg, $id); return; }
        if ($next === 'comments' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            places_comment_delete($pdo, $cfg, $id, (int)$seg[3]);
            return;
        }
        if ($next === 'rotate-image' && $method === 'POST') {
            places_hero_rotate_image($pdo, $cfg, $id);
            return;
        }
        // v486 #80 いいねトグル
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
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'お店がありません', 404);
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
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'お店がありません', 404);
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
    // v478 image_url (メイン写真) を追加。 cover_image は image_url 優先 → 最新 review。
    // v486 #80 いいねカウント + 自分が押したか。
    // v885 last_activity_at = 場所の作成 or 最終口コミ投稿のうち最新。
    //   フロント側で「新着順」ビューを出すために使う (口コミが新たに付いた店も新着扱い)。
    $st = $pdo->prepare("
        SELECT p.id, p.title, p.category, p.address, p.lat, p.lng, p.description, p.image_url,
               p.creator_user_id, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               p.created_at,
               GREATEST(
                 p.created_at,
                 COALESCE((SELECT MAX(c.created_at) FROM place_comments c WHERE c.place_id=p.id), p.created_at)
               ) AS last_activity_at,
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
         ORDER BY last_activity_at DESC, p.id DESC
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
        // v478 cover_image: 店のメイン画像を優先、なければ最新のレビュー画像
        $r['cover_image'] = $r['image_url'] ?: $r['latest_image'];
        // v503 #127 タイル表示は重いオリジナル画像を使っていたので、サムネ URL を
        //   別フィールドで返す (実在しなければ原画像 fallback)。
        $r['cover_image_thumb'] = $r['cover_image'] ? thumb_url_for((string)$r['cover_image']) : null;
        // v894 #460 回転後の地図マーカー/タイル画像のキャッシュ問題対策。
        //   ファイル mtime を ?v= に乗せて URL を一意化、ブラウザ HTTP キャッシュも
        //   旧 image を返さなくなる (rotate-image は in-place 書き換え → mtime 更新される)。
        $r['cover_image']       = _places_image_url_versioned((string)$r['cover_image']);
        $r['cover_image_thumb'] = _places_image_url_versioned((string)$r['cover_image_thumb']);
    }
    unset($r);
    json_response(['items' => $rows]);
}

// v894 #460 /uploads/ 配下の画像 URL に ?v=<mtime> を付けて返す。 file が無ければそのまま。
function _places_image_url_versioned(string $url): string {
    if ($url === '') return '';
    if (!preg_match('#^/uploads/#', $url)) return $url;  // 絶対 URL や別系統は触らない
    // 既存の ?v=, ?_t= は取り除いて付け直す (旧クライアントが付けたものを上書き)
    $clean = preg_replace('/[?&](?:v|_t)=\d+(&|$)/', '$1', $url);
    $clean = rtrim($clean, '?&');
    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $abs = $publicDir . explode('?', $clean, 2)[0];
    if (!is_file($abs)) return $clean;
    $mtime = @filemtime($abs);
    if (!$mtime) return $clean;
    $sep = (strpos($clean, '?') === false) ? '?' : '&';
    return $clean . $sep . 'v=' . $mtime;
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
    // v722 #318 元 URL (tabelog / Retty 等) をそのまま保存。
    $sourceUrl = isset($body['source_url']) ? trim((string)$body['source_url']) : '';
    if ($sourceUrl !== '' && !preg_match('#^https?://#', $sourceUrl)) $sourceUrl = '';
    if (mb_strlen($sourceUrl) > 500) $sourceUrl = mb_substr($sourceUrl, 0, 500);
    // v725 #327 電話番号 / 営業時間
    $phone = isset($body['phone']) ? trim((string)$body['phone']) : '';
    if (mb_strlen($phone) > 50) $phone = mb_substr($phone, 0, 50);
    $hours = isset($body['hours']) ? trim((string)$body['hours']) : '';
    if (mb_strlen($hours) > 2000) $hours = mb_substr($hours, 0, 2000);
    // v920 同一 source_url が既に登録済なら拒否 (二重登録防止の最終砦、
    //   通常はフロントで事前に気づくが、直接 POST や race 対策)。
    //   force=1 が明示的に送られたら通す (別支店など意図的な場合)。
    if ($sourceUrl !== '' && empty($body['force'])) {
        $stDup = $pdo->prepare("SELECT id, title FROM places WHERE source_url = ? LIMIT 1");
        $stDup->execute([$sourceUrl]);
        if ($ex = $stDup->fetch(PDO::FETCH_ASSOC)) {
            throw new ApiException('duplicate',
                "同じ URL の店がすでに登録済「{$ex['title']}」 (id={$ex['id']})。別支店として登録するなら force=1 を付けて再送信してください。",
                409,
                ['existing_id' => (int)$ex['id'], 'existing_title' => $ex['title']]);
        }
    }
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
    // v486 #80 いいね集計
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
        // v716 #311 image_urls (JSON 配列) を返す。旧単数 image_url もそのまま返して
        //   旧 client 互換を維持。
        $urls = [];
        if (!empty($r['image_urls'])) {
            $decoded = json_decode((string)$r['image_urls'], true);
            if (is_array($decoded)) $urls = array_values(array_filter($decoded, fn($x) => is_string($x) && $x !== ''));
        }
        if (!$urls && !empty($r['image_url'])) $urls = [(string)$r['image_url']];
        // v894 #460 ?v=mtime でキャッシュ破棄 (rotate 後の地図/タイル画像更新対策)
        $urls         = array_map('_places_image_url_versioned', $urls);
        $singleImage  = !empty($r['image_url']) ? _places_image_url_versioned((string)$r['image_url']) : $r['image_url'];
        return [
            'id'           => (int)$r['id'],
            'body'         => $r['body'],
            'image_url'    => $singleImage,
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
            'image_url'          => !empty($p['image_url']) ? _places_image_url_versioned((string)$p['image_url']) : ($p['image_url'] ?? null),
            'image_thumb_url'    => !empty($p['image_url']) ? _places_image_url_versioned(thumb_url_for((string)$p['image_url'])) : null, // v512 詳細ヒーロー用 v894 ?v=mtime 付き
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

// v472 編集 (起案者 + admin)。 title / category / address / lat / lng / description を部分更新。
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
    // v921 通知用に起案者と店名も一緒に引く。
    $st = $pdo->prepare("SELECT creator_user_id, title FROM places WHERE id=?");
    $st->execute([$placeId]);
    $placeRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$placeRow) throw new ApiException('not_found', 'お店が見つかりません', 404);
    $body = read_json_body();
    $bodyText = trim((string)($body['body'] ?? ''));
    if (mb_strlen($bodyText) > 4000) $bodyText = mb_substr($bodyText, 0, 4000);
    // v716 #311 複数画像対応。 image_urls (配列) を受理、 image_url (旧互換) は先頭を入れる。
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
    // 単数 image_url (旧 client) も受理して配列に統合
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
        throw new ApiException('bad_request', '本文 / 画像 / 評価のどれかは必要', 400);
    }
    $ins = $pdo->prepare("INSERT INTO place_comments
        (place_id, user_id, body, image_url, image_urls, rating, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$placeId, (int)$u['id'],
        $bodyText !== '' ? $bodyText : null,
        $imageUrl !== '' ? $imageUrl : null,
        $imageUrlsJson,
        $rating]);
    $commentId = (int)$pdo->lastInsertId();
    // v921 店の起案者 (投稿者本人以外) に通知。「自分が登録した店に誰かがレビュー」が見えるように。
    $creatorId = (int)$placeRow['creator_user_id'];
    if ($creatorId > 0 && $creatorId !== (int)$u['id']) {
        try {
            $short = $bodyText !== '' ? mb_substr($bodyText, 0, 40) : '';
            $star  = $rating !== null ? str_repeat('⭐', $rating) . ' ' : '';
            $imgMark = !empty($imageUrls) ? ' 📷' : '';
            $tail = $short !== '' ? "「{$short}" . (mb_strlen((string)$bodyText) > 40 ? '…' : '') . "」" : '';
            notify_safely($pdo, $cfg, $creatorId, 'admin_notice',
                "📍 {$u['display_name']} が「{$placeRow['title']}」にレビュー投稿 {$star}{$imgMark}{$tail} /#/places/{$placeId}",
                'place_comment', $commentId);
        } catch (Throwable $_) {}
    }
    json_response(['id' => $commentId]);
}

function places_comment_delete(PDO $pdo, array $cfg, int $placeId, int $commentId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM place_comments WHERE id=? AND place_id=?");
    $st->execute([$commentId, $placeId]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', '口コミが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cuid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM place_comments WHERE id=?")->execute([$commentId]);
    json_response(['ok' => true]);
}

// v471 URL (tabelog.com / retty.me) → 店名 / 住所 / 緯度経度を抽出。
// JSON-LD の Restaurant / FoodEstablishment / LocalBusiness ノードが
// あれば採用 (両サイトとも schema.org の geo を持っている)。
// fallback: og:title / og:description のみ。
function places_import_url(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $url = trim((string)($body['url'] ?? ''));
    if ($url === '') throw new ApiException('bad_request', 'url 必要', 400);
    if (!preg_match('#^https?://#', $url)) throw new ApiException('bad_request', 'http(s) URL のみ', 400);
    // ホワイトリスト: tabelog / Retty / hotpepper / Google Maps (短縮) / v921 TripAdvisor 対応
    $host = parse_url($url, PHP_URL_HOST) ?? '';
    $allowed = ['tabelog.com', 'retty.me', 'hotpepper.jp', 'goo.gl', 'maps.google.com',
                'maps.app.goo.gl', 'g.co',
                'tripadvisor.com', 'tripadvisor.jp', 'tripadvisor.co.jp'];
    $ok = false;
    foreach ($allowed as $h) {
        if ($host === $h || str_ends_with($host, '.' . $h)) { $ok = true; break; }
    }
    if (!$ok) throw new ApiException('bad_request', 'tabelog / Retty / hotpepper / TripAdvisor のみ対応', 400);

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
        throw new ApiException('fetch_failed', "ページ取得失敗 (HTTP {$code})", 502);
    }

    $title = ''; $address = ''; $lat = null; $lng = null; $desc = '';
    $phone = ''; $hours = '';

    // 1) JSON-LD
    if (preg_match_all('#<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>#is', $html, $m)) {
        foreach ($m[1] as $raw) {
            // v751 #369 tabelog の Restaurant JSON-LD は HTML entity がない生 JSON。
            //   html_entity_decode を通すと「&quot;」がない文字列も何故か壊れるケース
            //   がある (=「￥」等の特殊文字が影響) ので、まず raw で decode を試して
            //   失敗した時だけ html_entity_decode を fallback。
            $j = json_decode($raw, true);
            if (!is_array($j)) {
                $j = json_decode(html_entity_decode($raw, ENT_QUOTES|ENT_HTML5, 'UTF-8'), true);
            }
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
                if ($title !== '' && $lat !== null) break 2;  // 取れたら抜ける
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

    // v920 同一 URL の店が既に登録済かチェック (ユーザ要望)。見つかったら
    //   existing_place を返して、フロントで「もう登録されている」と案内する。
    $existingPlace = null;
    $stDup = $pdo->prepare("SELECT p.id, p.title, p.category, p.address, p.image_url, p.creator_user_id,
                                   u.display_name AS creator_name
                              FROM places p
                              LEFT JOIN users u ON u.id = p.creator_user_id
                             WHERE p.source_url = ? LIMIT 1");
    $stDup->execute([$url]);
    if ($r = $stDup->fetch(PDO::FETCH_ASSOC)) {
        $existingPlace = [
            'id'           => (int)$r['id'],
            'title'        => $r['title'],
            'category'     => $r['category'],
            'address'      => $r['address'],
            'image_url'    => $r['image_url'],
            'creator_name' => $r['creator_name'],
        ];
    }

    json_response([
        'title'          => $title,
        'address'        => $address,
        'lat'            => $lat,
        'lng'            => $lng,
        'description'    => $desc,
        'phone'          => $phone,
        'hours'          => $hours,
        'source_url'     => $url,
        'existing_place' => $existingPlace,
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

// v731 #340 source_url が空の place を一度に最大 10 件まで探して自動で入れる。
//   admin 限定。タイトル (+ 住所先頭) で tabelog 検索 → 1 件目の URL を採用。
function places_backfill_tabelog(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    if ((string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', 'admin のみ', 403);
    }
    $body = read_json_body();
    $batch = max(1, min(10, (int)($body['limit'] ?? 10)));
    // 未補完件数
    $totalLeft = (int)$pdo->query("SELECT COUNT(*) FROM places
                                     WHERE source_url IS NULL OR source_url = ''")->fetchColumn();
    $st = $pdo->prepare("SELECT id, title, address FROM places
                          WHERE source_url IS NULL OR source_url = ''
                          ORDER BY id ASC LIMIT $batch");
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $upd = $pdo->prepare("UPDATE places SET source_url=? WHERE id=?");
    $updated = 0; $missed = 0; $results = [];
    foreach ($rows as $r) {
        $kw = (string)$r['title'];
        if (!empty($r['address']) && preg_match('/^(.{1,15}?[都道府県市区町村])/u', (string)$r['address'], $am)) {
            $kw .= ' ' . $am[1];
        }
        $url = places_tabelog_first_hit($kw);
        if ($url) {
            $upd->execute([$url, (int)$r['id']]);
            $updated++;
            $results[] = ['id' => (int)$r['id'], 'title' => $r['title'], 'url' => $url];
        } else {
            $missed++;
            $results[] = ['id' => (int)$r['id'], 'title' => $r['title'], 'url' => null];
        }
        usleep(800 * 1000); // 0.8 秒 sleep でレート制限を避ける
    }
    json_response([
        'processed' => count($rows),
        'updated'   => $updated,
        'missed'    => $missed,
        'remaining' => max(0, $totalLeft - count($rows)),
        'results'   => $results,
    ]);
}

// v752 #370 画像を 90°/180°/270° 回転して同じファイルパスに上書き保存。
//   thumb.jpg が横にあれば同角度で回転。 client は URL に ?v=ts を付けて cache bust。
//   失敗系 (GD 無し / mime 非対応 / 書き込み不可) は ApiException で 400 / 500 返す。
function rotate_image_file_inplace(string $imageUrlPath, int $degrees): void {
    $degrees = ((int)$degrees) % 360;
    if (!in_array($degrees, [90, 180, 270], true)) {
        throw new ApiException('bad_request', 'degrees は 90 / 180 / 270 のみ', 400);
    }
    if (!function_exists('imagecreatefromstring')) {
        throw new ApiException('not_supported', 'GD 拡張がないので回転できません', 500);
    }
    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    // 先頭が '/' で始まる public 配下の path に限定
    if (!preg_match('#^/uploads/#', $imageUrlPath)) {
        throw new ApiException('bad_request', 'uploads/ 以下の path のみ', 400);
    }
    $abs = $publicDir . $imageUrlPath;
    if (!is_file($abs)) throw new ApiException('not_found', 'image not found: ' . $imageUrlPath, 404);
    if (!is_writable($abs)) throw new ApiException('forbidden', 'file not writable', 500);
    $rotate = function (string $path) use ($degrees): void {
        $raw = @file_get_contents($path);
        if ($raw === false) throw new ApiException('io_error', 'read failed', 500);
        $src = @imagecreatefromstring($raw);
        if (!$src) throw new ApiException('bad_request', '画像として読めません', 400);
        // v883 #456 EXIF orientation を先に適用してから user の rotate を重ねる。
        //   iPhone 縦撮影 (EXIF=6) の画像は元ファイルに EXIF orientation tag が残ったまま
        //   pixel データは横倒し → ブラウザは EXIF を見て縦表示。サーバ rotate は EXIF
        //   無視で pixel rotate するため、初回 click が EXIF rotation を相殺してしまい
        //   「1 回押しても動かず、2 回押すと 180° 回転」という挙動になっていた。
        //   先に EXIF orientation 通り pixel を回しておけば、保存時に EXIF が落ちる
        //   (imagejpeg 等は EXIF を保存しない) ので、以降の回転は user の入力通り素直に重なる。
        $ext0 = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (($ext0 === 'jpg' || $ext0 === 'jpeg') && function_exists('exif_read_data')) {
            $exif = @exif_read_data($path);
            $ori = isset($exif['Orientation']) ? (int)$exif['Orientation'] : 1;
            if ($ori === 3)      { $r = imagerotate($src, 180, 0); imagedestroy($src); $src = $r; }
            elseif ($ori === 6)  { $r = imagerotate($src,  -90, 0); imagedestroy($src); $src = $r; }
            elseif ($ori === 8)  { $r = imagerotate($src,   90, 0); imagedestroy($src); $src = $r; }
            // 鏡像 (2/4/5/7) は稀なのでスキップ
        }
        // imagerotate は反時計回り角度を取る (90 = 反時計 90°)。
        //   ユーザ期待 = 時計回り 90° なら -90 を渡す。ここでは「右 (時計回り) 90°」を標準とする。
        $rotated = imagerotate($src, -$degrees, 0);
        imagedestroy($src);
        if (!$rotated) throw new ApiException('io_error', 'rotate failed', 500);
        // 拡張子を見て保存形式を決める (jpg/jpeg/png/webp/gif)
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $ok = false;
        if ($ext === 'jpg' || $ext === 'jpeg') $ok = imagejpeg($rotated, $path, 90);
        elseif ($ext === 'png') $ok = imagepng($rotated, $path);
        elseif ($ext === 'webp' && function_exists('imagewebp')) $ok = imagewebp($rotated, $path, 90);
        elseif ($ext === 'gif') $ok = imagegif($rotated, $path);
        else throw new ApiException('bad_request', '対応外拡張子: ' . $ext, 400);
        imagedestroy($rotated);
        if (!$ok) throw new ApiException('io_error', 'save failed', 500);
        @chmod($path, 0644);
    };
    $rotate($abs);
    // v1021 中村さん指摘「口コミの画像は回転したのに、お店リストで見える画像は回転していない」
    //   → 従来は主と thumb を独立に同じ角度で回していたが、 EXIF orientation の処理タイミング
    //   や upload 側での事前 EXIF 補正とズレて、主と thumb の縦横が逆になるケースが
    //   発生していた。修正: rotate 後の主から thumb を再生成 (save_uploaded_file と同じ
    //   ロジックで 640px 縮小)。これで常に主と thumb が同じ向き / 縦横に揃う。
    _regenerate_thumb_from_main($abs);
}

function _regenerate_thumb_from_main(string $mainAbs): void {
    if (!is_file($mainAbs)) return;
    $thumbAbs = preg_replace('/\.[^.]+$/', '', $mainAbs) . '.thumb.jpg';
    // 既存 thumb が書き込み可か新規作成可か
    if (is_file($thumbAbs) && !is_writable($thumbAbs)) return;
    $dir = dirname($thumbAbs);
    if (!is_dir($dir) || !is_writable($dir)) return;
    try {
        $raw = @file_get_contents($mainAbs);
        $src = $raw ? @imagecreatefromstring($raw) : false;
        if (!$src) return;
        // v1092 中村さん報告「detail は回転しているが、お店リストのサムネは
        //   回転していない」→ 原因は main JPG が EXIF Orientation=6 (縦写真)
        //   だが、 imagecreatefromstring は EXIF を無視するため thumb 生成時に
        //   pixel が横倒しのまま保存されていた。 save_uploaded_file と同じく
        //   EXIF orientation を先に適用してから縮小する。 imagejpeg は EXIF を
        //   保存しないので、 thumb は物理ピクセルで正しい向きになる。
        $ext = strtolower(pathinfo($mainAbs, PATHINFO_EXTENSION));
        if (($ext === 'jpg' || $ext === 'jpeg') && function_exists('exif_read_data')) {
            $exif = @exif_read_data($mainAbs);
            $ori = isset($exif['Orientation']) ? (int)$exif['Orientation'] : 1;
            if ($ori === 3)      { $r = imagerotate($src, 180, 0); imagedestroy($src); $src = $r; }
            elseif ($ori === 6)  { $r = imagerotate($src,  -90, 0); imagedestroy($src); $src = $r; }
            elseif ($ori === 8)  { $r = imagerotate($src,   90, 0); imagedestroy($src); $src = $r; }
        }
        $sw = imagesx($src); $sh = imagesy($src);
        $maxDim = 640;
        $ratio = min($maxDim / $sw, $maxDim / $sh, 1.0);
        $tw = max(1, (int)round($sw * $ratio));
        $th = max(1, (int)round($sh * $ratio));
        $thumb = imagecreatetruecolor($tw, $th);
        imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh);
        imagejpeg($thumb, $thumbAbs, 90);
        @chmod($thumbAbs, 0644);
        imagedestroy($thumb); imagedestroy($src);
    } catch (Throwable $_) { /* thumb 生成失敗は致命的ではない */ }
}

function places_hero_rotate_image(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $degrees = (int)($body['degrees'] ?? 90);
    $st = $pdo->prepare("SELECT creator_user_id, image_url FROM places WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'お店がありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者 / admin のみ回転可', 403);
    }
    $url = (string)$row['image_url'];
    if ($url === '') throw new ApiException('bad_request', '画像がありません', 400);
    rotate_image_file_inplace(_places_url_to_path($url), $degrees);
    json_response(['ok' => true]);
}

function places_comment_rotate_image(PDO $pdo, array $cfg, int $placeId, int $commentId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $degrees = (int)($body['degrees'] ?? 90);
    $index = (int)($body['index'] ?? 0);
    $st = $pdo->prepare("SELECT user_id, image_url, image_urls FROM place_comments WHERE id=? AND place_id=?");
    $st->execute([$commentId, $placeId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '口コミがありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者 / admin のみ回転可', 403);
    }
    $urls = [];
    if (!empty($row['image_urls'])) {
        $d = json_decode((string)$row['image_urls'], true);
        if (is_array($d)) $urls = array_values(array_filter(array_map('strval', $d)));
    }
    if (!$urls && !empty($row['image_url'])) $urls = [(string)$row['image_url']];
    if (!isset($urls[$index])) throw new ApiException('bad_request', 'index 範囲外', 400);
    rotate_image_file_inplace(_places_url_to_path($urls[$index]), $degrees);
    json_response(['ok' => true]);
}

// /uploads/.../xxx.jpg または https://host/uploads/.../xxx.jpg を /uploads/.../xxx.jpg に正規化
function _places_url_to_path(string $url): string {
    if (preg_match('#^https?://[^/]+(/.*)$#', $url, $m)) return $m[1];
    if (str_starts_with($url, '/')) return $url;
    return '/' . $url;
}

function places_tabelog_first_hit(string $kw): ?string {
    $url = 'https://tabelog.com/rstLst/?sw=' . urlencode($kw);
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
    if (!$html || $code !== 200) return null;
    if (preg_match('@https?://tabelog\.com/[a-z]+/A\d+/A\d+/\d+/?@', (string)$html, $m)) {
        return rtrim($m[0], '/') . '/';
    }
    return null;
}

