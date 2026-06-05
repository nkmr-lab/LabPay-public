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
    if ($sub === 'combined')  { network_combined($pdo); return; }
    if ($sub === 'presence_cooc') { network_presence_cooc($pdo, $cfg); return; }
    json_error('not_found', "unknown network kind: $sub", 404);
}

// 在室共起ネットワーク: 同じ部屋 (room_id) で 同じ 1 時間スロット に 在室が
// 検出された ユーザー同士に 共起カウントを +1。 ペア (a < b) で 集計し
// 「件数」 として エッジ重み に。 days で 集計幅 切替 (7 / 30 / 365 / 0=全期間)。
function network_presence_cooc(PDO $pdo, array $cfg): void {
    $days = max(0, min(3650, (int)($_GET['days'] ?? 7)));
    $params = [];
    $where = "user_id IS NOT NULL";
    if ($days > 0) {
        $where .= " AND ended_at >= ?";
        $params[] = (new DateTimeImmutable("-{$days} days"))->format('Y-m-d H:i:s');
    }
    $sqlClosed = "SELECT user_id, room_id, started_at AS s, ended_at AS e
                    FROM presence_sessions WHERE $where";
    $stC = $pdo->prepare($sqlClosed);
    $stC->execute($params);

    $whereO = "pd.user_id IS NOT NULL AND ps.session_start_at IS NOT NULL";
    $paramsO = [];
    if ($days > 0) {
        $whereO .= " AND ps.last_seen_at >= ?";
        $paramsO[] = (new DateTimeImmutable("-{$days} days"))->format('Y-m-d H:i:s');
    }
    $sqlOpen = "SELECT pd.user_id, ps.room_id,
                       ps.session_start_at AS s, ps.last_seen_at AS e
                  FROM presence_seen ps
                  JOIN presence_devices pd ON pd.mac = ps.mac
                 WHERE $whereO";
    $stO = $pdo->prepare($sqlOpen);
    $stO->execute($paramsO);

    $sessions = array_merge($stC->fetchAll(PDO::FETCH_ASSOC), $stO->fetchAll(PDO::FETCH_ASSOC));

    // (room_id, hour_bucket) => set<user_id>
    $bucket = [];
    foreach ($sessions as $r) {
        $uid = (int)$r['user_id'];
        if ($uid <= 0) continue;
        $sTs = strtotime((string)$r['s']);
        $eTs = strtotime((string)$r['e']);
        if (!$sTs || !$eTs || $eTs <= $sTs) continue;
        $room = (string)$r['room_id'];
        $startHour = (int)(floor($sTs / 3600) * 3600);
        for ($h = $startHour; $h < $eTs; $h += 3600) {
            $bucket["$room|$h"][$uid] = true;
        }
    }

    // ペア毎の カウント (無向、 a < b)
    $edges = [];      // "a-b" => count
    $userSet = [];
    foreach ($bucket as $users) {
        if (count($users) < 2) continue;
        $uids = array_keys($users);
        sort($uids, SORT_NUMERIC);
        $n = count($uids);
        for ($i = 0; $i < $n; $i++) {
            $userSet[$uids[$i]] = true;
            for ($j = $i + 1; $j < $n; $j++) {
                $key = $uids[$i] . '-' . $uids[$j];
                $edges[$key] = ($edges[$key] ?? 0) + 1;
            }
        }
    }

    if (!$userSet || !$edges) { json_response(['nodes' => [], 'edges' => [], 'threshold' => 0]); return; }

    // v436 中央値だと 弱い ペアまで 残りすぎ → 75 パーセンタイル (Q3) に 引上げ。
    // 上位 25% の 「よく 一緒に いる」 ペア だけ 残す。 全エッジ平均が 低い ラボ
    // データ でも 確実に 強い エッジ だけ 残す。 最低 2 で 弾く (1回 きりは 確定除外)。
    $counts = array_values($edges);
    sort($counts, SORT_NUMERIC);
    $n = count($counts);
    // 75 パーセンタイル: index = floor(0.75 * (n - 1))
    $p75Idx = (int)floor(0.75 * ($n - 1));
    $p75 = $counts[$p75Idx];
    $threshold = max(2, (int)$p75);  // 最低 2 回 共起 を 要求 (1 回きりは 確定で 除外)

    // 閾値 以上 の エッジだけ 残す + 関与する ノード を 再収集。
    $keptEdges = [];
    $keptNodes = [];
    foreach ($edges as $k => $cnt) {
        if ($cnt < $threshold) continue;
        [$a, $b] = explode('-', $k, 2);
        $a = (int)$a; $b = (int)$b;
        $keptEdges[] = ['from' => $a, 'to' => $b, 'count' => $cnt, 'total' => $cnt];
        $keptNodes[$a] = true;
        $keptNodes[$b] = true;
    }
    if (!$keptNodes) { json_response(['nodes' => [], 'edges' => [], 'threshold' => $threshold]); return; }

    // ノード 解決 (残ったものだけ)
    $uidList = array_keys($keptNodes);
    $place = implode(',', array_fill(0, count($uidList), '?'));
    $stU = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
    $stU->execute($uidList);
    $nodes = array_map(fn($r) => [
        'id'     => (int)$r['id'],
        'name'   => $r['display_name'],
        'avatar' => $r['avatar_url'] ?? null,
    ], $stU->fetchAll(PDO::FETCH_ASSOC));

    json_response([
        'nodes' => $nodes,
        'edges' => $keptEdges,
        'threshold' => $threshold,
        'edge_total_before_filter' => $n,
        'edge_total_after_filter' => count($keptEdges),
    ]);
}

// 売買 + タスクを 1 グラフに重ねる。エッジに type を付けてクライアントが
// 色分けできるようにする (purchase / task)。
function network_combined(PDO $pdo): void {
    $stP = $pdo->query("
        SELECT p.buyer_user_id AS from_id, p.seller_user_id AS to_id,
               'purchase' AS type,
               COUNT(*) AS n,
               COALESCE(SUM(p.unit_price * p.qty), 0) AS total
          FROM purchases p
          JOIN users bu ON bu.id = p.buyer_user_id  AND bu.kind='human'
          JOIN users su ON su.id = p.seller_user_id AND su.kind='human'
         WHERE p.buyer_user_id <> p.seller_user_id
         GROUP BY p.buyer_user_id, p.seller_user_id");
    $stT = $pdo->query("
        SELECT t.requester_user_id AS from_id, tc.user_id AS to_id,
               'task' AS type,
               COUNT(*) AS n,
               COALESCE(SUM(t.reward), 0) AS total
          FROM task_claims tc
          JOIN tasks t  ON t.id  = tc.task_id
          JOIN users ru ON ru.id = t.requester_user_id AND ru.kind='human'
          JOIN users wu ON wu.id = tc.user_id          AND wu.kind='human'
         WHERE tc.status = 'approved'
           AND t.requester_user_id <> tc.user_id
         GROUP BY t.requester_user_id, tc.user_id");
    $rows = array_merge($stP->fetchAll(), $stT->fetchAll());

    $nodeIds = [];
    foreach ($rows as $r) {
        $nodeIds[(int)$r['from_id']] = true;
        $nodeIds[(int)$r['to_id']]   = true;
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
        'from'  => (int)$r['from_id'],
        'to'    => (int)$r['to_id'],
        'count' => (int)$r['n'],
        'total' => (int)$r['total'],
        'type'  => (string)$r['type'],
    ], $rows);
    json_response(['nodes' => $nodes, 'edges' => $edges]);
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
