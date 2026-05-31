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
        json_response(['items' => $st->fetchAll()]);
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
        $image = isset($body['image_url']) ? trim((string)$body['image_url']) : null;
        if ($name === '' || mb_strlen($name) > 200) {
            throw new ApiException('bad_request', 'name length 1..200', 400);
        }
        if ($image !== null && $image !== '' && !filter_var($image, FILTER_VALIDATE_URL)) {
            throw new ApiException('bad_request', 'image_url must be a URL', 400);
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
        $image = isset($body['image_url']) ? trim((string)$body['image_url']) : null;
        $jan_in = normalize_jan($jan_in);
        if ($name === '' || mb_strlen($name) > 200) {
            throw new ApiException('bad_request', 'name length 1..200', 400);
        }
        if ($image !== null && $image !== ''
            && !filter_var($image, FILTER_VALIDATE_URL)
            && !preg_match('#^/uploads/[A-Za-z0-9._/-]+$#', $image)) {
            throw new ApiException('bad_request', 'image_url must be a URL or /uploads/... path', 400);
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

    json_error('not_found', "no products route for $method", 404);
}
