<?php
// /api/wishlist — "これ欲しい" board. Anyone can post a request and anyone
// can see the open list. Mark fulfilled either explicitly (requester taps "出ました!")
// or implicitly (no auto-match yet; future enhancement).

declare(strict_types=1);

function route_wishlist(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET')   { wishlist_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST')  { wishlist_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        if ($method === 'DELETE')                                      { wishlist_delete($pdo, $cfg, $id);    return; }
        if (($seg[2] ?? '') === 'fulfill' && $method === 'POST')       { wishlist_fulfill($pdo, $cfg, $id);   return; }
    }
    json_error('not_found', "no wishlist route for $method $sub", 404);
}

function wishlist_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $open = isset($_GET['status']) ? (string)$_GET['status'] : 'open';
    // open = unfulfilled. all = include closed.
    $where = $open === 'all' ? '' : ' WHERE w.fulfilled_at IS NULL ';
    $st = $pdo->query("
        SELECT w.id, w.product_name, w.jan, w.note, w.fulfilled_listing_id,
               w.fulfilled_at, w.created_at,
               u.id AS requester_user_id, u.display_name AS requester_name,
               u.avatar_url AS requester_avatar_url
          FROM wishlist w
          JOIN users u ON u.id = w.requester_user_id
          $where
         ORDER BY w.fulfilled_at IS NULL DESC, w.created_at DESC");
    json_response(['items' => $st->fetchAll()]);
}

function wishlist_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $name = trim((string)require_field($body, 'product_name'));
    $jan  = isset($body['jan']) ? trim((string)$body['jan']) : '';
    $note = isset($body['note']) ? mb_substr((string)$body['note'], 0, 500) : null;
    if ($name === '' || mb_strlen($name) > 200) {
        throw new ApiException('bad_request', 'product_name length 1..200', 400);
    }
    if ($jan !== '' && !preg_match('/^[0-9]{8,14}$/', $jan)) {
        throw new ApiException('bad_request', 'jan must be 8-14 digits', 400);
    }
    $ins = $pdo->prepare("INSERT INTO wishlist (requester_user_id, product_name, jan, note)
        VALUES (?,?,?,?)");
    $ins->execute([$u['id'], $name, $jan !== '' ? $jan : null, $note]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function wishlist_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT requester_user_id FROM wishlist WHERE id=?");
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) throw new ApiException('not_found', "wishlist $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', 'リクエスト者または admin だけが削除できます', 403);
    }
    $pdo->prepare("DELETE FROM wishlist WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function wishlist_fulfill(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $listingId = isset($body['listing_id']) ? (int)$body['listing_id'] : null;
    $st = $pdo->prepare("SELECT requester_user_id FROM wishlist WHERE id=?");
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) throw new ApiException('not_found', "wishlist $id not found", 404);
    // Either the requester closing it themselves, OR someone (the seller) linking it.
    $pdo->prepare("UPDATE wishlist SET fulfilled_at=NOW(), fulfilled_listing_id=?
        WHERE id=?")->execute([$listingId, $id]);

    // Notify requester unless they closed it themselves.
    if ((int)$r['requester_user_id'] !== (int)$u['id']) {
        $body = $listingId
            ? "✨ あなたの「これ欲しい」が出ました: 出品 #{$listingId}"
            : "✨ あなたの「これ欲しい」が満たされました";
        notify_safely($pdo, $cfg, (int)$r['requester_user_id'], 'admin_notice', $body,
            'wishlist', $id);
    }

    json_response(['ok' => true]);
}
