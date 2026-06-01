<?php
// /api/me, /api/me/transactions, /api/me/listings.

declare(strict_types=1);

function route_me(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET') {
        $accId = Ledger::accountIdForUser($pdo, $u['id']);
        $bal = Ledger::balanceOf($pdo, $accId);
        $st = $pdo->prepare('SELECT current_streak, longest_streak, last_checkin_date
            FROM streaks WHERE user_id=?');
        $st->execute([$u['id']]);
        $streak = $st->fetch() ?: ['current_streak' => 0, 'longest_streak' => 0, 'last_checkin_date' => null];
        $av = $pdo->prepare('SELECT avatar_url, scrapbox_username, grade FROM users WHERE id=?');
        $av->execute([$u['id']]);
        $row = $av->fetch();
        $u['avatar_url']        = $row['avatar_url']        ?? null;
        $u['scrapbox_username'] = $row['scrapbox_username'] ?? null;
        $u['grade']             = $row['grade']             ?? null;
        json_response([
            'user' => $u,
            'balance' => $bal,
            'streak' => $streak,
        ]);
        return;
    }

    // PATCH /api/me — update editable profile fields (display_name, avatar_url, scrapbox_username).
    if ($sub === '' && $method === 'PATCH') {
        $body = read_json_body();
        $sets = []; $params = [];
        if (array_key_exists('display_name', $body)) {
            $name = trim((string)$body['display_name']);
            if ($name === '' || mb_strlen($name) > 100) {
                throw new ApiException('bad_request', 'display_name length 1..100', 400);
            }
            $sets[] = 'display_name = ?'; $params[] = $name;
        }
        if (array_key_exists('avatar_url', $body)) {
            $url = $body['avatar_url'];
            if ($url === null || $url === '') {
                $sets[] = 'avatar_url = NULL';
            } else {
                $url = (string)$url;
                // Local upload path: /uploads/<dir>?/<file>.<ext>, charset restricted, no ".." or extra segments.
                $isLocal = (bool)preg_match('#^/uploads/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?\.[A-Za-z0-9]{1,8}$#', $url);
                // Absolute URL: only http(s), and only pointing at this app's own origin.
                $isHttp = false;
                if (filter_var($url, FILTER_VALIDATE_URL) && (str_starts_with($url, 'http://') || str_starts_with($url, 'https://'))) {
                    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
                    if ($baseUrl !== '' && str_starts_with($url, $baseUrl . '/uploads/')) {
                        // Re-run the local check against the path portion.
                        $rel = substr($url, strlen($baseUrl));
                        $isHttp = (bool)preg_match('#^/uploads/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?\.[A-Za-z0-9]{1,8}$#', $rel);
                    }
                }
                if (!$isHttp && !$isLocal) {
                    throw new ApiException('bad_request', 'avatar_url must be /uploads/<file>.<ext> on this origin', 400);
                }
                $sets[] = 'avatar_url = ?'; $params[] = $url;
            }
        }
        if (array_key_exists('scrapbox_username', $body)) {
            $sb = $body['scrapbox_username'];
            if ($sb === null || $sb === '') {
                $sets[] = 'scrapbox_username = NULL';
            } else {
                $sb = trim((string)$sb);
                if (mb_strlen($sb) > 60) throw new ApiException('bad_request', 'scrapbox_username too long', 400);
                $sets[] = 'scrapbox_username = ?'; $params[] = $sb;
            }
        }
        if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
        $params[] = $u['id'];
        $pdo->prepare('UPDATE users SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        $get = $pdo->prepare('SELECT id, email, display_name, avatar_url, role, kind FROM users WHERE id=?');
        $get->execute([$u['id']]);
        json_response($get->fetch());
        return;
    }

    if ($sub === 'transactions' && $method === 'GET') {
        $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $accId = Ledger::accountIdForUser($pdo, $u['id']);

        // Join optional product name via purchases for nicer history.
        $sql = "
            SELECT l.id, l.from_account_id, l.to_account_id, l.amount, l.type, l.ref_type, l.ref_id,
                   l.memo, l.created_at,
                   af.code AS from_code, at.code AS to_code,
                   uf.display_name AS from_user, ut.display_name AS to_user,
                   pr.name AS product_name, pr.jan AS product_jan
              FROM ledger l
              JOIN accounts af ON af.id = l.from_account_id
              JOIN accounts at ON at.id = l.to_account_id
              LEFT JOIN users uf ON uf.id = af.owner_user_id
              LEFT JOIN users ut ON ut.id = at.owner_user_id
              LEFT JOIN purchases p ON l.ref_type='purchase' AND p.id = l.ref_id
              LEFT JOIN products pr ON pr.jan = p.jan
             WHERE l.from_account_id = ? OR l.to_account_id = ?
             ORDER BY l.id DESC
             LIMIT ? OFFSET ?";
        $st = $pdo->prepare($sql);
        $st->bindValue(1, $accId, PDO::PARAM_INT);
        $st->bindValue(2, $accId, PDO::PARAM_INT);
        $st->bindValue(3, $limit, PDO::PARAM_INT);
        $st->bindValue(4, $offset, PDO::PARAM_INT);
        $st->execute();
        $rows = $st->fetchAll();

        $items = [];
        foreach ($rows as $r) {
            $direction = ((int)$r['to_account_id'] === $accId) ? 'in' : 'out';
            $signed = ($direction === 'in' ? 1 : -1) * (int)$r['amount'];
            $items[] = [
                'id'             => (int)$r['id'],
                'type'           => $r['type'],
                'direction'      => $direction,
                'amount'         => (int)$r['amount'],
                'signed_amount'  => $signed,
                'counterparty'   => $direction === 'in' ? ($r['from_user'] ?? $r['from_code']) : ($r['to_user'] ?? $r['to_code']),
                'memo'           => $r['memo'],
                'ref_type'       => $r['ref_type'],
                'ref_id'         => $r['ref_id'] !== null ? (int)$r['ref_id'] : null,
                'product_name'   => $r['product_name'],
                'product_jan'    => $r['product_jan'],
                'created_at'     => $r['created_at'],
            ];
        }
        json_response(['items' => $items, 'limit' => $limit, 'offset' => $offset]);
        return;
    }

    if ($sub === 'achievements' && $method === 'GET') {
        $items = Achievements::reportFor($pdo, (int)$u['id']);
        json_response(['items' => $items]);
        return;
    }

    if ($sub === 'listings' && $method === 'GET') {
        require_exposure($cfg, 'listings_write');
        $status = $_GET['status'] ?? '';
        $sql = "SELECT l.*,
                       p.name AS product_name,
                       COALESCE(l.display_name, p.name) AS name,
                       p.image_url
                  FROM listings l JOIN products p ON p.jan = l.jan
                 WHERE l.seller_user_id = ?";
        $params = [$u['id']];
        if ($status !== '') {
            $sql .= ' AND l.status = ?';
            $params[] = $status;
        }
        $sql .= ' ORDER BY l.updated_at DESC';
        $st = $pdo->prepare($sql);
        $st->execute($params);
        json_response(['items' => $st->fetchAll()]);
        return;
    }

    json_error('not_found', "no me route for $method $sub", 404);
}

// GET /api/users — lightweight list of all human users for recipient pickers.
function route_users(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    if ($method !== 'GET' || isset($seg[1])) {
        json_error('not_found', 'use GET /api/users', 404);
        return;
    }
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q !== '') {
        $st = $pdo->prepare("SELECT id, display_name, avatar_url, grade
            FROM users WHERE kind='human'
              AND (display_name LIKE CONCAT('%', ?, '%') OR email LIKE CONCAT('%', ?, '%'))
            ORDER BY display_name LIMIT 50");
        $st->execute([$q, $q]);
    } else {
        $st = $pdo->query("SELECT id, display_name, avatar_url, grade
            FROM users WHERE kind='human' ORDER BY display_name");
    }
    json_response(['items' => $st->fetchAll()]);
}
