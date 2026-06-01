<?php
// /api/network — social-graph aggregates for buyer<->seller and requester<->worker
// flows. Used by the #/network view to render a force-directed graph.
//
// Edges are aggregated (one edge per pair), with `count` and `total` weights so the
// UI can scale thickness / opacity by volume.

declare(strict_types=1);

function route_network(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';

    if ($method !== 'GET') {
        json_error('not_found', "no network route for $method $sub", 404);
        return;
    }

    if ($sub === 'purchases') { network_purchases($pdo); return; }
    if ($sub === 'tasks')     { network_tasks($pdo); return; }
    json_error('not_found', "unknown network kind: $sub", 404);
}

// Aggregate every (buyer, seller) pair into a single edge with totals.
function network_purchases(PDO $pdo): void {
    $st = $pdo->query("
        SELECT p.buyer_user_id, p.seller_user_id,
               COUNT(*)                        AS n,
               COALESCE(SUM(p.unit_price * p.qty), 0) AS total
          FROM purchases p
          JOIN users bu ON bu.id = p.buyer_user_id  AND bu.kind='human'
          JOIN users su ON su.id = p.seller_user_id AND su.kind='human'
         WHERE p.buyer_user_id <> p.seller_user_id
         GROUP BY p.buyer_user_id, p.seller_user_id
    ");
    network_emit_graph($pdo, $st->fetchAll(), 'buyer_user_id', 'seller_user_id');
}

// Approved task claims: requester -> worker edge.
function network_tasks(PDO $pdo): void {
    $st = $pdo->query("
        SELECT t.requester_user_id, tc.user_id AS worker_user_id,
               COUNT(*)                  AS n,
               COALESCE(SUM(t.reward), 0) AS total
          FROM task_claims tc
          JOIN tasks t  ON t.id  = tc.task_id
          JOIN users ru ON ru.id = t.requester_user_id AND ru.kind='human'
          JOIN users wu ON wu.id = tc.user_id          AND wu.kind='human'
         WHERE tc.status = 'approved'
           AND t.requester_user_id <> tc.user_id
         GROUP BY t.requester_user_id, tc.user_id
    ");
    network_emit_graph($pdo, $st->fetchAll(), 'requester_user_id', 'worker_user_id');
}

// Common: given aggregated edges and the two FK column names, hydrate node info and
// return {nodes: [...], edges: [...]} suitable for a force-directed renderer.
function network_emit_graph(PDO $pdo, array $rows, string $fromCol, string $toCol): void {
    $nodeIds = [];
    foreach ($rows as $r) {
        $nodeIds[(int)$r[$fromCol]] = true;
        $nodeIds[(int)$r[$toCol]]   = true;
    }
    $nodes = [];
    if ($nodeIds) {
        $place = implode(',', array_fill(0, count($nodeIds), '?'));
        $st = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
        $st->execute(array_keys($nodeIds));
        foreach ($st->fetchAll() as $n) {
            $nodes[] = [
                'id'     => (int)$n['id'],
                'name'   => $n['display_name'],
                'avatar' => $n['avatar_url'] ?? null,
            ];
        }
    }
    $edges = array_map(fn($r) => [
        'from'  => (int)$r[$fromCol],
        'to'    => (int)$r[$toCol],
        'count' => (int)$r['n'],
        'total' => (int)$r['total'],
    ], $rows);
    json_response(['nodes' => $nodes, 'edges' => $edges]);
}
