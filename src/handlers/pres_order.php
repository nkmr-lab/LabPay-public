<?php
// v1120 中村さん要望「発表順オークション/論文紹介・ポスターセッションの希望の順番,
//   セッションをオークションできる」
//
// フロー:
//   1. 誰かがオークションを起案 (タイトル + 締切)
//   2. ラボメンが好きなだけ「早い順が欲しい額」を sealed で入札 (更新可)
//      未入札の人は自動 0pt 扱い
//   3. 締切 or 手動 close で開票 → 金額降順で slot 1, 2, ... を割り当て、
//      勝者は入札額を SYSTEM に支払う (pot)
//      未入札 (0pt) の人はそのまま最下位ゾーンに並ぶ
//   4. 全員に「あなたは N 番目」通知
//
// API:
//   GET    /api/pres-order                    → 一覧
//   POST   /api/pres-order                    → 起案 { title, description?, deadline? }
//   GET    /api/pres-order/{id}               → 詳細 (自分の bid + 参加人数、締切前は他人の額は隠す)
//   PUT    /api/pres-order/{id}/bid           → 自分の bid を上書き { amount }
//   DELETE /api/pres-order/{id}/bid           → 自分の bid を取消
//   POST   /api/pres-order/{id}/close         → creator/admin が締める (即開票 + 徴収)
//   POST   /api/pres-order/{id}/cancel        → creator/admin がキャンセル (誰にも課金しない)

declare(strict_types=1);

const POA_MIN_BID = 0;      // 0pt (= 入札しない) 相当
const POA_MAX_BID = 5000;

function route_pres_order(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { poa_list  ($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { poa_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { poa_detail($pdo, $cfg, $id); return; }
        if ($next === 'bid'    && $method === 'PUT')    { poa_bid_put($pdo, $cfg, $id); return; }
        if ($next === 'bid'    && $method === 'DELETE') { poa_bid_del($pdo, $cfg, $id); return; }
        if ($next === 'close'  && $method === 'POST')   { poa_close($pdo, $cfg, $id);   return; }
        if ($next === 'cancel' && $method === 'POST')   { poa_cancel($pdo, $cfg, $id);  return; }
    }
    throw new ApiException('not_found', "no pres-order route for $method $sub", 404);
}

function _poa_row(PDO $pdo, int $id, int $uid, bool $isAdmin): ?array {
    $st = $pdo->prepare("SELECT a.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                 (SELECT COUNT(*) FROM pres_order_bids b WHERE b.auction_id = a.id) AS bid_count
                            FROM pres_order_auctions a LEFT JOIN users u ON u.id = a.creator_user_id
                           WHERE a.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    $r['id']              = (int)$r['id'];
    $r['creator_user_id'] = (int)$r['creator_user_id'];
    $r['bid_count']       = (int)$r['bid_count'];
    $r['is_mine']         = ((int)$r['creator_user_id'] === $uid);
    $r['can_close']       = ($r['status'] === 'open') && ($r['is_mine'] || $isAdmin);
    // 自分の bid
    $mySt = $pdo->prepare("SELECT amount, assigned_slot FROM pres_order_bids WHERE auction_id = ? AND user_id = ?");
    $mySt->execute([$id, $uid]);
    $my = $mySt->fetch(PDO::FETCH_ASSOC);
    $r['my_bid'] = $my ? (int)$my['amount'] : null;
    $r['my_slot'] = $my && $my['assigned_slot'] !== null ? (int)$my['assigned_slot'] : null;
    // closed なら全公開 (slot 順で並べ)
    if ($r['status'] === 'closed') {
        $bs = $pdo->prepare("SELECT b.user_id, b.amount, b.assigned_slot, u.display_name, u.avatar_url
                               FROM pres_order_bids b JOIN users u ON u.id = b.user_id
                              WHERE b.auction_id = ?
                           ORDER BY b.assigned_slot ASC, b.amount DESC");
        $bs->execute([$id]);
        $r['results'] = array_map(fn($x) => [
            'user_id'       => (int)$x['user_id'],
            'display_name'  => (string)$x['display_name'],
            'avatar_url'    => $x['avatar_url'] ?: null,
            'amount'        => (int)$x['amount'],
            'assigned_slot' => (int)$x['assigned_slot'],
            'is_me'         => ((int)$x['user_id'] === $uid),
        ], $bs->fetchAll(PDO::FETCH_ASSOC));
    } else {
        // open: 参加人数だけ返す (bidder リスト自体は avatar のみ、金額は隠す)
        $bs = $pdo->prepare("SELECT b.user_id, u.display_name, u.avatar_url
                               FROM pres_order_bids b JOIN users u ON u.id = b.user_id
                              WHERE b.auction_id = ? ORDER BY b.created_at ASC");
        $bs->execute([$id]);
        $r['bidders'] = array_map(fn($x) => [
            'user_id'      => (int)$x['user_id'],
            'display_name' => (string)$x['display_name'],
            'avatar_url'   => $x['avatar_url'] ?: null,
            'is_me'        => ((int)$x['user_id'] === $uid),
        ], $bs->fetchAll(PDO::FETCH_ASSOC));
    }
    return $r;
}

function poa_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->query("SELECT id FROM pres_order_auctions
                        WHERE status IN ('open','closed') OR created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                        ORDER BY (status='open') DESC, created_at DESC LIMIT 50");
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $items[] = _poa_row($pdo, (int)$r['id'], (int)$u['id'], $isAdmin);
    }
    json_response(['items' => $items]);
}

function poa_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1-200', 400);
    }
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > 2000) $desc = mb_substr($desc, 0, 2000);
    $deadline = null;
    if (!empty($body['deadline'])) {
        try {
            $dt = new DateTime((string)$body['deadline']);
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $deadline = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $_) {}
    }
    $pdo->prepare("INSERT INTO pres_order_auctions (title, description, deadline, creator_user_id) VALUES (?, ?, ?, ?)")
        ->execute([$title, $desc ?: null, $deadline, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $id, 'auction' => _poa_row($pdo, $id, (int)$u['id'], false)]);
}

function poa_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $r = _poa_row($pdo, $id, (int)$u['id'], $isAdmin);
    if (!$r) throw new ApiException('not_found', 'auction なし', 404);
    json_response(['auction' => $r]);
}

