<?php
// /api/playlists — 音楽 / 動画 プレイリスト。 YouTube / Spotify URL + メモ + 並び順。
// 1 プレイリストに N アイテム、 アイテムごとに 1-5 評価 + コメント、 プレイリスト
// 全体に ❤️ like。

declare(strict_types=1);

function route_playlists(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET')  { playlists_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { playlists_create($pdo, $cfg); return; }

    $pid = (int)$sub;
    if ($pid > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { playlists_detail($pdo, $cfg, $pid); return; }
        if ($next === '' && $method === 'PATCH')  { playlists_patch($pdo, $cfg, $pid);  return; }
        if ($next === '' && $method === 'DELETE') { playlists_delete($pdo, $cfg, $pid); return; }
        if ($next === 'like' && $method === 'POST') { playlists_toggle_like($pdo, $cfg, $pid); return; }
        if ($next === 'items') {
            $iid = isset($seg[3]) ? (int)$seg[3] : 0;
            $op  = $seg[4] ?? '';
            if ($iid === 0 && $method === 'POST') { playlists_item_add($pdo, $cfg, $pid); return; }
            if ($iid > 0) {
                if ($op === '' && $method === 'PATCH')  { playlists_item_patch($pdo, $cfg, $pid, $iid); return; }
                if ($op === '' && $method === 'DELETE') { playlists_item_delete($pdo, $cfg, $pid, $iid); return; }
                if ($op === 'move' && $method === 'PATCH') { playlists_item_move($pdo, $cfg, $pid, $iid); return; }
                if ($op === 'rating' && $method === 'POST')   { playlists_item_rate($pdo, $cfg, $pid, $iid); return; }
                if ($op === 'rating' && $method === 'DELETE') { playlists_item_unrate($pdo, $cfg, $pid, $iid); return; }
            }
        }
    }
    json_error('not_found', "no playlists route for $method $sub", 404);
}

// ─── URL parser ─────────────────────────────────────────
// YouTube / Spotify / direct video / その他 を 識別、 サムネ URL も 解決。
function playlists_parse_url(string $url): array {
    $url = trim($url);
    $m = [];
    if (preg_match('#(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})#', $url, $m)) {
        $vid = $m[1];
        return [
            'source_type'   => 'youtube',
            'source_id'     => $vid,
            'thumbnail_url' => "https://img.youtube.com/vi/{$vid}/hqdefault.jpg",
        ];
    }
    if (preg_match('#open\.spotify\.com/(track|album|playlist|episode)/([A-Za-z0-9]+)#', $url, $m)) {
        return [
            'source_type'   => 'spotify_' . $m[1],
            'source_id'     => $m[2],
            'thumbnail_url' => null,
        ];
    }
    if (preg_match('#\.(mp4|webm|m4v|ogg|mov)(\?|$)#i', $url)) {
        return ['source_type' => 'direct_video', 'source_id' => null, 'thumbnail_url' => null];
    }
    return ['source_type' => 'other', 'source_id' => null, 'thumbnail_url' => null];
}

function playlists_validate_url(string $url): string {
    $url = trim($url);
    if ($url === '' || mb_strlen($url) > 2000) {
        throw new ApiException('bad_request', 'url length 1..2000', 400);
    }
    if (!preg_match('#^https?://#i', $url)) {
        throw new ApiException('bad_request', 'url は http(s) で始まる必要があります', 400);
    }
    return $url;
}

