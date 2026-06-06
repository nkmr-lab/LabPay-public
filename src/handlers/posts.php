<?php
// /api/posts — シンプル SNS (Twitter 風)。 全員 が 全投稿 を 見る (フォロー なし)。
//  - body / image_url / lat / lng を 投稿
//  - parent_id で 返信 (スレッド)
//  - いいね は post_likes (PK = post_id + user_id) で トグル
//  - @display_name で メンション → 通知

declare(strict_types=1);

function route_posts(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { posts_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { posts_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { posts_detail($pdo, $cfg, $id); return; }
        if ($next === ''       && $method === 'DELETE') { posts_delete($pdo, $cfg, $id); return; }
        if ($next === 'like'   && $method === 'POST')   { posts_like_toggle($pdo, $cfg, $id, true);  return; }
        if ($next === 'like'   && $method === 'DELETE') { posts_like_toggle($pdo, $cfg, $id, false); return; }
    }
    json_error('not_found', "no posts route for $method $sub", 404);
}

function posts_serialize_rows(PDO $pdo, array $rows, int $meId): array {
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int)$r['id'], $rows);
    $place = implode(',', array_fill(0, count($ids), '?'));
    // いいね 集計
    $stL = $pdo->prepare("SELECT post_id, COUNT(*) AS n,
                              SUM(user_id=?) AS mine
                         FROM post_likes WHERE post_id IN ($place) GROUP BY post_id");
    $stL->execute(array_merge([$meId], $ids));
    $likes = [];
    foreach ($stL->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $likes[(int)$r['post_id']] = ['n' => (int)$r['n'], 'mine' => (int)$r['mine'] > 0];
    }
    // 返信数 集計
    $stR = $pdo->prepare("SELECT parent_id, COUNT(*) AS n FROM posts WHERE parent_id IN ($place) GROUP BY parent_id");
    $stR->execute($ids);
    $replies = [];
    foreach ($stR->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $replies[(int)$r['parent_id']] = (int)$r['n'];
    }
    $out = [];
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $out[] = [
            'id'           => $id,
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'body'         => $r['body'],
            'image_url'    => $r['image_url'],
            'lat'          => $r['lat'] !== null ? (float)$r['lat'] : null,
            'lng'          => $r['lng'] !== null ? (float)$r['lng'] : null,
            'parent_id'    => $r['parent_id'] !== null ? (int)$r['parent_id'] : null,
            'created_at'   => $r['created_at'],
            'like_count'   => $likes[$id]['n']    ?? 0,
            'liked_by_me'  => $likes[$id]['mine'] ?? false,
            'reply_count'  => $replies[$id]       ?? 0,
        ];
    }
    return $out;
}

function posts_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
    $beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
    $parentId = isset($_GET['parent_id']) && $_GET['parent_id'] !== '' ? (int)$_GET['parent_id'] : null;
    $args = [];
    $where = "1=1";
    if ($parentId !== null) {
        $where .= " AND p.parent_id = ?";
        $args[] = $parentId;
    } else {
        // タイムライン = parent_id IS NULL の トップレベル のみ
        $where .= " AND p.parent_id IS NULL";
    }
    if ($beforeId > 0) {
        $where .= " AND p.id < ?";
        $args[] = $beforeId;
    }
    $sql = "SELECT p.id, p.user_id, p.body, p.image_url, p.lat, p.lng, p.parent_id, p.created_at,
                   u.display_name, u.avatar_url
              FROM posts p
              JOIN users u ON u.id = p.user_id
             WHERE $where
             ORDER BY p.id DESC
             LIMIT $limit";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = posts_serialize_rows($pdo, $st->fetchAll(PDO::FETCH_ASSOC), (int)$u['id']);
    json_response(['items' => $items]);
}

