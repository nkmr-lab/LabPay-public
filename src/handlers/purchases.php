<?php
// /api/purchases — the core sale flow. Idempotent, atomic, locked.

declare(strict_types=1);

function route_purchases(PDO $pdo, array $cfg, string $method, array $seg): void {
    if ($method !== 'POST' || isset($seg[1])) {
        json_error('not_found', "no purchases route for $method", 404);
        return;
    }
    require_exposure($cfg, 'purchase');

    $buyer = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $listingId = require_int_positive($body['listing_id'] ?? null, 'listing_id');
    $ukey = (string)require_field($body, 'idempotency_key');
    if (strlen($ukey) < 8 || strlen($ukey) > 80) {
        throw new ApiException('bad_request', 'idempotency_key length 8..80', 400);
    }

    $endpoint = 'POST /api/purchases';
    $cached = idempotency_get($pdo, $ukey, $buyer['id'], $endpoint);
    if ($cached) {
        json_response($cached['body'], $cached['status']);
        return;
    }

    $feeRate = Money::feeRate($pdo);

    // Captured for post-commit notifications
    $notify = null;

    $pdo->beginTransaction();
    try {
        // Lock listing
        $st = $pdo->prepare('SELECT * FROM listings WHERE id=? FOR UPDATE');
        $st->execute([$listingId]);
        $listing = $st->fetch();
        if (!$listing) throw new ApiException('not_found', "listing $listingId not found", 404);
        if ($listing['status'] !== 'on_sale' || (int)$listing['qty'] < 1) {
            throw new ApiException('not_available', 'listing is not available', 409);
        }
        if ((int)$listing['seller_user_id'] === (int)$buyer['id']) {
            throw new ApiException('self_purchase', 'cannot buy your own listing', 400);
        }

        $price = (int)$listing['price'];
        [$fee, $sellerTake, $buyerPay] = Money::split($price, $feeRate);
        if ($buyerPay !== $sellerTake + $fee) {
            throw new RuntimeException('split invariant violation');
        }

        $sellerId = (int)$listing['seller_user_id'];
        $buyerAcc  = Ledger::accountIdForUser($pdo, (int)$buyer['id']);
        $sellerAcc = Ledger::accountIdForUser($pdo, $sellerId);
        $sysAcc    = Ledger::accountIdByCode($pdo, 'SYSTEM');

        // Upfront buyer balance check covers seller_take + fee together; per-transfer
        // checks alone could let the first transfer succeed and the second one fail.
        $buyerBal = Ledger::balanceOf($pdo, $buyerAcc);
        if ($buyerBal < $buyerPay) {
            throw new ApiException('insufficient_funds',
                "balance $buyerBal < price $buyerPay", 402,
                ['balance' => $buyerBal, 'required' => $buyerPay]);
        }

        // Product name for memos/notifications
        $pn = $pdo->prepare('SELECT name FROM products WHERE jan=?');
        $pn->execute([$listing['jan']]);
        $productName = (string)($pn->fetchColumn() ?: $listing['jan']);

        // Insert purchase row first to obtain id for ledger ref
        $ins = $pdo->prepare(
            'INSERT INTO purchases (listing_id, jan, buyer_user_id, seller_user_id,
                                    unit_price, fee, qty, idempotency_key)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $ins->execute([$listingId, $listing['jan'], $buyer['id'], $sellerId,
                       $price, $fee, 1, $ukey]);
        $purchaseId = (int)$pdo->lastInsertId();

        // Ledger: buyer -> seller (seller_take), then buyer -> SYSTEM (fee, if any)
        Ledger::transfer($pdo, $buyerAcc, $sellerAcc, $sellerTake, 'purchase',
            'purchase', $purchaseId, "購入: {$productName}");
        if ($fee > 0) {
            Ledger::transfer($pdo, $buyerAcc, $sysAcc, $fee, 'fee',
                'purchase', $purchaseId, "手数料: {$productName}");
        }

        // Decrement stock
        $newQty = (int)$listing['qty'] - 1;
        $newStatus = $newQty <= 0 ? 'sold_out' : 'on_sale';
        $pdo->prepare('UPDATE listings SET qty=?, status=? WHERE id=?')
            ->execute([$newQty, $newStatus, $listingId]);

        // Compose payload (new_balance can be derived; avoids a re-query in TX)
        $newBalance = $buyerBal - $buyerPay;

        $payload = [
            'purchase_id'  => $purchaseId,
            'listing_id'   => $listingId,
            'product_name' => $productName,
            'unit_price'   => $price,
            'seller_take'  => $sellerTake,
            'fee'          => $fee,
            'new_balance'  => $newBalance,
            'qty_remaining'=> $newQty,
        ];

        // Save idempotency key INSIDE the transaction so a retry after partial failure
        // cannot create a second purchase.
        idempotency_save($pdo, $ukey, (int)$buyer['id'], $endpoint, $payload, 200);

        $pdo->commit();

        $notify = [
            'sellerId'   => $sellerId,
            'newQty'     => $newQty,
            'productName'=> $productName,
            'sellerTake' => $sellerTake,
            'fee'        => $fee,
            'purchaseId' => $purchaseId,
            'listingId'  => $listingId,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // Fire notifications AFTER commit. Failures must not propagate.
    try {
        Notifier::notify($pdo, $cfg, $notify['sellerId'], 'sale',
            "{$notify['productName']} が {$notify['sellerTake']}pt で売れました（手数料 {$notify['fee']}pt）",
            'purchase', $notify['purchaseId']);
        if ($notify['newQty'] === 0) {
            Notifier::notify($pdo, $cfg, $notify['sellerId'], 'sold_out',
                "{$notify['productName']} の在庫が切れました（出品 #{$notify['listingId']}）",
                'listing', $notify['listingId']);
        }
    } catch (Throwable $e) { /* swallow */ }

    json_response($payload);
}
