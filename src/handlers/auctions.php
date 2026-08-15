<?php
// /api/auctions — オークション MVP。出品 + 入札 + lazy settle。落札後の円移動は無し。
// Routes:
//   GET    /api/auctions                  自分の関連 + 進行中の一覧
//   POST   /api/auctions                  出品作成
//   GET    /api/auctions/:id              詳細 (lazy settle 含む)
//   POST   /api/auctions/:id/bids         入札
//   PATCH  /api/auctions/:id/cancel       出品取消 (seller のみ、入札 0 件か、 admin)
//   DELETE /api/auctions/:id              削除 (seller / admin)

declare(strict_types=1);

function route_auctions(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { auctions_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { auctions_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { auctions_detail($pdo, $cfg, $id); return; }
        if ($next === ''       && $method === 'DELETE') { auctions_delete($pdo, $cfg, $id); return; }
        if ($next === 'bids'   && $method === 'POST')   { auctions_bid($pdo, $cfg, $id); return; }
        if ($next === 'cancel' && $method === 'PATCH')  { auctions_cancel($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no auctions route for $method $sub", 404);
}

// 締切過ぎでまだ settle されてないオークションをその場で確定。高 traffic でない
// 前提なので cron 不要。落札者 + 出品者に通知。
function auctions_maybe_settle(PDO $pdo, array $cfg, int $id): void {
    $st = $pdo->prepare("SELECT id, seller_user_id, title, closes_at, settled_at, cancelled_at
                           FROM auctions WHERE id = ?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) return;
    if ($a['settled_at'] !== null) return;
    if ($a['cancelled_at'] !== null) return;
    if (strtotime((string)$a['closes_at']) > time()) return;

    // 最高額 (タイブレーク: 早い入札優先 = id 昇順)。
    $stB = $pdo->prepare("SELECT bidder_user_id, amount FROM auction_bids
                          WHERE auction_id = ? ORDER BY amount DESC, id ASC LIMIT 1");
    $stB->execute([$id]);
    $top = $stB->fetch(PDO::FETCH_ASSOC);
    if ($top) {
        $pdo->prepare("UPDATE auctions SET settled_at=NOW(), winner_user_id=?, winning_bid=? WHERE id=?")
            ->execute([(int)$top['bidder_user_id'], (int)$top['amount'], $id]);
        // 落札者に
        try {
            Notifier::notify($pdo, $cfg, (int)$top['bidder_user_id'], 'auction',
                "🎉 落札しました!: 「{$a['title']}」 ({$top['amount']}円)", 'auction', $id);
        } catch (Throwable $_) {}
        // 出品者に
        try {
            $stU = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
            $stU->execute([(int)$top['bidder_user_id']]);
            $winName = (string)$stU->fetchColumn();
            Notifier::notify($pdo, $cfg, (int)$a['seller_user_id'], 'auction',
                "🏷 落札確定: 「{$a['title']}」 → {$winName} さん ({$top['amount']}円)", 'auction', $id);
        } catch (Throwable $_) {}
    } else {
        $pdo->prepare("UPDATE auctions SET settled_at=NOW() WHERE id=?")->execute([$id]);
        try {
            Notifier::notify($pdo, $cfg, (int)$a['seller_user_id'], 'auction',
                "❎ 入札 0 件で終了: 「{$a['title']}」", 'auction', $id);
        } catch (Throwable $_) {}
    }
}

function auctions_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 締切過ぎ + 未 settle をまとめて lazy settle (極小コスト)。
    $stExp = $pdo->prepare("SELECT id FROM auctions
                            WHERE settled_at IS NULL AND cancelled_at IS NULL
                              AND closes_at <= NOW() LIMIT 50");
    $stExp->execute();
    foreach ($stExp->fetchAll(PDO::FETCH_COLUMN) as $aid) {
        auctions_maybe_settle($pdo, $cfg, (int)$aid);
    }

    $st = $pdo->prepare("
        SELECT a.id, a.title, a.image_url, a.min_price, a.closes_at, a.created_at,
               a.seller_user_id, a.cancelled_at, a.settled_at, a.winner_user_id, a.winning_bid,
               us.display_name AS seller_name, us.avatar_url AS seller_avatar_url,
               uw.display_name AS winner_name,
               (SELECT MAX(amount) FROM auction_bids WHERE auction_id=a.id) AS top_bid,
               (SELECT COUNT(*)   FROM auction_bids WHERE auction_id=a.id) AS bid_count,
               (SELECT COUNT(*)   FROM auction_bids WHERE auction_id=a.id AND bidder_user_id=?) AS my_bid_count
          FROM auctions a
          JOIN users us ON us.id = a.seller_user_id
          LEFT JOIN users uw ON uw.id = a.winner_user_id
         ORDER BY (a.cancelled_at IS NULL AND a.settled_at IS NULL) DESC,
                  a.closes_at DESC, a.id DESC LIMIT 100");
    $st->execute([$uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    // v512 サムネ実在チェック済み URL を返す (なければ原画像 fallback)
    foreach ($items as &$it) {
        $it['image_thumb_url'] = !empty($it['image_url']) ? thumb_url_for((string)$it['image_url']) : null;
    }
    unset($it);
    json_response(['items' => $items]);
}

function auctions_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $description = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    $imageUrl = validate_product_image_url($body['image_url'] ?? null);
    $minPrice = isset($body['min_price']) ? max(1, (int)$body['min_price']) : 1;
    $closesRaw = (string)require_field($body, 'closes_at');
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $closesRaw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $closesRaw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $closesRaw);
    if (!$dt) throw new ApiException('bad_request', 'closes_at は ISO 日時', 400);
    $closesAt = $dt->format('Y-m-d H:i:s');
    if (strtotime($closesAt) <= time() + 60) {
        throw new ApiException('bad_request', '締切は今より少なくとも 1 分後に', 400);
    }
    if (strtotime($closesAt) > time() + 14 * 24 * 3600) {
        throw new ApiException('bad_request', '締切は 14 日以内に', 400);
    }
    $st = $pdo->prepare("INSERT INTO auctions
        (seller_user_id, title, description, image_url, min_price, closes_at, created_at)
        VALUES (?,?,?,?,?,?, NOW())");
    $st->execute([(int)$u['id'], $title, $description, $imageUrl, $minPrice, $closesAt]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function auctions_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    auctions_maybe_settle($pdo, $cfg, $id);
    $st = $pdo->prepare("
        SELECT a.*, us.display_name AS seller_name, us.avatar_url AS seller_avatar_url,
               us.phone_number AS seller_phone,
               uw.display_name AS winner_name, uw.avatar_url AS winner_avatar_url,
               uw.phone_number AS winner_phone
          FROM auctions a
          JOIN users us ON us.id = a.seller_user_id
          LEFT JOIN users uw ON uw.id = a.winner_user_id
         WHERE a.id = ?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'オークション無し', 404);
    // slack_member_id は auth.nkmr.io に集約済み。 露出可否は下で expose 条件でガード。
    $a['seller_slack'] = AuthProfile::slackMemberId($pdo, $cfg, (int)$a['seller_user_id']);
    $a['winner_slack'] = !empty($a['winner_user_id'])
        ? AuthProfile::slackMemberId($pdo, $cfg, (int)$a['winner_user_id'])
        : null;
    $stB = $pdo->prepare("SELECT b.id, b.bidder_user_id, b.amount, b.created_at,
                                 ub.display_name AS bidder_name, ub.avatar_url AS bidder_avatar_url
                            FROM auction_bids b
                            JOIN users ub ON ub.id = b.bidder_user_id
                           WHERE b.auction_id = ?
                           ORDER BY b.amount DESC, b.id ASC LIMIT 100");
    $stB->execute([$id]);
    $bids = $stB->fetchAll(PDO::FETCH_ASSOC);
    $myId = (int)$u['id'];
    $isSeller = (int)$a['seller_user_id'] === $myId;
    $isWinner = !empty($a['winner_user_id']) && (int)$a['winner_user_id'] === $myId;
    // 連絡先は seller / winner / admin にだけ露出 (それ以外には NULL に潰す)
    $expose = $isSeller || $isWinner || ((string)($u['role'] ?? '') === 'admin');
    if (!$expose) {
        $a['seller_slack'] = null; $a['seller_phone'] = null;
        $a['winner_slack'] = null; $a['winner_phone'] = null;
    }
    json_response([
        'auction' => $a,
        'bids' => $bids,
        'top_bid' => $bids[0]['amount'] ?? null,
        'is_seller' => $isSeller,
        'is_winner' => $isWinner,
        'server_now' => date('Y-m-d H:i:s'),
    ]);
}

function auctions_bid(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $amount = isset($body['amount']) ? max(0, (int)$body['amount']) : 0;
    if ($amount <= 0) throw new ApiException('bad_request', '入札額は 1 以上', 400);

    // ロック取って競合を防ぐ (高 traffic でないので楽観でも良いが MVP として真面目に)
    db_tx($pdo, function () use ($pdo, $cfg, $u, $id, $amount) {
        $st = $pdo->prepare("SELECT seller_user_id, title, min_price, closes_at,
                                    cancelled_at, settled_at FROM auctions WHERE id=? FOR UPDATE");
        $st->execute([$id]);
        $a = $st->fetch(PDO::FETCH_ASSOC);
        if (!$a) throw new ApiException('not_found', 'オークション無し', 404);
        if ($a['cancelled_at'] !== null) throw new ApiException('bad_request', '取消済', 400);
        if ($a['settled_at']   !== null) throw new ApiException('bad_request', '終了済', 400);
        if (strtotime((string)$a['closes_at']) <= time()) throw new ApiException('bad_request', '締切超過', 400);
        if ((int)$a['seller_user_id'] === (int)$u['id']) throw new ApiException('bad_request', '自分の出品に入札できません', 400);
        if ($amount < (int)$a['min_price']) {
            throw new ApiException('bad_request', "最低 {$a['min_price']}円から", 400);
        }
        $stT = $pdo->prepare("SELECT bidder_user_id, amount FROM auction_bids
                              WHERE auction_id = ? ORDER BY amount DESC, id ASC LIMIT 1");
        $stT->execute([$id]);
        $top = $stT->fetch(PDO::FETCH_ASSOC);
        if ($top && $amount <= (int)$top['amount']) {
            throw new ApiException('bad_request',
                "現在の最高入札 {$top['amount']}円より高い額が必要", 400);
        }
        $pdo->prepare("INSERT INTO auction_bids (auction_id, bidder_user_id, amount, created_at)
                       VALUES (?,?,?, NOW())")
            ->execute([$id, (int)$u['id'], $amount]);
        // 通知: 1) 出品者「新しい入札」  2) 直前 top bidder 「他に上を取られました」
        try {
            Notifier::notify($pdo, $cfg, (int)$a['seller_user_id'], 'auction',
                "💰 新しい入札: 「{$a['title']}」 {$amount}円", 'auction', $id);
        } catch (Throwable $_) {}
        if ($top && (int)$top['bidder_user_id'] !== (int)$u['id']) {
            try {
                Notifier::notify($pdo, $cfg, (int)$top['bidder_user_id'], 'auction',
                    "⚠ 上を取られました: 「{$a['title']}」 → 新最高 {$amount}円", 'auction', $id);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function auctions_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT seller_user_id, cancelled_at, settled_at, title FROM auctions WHERE id=?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'オークション無し', 404);
    if ($a['settled_at'] !== null)  throw new ApiException('bad_request', '終了済', 400);
    if ($a['cancelled_at'] !== null) { json_response(['ok' => true, 'already' => true]); return; }
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$a['seller_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '出品者または admin のみ', 403);
    }
    $pdo->prepare("UPDATE auctions SET cancelled_at=NOW() WHERE id=?")->execute([$id]);
    // 入札者全員に通知
    $stB = $pdo->prepare("SELECT DISTINCT bidder_user_id FROM auction_bids WHERE auction_id=?");
    $stB->execute([$id]);
    foreach ($stB->fetchAll(PDO::FETCH_COLUMN) as $bid) {
        if ((int)$bid === (int)$u['id']) continue;
        try { Notifier::notify($pdo, $cfg, (int)$bid, 'auction',
            "❌ 出品取消: 「{$a['title']}」", 'auction', $id); } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function auctions_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT seller_user_id FROM auctions WHERE id=?");
    $st->execute([$id]);
    $sid = (int)$st->fetchColumn();
    if (!$sid) throw new ApiException('not_found', 'オークション無し', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($sid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '出品者または admin のみ', 403);
    }
    $pdo->prepare("DELETE FROM auctions WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
