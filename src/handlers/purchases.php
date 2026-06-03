<?php
// /api/purchases — the core sale flow. Idempotent, atomic, locked.

declare(strict_types=1);

// Has the user been observed via a registered MAC within the presence window?
// Used as the lab-Wi-Fi gate on purchases.
function user_is_in_lab(PDO $pdo, int $userId): bool {
    $window = max(1, (int)cfg_get($pdo, 'presence_window_minutes', '3'));
    $st = $pdo->prepare("SELECT 1 FROM presence_seen ps
        JOIN presence_devices pd ON pd.mac = ps.mac
        WHERE pd.user_id = ?
          AND ps.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        LIMIT 1");
    $st->execute([$userId, $window]);
    return (bool)$st->fetchColumn();
}

function route_purchases(PDO $pdo, array $cfg, string $method, array $seg): void {
    // POST /api/purchases/{id}/thank
    $id = isset($seg[1]) ? (int)$seg[1] : 0;
    if ($id > 0 && ($seg[2] ?? '') === 'thank' && $method === 'POST') {
        purchases_thank($pdo, $cfg, $id);
        return;
    }
    if ($method !== 'POST' || isset($seg[1])) {
        json_error('not_found', "no purchases route for $method", 404);
        return;
    }
    require_exposure($cfg, 'purchase');

    $buyer = Auth::requireUser($pdo, $cfg);

    // Lab-wifi gate: the buyer must be currently observed via a registered
    // MAC in any room (= connected to the lab Wi-Fi). Window is the same
    // presence_window_minutes used for the home "今ラボにいる人" card so
    // the UI's view of the world matches what the server enforces.
    if (!user_is_in_lab($pdo, (int)$buyer['id'])) {
        throw new ApiException('not_in_lab',
            '購入はラボのWi-Fiに繋いでいる時だけ可能です', 403);
    }

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

    [$payload, $notify] = db_tx($pdo, function () use ($pdo, $listingId, $buyer, $feeRate, $ukey, $endpoint) {
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
        $isGift = !empty($listing['is_gift']);
        $sellerId = (int)$listing['seller_user_id'];
        $buyerAcc  = Ledger::accountIdForUser($pdo, (int)$buyer['id']);
        $sellerAcc = Ledger::accountIdForUser($pdo, $sellerId);
        $sysAcc    = Ledger::accountIdByCode($pdo, 'SYSTEM');

        if ($isGift || $price === 0) {
            $fee = 0; $sellerTake = 0; $buyerPay = 0;
            $buyerBal = Ledger::balanceOf($pdo, $buyerAcc);
        } else {
            [$fee, $sellerTake, $buyerPay] = Money::split($price, $feeRate);
            if ($buyerPay !== $sellerTake + $fee) {
                throw new RuntimeException('split invariant violation');
            }
            $buyerBal = Ledger::balanceOf($pdo, $buyerAcc);
            if ($buyerBal < $buyerPay) {
                throw new ApiException('insufficient_funds',
                    "balance $buyerBal < price $buyerPay", 402,
                    ['balance' => $buyerBal, 'required' => $buyerPay]);
            }
        }

        $pn = $pdo->prepare('SELECT name FROM products WHERE jan=?');
        $pn->execute([$listing['jan']]);
        $productName = (string)($pn->fetchColumn() ?: $listing['jan']);

        $ins = $pdo->prepare(
            'INSERT INTO purchases (listing_id, jan, buyer_user_id, seller_user_id,
                                    unit_price, fee, qty, idempotency_key)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $ins->execute([$listingId, $listing['jan'], $buyer['id'], $sellerId,
                       $price, $fee, 1, $ukey]);
        $purchaseId = (int)$pdo->lastInsertId();

        if ($sellerTake > 0) {
            Ledger::transfer($pdo, $buyerAcc, $sellerAcc, $sellerTake, 'purchase',
                'purchase', $purchaseId, "購入: {$productName}");
        }
        if ($fee > 0) {
            Ledger::transfer($pdo, $buyerAcc, $sysAcc, $fee, 'fee',
                'purchase', $purchaseId, "手数料: {$productName}");
        }

        $newQty = (int)$listing['qty'] - 1;
        $newStatus = $newQty <= 0 ? 'sold_out' : 'on_sale';
        $pdo->prepare('UPDATE listings SET qty=?, status=? WHERE id=?')
            ->execute([$newQty, $newStatus, $listingId]);

        $newBalance = $buyerBal - $buyerPay;
        $payload = [
            'purchase_id'    => $purchaseId,
            'listing_id'     => $listingId,
            'product_name'   => $productName,
            'unit_price'     => $price,
            'seller_take'    => $sellerTake,
            'fee'            => $fee,
            'new_balance'    => $newBalance,
            'qty_remaining'  => $newQty,
            'seller_user_id' => $sellerId,
            'is_gift'        => $isGift,
            'completion_message' => $listing['completion_message'] ?? null,
            'seller_name'    => null,
        ];
        $sn = $pdo->prepare('SELECT display_name FROM users WHERE id=?');
        $sn->execute([$sellerId]);
        $payload['seller_name'] = $sn->fetchColumn() ?: null;

        idempotency_save($pdo, $ukey, (int)$buyer['id'], $endpoint, $payload, 200);

        $notify = [
            'sellerId'   => $sellerId,
            'newQty'     => $newQty,
            'productName'=> $productName,
            'sellerTake' => $sellerTake,
            'fee'        => $fee,
            'purchaseId' => $purchaseId,
            'listingId'  => $listingId,
            'isGift'     => $isGift,
            'buyerName'  => (string)$buyer['display_name'],
        ];
        return [$payload, $notify];
    });

    // Fire notifications AFTER commit. Failures must not propagate.
    try {
        $body = $notify['isGift']
            ? "{$notify['buyerName']} が「{$notify['productName']}」をもらいました"
            : "{$notify['productName']} が {$notify['sellerTake']}pt で売れました（手数料 {$notify['fee']}pt）";
        Notifier::notify($pdo, $cfg, $notify['sellerId'], 'sale', $body,
            'purchase', $notify['purchaseId']);
        if ($notify['newQty'] === 0) {
            Notifier::notify($pdo, $cfg, $notify['sellerId'], 'sold_out',
                "{$notify['productName']} の在庫が切れました（出品 #{$notify['listingId']}）",
                'listing', $notify['listingId']);
        }
    } catch (Throwable $e) { /* swallow */ }

    json_response($payload);
}

// POST /api/purchases/{id}/thank — buyer sends a thank-you message (and optionally a tip)
// to the seller after a purchase. Either message or tip > 0 is required.
function purchases_thank(PDO $pdo, array $cfg, int $purchaseId): void {
    $buyer = Auth::requireUser($pdo, $cfg);
    $body  = read_json_body();
    $message = optional_text_field($body, 'message', 500);
    $tip = isset($body['tip']) ? (int)$body['tip'] : 0;
    if ($tip < 0)         throw new ApiException('bad_request', 'tip must be >= 0', 400);
    if ($tip > 100000)    throw new ApiException('bad_request', 'tip too large', 400);
    if ($message === null && $tip === 0) {
        throw new ApiException('bad_request', 'message かチップ、どちらかは入れてください', 400);
    }

    $st = $pdo->prepare('SELECT * FROM purchases WHERE id=?');
    $st->execute([$purchaseId]);
    $purchase = $st->fetch();
    if (!$purchase) throw new ApiException('not_found', 'purchase not found', 404);
    if ((int)$purchase['buyer_user_id'] !== (int)$buyer['id']) {
        throw new ApiException('forbidden', '自分の購入にのみお礼を送れます', 403);
    }

    $sellerId = (int)$purchase['seller_user_id'];
    if ($sellerId === (int)$buyer['id']) {
        throw new ApiException('bad_request', '自分自身にはお礼を送れません', 400);
    }

    // Product name for notification body
    $pn = $pdo->prepare('SELECT name FROM products WHERE jan=?');
    $pn->execute([$purchase['jan']]);
    $productName = (string)($pn->fetchColumn() ?: $purchase['jan']);

    [$ledgerId, $newBalance] = db_tx($pdo, function () use ($pdo, $purchaseId, $buyer, $sellerId, $tip, $message, $productName) {
        $ledgerId = null; $newBalance = null;
        if ($tip > 0) {
            $buyerAcc  = Ledger::accountIdForUser($pdo, (int)$buyer['id']);
            $sellerAcc = Ledger::accountIdForUser($pdo, $sellerId);
            $bal = Ledger::balanceOf($pdo, $buyerAcc);
            if ($bal < $tip) {
                throw new ApiException('insufficient_funds',
                    "balance $bal < tip $tip", 402,
                    ['balance' => $bal, 'required' => $tip]);
            }
            $ledgerId = Ledger::transfer($pdo, $buyerAcc, $sellerAcc, $tip, 'transfer',
                'thanks', $purchaseId, "「{$productName}」のお礼");
            $newBalance = $bal - $tip;
        }
        $ins = $pdo->prepare('INSERT INTO purchase_thanks
            (purchase_id, from_user_id, to_user_id, message, tip_amount, ledger_id)
            VALUES (?,?,?,?,?,?)');
        $ins->execute([$purchaseId, $buyer['id'], $sellerId, $message, $tip, $ledgerId]);
        return [$ledgerId, $newBalance];
    });

    try {
        $bits = ["「{$productName}」のお礼"];
        if ($tip > 0)         $bits[] = "{$tip}pt";
        $head = "{$buyer['display_name']} から " . implode(' · ', $bits);
        $body = $head . notification_quote($message);
        Notifier::notify($pdo, $cfg, $sellerId, 'transfer_received', $body,
            'purchase', $purchaseId);
    } catch (Throwable $e) { /* swallow */ }

    json_response([
        'ok'          => true,
        'tip'         => $tip,
        'ledger_id'   => $ledgerId,
        'new_balance' => $newBalance,
    ]);
}