function posts_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = isset($body['body']) ? trim((string)$body['body']) : '';
    if (mb_strlen($text) > 2000) $text = mb_substr($text, 0, 2000);
    $imageUrl = trim((string)($body['image_url'] ?? ''));
    if (mb_strlen($imageUrl) > 500) $imageUrl = mb_substr($imageUrl, 0, 500);
    $parentId = isset($body['parent_id']) && $body['parent_id'] !== '' && $body['parent_id'] !== null
                  ? (int)$body['parent_id'] : null;
    $lat = isset($body['lat']) && $body['lat'] !== '' && $body['lat'] !== null ? (float)$body['lat'] : null;
    $lng = isset($body['lng']) && $body['lng'] !== '' && $body['lng'] !== null ? (float)$body['lng'] : null;
    if ($lat !== null && ($lat < -90 || $lat > 90))   throw new ApiException('bad_request', 'lat 範囲外', 400);
    if ($lng !== null && ($lng < -180 || $lng > 180)) throw new ApiException('bad_request', 'lng 範囲外', 400);
    if ($text === '' && $imageUrl === '') {
        throw new ApiException('bad_request', '本文 か 画像 が 必要', 400);
    }
    if ($parentId !== null) {
        $st = $pdo->prepare("SELECT 1 FROM posts WHERE id=?");
        $st->execute([$parentId]);
        if (!$st->fetchColumn()) throw new ApiException('not_found', '返信先 投稿 が ありません', 404);
    }
    $pid = 0;
    $mentioned = [];
    db_tx($pdo, function () use ($pdo, $u, $text, $imageUrl, $lat, $lng, $parentId, &$pid, &$mentioned) {
        $ins = $pdo->prepare("INSERT INTO posts (user_id, body, image_url, lat, lng, parent_id, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, NOW())");
        $ins->execute([(int)$u['id'], $text !== '' ? $text : null,
                       $imageUrl !== '' ? $imageUrl : null,
                       $lat, $lng, $parentId]);
        $pid = (int)$pdo->lastInsertId();
        // @メンション 抽出 (display_name の 前方一致 で 簡易)
        if ($text !== '' && preg_match_all('/@([\p{L}\p{N}_\-\.]{1,40})/u', $text, $m)) {
            $names = array_unique($m[1]);
            if ($names) {
                $place = implode(',', array_fill(0, count($names), '?'));
                $stU = $pdo->prepare("SELECT id, display_name FROM users
                                       WHERE display_name IN ($place) AND kind='human' LIMIT 50");
                $stU->execute($names);
                $stM = $pdo->prepare("INSERT IGNORE INTO post_mentions (post_id, user_id) VALUES (?, ?)");
                foreach ($stU->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $uid = (int)$row['id'];
                    if ($uid === (int)$u['id']) continue;
                    $stM->execute([$pid, $uid]);
                    $mentioned[] = $uid;
                }
            }
        }
    });
    // 通知: メンション / 返信先 ユーザ
    $snip = mb_substr($text !== '' ? $text : '(画像のみ)', 0, 80);
    $notifTargets = $mentioned;
    if ($parentId !== null) {
        $st = $pdo->prepare("SELECT user_id FROM posts WHERE id=?");
        $st->execute([$parentId]);
        $parentUid = (int)$st->fetchColumn();
        if ($parentUid > 0 && $parentUid !== (int)$u['id']) $notifTargets[] = $parentUid;
    }
    $notifTargets = array_unique($notifTargets);
    foreach ($notifTargets as $uid) {
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'post',
                "💬 {$u['display_name']}: {$snip}",
                'post', $pid);
        } catch (Throwable $_) {}
    }
    json_response(['id' => $pid]);
}

function posts_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT p.id, p.user_id, p.body, p.image_url, p.lat, p.lng, p.parent_id, p.created_at,
                                u.display_name, u.avatar_url
                           FROM posts p
                           JOIN users u ON u.id = p.user_id
                          WHERE p.id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投稿が ありません', 404);
    $post = posts_serialize_rows($pdo, [$row], (int)$u['id'])[0];
    // 返信
    $stR = $pdo->prepare("SELECT p.id, p.user_id, p.body, p.image_url, p.lat, p.lng, p.parent_id, p.created_at,
                                 u.display_name, u.avatar_url
                            FROM posts p JOIN users u ON u.id = p.user_id
                           WHERE p.parent_id = ?
                           ORDER BY p.id ASC LIMIT 200");
    $stR->execute([$id]);
    $replies = posts_serialize_rows($pdo, $stR->fetchAll(PDO::FETCH_ASSOC), (int)$u['id']);
    json_response(['post' => $post, 'replies' => $replies]);
}

function posts_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM posts WHERE id=?");
    $st->execute([$id]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', '投稿が ありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cuid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者 または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM posts WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function posts_like_toggle(PDO $pdo, array $cfg, int $id, bool $like): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT 1 FROM posts WHERE id=?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', '投稿 が ありません', 404);
    if ($like) {
        $pdo->prepare("INSERT IGNORE INTO post_likes (post_id, user_id, created_at)
                       VALUES (?, ?, NOW())")
            ->execute([$id, (int)$u['id']]);
    } else {
        $pdo->prepare("DELETE FROM post_likes WHERE post_id=? AND user_id=?")
            ->execute([$id, (int)$u['id']]);
    }
    $cn = (int)$pdo->prepare("SELECT COUNT(*) FROM post_likes WHERE post_id=?")
                   ->execute([$id]) ? null : null;
    // 件数 取得
    $stC = $pdo->prepare("SELECT COUNT(*) FROM post_likes WHERE post_id=?");
    $stC->execute([$id]);
    json_response(['ok' => true, 'like_count' => (int)$stC->fetchColumn(), 'liked_by_me' => $like]);
}
