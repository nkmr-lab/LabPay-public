<?php
// /api/listings[/{id}] — distributed marketplace. Same JAN, multiple sellers.

declare(strict_types=1);

// Sweep listings whose expires_at has passed into status='withdrawn'. Called at
// the top of public read paths so the seller's "this is for sale until X" promise
// is honored without needing a separate cron.
function listings_sweep_expired(PDO $pdo): void {
    $pdo->exec("UPDATE listings
        SET status='withdrawn'
        WHERE status='on_sale'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()");
}

// Parse the loose datetime-local format the browser sends ("Y-m-d\TH:i" / "Y-m-d H:i:s")
// and require it to be in the future (with a 1-minute slack for clock drift).
// Returns null when the input is null/empty.
function listings_parse_deadline($raw): ?string {
    if ($raw === null || trim((string)$raw) === '') return null;
    $s = str_replace('T', ' ', trim((string)$raw));
    if (strlen($s) === 16) $s .= ':00';
    $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $s);
    if (!$dt) throw new ApiException('bad_request', 'expires_at must be Y-m-d H:i:s', 400);
    if ($dt < (new DateTimeImmutable('now'))->modify('-1 minute')) {
        throw new ApiException('bad_request', '販売期限は未来の日時で', 400);
    }
    return $dt->format('Y-m-d H:i:s');
}