function playlists_assert_creator(PDO $pdo, int $pid, int $userId): array {
    $st = $pdo->prepare("SELECT id, creator_user_id, visibility FROM playlists WHERE id=?");
    $st->execute([$pid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'playlist not found', 404);
    if ((int)$row['creator_user_id'] !== $userId) {
        throw new ApiException('forbidden', '作成者のみ編集できます', 403);
    }
    return $row;
}

function playlists_assert_readable(PDO $pdo, int $pid, int $userId): array {
    $st = $pdo->prepare("SELECT id, creator_user_id, visibility FROM playlists WHERE id=?");
    $st->execute([$pid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'playlist not found', 404);
    if ($row['visibility'] === 'private' && (int)$row['creator_user_id'] !== $userId) {
        throw new ApiException('forbidden', 'このプレイリストは非公開です', 403);
    }
    return $row;
}

// ─── LIST ─────────────────────────────────────────────
function playlists_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $q       = trim((string)($_GET['q'] ?? ''));
    $genre   = trim((string)($_GET['genre'] ?? ''));
    $mine    = !empty($_GET['mine']);
    $creator = isset($_GET['creator']) ? (int)$_GET['creator'] : 0;
    $limit   = max(1, min(100, (int)($_GET['limit'] ?? 50)));

    // 公開 + 自分の private のみ 見せる。
    $where  = '(p.visibility = \'public\' OR p.creator_user_id = ?)';
    $params = [$u['id']];
    if ($mine)   { $where .= ' AND p.creator_user_id = ?';            $params[] = $u['id']; }
    if ($creator > 0) { $where .= ' AND p.creator_user_id = ?';       $params[] = $creator; }
    if ($genre !== '') { $where .= ' AND p.genre_tag = ?';            $params[] = $genre; }
    if ($q !== '') {
        $where .= ' AND (p.title LIKE ? OR p.description LIKE ?)';
        $like = '%' . $q . '%';
        $params[] = $like; $params[] = $like;
    }

    $sql = "SELECT p.id, p.title, p.cover_image_url, p.visibility, p.genre_tag,
                   p.view_count, p.created_at, p.updated_at,
                   p.creator_user_id, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
                   (SELECT COUNT(*) FROM playlist_items   pi WHERE pi.playlist_id = p.id) AS item_count,
                   (SELECT COUNT(*) FROM playlist_likes   pl WHERE pl.playlist_id = p.id) AS like_count,
                   EXISTS (SELECT 1 FROM playlist_likes pl2 WHERE pl2.playlist_id = p.id AND pl2.user_id = ?) AS i_liked
              FROM playlists p
              JOIN users u ON u.id = p.creator_user_id
             WHERE {$where}
             ORDER BY p.created_at DESC
             LIMIT {$limit}";
    array_unshift($params, $u['id']); // for i_liked subquery
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$r) {
        $r['id']         = (int)$r['id'];
        $r['view_count'] = (int)$r['view_count'];
        $r['item_count'] = (int)$r['item_count'];
        $r['like_count'] = (int)$r['like_count'];
        $r['i_liked']    = (int)$r['i_liked'] === 1;
        // v521 #157 サムネ URL を併せて返す
        $r['cover_image_thumb'] = !empty($r['cover_image_url']) ? thumb_url_for((string)$r['cover_image_url']) : null;
    }
    json_response(['items' => $items]);
}

