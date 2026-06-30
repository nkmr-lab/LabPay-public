<?php
// /api/posts — シンプル SNS (Twitter 風)。 全員が全投稿を見る (フォローなし)。
//  - body / image_url / lat / lng を投稿
//  - parent_id で返信 (スレッド)
//  - いいねは post_likes (PK = post_id + user_id) でトグル
//  - @display_name でメンション → 通知

declare(strict_types=1);

function route_posts(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { posts_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { posts_create($pdo, $cfg); return; }
    // v480 軽量ポーリング: 最新投稿 id だけ返す。 これより大きい id を持つ
    //   投稿があるならクライアントが一覧を取り直す。 DB 1 クエリで終わる。
    if ($sub === 'latest_id' && $method === 'GET') { posts_latest_id($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { posts_detail($pdo, $cfg, $id); return; }
        if ($next === ''       && $method === 'DELETE') { posts_delete($pdo, $cfg, $id); return; }
        // v736 #346 投稿後に位置情報だけを削除 (投稿者または admin)
        if ($next === 'location' && $method === 'DELETE') { posts_clear_location($pdo, $cfg, $id); return; }
        // v480 旧 /like (引数なし = ❤️ 単一) → /reaction?kind=thumb|heart|star に統一。
        //   後方互換: /like POST/DELETE は kind='heart' として扱う。
        if ($next === 'like'     && $method === 'POST')   { posts_reaction_toggle($pdo, $cfg, $id, 'heart', true);  return; }
        if ($next === 'like'     && $method === 'DELETE') { posts_reaction_toggle($pdo, $cfg, $id, 'heart', false); return; }
        if ($next === 'reaction' && $method === 'POST')   { posts_reaction_toggle($pdo, $cfg, $id, posts_kind_param(), true);  return; }
        if ($next === 'reaction' && $method === 'DELETE') { posts_reaction_toggle($pdo, $cfg, $id, posts_kind_param(), false); return; }
        // v785 #383 投稿画像を 90° 回転 (投稿者 / admin のみ)。 places と同じくサーバ側で上書き保存。
        if ($next === 'rotate-image' && $method === 'POST') { posts_rotate_image($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no posts route for $method $sub", 404);
}

function posts_kind_param(): string {
    $k = isset($_GET['kind']) ? (string)$_GET['kind'] : 'heart';
    if (!in_array($k, ['thumb','heart','star'], true)) {
        throw new ApiException('bad_request', 'kind は thumb / heart / star のみ', 400);
    }
    return $k;
}

function posts_latest_id(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $id = (int)$pdo->query("SELECT COALESCE(MAX(id),0) FROM posts WHERE parent_id IS NULL")->fetchColumn();
    json_response(['latest_id' => $id]);
}

function posts_serialize_rows(PDO $pdo, array $rows, int $meId): array {
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int)$r['id'], $rows);
    $place = implode(',', array_fill(0, count($ids), '?'));
    // v480 リアクション集計: kind 別 count + 自分が押した kind のセット。
    //   like_count / liked_by_me は ❤ ハートの件数 / 自分状態として後方互換を残す。
    $stL = $pdo->prepare("SELECT post_id, kind, COUNT(*) AS n,
                              SUM(user_id=?) AS mine
                         FROM post_likes WHERE post_id IN ($place) GROUP BY post_id, kind");
    $stL->execute(array_merge([$meId], $ids));
    $reactions = [];
    foreach ($stL->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $pid = (int)$r['post_id'];
        $k = (string)$r['kind'];
        if (!isset($reactions[$pid])) $reactions[$pid] = ['counts' => [], 'mine' => []];
        $reactions[$pid]['counts'][$k] = (int)$r['n'];
        if ((int)$r['mine'] > 0) $reactions[$pid]['mine'][] = $k;
    }
    // 返信数集計
    $stR = $pdo->prepare("SELECT parent_id, COUNT(*) AS n FROM posts WHERE parent_id IN ($place) GROUP BY parent_id");
    $stR->execute($ids);
    $replies = [];
    foreach ($stR->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $replies[(int)$r['parent_id']] = (int)$r['n'];
    }
    $out = [];
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $counts = $reactions[$id]['counts'] ?? [];
        $mine = $reactions[$id]['mine'] ?? [];
        $heartN = $counts['heart'] ?? 0;
        $out[] = [
            'id'              => $id,
            'user_id'         => (int)$r['user_id'],
            'display_name'    => $r['display_name'],
            'avatar_url'      => $r['avatar_url'],
            // v528 #187 admin が LabPay 投稿だけ削除可能にするためのフラグ。
            //   クライアント posts.js が `author_kind === 'system'` で判定する。
            'author_kind'     => $r['author_kind'] ?? null,
            'body'            => $r['body'],
            'image_url'       => $r['image_url'],
            // v494 #101 サムネが実在する時だけそのURLを返す。 存在しなければ null。
            //   クライアントは image_thumb_url ?? image_url を使う。
            'image_thumb_url' => $r['image_url'] ? thumb_url_for((string)$r['image_url']) : null,
            'lat'             => $r['lat'] !== null ? (float)$r['lat'] : null,
            'lng'             => $r['lng'] !== null ? (float)$r['lng'] : null,
            'parent_id'       => $r['parent_id'] !== null ? (int)$r['parent_id'] : null,
            'created_at'      => $r['created_at'],
            // v497 #104 旅行中などタイムゾーンが端末≠サーバ (JST) の時、 クライアントの
            //   new Date('YYYY-MM-DD HH:MM:SS') は端末ローカルとして解釈してしまい
            //   「結構前の投稿がたった今」 になる。 TZ付きISOで返して曖昧さをなくす。
            'created_at_iso'  => $r['created_at'] ? (new DateTimeImmutable((string)$r['created_at']))->format('c') : null,
            // 後方互換: like = heart。
            'like_count'      => $heartN,
            'liked_by_me'     => in_array('heart', $mine, true),
            // 新 v480
            'reaction_counts' => [
                'thumb' => $counts['thumb'] ?? 0,
                'heart' => $heartN,
                'star'  => $counts['star']  ?? 0,
            ],
            'my_reactions'    => array_values(array_intersect(['thumb','heart','star'], $mine)),
            'reply_count'     => $replies[$id] ?? 0,
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
        // タイムライン = parent_id IS NULL のトップレベルのみ
        $where .= " AND p.parent_id IS NULL";
    }
    if ($beforeId > 0) {
        $where .= " AND p.id < ?";
        $args[] = $beforeId;
    }
    // v525 #180 投稿者で絞り込み (?user_id=N)
    if (isset($_GET['user_id']) && (int)$_GET['user_id'] > 0) {
        $where .= " AND p.user_id = ?";
        $args[] = (int)$_GET['user_id'];
    }
    $sql = "SELECT p.id, p.user_id, p.body, p.image_url, p.lat, p.lng, p.parent_id, p.created_at,
                   u.display_name, u.avatar_url, u.kind AS author_kind
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

// v465 LabPay 公式アカウント (system user) を取得 / 作成。
function labpay_account_id(PDO $pdo): int {
    static $cached = null;
    if ($cached !== null) return $cached;
    $st = $pdo->query("SELECT id FROM users WHERE display_name='LabPay' AND kind='system' LIMIT 1");
    $uid = (int)$st->fetchColumn();
    if ($uid <= 0) {
        $pdo->prepare("INSERT INTO users (display_name, role, kind, created_at) VALUES ('LabPay','member','system',NOW())")
            ->execute();
        $uid = (int)$pdo->lastInsertId();
    }
    $cached = $uid;
    return $uid;
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
        throw new ApiException('bad_request', '本文か画像が必要', 400);
    }
    if ($parentId !== null) {
        $st = $pdo->prepare("SELECT 1 FROM posts WHERE id=?");
        $st->execute([$parentId]);
        if (!$st->fetchColumn()) throw new ApiException('not_found', '返信先投稿がありません', 404);
    }
    // v465 → v477 @LabPay メンション or LabPay 投稿への返信 → 自動的に feedback 起票。
    // admin 投稿なら即 approved。 「#バグ」 ハッシュタグで kind='bug'、 それ以外 (default) は 'feature'。
    // i フラグで大文字小文字を無視 (@labpay も拾う)。
    $linkedFeedbackId = null;
    $shouldCreateFb = false;
    $fbBody = '';
    if ($text !== '' && preg_match('/@LabPay\b/iu', $text)) {
        $fbBody = mb_substr(trim(preg_replace('/@LabPay\s*/iu', '', $text)), 0, 4000);
        if ($fbBody !== '') $shouldCreateFb = true;
    }
    // v477 LabPay 投稿への返信も feedback 扱い (本文から @LabPay がなくても)。
    if (!$shouldCreateFb && $parentId !== null && $text !== '') {
        $stChk = $pdo->prepare("SELECT u.id FROM posts p
                                  JOIN users u ON u.id = p.user_id
                                 WHERE p.id = ? AND u.display_name='LabPay' AND u.kind='system'");
        $stChk->execute([$parentId]);
        if ((int)$stChk->fetchColumn() > 0) {
            $fbBody = mb_substr(trim($text), 0, 4000);
            $shouldCreateFb = true;
        }
    }
    if ($shouldCreateFb && $fbBody !== '') {
        $fbKind = preg_match('/#バグ|#bug/iu', $text) ? 'bug' : 'feature';
        $isAdmin = (string)($u['role'] ?? '') === 'admin';
        if ($isAdmin) {
            $stFb = $pdo->prepare("INSERT INTO feedback
                (user_id, kind, body, url, claude_status, claude_assigned_at, claude_assigned_by_user_id)
                VALUES (?, ?, ?, '#/sns', 'approved', NOW(), ?)");
            $stFb->execute([(int)$u['id'], $fbKind, $fbBody, (int)$u['id']]);
        } else {
            $stFb = $pdo->prepare("INSERT INTO feedback (user_id, kind, body, url)
                VALUES (?, ?, ?, '#/sns')");
            $stFb->execute([(int)$u['id'], $fbKind, $fbBody]);
        }
        $linkedFeedbackId = (int)$pdo->lastInsertId();
    }
    $pid = 0;
    $mentioned = [];
    db_tx($pdo, function () use ($pdo, $u, $text, $imageUrl, $lat, $lng, $parentId, $linkedFeedbackId, &$pid, &$mentioned) {
        $ins = $pdo->prepare("INSERT INTO posts (user_id, body, image_url, lat, lng, parent_id, feedback_id, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
        $ins->execute([(int)$u['id'], $text !== '' ? $text : null,
                       $imageUrl !== '' ? $imageUrl : null,
                       $lat, $lng, $parentId, $linkedFeedbackId]);
        $pid = (int)$pdo->lastInsertId();
        // @メンション抽出 (display_name の前方一致で簡易)
        if ($text !== '' && preg_match_all('/@([\p{L}\p{N}_\-\.]{1,40})/u', $text, $m)) {
            $names = array_unique($m[1]);
            if ($names) {
                $place = implode(',', array_fill(0, count($names), '?'));
                // v465 system (=LabPay) も含めてメンション解決
                $stU = $pdo->prepare("SELECT id, display_name FROM users
                                       WHERE display_name IN ($place) AND kind IN ('human','system') LIMIT 50");
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
    // 通知: メンション / 返信先ユーザ
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
                                u.display_name, u.avatar_url, u.kind AS author_kind
                           FROM posts p
                           JOIN users u ON u.id = p.user_id
                          WHERE p.id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投稿がありません', 404);
    $post = posts_serialize_rows($pdo, [$row], (int)$u['id'])[0];
    // 返信
    $stR = $pdo->prepare("SELECT p.id, p.user_id, p.body, p.image_url, p.lat, p.lng, p.parent_id, p.created_at,
                                 u.display_name, u.avatar_url
                            FROM posts p JOIN users u ON u.id = p.user_id
                           WHERE p.parent_id = ?
                           ORDER BY p.id ASC LIMIT 200");
    $stR->execute([$id]);
    $replies = posts_serialize_rows($pdo, $stR->fetchAll(PDO::FETCH_ASSOC), (int)$u['id']);
    // v498 #106 詳細では誰がどの kind を押したかも返す。
    // v499 #117 reactors は投稿者本人と admin のみ閲覧可。 他人が見るとプライバシー
    //   懸念があるので空配列で隠す。
    $reactors = [];
    $isOwner = (int)$post['user_id'] === (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($isOwner || $isAdmin) {
        $stReact = $pdo->prepare("SELECT pl.kind, pl.user_id, pl.created_at,
                                         u.display_name, u.avatar_url
                                    FROM post_likes pl
                                    JOIN users u ON u.id = pl.user_id
                                   WHERE pl.post_id = ?
                                   ORDER BY pl.created_at DESC");
        $stReact->execute([$id]);
        $reactors = array_map(fn($r) => [
            'kind'         => $r['kind'],
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'created_at'   => $r['created_at'],
        ], $stReact->fetchAll(PDO::FETCH_ASSOC));
    }
    json_response(['post' => $post, 'replies' => $replies, 'reactors' => $reactors]);
}

// v736 #346 投稿後に位置情報だけを削除する。投稿者または admin のみ。
function posts_clear_location(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM posts WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投稿がありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者または admin のみ', 403);
    }
    $pdo->prepare("UPDATE posts SET lat=NULL, lng=NULL WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function posts_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT p.user_id, u.kind FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投稿がありません', 404);
    $cuid = (int)$row['user_id'];
    $authorIsSystem = (string)($row['kind'] ?? '') === 'system';
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    // v524 #182 削除権限を絞る:
    //   - 投稿者本人: 常に OK
    //   - admin: 自分の投稿 + system (LabPay 自動投稿) のみ。 他人の人間投稿は削除不可
    //   - その他: 自分のみ
    $isAuthor = $cuid === (int)$u['id'];
    $canDelete = $isAuthor || ($isAdmin && $authorIsSystem);
    if (!$canDelete) {
        throw new ApiException('forbidden', '投稿者本人または admin (system 投稿のみ) しか削除できません', 403);
    }
    $pdo->prepare("DELETE FROM posts WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// v785 #383 投稿画像を 90° 回転し、 サーバ側で上書き保存。 投稿者 or admin のみ。
function posts_rotate_image(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $degrees = (int)($body['degrees'] ?? 90);
    $st = $pdo->prepare("SELECT user_id, image_url FROM posts WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投稿がありません', 404);
    $isAuthor = (int)$row['user_id'] === (int)$u['id'];
    $isAdmin  = (string)($u['role'] ?? '') === 'admin';
    if (!$isAuthor && !$isAdmin) throw new ApiException('forbidden', '投稿者または admin のみ回転可', 403);
    $url = (string)($row['image_url'] ?? '');
    if ($url === '') throw new ApiException('bad_request', '画像がありません', 400);
    rotate_image_file_inplace(_places_url_to_path($url), $degrees);
    json_response(['ok' => true]);
}

function posts_reaction_toggle(PDO $pdo, array $cfg, int $id, string $kind, bool $on): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id, body FROM posts WHERE id=?");
    $st->execute([$id]);
    $post = $st->fetch(PDO::FETCH_ASSOC);
    if (!$post) throw new ApiException('not_found', '投稿がありません', 404);
    if ($on) {
        $stIns = $pdo->prepare("INSERT IGNORE INTO post_likes (post_id, user_id, kind, created_at)
                                 VALUES (?, ?, ?, NOW())");
        $stIns->execute([$id, (int)$u['id'], $kind]);
        // v498 #106 新規 INSERT (IGNORE で重複除外) かつ自分以外の投稿なら通知。
        if ($stIns->rowCount() > 0 && (int)$post['user_id'] !== (int)$u['id']) {
            $icon = ['thumb' => '👍', 'heart' => '❤️', 'star' => '⭐'][$kind] ?? '👍';
            $snip = mb_substr((string)($post['body'] ?? ''), 0, 40);
            try {
                Notifier::notify($pdo, $cfg, (int)$post['user_id'], 'post',
                    "{$icon} {$u['display_name']} が反応: 「{$snip}」",
                    'post', $id);
            } catch (Throwable $_) {}
        }
    } else {
        $pdo->prepare("DELETE FROM post_likes WHERE post_id=? AND user_id=? AND kind=?")
            ->execute([$id, (int)$u['id'], $kind]);
    }
    // 全 kind 件数 + 自分が押した kind を返す。
    $stC = $pdo->prepare("SELECT kind, COUNT(*) AS n,
                              SUM(user_id=?) AS mine
                         FROM post_likes WHERE post_id=? GROUP BY kind");
    $stC->execute([(int)$u['id'], $id]);
    $counts = ['thumb' => 0, 'heart' => 0, 'star' => 0];
    $mine = [];
    foreach ($stC->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $k = (string)$r['kind'];
        if (isset($counts[$k])) $counts[$k] = (int)$r['n'];
        if ((int)$r['mine'] > 0) $mine[] = $k;
    }
    json_response([
        'ok' => true,
        'reaction_counts' => $counts,
        'my_reactions'    => array_values(array_intersect(['thumb','heart','star'], $mine)),
        // 後方互換
        'like_count'      => $counts['heart'],
        'liked_by_me'     => in_array('heart', $mine, true),
    ]);
}