// Walk backwards from a listing through the resold_from_purchase_id chain. Returns the
// chain of sellers, OLDEST first, INCLUDING the current listing's seller as the last entry.
// Capped at 20 hops to defend against any malformed cycle that slipped past the FK.
function listings_resale_chain(PDO $pdo, int $listingId): array {
    $chain = [];
    $curListing = $listingId;
    $seen = [];
    for ($i = 0; $i < 20 && $curListing && !isset($seen[$curListing]); $i++) {
        $seen[$curListing] = true;
        $st = $pdo->prepare("SELECT l.id, l.seller_user_id, u.display_name, u.avatar_url,
                                    l.resold_from_purchase_id
              FROM listings l JOIN users u ON u.id = l.seller_user_id
             WHERE l.id = ?");
        $st->execute([$curListing]);
        $row = $st->fetch();
        if (!$row) break;
        $chain[] = [
            'user_id'      => (int)$row['seller_user_id'],
            'display_name' => $row['display_name'],
            'avatar_url'   => $row['avatar_url'],
        ];
        if (!$row['resold_from_purchase_id']) break;
        // Find the listing this purchase came from.
        $st2 = $pdo->prepare('SELECT listing_id FROM purchases WHERE id = ?');
        $st2->execute([(int)$row['resold_from_purchase_id']]);
        $curListing = (int)$st2->fetchColumn();
    }
    // We collected newest-first; reverse so the original seller is first.
    return array_reverse($chain);
}

// Attach `resale_chain` (array of {user_id,display_name,avatar_url}) and a convenience
// `is_resale` boolean to each listing row.
function listings_attach_chain(PDO $pdo, array $rows): array {
    foreach ($rows as &$r) {
        if (!empty($r['resold_from_purchase_id'])) {
            $chain = listings_resale_chain($pdo, (int)$r['id']);
            $r['resale_chain'] = $chain;
            $r['is_resale'] = count($chain) > 1;
        } else {
            $r['resale_chain'] = [];
            $r['is_resale'] = false;
        }
        // v511 サムネ実在チェック済み URL を別フィールドで返す (なければ原画像)。
        $r['image_thumb_url'] = !empty($r['image_url']) ? thumb_url_for((string)$r['image_url']) : null;
    }
    return $rows;
}

function route_listings(PDO $pdo, array $cfg, string $method, array $seg): void {
    $id = isset($seg[1]) && $seg[1] !== '' ? (int)$seg[1] : 0;

    if ($id === 0 && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        listings_sweep_expired($pdo);
        $jan = trim((string)($_GET['jan'] ?? ''));
        $limit = min(500, max(1, (int)($_GET['limit'] ?? 200)));
        // Best-effort "have I bought this before" flag for the caller. Unauthenticated
        // requests get false everywhere (default). We don't require login here.
        $meId = 0;
        try {
            $me = Auth::currentUser($pdo, $cfg);
            if ($me) $meId = (int)$me['id'];
        } catch (Throwable $e) { /* anonymous OK */ }
        // v526 #172 旧クエリは行ごとに per-seller の SUM(qty) と per-jan の EXISTS の
        //   2 つの相関サブクエリがあり、 200 件 × N seller の N+1 問題になっていた。
        //   per-seller / per-jan の集計を派生テーブルで先に出してから JOIN で参照。
        $sql = "
            SELECT l.id, l.jan, l.seller_user_id, l.price, l.is_gift, l.qty, l.status,
                   l.location, l.display_name, l.created_at, l.updated_at,
                   p.name AS product_name,
                   COALESCE(l.display_name, p.name) AS name,
                   p.image_url,
                   u.display_name AS seller_name,
                   u.avatar_url   AS seller_avatar_url,
                   COALESCE(ss.seller_sales, 0) AS seller_sales,
                   COALESCE(ib.i_bought_before, 0) AS i_bought_before
              FROM listings l
              JOIN products p ON p.jan = l.jan
              JOIN users u    ON u.id  = l.seller_user_id
         LEFT JOIN (
                SELECT seller_user_id, COALESCE(SUM(qty),0) AS seller_sales
                  FROM purchases GROUP BY seller_user_id
              ) ss ON ss.seller_user_id = l.seller_user_id
         LEFT JOIN (
                SELECT DISTINCT jan, 1 AS i_bought_before FROM purchases WHERE buyer_user_id = ?
              ) ib ON ib.jan = l.jan
             WHERE l.status='on_sale' AND l.qty > 0";
        $params = [$meId];
        if ($jan !== '') { $sql .= ' AND l.jan = ?'; $params[] = $jan; }
        $sql .= ' ORDER BY l.price ASC, l.created_at ASC LIMIT ?';
        $st = $pdo->prepare($sql);
        foreach ($params as $i => $v) $st->bindValue($i+1, $v);
        $st->bindValue(count($params)+1, $limit, PDO::PARAM_INT);
        $st->execute();
        $rows = listings_attach_chain($pdo, $st->fetchAll());
        json_response(['items' => $rows]);
        return;
    }

    if ($id > 0 && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        $st = $pdo->prepare("
            SELECT l.*,
                   p.name AS product_name,
                   COALESCE(l.display_name, p.name) AS name,
                   p.image_url,
                   u.display_name AS seller_name, u.avatar_url AS seller_avatar_url
              FROM listings l
              JOIN products p ON p.jan = l.jan
              JOIN users u    ON u.id  = l.seller_user_id
             WHERE l.id = ?");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) { json_error('not_found', "listing $id not found", 404); return; }
        $row = listings_attach_chain($pdo, [$row])[0];
        json_response($row);
        return;
    }

    if ($id === 0 && $method === 'POST') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $jan = normalize_jan((string)require_field($body, 'jan'));
        $isGift = !empty($body['is_gift']) ? 1 : 0;
        // For sale listings we still require price > 0; gift listings force price = 0.
        $price = $isGift ? 0 : require_int_positive($body['price'] ?? null, 'price');
        $qty = require_int_positive($body['qty'] ?? null, 'qty');
        $completionMsg = optional_text_field($body, 'completion_message', 2000);
        $location      = optional_text_field($body, 'location', 100);
        $displayName   = optional_text_field($body, 'display_name', 200);
        $expiresAt     = listings_parse_deadline($body['expires_at'] ?? null);
        // Product must already exist (client should POST /api/products first)
        $chk = $pdo->prepare('SELECT 1 FROM products WHERE jan=?');
        $chk->execute([$jan]);
        if ($chk->fetchColumn() === false) {
            throw new ApiException('product_unknown',
                "product $jan not registered. POST /api/products first", 400);
        }
        // Resale detection: if this seller previously bought this JAN on LabPay, link the
        // new listing to their most recent purchase so the product page can show the
        // chain (中村 -> 田中 -> あなた).
        $rs = $pdo->prepare("SELECT id FROM purchases
            WHERE buyer_user_id = ? AND jan = ?
            ORDER BY id DESC LIMIT 1");
        $rs->execute([$u['id'], $jan]);
        $resoldFromPurchaseId = $rs->fetchColumn() ?: null;

        $ins = $pdo->prepare(
            'INSERT INTO listings (jan, seller_user_id, price, is_gift, qty, display_name, status, expires_at, completion_message, location, resold_from_purchase_id)
             VALUES (?,?,?,?,?,?, "on_sale", ?, ?, ?, ?)'
        );
        $ins->execute([$jan, $u['id'], $price, $isGift, $qty, $displayName, $expiresAt, $completionMsg, $location, $resoldFromPurchaseId]);
        $lid = (int)$pdo->lastInsertId();
        $get = $pdo->prepare("SELECT l.*,
                p.name AS product_name,
                COALESCE(l.display_name, p.name) AS name,
                p.image_url
            FROM listings l JOIN products p ON p.jan=l.jan WHERE l.id=?");
        $get->execute([$lid]);
        $listing = $get->fetch();

        // Slack 入荷通知 — fire-and-forget; never blocks the response if Slack is slow/down.
        try {
            $productName = $listing['name'] ?? $jan;
            $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
            $prodUrl = $baseUrl . '/#/product/' . urlencode($jan);
            $priceLine = $isGift ? '🎁 これどうぞ' : ($price . 'pt × ' . $qty . '個');
            $sellerLine = '出品: ' . $u['display_name'];
            $locationLine = $location ? "\n📍 " . $location : '';
            $msg = "🛒 *新規入荷*  <{$prodUrl}|{$productName}>\n{$sellerLine}  ·  {$priceLine}{$locationLine}";
            slack_notify($cfg, $msg);
        } catch (Throwable $e) { /* swallow */ }

        json_response($listing, 200);
        return;
    }

    if ($id > 0 && $method === 'PATCH') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        db_tx($pdo, function () use ($pdo, $id, $u, $body) {
            $st = $pdo->prepare('SELECT * FROM listings WHERE id=? FOR UPDATE');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) throw new ApiException('not_found', "listing $id not found", 404);
            if ((int)$row['seller_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
                throw new ApiException('forbidden', 'not your listing', 403);
            }
            $sets = [];
            $params = [];
            if (array_key_exists('is_gift', $body)) {
                $gift = !empty($body['is_gift']) ? 1 : 0;
                $sets[] = 'is_gift = ?'; $params[] = $gift;
                // Gift listings always store price = 0; flipping to gift zeros it,
                // flipping back to sale requires the caller to also set a new price.
                if ($gift) { $sets[] = 'price = 0'; }
            }
            if (array_key_exists('price', $body) && $body['price'] !== null) {
                $sets[] = 'price = ?';
                // 0 is only valid for gift listings; otherwise > 0.
                $params[] = require_int_nonneg($body['price'], 'price');
            }
            if (array_key_exists('qty', $body) && $body['qty'] !== null) {
                $newqty = require_int_nonneg($body['qty'], 'qty');
                $sets[] = 'qty = ?';
                $params[] = $newqty;
                // qty 0 → sold_out unless explicitly withdrawn; >0 → on_sale (re-listing)
                if ($newqty === 0) {
                    $sets[] = "status = 'sold_out'";
                } else {
                    if (in_array($row['status'], ['withdrawn', 'sold_out'], true)) {
                        $sets[] = "status = 'on_sale'";
                    }
                }
            }
            if (array_key_exists('status', $body) && $body['status'] !== null) {
                $s = (string)$body['status'];
                if (!in_array($s, ['on_sale','withdrawn','sold_out'], true)) {
                    throw new ApiException('bad_request', "invalid status: $s", 400);
                }
                $sets[] = 'status = ?';
                $params[] = $s;
            }
            if (array_key_exists('completion_message', $body)) {
                $cm = optional_text_field($body, 'completion_message', 2000);
                if ($cm === null) { $sets[] = 'completion_message = NULL'; }
                else              { $sets[] = 'completion_message = ?'; $params[] = $cm; }
            }
            if (array_key_exists('location', $body)) {
                $loc = optional_text_field($body, 'location', 100);
                if ($loc === null) { $sets[] = 'location = NULL'; }
                else               { $sets[] = 'location = ?'; $params[] = $loc; }
            }
            if (array_key_exists('display_name', $body)) {
                $dn = optional_text_field($body, 'display_name', 200);
                if ($dn === null) { $sets[] = 'display_name = NULL'; }
                else              { $sets[] = 'display_name = ?'; $params[] = $dn; }
            }
            if (array_key_exists('expires_at', $body)) {
                $ea = listings_parse_deadline($body['expires_at']);
                if ($ea === null) { $sets[] = 'expires_at = NULL'; }
                else              { $sets[] = 'expires_at = ?'; $params[] = $ea; }
            }
            if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
            $params[] = $id;
            $upd = $pdo->prepare('UPDATE listings SET ' . implode(',', $sets) . ' WHERE id=?');
            $upd->execute($params);
        });
        $get = $pdo->prepare("SELECT l.*,
                p.name AS product_name,
                COALESCE(l.display_name, p.name) AS name,
                p.image_url
            FROM listings l JOIN products p ON p.jan=l.jan WHERE l.id=?");
        $get->execute([$id]);
        json_response($get->fetch());
        return;
    }

    // POST /api/listings/{id}/consume — seller decrements their own stock by 1 for
    // self-consumption. No ledger entry, no fee, no purchase record (it never left them).
    // Status flips to sold_out when qty hits 0.
    if ($id > 0 && isset($seg[2]) && $seg[2] === 'consume' && $method === 'POST') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $qtyToConsume = isset($body['qty']) ? require_int_positive($body['qty'], 'qty') : 1;

        [$newQty, $newStatus] = db_tx($pdo, function () use ($pdo, $id, $u, $qtyToConsume) {
            $st = $pdo->prepare('SELECT * FROM listings WHERE id=? FOR UPDATE');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) throw new ApiException('not_found', "listing $id not found", 404);
            if ((int)$row['seller_user_id'] !== (int)$u['id']) {
                throw new ApiException('forbidden', '自分の出品のみ消費できます', 403);
            }
            if ((int)$row['qty'] < $qtyToConsume) {
                throw new ApiException('insufficient_qty',
                    "在庫が足りません (残 {$row['qty']}, 消費 {$qtyToConsume})", 409);
            }
            $newQty = (int)$row['qty'] - $qtyToConsume;
            $newStatus = $newQty <= 0 ? 'sold_out' : $row['status'];
            $pdo->prepare('UPDATE listings SET qty=?, status=? WHERE id=?')
                ->execute([$newQty, $newStatus, $id]);
            return [$newQty, $newStatus];
        });
        json_response(['ok' => true, 'qty_remaining' => $newQty, 'status' => $newStatus]);
        return;
    }

    if ($id > 0 && $method === 'DELETE') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $hard = !empty($_GET['hard']); // DELETE /api/listings/{id}?hard=1 → real delete (no history)
        db_tx($pdo, function () use ($pdo, $id, $u, $hard) {
            $st = $pdo->prepare('SELECT seller_user_id, status FROM listings WHERE id=? FOR UPDATE');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) throw new ApiException('not_found', "listing $id not found", 404);
            if ((int)$row['seller_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
                throw new ApiException('forbidden', 'not your listing', 403);
            }

            if ($hard) {
                // Refuse if there are purchases tied to this listing (preserve history integrity).
                $chk = $pdo->prepare('SELECT COUNT(*) FROM purchases WHERE listing_id=?');
                $chk->execute([$id]);
                if ((int)$chk->fetchColumn() > 0) {
                    throw new ApiException('has_purchases',
                        'この出品には購入実績があるため完全削除できません。取り下げのみ可能です。', 409);
                }
                $pdo->prepare('DELETE FROM listings WHERE id=?')->execute([$id]);
            } else {
                $pdo->prepare('UPDATE listings SET status="withdrawn" WHERE id=?')->execute([$id]);
            }
        });
        json_response(['ok' => true, 'hard' => $hard]);
        return;
    }

    json_error('not_found', "no listings route for $method", 404);
}