// ─── CREATE ─────────────────────────────────────────────
function playlists_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $desc  = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    if ($desc === '') $desc = null;
    $cover = validate_product_image_url($body['cover_image_url'] ?? null);
    $vis   = (string)($body['visibility'] ?? 'public');
    if (!in_array($vis, ['public','private'], true)) $vis = 'public';
    $genre = isset($body['genre_tag']) ? trim((string)$body['genre_tag']) : '';
    if ($genre === '' || mb_strlen($genre) > 60) $genre = null;

    $st = $pdo->prepare("INSERT INTO playlists
        (creator_user_id, title, description, cover_image_url, visibility, genre_tag)
        VALUES (?,?,?,?,?,?)");
    $st->execute([$u['id'], $title, $desc, $cover, $vis, $genre]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

// ─── DETAIL ─────────────────────────────────────────────
function playlists_detail(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_readable($pdo, $pid, (int)$u['id']);
    // 閲覧数 を 自分以外の閲覧時に +1。 同一 user が連打しても 自作品は カウント
    // しない (作者の自己閲覧を 弾く)。
    $pdo->prepare("UPDATE playlists SET view_count = view_count + 1
                   WHERE id = ? AND creator_user_id <> ?")
        ->execute([$pid, $u['id']]);

    $st = $pdo->prepare("
        SELECT p.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               (SELECT COUNT(*) FROM playlist_likes WHERE playlist_id = p.id) AS like_count,
               EXISTS (SELECT 1 FROM playlist_likes WHERE playlist_id = p.id AND user_id = ?) AS i_liked
          FROM playlists p
          JOIN users u ON u.id = p.creator_user_id
         WHERE p.id = ?");
    $st->execute([$u['id'], $pid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $row['id']         = (int)$row['id'];
    $row['view_count'] = (int)$row['view_count'];
    $row['like_count'] = (int)$row['like_count'];
    $row['i_liked']    = (int)$row['i_liked'] === 1;
    $row['is_mine']    = (int)$row['creator_user_id'] === (int)$u['id'];
    // v521 #157 サムネ URL を併せて返す (詳細ヒーロー用)
    $row['cover_image_thumb'] = !empty($row['cover_image_url']) ? thumb_url_for((string)$row['cover_image_url']) : null;

    // items + 自分の評価 + 平均 + 評価件数
    $st = $pdo->prepare("
        SELECT pi.*,
               (SELECT AVG(rating) FROM playlist_item_ratings WHERE playlist_item_id = pi.id) AS avg_rating,
               (SELECT COUNT(*)    FROM playlist_item_ratings WHERE playlist_item_id = pi.id) AS rating_count,
               (SELECT rating  FROM playlist_item_ratings WHERE playlist_item_id = pi.id AND user_id = ?) AS my_rating,
               (SELECT comment FROM playlist_item_ratings WHERE playlist_item_id = pi.id AND user_id = ?) AS my_comment,
               ua.display_name AS added_by_name
          FROM playlist_items pi
          JOIN users ua ON ua.id = pi.added_by_user_id
         WHERE pi.playlist_id = ?
         ORDER BY pi.position, pi.id");
    $st->execute([$u['id'], $u['id'], $pid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$it) {
        $it['id']            = (int)$it['id'];
        $it['playlist_id']   = (int)$it['playlist_id'];
        $it['position']      = (int)$it['position'];
        $it['duration_sec']  = $it['duration_sec'] === null ? null : (int)$it['duration_sec'];
        $it['avg_rating']    = $it['avg_rating'] === null ? null : round((float)$it['avg_rating'], 2);
        $it['rating_count']  = (int)$it['rating_count'];
        $it['my_rating']     = $it['my_rating'] === null ? null : (int)$it['my_rating'];
    }
    $row['items'] = $items;
    json_response($row);
}

// ─── PATCH (creator) ─────────────────────────────────────
function playlists_patch(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) {
            throw new ApiException('bad_request', 'title length 1..200', 400);
        }
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = $body['description'];
        if ($d === null || trim((string)$d) === '') { $sets[] = 'description = NULL'; }
        else { $sets[] = 'description = ?'; $args[] = mb_substr((string)$d, 0, 5000); }
    }
    if (array_key_exists('cover_image_url', $body)) {
        $c = validate_product_image_url($body['cover_image_url']);
        if ($c === null) { $sets[] = 'cover_image_url = NULL'; }
        else { $sets[] = 'cover_image_url = ?'; $args[] = $c; }
    }
    if (array_key_exists('visibility', $body)) {
        $v = (string)$body['visibility'];
        if (!in_array($v, ['public','private'], true)) {
            throw new ApiException('bad_request', "visibility must be public|private", 400);
        }
        $sets[] = 'visibility = ?'; $args[] = $v;
    }
    if (array_key_exists('genre_tag', $body)) {
        $g = trim((string)($body['genre_tag'] ?? ''));
        if ($g === '' || mb_strlen($g) > 60) { $sets[] = 'genre_tag = NULL'; }
        else { $sets[] = 'genre_tag = ?'; $args[] = $g; }
    }
    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $args[] = $pid;
    $pdo->prepare('UPDATE playlists SET ' . implode(', ', $sets) . ' WHERE id = ?')
        ->execute($args);
    json_response(['ok' => true]);
}

// ─── DELETE (creator) ────────────────────────────────────
function playlists_delete(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $pdo->prepare("DELETE FROM playlists WHERE id = ?")->execute([$pid]);
    json_response(['ok' => true]);
}

// ─── LIKE toggle ─────────────────────────────────────────
function playlists_toggle_like(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_readable($pdo, $pid, (int)$u['id']);
    $st = $pdo->prepare("SELECT 1 FROM playlist_likes WHERE playlist_id = ? AND user_id = ?");
    $st->execute([$pid, $u['id']]);
    if ($st->fetchColumn()) {
        $pdo->prepare("DELETE FROM playlist_likes WHERE playlist_id = ? AND user_id = ?")
            ->execute([$pid, $u['id']]);
        json_response(['ok' => true, 'liked' => false]);
    } else {
        $pdo->prepare("INSERT INTO playlist_likes (playlist_id, user_id) VALUES (?, ?)")
            ->execute([$pid, $u['id']]);
        json_response(['ok' => true, 'liked' => true]);
    }
}

// ─── ITEM add ────────────────────────────────────────────
// メモ: items の 追加は 作成者だけ。 アイテム評価は 全員可能。
function playlists_item_add(PDO $pdo, array $cfg, int $pid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $body = read_json_body();
    $url = playlists_validate_url((string)require_field($body, 'url'));
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) {
        throw new ApiException('bad_request', 'title length 1..300', 400);
    }
    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 500) : null;
    if ($memo === '') $memo = null;
    $duration = isset($body['duration_sec']) && $body['duration_sec'] !== ''
        ? max(0, (int)$body['duration_sec']) : null;
    $parsed = playlists_parse_url($url);
    // 末尾 position
    $st = $pdo->prepare("SELECT COALESCE(MAX(position),0)+1 FROM playlist_items WHERE playlist_id=?");
    $st->execute([$pid]);
    $pos = (int)$st->fetchColumn();
    $ins = $pdo->prepare("INSERT INTO playlist_items
        (playlist_id, position, title, url, source_type, source_id, thumbnail_url, duration_sec, memo, added_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)");
    $thumb = $parsed['thumbnail_url'] ?? null;
    if (!empty($body['thumbnail_url']) && is_string($body['thumbnail_url'])) {
        $thumb = mb_substr((string)$body['thumbnail_url'], 0, 2000);
    }
    $ins->execute([$pid, $pos, $title, $url, $parsed['source_type'], $parsed['source_id'],
        $thumb, $duration, $memo, $u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'position' => $pos]);
}

// ─── ITEM patch ─────────────────────────────────────────
function playlists_item_patch(PDO $pdo, array $cfg, int $pid, int $iid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 300) {
            throw new ApiException('bad_request', 'title length 1..300', 400);
        }
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('url', $body)) {
        $url = playlists_validate_url((string)$body['url']);
        $parsed = playlists_parse_url($url);
        $sets[] = 'url = ?'; $args[] = $url;
        $sets[] = 'source_type = ?'; $args[] = $parsed['source_type'];
        $sets[] = 'source_id = ?'; $args[] = $parsed['source_id'];
        if (!array_key_exists('thumbnail_url', $body) && $parsed['thumbnail_url']) {
            $sets[] = 'thumbnail_url = ?'; $args[] = $parsed['thumbnail_url'];
        }
    }
    if (array_key_exists('thumbnail_url', $body)) {
        $th = $body['thumbnail_url'];
        if ($th === null || $th === '') { $sets[] = 'thumbnail_url = NULL'; }
        else { $sets[] = 'thumbnail_url = ?'; $args[] = mb_substr((string)$th, 0, 2000); }
    }
    if (array_key_exists('memo', $body)) {
        $m = $body['memo'];
        if ($m === null || $m === '') { $sets[] = 'memo = NULL'; }
        else { $sets[] = 'memo = ?'; $args[] = mb_substr((string)$m, 0, 500); }
    }
    if (array_key_exists('duration_sec', $body)) {
        if ($body['duration_sec'] === null || $body['duration_sec'] === '') {
            $sets[] = 'duration_sec = NULL';
        } else {
            $sets[] = 'duration_sec = ?'; $args[] = max(0, (int)$body['duration_sec']);
        }
    }
    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $args[] = $iid; $args[] = $pid;
    $pdo->prepare('UPDATE playlist_items SET ' . implode(', ', $sets)
        . ' WHERE id = ? AND playlist_id = ?')->execute($args);
    json_response(['ok' => true]);
}

// ─── ITEM delete ─────────────────────────────────────────
function playlists_item_delete(PDO $pdo, array $cfg, int $pid, int $iid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $pdo->prepare("DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?")
        ->execute([$iid, $pid]);
    json_response(['ok' => true]);
}

// ─── ITEM move (position swap with neighbor) ───────────────
function playlists_item_move(PDO $pdo, array $cfg, int $pid, int $iid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_creator($pdo, $pid, (int)$u['id']);
    $body = read_json_body();
    $dir = (string)($body['dir'] ?? '');
    if (!in_array($dir, ['up','down'], true)) {
        throw new ApiException('bad_request', "dir must be 'up' or 'down'", 400);
    }
    $st = $pdo->prepare("SELECT id, position FROM playlist_items WHERE playlist_id=? ORDER BY position, id");
    $st->execute([$pid]);
    $list = $st->fetchAll(PDO::FETCH_ASSOC);
    $idx = -1;
    foreach ($list as $i => $r) if ((int)$r['id'] === $iid) { $idx = $i; break; }
    if ($idx < 0) throw new ApiException('not_found', 'item not found', 404);
    $neiIdx = $dir === 'up' ? $idx - 1 : $idx + 1;
    if ($neiIdx < 0 || $neiIdx >= count($list)) {
        json_response(['ok' => true, 'moved' => false]); return;
    }
    $a = $list[$idx]; $b = $list[$neiIdx];
    db_tx($pdo, function () use ($pdo, $a, $b) {
        $pdo->prepare("UPDATE playlist_items SET position=? WHERE id=?")->execute([(int)$b['position'], (int)$a['id']]);
        $pdo->prepare("UPDATE playlist_items SET position=? WHERE id=?")->execute([(int)$a['position'], (int)$b['id']]);
    });
    json_response(['ok' => true, 'moved' => true]);
}

// ─── ITEM rating ───────────────────────────────────────
// rating = 1..5、 comment = 任意。 自分の前評価は UPSERT で上書き。
function playlists_item_rate(PDO $pdo, array $cfg, int $pid, int $iid): void {
    $u = Auth::requireUser($pdo, $cfg);
    playlists_assert_readable($pdo, $pid, (int)$u['id']);
    $st = $pdo->prepare("SELECT 1 FROM playlist_items WHERE id=? AND playlist_id=?");
    $st->execute([$iid, $pid]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'item not found', 404);
    $body = read_json_body();
    $rating = (int)require_field($body, 'rating');
    if ($rating < 1 || $rating > 5) {
        throw new ApiException('bad_request', 'rating must be 1..5', 400);
    }
    $comment = isset($body['comment']) ? mb_substr((string)$body['comment'], 0, 500) : null;
    if ($comment === '') $comment = null;
    $pdo->prepare("INSERT INTO playlist_item_ratings (playlist_item_id, user_id, rating, comment)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = NOW()")
        ->execute([$iid, $u['id'], $rating, $comment]);
    json_response(['ok' => true]);
}

function playlists_item_unrate(PDO $pdo, array $cfg, int $pid, int $iid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM playlist_item_ratings WHERE playlist_item_id = ? AND user_id = ?
        AND EXISTS (SELECT 1 FROM playlist_items WHERE id = ? AND playlist_id = ?)")
        ->execute([$iid, $u['id'], $iid, $pid]);
    json_response(['ok' => true]);
}
