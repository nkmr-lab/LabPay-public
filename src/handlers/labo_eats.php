<?php
// v1123 ラーボーイーツ - 研究室版 UBER EATS
//   研究室にいる人 (依頼者) が外にいる人 (引受人) に「ついで買い」を頼む。
//   料金: base 50pt + ceil(distance/100)*10pt (依頼時に確定)
//   + 商品代 (完了時に引受人が実費入力、依頼者が最終支払)
//
// API:
//   GET  /api/labo-eats            → open + 自分関連
//   POST /api/labo-eats            → 依頼作成 {food_desc, shop_hint?, receive_location?, memo?, distance_m}
//   GET  /api/labo-eats/{id}       → 詳細
//   POST /api/labo-eats/{id}/accept    → 引受 (誰でも、依頼者以外)
//   POST /api/labo-eats/{id}/deliver   → 引受人が「渡した」+ item_cost 入力
//   POST /api/labo-eats/{id}/complete  → 依頼者が「受け取った」= 支払確定 (Ledger 転送)
//   POST /api/labo-eats/{id}/cancel    → キャンセル (open は誰でも、accepted 以降は依頼者/引受人/admin)

declare(strict_types=1);

const LE_BASE_FEE   = 50;
const LE_PER_100M   = 10;
const LE_MAX_DIST_M = 5000;
const LE_MAX_ITEM   = 20000;

function route_labo_eats(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { le_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { le_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''          && $method === 'GET')  { le_detail($pdo, $cfg, $id);   return; }
        if ($next === 'accept'    && $method === 'POST') { le_accept($pdo, $cfg, $id);   return; }
        if ($next === 'deliver'   && $method === 'POST') { le_deliver($pdo, $cfg, $id);  return; }
        if ($next === 'complete'  && $method === 'POST') { le_complete($pdo, $cfg, $id); return; }
        if ($next === 'cancel'    && $method === 'POST') { le_cancel($pdo, $cfg, $id);   return; }
    }
    throw new ApiException('not_found', "no labo-eats route for $method $sub", 404);
}

function _le_shape(array $r, int $uid): array {
    return [
        'id'                => (int)$r['id'],
        'requester_user_id' => (int)$r['requester_user_id'],
        'requester_name'    => (string)($r['requester_name'] ?? ''),
        'requester_avatar'  => $r['requester_avatar'] ?? null,
        'acceptor_user_id'  => $r['acceptor_user_id'] !== null ? (int)$r['acceptor_user_id'] : null,
        'acceptor_name'     => (string)($r['acceptor_name'] ?? ''),
        'acceptor_avatar'   => $r['acceptor_avatar'] ?? null,
        'food_desc'         => (string)$r['food_desc'],
        'shop_hint'         => (string)($r['shop_hint'] ?? ''),
        'receive_location'  => (string)($r['receive_location'] ?? ''),
        'memo'              => (string)($r['memo'] ?? ''),
        'distance_m'        => (int)$r['distance_m'],
        'base_fee'          => (int)$r['base_fee'],
        'distance_fee'      => (int)$r['distance_fee'],
        'item_cost'         => (int)$r['item_cost'],
        'total_fee'         => (int)$r['total_fee'],
        'grand_total'       => (int)$r['base_fee'] + (int)$r['distance_fee'] + (int)$r['item_cost'],
        'status'            => (string)$r['status'],
        'created_at'        => (string)$r['created_at'],
        'accepted_at'       => $r['accepted_at'] ?: null,
        'delivered_at'      => $r['delivered_at'] ?: null,
        'completed_at'      => $r['completed_at'] ?: null,
        'is_requester'      => ((int)$r['requester_user_id'] === $uid),
        'is_acceptor'       => ($r['acceptor_user_id'] !== null && (int)$r['acceptor_user_id'] === $uid),
    ];
}

