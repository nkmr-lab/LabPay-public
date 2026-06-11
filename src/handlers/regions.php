<?php
// v531 #163 行った国 / 都道府県 (制覇マップ)。
//   GET    /api/regions/visited            自分が記録した {kind, code} の一覧
//   POST   /api/regions/visit              { kind, code } を記録 (INSERT IGNORE)
//   DELETE /api/regions/visit?kind=...&code=...  解除
//   GET    /api/regions/stats              ラボ全体の 国別 / 都道府県別 訪問者数 (匿名集計)

declare(strict_types=1);

function route_regions(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === 'visited' && $method === 'GET') {
        $st = $pdo->prepare("SELECT kind, code, visited_at FROM visited_regions WHERE user_id = ? ORDER BY kind, code");
        $st->execute([$uid]);
        json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
        return;
    }
    if ($sub === 'visit' && $method === 'POST') {
        $body = read_json_body();
        [$kind, $code] = regions_validate($body);
        $pdo->prepare("INSERT IGNORE INTO visited_regions (user_id, kind, code, visited_at) VALUES (?, ?, ?, NOW())")
            ->execute([$uid, $kind, $code]);
        json_response(['ok' => true, 'kind' => $kind, 'code' => $code]);
        return;
    }
    if ($sub === 'visit' && $method === 'DELETE') {
        $kind = (string)($_GET['kind'] ?? '');
        $code = (string)($_GET['code'] ?? '');
        [$kind, $code] = regions_validate(['kind' => $kind, 'code' => $code]);
        $pdo->prepare("DELETE FROM visited_regions WHERE user_id = ? AND kind = ? AND code = ?")
            ->execute([$uid, $kind, $code]);
        json_response(['ok' => true]);
        return;
    }
    if ($sub === 'stats' && $method === 'GET') {
        // ラボ全体 (匿名集計) — kind ごとに code → 訪問者数
        $st = $pdo->query("SELECT kind, code, COUNT(*) AS n FROM visited_regions GROUP BY kind, code");
        $out = ['country' => [], 'prefecture' => []];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['kind']][$r['code']] = (int)$r['n'];
        }
        json_response($out);
        return;
    }
    json_error('not_found', "no regions route for $method $sub", 404);
}

function regions_validate(array $body): array {
    $kind = (string)($body['kind'] ?? '');
    $code = (string)($body['code'] ?? '');
    if (!in_array($kind, ['country', 'prefecture'], true)) {
        throw new ApiException('bad_request', "kind must be 'country' or 'prefecture'", 400);
    }
    if ($kind === 'country' && !preg_match('/^[A-Z]{2}$/', $code)) {
        throw new ApiException('bad_request', "country code must be 2 uppercase letters", 400);
    }
    if ($kind === 'prefecture' && !preg_match('/^JP-\d{2}$/', $code)) {
        throw new ApiException('bad_request', "prefecture code must be 'JP-NN'", 400);
    }
    return [$kind, $code];
}
