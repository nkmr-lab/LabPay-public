<?php
// /api/overleaf — Overleaf プロジェクト追跡 (LabPay 内アプリ)。
//   pyoverleaf が DB に snapshot を入れる → ここで集計して返す。
//   現状 admin 限定 (教員アカウントが cookie 持ってる前提)。

declare(strict_types=1);

function route_overleaf(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'projects' && $method === 'GET' && !isset($seg[2])) { overleaf_list($pdo, $cfg); return; }
    if ($sub === 'projects' && ctype_digit((string)($seg[2] ?? '')) && $method === 'GET' && !isset($seg[3])) {
        overleaf_detail($pdo, $cfg, (int)$seg[2]); return;
    }
    if ($sub === 'status' && $method === 'GET') { overleaf_status($pdo, $cfg); return; }
    json_error('not_found', "no overleaf route for $method $sub", 404);
}

function _overleaf_require_admin(PDO $pdo, array $cfg): array {
    $u = Auth::requireUser($pdo, $cfg);
    if (($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', 'admin のみ', 403);
    }
    return $u;
}

function overleaf_list(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    // 各 project に対して「最新 snapshot」「24h 前 snapshot」「7d 前 snapshot」を抽出して
    // 文字数 + 差分を返す。 N 件 (最大 100) 想定。
    $rows = $pdo->query("
        SELECT p.id, p.overleaf_id, p.name, p.owner_email, p.owner_name,
               p.last_remote_updated_at, p.is_archived, p.is_trashed, p.first_seen_at
          FROM overleaf_projects p
         WHERE p.is_trashed = 0
         ORDER BY p.last_remote_updated_at DESC, p.id DESC
         LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);

    $stLatest = $pdo->prepare("
        SELECT id, taken_at, total_char_count, total_char_body, total_jp_char_count,
               total_word_count, file_count
          FROM overleaf_snapshots
         WHERE project_id = ?
         ORDER BY taken_at DESC LIMIT 1");
    // 「N 時間前 (またはそれ以前) の最新 snapshot」を返す
    $stPast = $pdo->prepare("
        SELECT total_char_count, total_char_body, total_jp_char_count, total_word_count, taken_at
          FROM overleaf_snapshots
         WHERE project_id = ? AND taken_at <= (NOW() - INTERVAL ? HOUR)
         ORDER BY taken_at DESC LIMIT 1");
    // sparkline: 過去 14 日を 24h 区切りで 14 点 (最新 snapshot を各 day で取る)
    $stSpark = $pdo->prepare("
        SELECT DATE(taken_at) AS d, MAX(total_char_count) AS c
          FROM overleaf_snapshots
         WHERE project_id = ? AND taken_at >= (NOW() - INTERVAL 14 DAY)
         GROUP BY DATE(taken_at)
         ORDER BY d ASC");

    $items = [];
    foreach ($rows as $r) {
        $pid = (int)$r['id'];
        $stLatest->execute([$pid]);
        $latest = $stLatest->fetch(PDO::FETCH_ASSOC);
        $stPast->execute([$pid, 24]);
        $past24 = $stPast->fetch(PDO::FETCH_ASSOC);
        $stPast->execute([$pid, 24 * 7]);
        $past7d = $stPast->fetch(PDO::FETCH_ASSOC);
        $stSpark->execute([$pid]);
        $spark = $stSpark->fetchAll(PDO::FETCH_ASSOC);

        $items[] = [
            'id'                     => $pid,
            'overleaf_id'            => $r['overleaf_id'],
            'name'                   => $r['name'],
            'owner_email'            => $r['owner_email'],
            'owner_name'             => $r['owner_name'],
            'last_remote_updated_at' => $r['last_remote_updated_at'],
            'is_archived'            => (int)$r['is_archived'] === 1,
            'first_seen_at'          => $r['first_seen_at'],
            'latest' => $latest ? [
                'taken_at'            => $latest['taken_at'],
                'total_char_count'    => (int)$latest['total_char_count'],
                'total_char_body'     => (int)$latest['total_char_body'],
                'total_jp_char_count' => (int)$latest['total_jp_char_count'],
                'total_word_count'    => (int)$latest['total_word_count'],
                'file_count'          => (int)$latest['file_count'],
            ] : null,
            'delta_24h' => ($latest && $past24) ? [
                'total_char_count' => (int)$latest['total_char_count'] - (int)$past24['total_char_count'],
                'total_char_body'  => (int)$latest['total_char_body']  - (int)$past24['total_char_body'],
                'baseline_at'      => $past24['taken_at'],
            ] : null,
            'delta_7d' => ($latest && $past7d) ? [
                'total_char_count' => (int)$latest['total_char_count'] - (int)$past7d['total_char_count'],
                'total_char_body'  => (int)$latest['total_char_body']  - (int)$past7d['total_char_body'],
                'baseline_at'      => $past7d['taken_at'],
            ] : null,
            'sparkline' => array_map(fn($s) => ['d' => $s['d'], 'c' => (int)$s['c']], $spark),
        ];
    }

    json_response(['items' => $items]);
}

function overleaf_detail(PDO $pdo, array $cfg, int $id): void {
    _overleaf_require_admin($pdo, $cfg);
    $stP = $pdo->prepare("SELECT * FROM overleaf_projects WHERE id = ?");
    $stP->execute([$id]);
    $p = $stP->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', 'project not found', 404);

    // 最新 snapshot
    $stS = $pdo->prepare("SELECT * FROM overleaf_snapshots
        WHERE project_id = ? ORDER BY taken_at DESC LIMIT 1");
    $stS->execute([$id]);
    $latest = $stS->fetch(PDO::FETCH_ASSOC);

    // 直近 60 日全 snapshot (chart 用)
    $stHist = $pdo->prepare("SELECT id, taken_at, total_char_count, total_char_body, total_word_count, total_jp_char_count
        FROM overleaf_snapshots
        WHERE project_id = ? AND taken_at >= (NOW() - INTERVAL 60 DAY)
        ORDER BY taken_at ASC");
    $stHist->execute([$id]);
    $hist = $stHist->fetchAll(PDO::FETCH_ASSOC);

    // 最新 snapshot の per-file 内訳
    $files = [];
    if ($latest) {
        $stF = $pdo->prepare("SELECT file_path, char_count_total, char_count_body, jp_char_count, word_count
            FROM overleaf_file_snapshots WHERE snapshot_id = ?
            ORDER BY char_count_total DESC");
        $stF->execute([(int)$latest['id']]);
        $files = $stF->fetchAll(PDO::FETCH_ASSOC);
        foreach ($files as &$f) {
            $f['char_count_total'] = (int)$f['char_count_total'];
            $f['char_count_body']  = (int)$f['char_count_body'];
            $f['jp_char_count']    = (int)$f['jp_char_count'];
            $f['word_count']       = (int)$f['word_count'];
        } unset($f);
    }

    json_response([
        'project' => [
            'id'                     => (int)$p['id'],
            'overleaf_id'            => $p['overleaf_id'],
            'name'                   => $p['name'],
            'owner_email'            => $p['owner_email'],
            'owner_name'             => $p['owner_name'],
            'last_remote_updated_at' => $p['last_remote_updated_at'],
            'is_archived'            => (int)$p['is_archived'] === 1,
            'is_trashed'             => (int)$p['is_trashed'] === 1,
            'first_seen_at'          => $p['first_seen_at'],
        ],
        'latest' => $latest ? [
            'taken_at'            => $latest['taken_at'],
            'total_char_count'    => (int)$latest['total_char_count'],
            'total_char_body'     => (int)$latest['total_char_body'],
            'total_jp_char_count' => (int)$latest['total_jp_char_count'],
            'total_word_count'    => (int)$latest['total_word_count'],
            'file_count'          => (int)$latest['file_count'],
        ] : null,
        'history' => array_map(fn($h) => [
            'taken_at'            => $h['taken_at'],
            'total_char_count'    => (int)$h['total_char_count'],
            'total_char_body'     => (int)$h['total_char_body'],
            'total_jp_char_count' => (int)$h['total_jp_char_count'],
            'total_word_count'    => (int)$h['total_word_count'],
        ], $hist),
        'files' => $files,
    ]);
}

function overleaf_status(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    $stR = $pdo->query("SELECT id, started_at, finished_at, ok, projects_seen, error_msg
        FROM overleaf_collector_runs ORDER BY started_at DESC LIMIT 1");
    $last = $stR->fetch(PDO::FETCH_ASSOC) ?: null;
    $cnt = (int)$pdo->query("SELECT COUNT(*) FROM overleaf_projects WHERE is_trashed = 0")->fetchColumn();
    $snapCnt = (int)$pdo->query("SELECT COUNT(*) FROM overleaf_snapshots")->fetchColumn();
    json_response([
        'last_run' => $last ? [
            'id'            => (int)$last['id'],
            'started_at'    => $last['started_at'],
            'finished_at'   => $last['finished_at'],
            'ok'            => (int)$last['ok'] === 1,
            'projects_seen' => (int)$last['projects_seen'],
            'error_msg'     => $last['error_msg'],
        ] : null,
        'project_count'  => $cnt,
        'snapshot_count' => $snapCnt,
    ]);
}
