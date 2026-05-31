<?php
// /api/listings[/{id}] — distributed marketplace. Same JAN, multiple sellers.

declare(strict_types=1);

function route_listings(PDO $pdo, array $cfg, string $method, array $seg): void {
    $id = isset($seg[1]) && $seg[1] !== '' ? (int)$seg[1] : 0;

    if ($id === 0 && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        $jan = trim((string)($_GET['jan'] ?? ''));
        $limit = min(500, max(1, (int)($_GET['limit'] ?? 200)));
        $sql = "
            SELECT l.id, l.jan, l.seller_user_id, l.price, l.qty, l.status,
                   l.created_at, l.updated_at,
                   p.name, p.image_url,
                   u.display_name AS seller_name,
                   u.avatar_url   AS seller_avatar_url,
                   (SELECT COALESCE(SUM(qty),0) FROM purchases pu WHERE pu.seller_user_id = l.seller_user_id) AS seller_sales
              FROM listings l
              JOIN products p ON p.jan = l.jan
              JOIN users u    ON u.id  = l.seller_user_id
             WHERE l.status='on_sale' AND l.qty > 0";
        $params = [];
        if ($jan !== '') { $sql .= ' AND l.jan = ?'; $params[] = $jan; }
        $sql .= ' ORDER BY l.price ASC, l.created_at ASC LIMIT ?';
        $st = $pdo->prepare($sql);
        foreach ($params as $i => $v) $st->bindValue($i+1, $v);
        $st->bindValue(count($params)+1, $limit, PDO::PARAM_INT);
        $st->execute();
        json_response(['items' => $st->fetchAll()]);
        return;
    }

    if ($id > 0 && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        $st = $pdo->prepare("
            SELECT l.*, p.name, p.image_url,
                   u.display_name AS seller_name, u.avatar_url AS seller_avatar_url
              FROM listings l
              JOIN products p ON p.jan = l.jan
              JOIN users u    ON u.id  = l.seller_user_id
             WHERE l.id = ?");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) { json_error('not_found', "listing $id not found", 404); return; }
        json_response($row);
        return;
    }

    if ($id === 0 && $method === 'POST') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $jan = normalize_jan((string)require_field($body, 'jan'));
        $price = require_int_positive($body['price'] ?? null, 'price');
        $qty = require_int_positive($body['qty'] ?? null, 'qty');
        // Product must already exist (client should POST /api/products first)
        $chk = $pdo->prepare('SELECT 1 FROM products WHERE jan=?');
        $chk->execute([$jan]);
        if ($chk->fetchColumn() === false) {
            throw new ApiException('product_unknown',
                "product $jan not registered. POST /api/products first", 400);
        }
        $ins = $pdo->prepare(
            'INSERT INTO listings (jan, seller_user_id, price, qty, status)
             VALUES (?,?,?,?, "on_sale")'
        );
        $ins->execute([$jan, $u['id'], $price, $qty]);
        $lid = (int)$pdo->lastInsertId();
        $get = $pdo->prepare("SELECT l.*, p.name, p.image_url FROM listings l
            JOIN products p ON p.jan=l.jan WHERE l.id=?");
        $get->execute([$lid]);
        json_response($get->fetch(), 200);
        return;
    }

    if ($id > 0 && $method === 'PATCH') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT * FROM listings WHERE id=? FOR UPDATE');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) throw new ApiException('not_found', "listing $id not found", 404);
            if ((int)$row['seller_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
                throw new ApiException('forbidden', 'not your listing', 403);
            }
            $sets = [];
            $params = [];
            if (array_key_exists('price', $body) && $body['price'] !== null) {
                $sets[] = 'price = ?';
                $params[] = require_int_positive($body['price'], 'price');
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
            if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
            $params[] = $id;
            $upd = $pdo->prepare('UPDATE listings SET ' . implode(',', $sets) . ' WHERE id=?');
            $upd->execute($params);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $get = $pdo->prepare("SELECT l.*, p.name, p.image_url FROM listings l
            JOIN products p ON p.jan=l.jan WHERE l.id=?");
        $get->execute([$id]);
        json_response($get->fetch());
        return;
    }

    if ($id > 0 && $method === 'DELETE') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $hard = !empty($_GET['hard']); // DELETE /api/listings/{id}?hard=1 → real delete (no history)
        $pdo->beginTransaction();
        try {
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
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        json_response(['ok' => true, 'hard' => $hard]);
        return;
    }

    json_error('not_found', "no listings route for $method", 404);
}
