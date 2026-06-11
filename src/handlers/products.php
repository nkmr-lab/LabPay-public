<?php
// /api/products[/{jan}] — shared catalog by JAN.

declare(strict_types=1);

function route_products(PDO $pdo, array $cfg, string $method, array $seg): void {
    $jan = $seg[1] ?? '';

    if ($jan === '' && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        $q = trim((string)($_GET['q'] ?? ''));
        $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        if ($q !== '') {
            $st = $pdo->prepare(
                "SELECT jan, name, image_url, source, created_at
                   FROM products
                  WHERE name LIKE CONCAT('%', ?, '%') OR jan LIKE CONCAT(?, '%')
                  ORDER BY name LIMIT ?"
            );
            $st->bindValue(1, $q);
            $st->bindValue(2, $q);
            $st->bindValue(3, $limit, PDO::PARAM_INT);
            $st->execute();
        } else {
            $st = $pdo->prepare(
                "SELECT jan, name, image_url, source, created_at
                   FROM products ORDER BY created_at DESC LIMIT ?"
            );
            $st->bindValue(1, $limit, PDO::PARAM_INT);
            $st->execute();
        }
        // v512 サムネ実在チェック済み URL を併せて返す
        $items = $st->fetchAll();
        foreach ($items as &$it) {
            $it['image_thumb_url'] = !empty($it['image_url']) ? thumb_url_for((string)$it['image_url']) : null;
        }
        unset($it);
        json_response(['items' => $items]);
        return;
    }

    if ($jan !== '' && $method === 'GET') {
        require_exposure($cfg, 'public_read');
        $st = $pdo->prepare('SELECT jan, name, image_url, source, created_at FROM products WHERE jan=?');
        $st->execute([$jan]);
        $row = $st->fetch();
        if (!$row) {
            // Try external provider (today: null) and surface a "needs manual entry" signal.
            $info = ProductInfo::fetch($jan, $cfg);
            if ($info) {
                json_response([
                    'jan' => $jan,
                    'name' => $info['name'],
                    'image_url' => $info['image_url'] ?? null,
                    'source' => 'api',
                    'pending' => true,
                    'confidence' => $info['confidence'] ?? 'unknown',
                ]);
                return;
            }
            json_error('not_found', "product $jan not found; submit POST /api/products to register", 404,
                ['jan' => $jan]);
            return;
        }
        // v521 #157 サムネ URL を併せて返す (個別 GET でも list と同じ形)。
        $row['image_thumb_url'] = !empty($row['image_url']) ? thumb_url_for((string)$row['image_url']) : null;
        json_response($row);
        return;
    }

    // POST /api/products/no_jan — register a product with auto-generated synthetic JAN
    // (for things like loose coffee capsules where the unit has no barcode)
    if ($jan === 'no_jan' && $method === 'POST') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $name  = trim((string)require_field($body, 'name'));
        $image = validate_product_image_url($body['image_url'] ?? null);
        if ($name === '' || mb_strlen($name) > 200) {
            throw new ApiException('bad_request', 'name length 1..200', 400);
        }
        // Synthetic JAN: 13-digit "9" + timestamp(yymmddhhmm) + 2 random digits.
        // Leading 9 dodges all real GS1 ranges; retry on the rare collision.
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $syntheticJan = '9' . date('ymdHi') . str_pad((string)random_int(0, 99), 2, '0', STR_PAD_LEFT);
            $chk = $pdo->prepare('SELECT 1 FROM products WHERE jan=?');
            $chk->execute([$syntheticJan]);
            if ($chk->fetchColumn() === false) break;
            $syntheticJan = null;
        }
        if ($syntheticJan === null) throw new ApiException('collision', 'failed to allocate synthetic JAN', 500);
        $ins = $pdo->prepare('INSERT INTO products (jan, name, image_url, source, created_by_user_id)
            VALUES (?,?,?,?,?)');
        $ins->execute([$syntheticJan, $name, $image ?: null, 'manual', $u['id']]);
        $st = $pdo->prepare('SELECT jan, name, image_url, source, created_at FROM products WHERE jan=?');
        $st->execute([$syntheticJan]);
        json_response($st->fetch(), 200);
        return;
    }

    if ($jan === '' && $method === 'POST') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);
        $body = read_json_body();
        $jan_in = trim((string)require_field($body, 'jan'));
        $name = trim((string)require_field($body, 'name'));
        $image = validate_product_image_url($body['image_url'] ?? null);
        $jan_in = normalize_jan($jan_in);
        if ($name === '' || mb_strlen($name) > 200) {
            throw new ApiException('bad_request', 'name length 1..200', 400);
        }
        $ins = $pdo->prepare(
            'INSERT INTO products (jan, name, image_url, source, created_by_user_id)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE name=VALUES(name), image_url=VALUES(image_url)'
        );
        $ins->execute([$jan_in, $name, $image ?: null, 'manual', $u['id']]);
        $st = $pdo->prepare('SELECT jan, name, image_url, source, created_at FROM products WHERE jan=?');
        $st->execute([$jan_in]);
        json_response($st->fetch(), 200);
        return;
    }

    // PATCH /api/products/{jan} — fix the product name and/or image after the fact.
    // Allowed: admin, the user who originally registered it, or anyone currently selling
    // a listing of this JAN (the catalog is community-owned and typos get fixed by hand).
    if ($jan !== '' && $method === 'PATCH') {
        require_exposure($cfg, 'listings_write');
        $u = Auth::requireUser($pdo, $cfg);

        $st = $pdo->prepare('SELECT * FROM products WHERE jan=?');
        $st->execute([$jan]);
        $prod = $st->fetch();
        if (!$prod) throw new ApiException('not_found', "product $jan not found", 404);

        $authorized = ($u['role'] === 'admin')
            || ((int)$prod['created_by_user_id'] === (int)$u['id']);
        if (!$authorized) {
            $chk = $pdo->prepare('SELECT 1 FROM listings WHERE jan=? AND seller_user_id=? LIMIT 1');
            $chk->execute([$jan, $u['id']]);
            $authorized = (bool)$chk->fetchColumn();
        }
        if (!$authorized) {
            throw new ApiException('forbidden', '商品情報を編集する権限がありません', 403);
        }

        $body = read_json_body();
        $sets = []; $params = [];
        if (array_key_exists('name', $body)) {
            $name = trim((string)$body['name']);
            if ($name === '' || mb_strlen($name) > 200) {
                throw new ApiException('bad_request', 'name length 1..200', 400);
            }
            $sets[] = 'name = ?'; $params[] = $name;
        }
        if (array_key_exists('image_url', $body)) {
            $img = validate_product_image_url($body['image_url']);
            if ($img === null) { $sets[] = 'image_url = NULL'; }
            else               { $sets[] = 'image_url = ?'; $params[] = $img; }
        }
        if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
        $params[] = $jan;
        $pdo->prepare('UPDATE products SET ' . implode(',', $sets) . ' WHERE jan=?')->execute($params);

        $st = $pdo->prepare('SELECT jan, name, image_url, source, created_at FROM products WHERE jan=?');
        $st->execute([$jan]);
        json_response($st->fetch());
        return;
    }

    json_error('not_found', "no products route for $method", 404);
}