function poa_bid_put(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $amount = (int)($body['amount'] ?? 0);
    if ($amount < POA_MIN_BID || $amount > POA_MAX_BID) {
        throw new ApiException('bad_request', sprintf('amount %d-%d', POA_MIN_BID, POA_MAX_BID), 400);
    }
    $st = $pdo->prepare("SELECT status, deadline FROM pres_order_auctions WHERE id = ?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'auction なし', 404);
    if ($a['status'] !== 'open') throw new ApiException('bad_request', '既に締切/取消', 400);
    if ($a['deadline'] && strtotime($a['deadline']) < time()) {
        throw new ApiException('bad_request', '締切時刻を過ぎています', 400);
    }
    $pdo->prepare("INSERT INTO pres_order_bids (auction_id, user_id, amount) VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE amount = VALUES(amount)")
        ->execute([$id, (int)$u['id'], $amount]);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    json_response(['ok' => true, 'auction' => _poa_row($pdo, $id, (int)$u['id'], $isAdmin)]);
}

function poa_bid_del(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT status FROM pres_order_auctions WHERE id = ?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'auction なし', 404);
    if ($a['status'] !== 'open') throw new ApiException('bad_request', '既に締切/取消', 400);
    $pdo->prepare("DELETE FROM pres_order_bids WHERE auction_id = ? AND user_id = ?")->execute([$id, (int)$u['id']]);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    json_response(['ok' => true, 'auction' => _poa_row($pdo, $id, (int)$u['id'], $isAdmin)]);
}

// close: 締切 → assigned_slot を割り当て → Ledger で徴収 → 全員に通知
function poa_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM pres_order_auctions WHERE id = ? FOR UPDATE");
    $pdo->beginTransaction();
    try {
        $st->execute([$id]);
        $a = $st->fetch(PDO::FETCH_ASSOC);
        if (!$a) { $pdo->rollBack(); throw new ApiException('not_found', 'auction なし', 404); }
        if ($a['status'] !== 'open') { $pdo->rollBack(); throw new ApiException('bad_request', '既に締切/取消', 400); }
        if (!$isAdmin && (int)$a['creator_user_id'] !== $uid) {
            $pdo->rollBack();
            throw new ApiException('forbidden', '起案者 or admin のみ締切可', 403);
        }
        // 開票: amount DESC, tie-break は created_at ASC (早い者勝ち)
        $bs = $pdo->prepare("SELECT user_id, amount FROM pres_order_bids
                              WHERE auction_id = ? ORDER BY amount DESC, created_at ASC");
        $bs->execute([$id]);
        $rows = $bs->fetchAll(PDO::FETCH_ASSOC);
        $up = $pdo->prepare("UPDATE pres_order_bids SET assigned_slot = ? WHERE auction_id = ? AND user_id = ?");
        $slot = 1;
        $totalCharged = 0;
        $winnerNotifs = [];
        foreach ($rows as $r) {
            $uidR = (int)$r['user_id'];
            $amt  = (int)$r['amount'];
            $up->execute([$slot, $id, $uidR]);
            if ($amt > 0) {
                Ledger::transfer($pdo, $uidR, 1, $amt, 'auction_buyin', 'pres_order', $id, "発表順オークション #{$id} 落札 (slot {$slot}, {$amt}pt)");
                $totalCharged += $amt;
            }
            $winnerNotifs[] = ['user_id' => $uidR, 'slot' => $slot, 'amount' => $amt];
            $slot++;
        }
        $pdo->prepare("UPDATE pres_order_auctions SET status='closed', closed_at=NOW() WHERE id = ?")->execute([$id]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 通知 (トランザクション外)
    global $CFG;
    $title = (string)$pdo->query("SELECT title FROM pres_order_auctions WHERE id={$id}")->fetchColumn();
    foreach ($winnerNotifs as $w) {
        $msg = "🎪 「{$title}」発表順が確定: あなたは **{$w['slot']} 番目** (" . ($w['amount'] > 0 ? "落札 {$w['amount']}pt" : "非入札") . ")";
        try { notify_safely($pdo, $CFG, (int)$w['user_id'], 'admin_notice', $msg, 'pres_order', $id); } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'auction' => _poa_row($pdo, $id, $uid, $isAdmin), 'total_charged' => $totalCharged]);
}

function poa_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT creator_user_id, status FROM pres_order_auctions WHERE id = ?");
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'auction なし', 404);
    if ($a['status'] !== 'open') throw new ApiException('bad_request', '既に締切/取消', 400);
    if (!$isAdmin && (int)$a['creator_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '起案者 or admin のみキャンセル可', 403);
    }
    $pdo->prepare("UPDATE pres_order_auctions SET status='cancelled', closed_at=NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true, 'auction' => _poa_row($pdo, $id, (int)$u['id'], $isAdmin)]);
}