function _le_select_base(): string {
    return "SELECT o.*, ur.display_name AS requester_name, ur.avatar_url AS requester_avatar,
                       ua.display_name AS acceptor_name, ua.avatar_url AS acceptor_avatar
              FROM labo_eats_orders o
         LEFT JOIN users ur ON ur.id = o.requester_user_id
         LEFT JOIN users ua ON ua.id = o.acceptor_user_id";
}

function le_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // open (誰でも見える) + accepted 自分関連 + 直近履歴
    $st = $pdo->prepare(_le_select_base() . "
              WHERE o.status = 'open'
                 OR o.requester_user_id = ?
                 OR o.acceptor_user_id  = ?
              ORDER BY (o.status='open') DESC, (o.status='accepted') DESC, o.id DESC
              LIMIT 100");
    $st->execute([$uid, $uid]);
    $items = array_map(fn($r) => _le_shape($r, $uid), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items, 'base_fee' => LE_BASE_FEE, 'per_100m' => LE_PER_100M]);
}

function le_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare(_le_select_base() . " WHERE o.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼なし', 404);
    json_response(['order' => _le_shape($r, (int)$u['id'])]);
}

function le_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $food = trim((string)($body['food_desc'] ?? ''));
    if ($food === '' || mb_strlen($food) > 400) throw new ApiException('bad_request', 'food_desc 1-400', 400);
    $shop = trim((string)($body['shop_hint'] ?? ''));
    if (mb_strlen($shop) > 200) $shop = mb_substr($shop, 0, 200);
    $loc = trim((string)($body['receive_location'] ?? ''));
    if (mb_strlen($loc) > 200) $loc = mb_substr($loc, 0, 200);
    $memo = trim((string)($body['memo'] ?? ''));
    if (mb_strlen($memo) > 500) $memo = mb_substr($memo, 0, 500);
    $dist = (int)($body['distance_m'] ?? 0);
    if ($dist < 0 || $dist > LE_MAX_DIST_M) throw new ApiException('bad_request', 'distance_m 0-' . LE_MAX_DIST_M, 400);
    $distFee = (int)ceil($dist / 100) * LE_PER_100M;
    $total = LE_BASE_FEE + $distFee;
    $st = $pdo->prepare("INSERT INTO labo_eats_orders
        (requester_user_id, food_desc, shop_hint, receive_location, memo, distance_m, base_fee, distance_fee, total_fee)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([(int)$u['id'], $food, $shop ?: null, $loc ?: null, $memo ?: null, $dist, LE_BASE_FEE, $distFee, $total]);
    $id = (int)$pdo->lastInsertId();
    $rr = $pdo->prepare(_le_select_base() . " WHERE o.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'order' => _le_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'])]);
}

function le_accept(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM labo_eats_orders WHERE id = ? FOR UPDATE");
        $st->execute([$id]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        if (!$r) { $pdo->rollBack(); throw new ApiException('not_found', '依頼なし', 404); }
        if ($r['status'] !== 'open') { $pdo->rollBack(); throw new ApiException('bad_request', '既に受付終了', 400); }
        if ((int)$r['requester_user_id'] === $uid) { $pdo->rollBack(); throw new ApiException('bad_request', '自分の依頼は引受不可', 400); }
        $pdo->prepare("UPDATE labo_eats_orders SET status='accepted', acceptor_user_id=?, accepted_at=NOW() WHERE id = ?")
            ->execute([$uid, $id]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 依頼者へ通知
    try {
        global $CFG;
        $accName = (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        $st = $pdo->prepare("SELECT requester_user_id, food_desc FROM labo_eats_orders WHERE id=?");
        $st->execute([$id]);
        $r2 = $st->fetch(PDO::FETCH_ASSOC);
        notify_safely($pdo, $CFG, (int)$r2['requester_user_id'], 'admin_notice',
            "🍱 {$accName} さんがラーボーイーツ「{$r2['food_desc']}」を引き受けました",
            'labo_eats', $id);
    } catch (Throwable $_) {}
    $rr = $pdo->prepare(_le_select_base() . " WHERE o.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'order' => _le_shape($rr->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function le_deliver(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $itemCost = (int)($body['item_cost'] ?? 0);
    if ($itemCost < 0 || $itemCost > LE_MAX_ITEM) throw new ApiException('bad_request', 'item_cost 0-' . LE_MAX_ITEM, 400);
    $st = $pdo->prepare("SELECT * FROM labo_eats_orders WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼なし', 404);
    if ($r['status'] !== 'accepted') throw new ApiException('bad_request', 'accepted 状態のみ deliver 可能', 400);
    if ((int)$r['acceptor_user_id'] !== $uid) throw new ApiException('forbidden', '引受人のみ', 403);
    $pdo->prepare("UPDATE labo_eats_orders SET status='delivered', item_cost=?, delivered_at=NOW() WHERE id = ?")
        ->execute([$itemCost, $id]);
    try {
        global $CFG;
        $grand = LE_BASE_FEE + (int)$r['distance_fee'] + $itemCost;
        notify_safely($pdo, $CFG, (int)$r['requester_user_id'], 'admin_notice',
            "🍱 「{$r['food_desc']}」が届きました! 商品代 {$itemCost}pt + サービス料 " . (LE_BASE_FEE + (int)$r['distance_fee']) . "pt = 合計 {$grand}pt。受取確認をお願いします",
            'labo_eats', $id);
    } catch (Throwable $_) {}
    $rr = $pdo->prepare(_le_select_base() . " WHERE o.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'order' => _le_shape($rr->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function le_complete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM labo_eats_orders WHERE id = ? FOR UPDATE");
        $st->execute([$id]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        if (!$r) { $pdo->rollBack(); throw new ApiException('not_found', '依頼なし', 404); }
        if ($r['status'] !== 'delivered') { $pdo->rollBack(); throw new ApiException('bad_request', 'delivered 状態のみ complete 可能', 400); }
        if ((int)$r['requester_user_id'] !== $uid) { $pdo->rollBack(); throw new ApiException('forbidden', '依頼者のみ', 403); }
        $grand = (int)$r['base_fee'] + (int)$r['distance_fee'] + (int)$r['item_cost'];
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $grand) { $pdo->rollBack(); throw new ApiException('insufficient_balance', "残高不足 (要 {$grand}pt、現在 {$bal}pt)", 400); }
        Ledger::transfer($pdo, $uid, (int)$r['acceptor_user_id'], $grand, 'labo_eats', 'labo_eats', $id, "🍱 ラーボーイーツ「" . mb_substr($r['food_desc'], 0, 40) . "」");
        $pdo->prepare("UPDATE labo_eats_orders SET status='completed', completed_at=NOW() WHERE id = ?")->execute([$id]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    try {
        global $CFG;
        $reqName = (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        $st = $pdo->prepare("SELECT acceptor_user_id, food_desc, base_fee, distance_fee, item_cost FROM labo_eats_orders WHERE id=?");
        $st->execute([$id]);
        $r2 = $st->fetch(PDO::FETCH_ASSOC);
        $grand = (int)$r2['base_fee'] + (int)$r2['distance_fee'] + (int)$r2['item_cost'];
        notify_safely($pdo, $CFG, (int)$r2['acceptor_user_id'], 'admin_notice',
            "🍱 {$reqName} さんが「{$r2['food_desc']}」を受け取り確定 +{$grand}pt",
            'labo_eats', $id);
    } catch (Throwable $_) {}
    $rr = $pdo->prepare(_le_select_base() . " WHERE o.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'order' => _le_shape($rr->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function le_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM labo_eats_orders WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '依頼なし', 404);
    if (!in_array($r['status'], ['open','accepted'], true)) throw new ApiException('bad_request', 'completed / cancelled は取消不可', 400);
    if (!$isAdmin && (int)$r['requester_user_id'] !== $uid && ($r['acceptor_user_id'] === null || (int)$r['acceptor_user_id'] !== $uid)) {
        throw new ApiException('forbidden', '依頼者/引受人/admin のみ', 403);
    }
    $pdo->prepare("UPDATE labo_eats_orders SET status='cancelled', cancelled_at=NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}
