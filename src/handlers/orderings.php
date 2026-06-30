<?php
// v523 #160 順番決め (発表順 / 当番割など)。ルーレットの全員順列版。
//   POST /api/orderings        — タイトル + メンバー指定で順番を決定 (CSPRNG シャッフル)
//                                 → 結果を保存 + 全員に通知 (ref_type='ordering')
//   GET  /api/orderings        — 自分が起案 or メンバーに含まれているものの最近 50 件
//   GET  /api/orderings/:id    — 詳細 (順番付きメンバー)
//   DELETE /api/orderings/:id  — 起案者 or admin が削除 (結果ごと CASCADE)

declare(strict_types=1);

function route_orderings(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u   = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET') { orderings_list($pdo, $uid); return; }
    if ($sub === '' && $method === 'POST') { orderings_create($pdo, $cfg, $uid); return; }
    if (is_numeric($sub) && $method === 'GET')    { orderings_detail($pdo, $uid, (int)$sub); return; }
    if (is_numeric($sub) && $method === 'DELETE') { orderings_delete($pdo, $u, (int)$sub); return; }
    json_error('not_found', "no ordering route for $method $sub", 404);
}

function orderings_list(PDO $pdo, int $uid): void {
    // 自分が起案 or 自分が結果に入ってるものだけ。 50 件まで。
    $st = $pdo->prepare("
        SELECT DISTINCT o.id, o.title, o.creator_user_id, o.created_at,
               uc.display_name AS creator_name,
               (SELECT COUNT(*) FROM ordering_results r WHERE r.ordering_id = o.id) AS member_count,
               (SELECT position FROM ordering_results r WHERE r.ordering_id = o.id AND r.user_id = ?) AS my_position
          FROM orderings o
          JOIN users uc ON uc.id = o.creator_user_id
     LEFT JOIN ordering_results rm ON rm.ordering_id = o.id AND rm.user_id = ?
         WHERE o.creator_user_id = ? OR rm.user_id IS NOT NULL
         ORDER BY o.id DESC LIMIT 50");
    $st->execute([$uid, $uid, $uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$r) {
        $r['id']             = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['member_count']   = (int)$r['member_count'];
        $r['my_position']    = $r['my_position'] !== null ? (int)$r['my_position'] : null;
    }
    unset($r);
    json_response(['items' => $items]);
}

function orderings_create(PDO $pdo, array $cfg, int $uid): void {
    $body  = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $memberIds = $body['member_ids'] ?? [];
    if (!is_array($memberIds) || count($memberIds) < 2) {
        throw new ApiException('bad_request', 'member_ids: 2 名以上', 400);
    }
    // 整数化 + 重複排除 + human 限定 (system / bot は除く)
    $memberIds = array_values(array_unique(array_map('intval', $memberIds)));
    if (count($memberIds) > 100) throw new ApiException('bad_request', 'member_ids: 100 名まで', 400);
    $place = implode(',', array_fill(0, count($memberIds), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($memberIds);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) < 2) throw new ApiException('bad_request', '有効メンバー 2 名以上', 400);

    // CSPRNG Fisher-Yates シャッフル
    $shuffled = $valid;
    for ($i = count($shuffled) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$shuffled[$i], $shuffled[$j]] = [$shuffled[$j], $shuffled[$i]];
    }
    $orderingId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $shuffled, &$orderingId) {
        $pdo->prepare("INSERT INTO orderings (creator_user_id, title, created_at) VALUES (?, ?, NOW())")
            ->execute([$uid, $title]);
        $orderingId = (int)$pdo->lastInsertId();
        $insR = $pdo->prepare("INSERT INTO ordering_results (ordering_id, user_id, position) VALUES (?, ?, ?)");
        foreach ($shuffled as $idx => $userId) {
            $insR->execute([$orderingId, $userId, $idx + 1]);
        }
    });

    // 通知 (各メンバーに自分の順番を伝える)。自分が含まれていても「自分が起案した順番決め」を
    //   通知するのは少し冗長なので起案者 = メンバーの場合は通知不要 (起案者自身は画面で結果を見るので)。
    $cfg2 = $GLOBALS['CFG'] ?? $cfg;
    $stNm = $pdo->prepare("SELECT display_name FROM users WHERE id IN ($place)");
    $stNm->execute($memberIds);
    foreach ($shuffled as $idx => $userId) {
        if ($userId === $uid) continue;
        $pos = $idx + 1;
        try {
            notify_safely(
                $pdo, $cfg2, $userId, 'admin_notice',
                "📋 『{$title}』の順番が決まりました! あなたは {$pos} 番目です。",
                'ordering', $orderingId
            );
        } catch (Throwable $_) { /* swallow */ }
    }
    try {
        $pdo->prepare("UPDATE orderings SET notified_at = NOW() WHERE id = ?")->execute([$orderingId]);
    } catch (Throwable $_) {}

    json_response(['ok' => true, 'id' => $orderingId]);
}

function orderings_detail(PDO $pdo, int $uid, int $id): void {
    $st = $pdo->prepare("SELECT o.id, o.title, o.creator_user_id, o.created_at, o.notified_at,
                                uc.display_name AS creator_name
                           FROM orderings o
                           JOIN users uc ON uc.id = o.creator_user_id
                          WHERE o.id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', "ordering $id not found", 404);
    $row['id']              = (int)$row['id'];
    $row['creator_user_id'] = (int)$row['creator_user_id'];

    $stR = $pdo->prepare("
        SELECT r.user_id, r.position, u.display_name, u.avatar_url
          FROM ordering_results r
          JOIN users u ON u.id = r.user_id
         WHERE r.ordering_id = ?
         ORDER BY r.position");
    $stR->execute([$id]);
    $row['results'] = array_map(fn($r) => [
        'user_id'      => (int)$r['user_id'],
        'position'     => (int)$r['position'],
        'display_name' => $r['display_name'],
        'avatar_url'   => $r['avatar_url'],
    ], $stR->fetchAll(PDO::FETCH_ASSOC));
    json_response($row);
}

function orderings_delete(PDO $pdo, array $u, int $id): void {
    $st = $pdo->prepare("SELECT creator_user_id FROM orderings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', "ordering $id not found", 404);
    $isOwner = (int)$row['creator_user_id'] === (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if (!$isOwner && !$isAdmin) throw new ApiException('forbidden', '起案者 / admin のみ削除可', 403);
    $pdo->prepare("DELETE FROM orderings WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}
