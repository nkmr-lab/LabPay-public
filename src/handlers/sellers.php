<?php
// /api/sellers/{id}/stats — public seller reputation snapshot.

declare(strict_types=1);

function route_sellers(PDO $pdo, array $cfg, string $method, array $seg): void {
    require_exposure($cfg, 'public_read');
    if (($seg[2] ?? '') !== 'stats' || $method !== 'GET') {
        json_error('not_found', 'use GET /api/sellers/{id}/stats', 404);
        return;
    }
    $sid = (int)($seg[1] ?? 0);
    if ($sid <= 0) { json_error('bad_request', 'bad seller id', 400); return; }

    $u = $pdo->prepare('SELECT id, display_name FROM users WHERE id=? AND kind="human"');
    $u->execute([$sid]);
    $user = $u->fetch();
    if (!$user) { json_error('not_found', 'seller not found', 404); return; }

    $st = $pdo->prepare("SELECT
        COUNT(*) AS sales_count,
        COALESCE(SUM(unit_price - fee), 0) AS gross_take,
        MIN(created_at) AS first_sale_at,
        MAX(created_at) AS last_sale_at
        FROM purchases WHERE seller_user_id = ?");
    $st->execute([$sid]);
    $stats = $st->fetch();

    $st2 = $pdo->prepare("SELECT COUNT(*) FROM listings
        WHERE seller_user_id=? AND status='on_sale' AND qty > 0");
    $st2->execute([$sid]);
    $active = (int)$st2->fetchColumn();

    json_response([
        'user' => $user,
        'sales_count'   => (int)$stats['sales_count'],
        'gross_take'    => (int)$stats['gross_take'],
        'first_sale_at' => $stats['first_sale_at'],
        'last_sale_at'  => $stats['last_sale_at'],
        'active_listings' => $active,
    ]);
}
