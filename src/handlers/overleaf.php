<?php
// /api/overleaf — Overleaf プロジェクト追跡 (LabPay 内アプリ)。
//   pyoverleaf が DB に snapshot を入れる → ここで集計して返す。
//   v889 admin 限定だったのを LabPay ユーザ全員に開放 (他の人の状況も見えるように)。

declare(strict_types=1);

function route_overleaf(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'projects' && $method === 'GET' && !isset($seg[2])) { overleaf_list($pdo, $cfg); return; }
    if ($sub === 'projects' && ctype_digit((string)($seg[2] ?? '')) && $method === 'GET' && !isset($seg[3])) {
        overleaf_detail($pdo, $cfg, (int)$seg[2]); return;
    }
    if ($sub === 'status' && $method === 'GET') { overleaf_status($pdo, $cfg); return; }
    // v890 admin 設定 API: cookie 確認/設定 + collector 即時実行 + 実行履歴
    if ($sub === 'admin') {
        $next = $seg[2] ?? '';
        if ($next === 'cookie' && $method === 'GET')  { overleaf_admin_cookie_get($pdo, $cfg);  return; }
        if ($next === 'cookie' && $method === 'POST') { overleaf_admin_cookie_set($pdo, $cfg);  return; }
        if ($next === 'verify' && $method === 'POST') { overleaf_admin_verify($pdo, $cfg);      return; }
        if ($next === 'run'    && $method === 'POST') { overleaf_admin_run($pdo, $cfg);         return; }
        if ($next === 'runs'   && $method === 'GET')  { overleaf_admin_runs($pdo, $cfg);        return; }
    }
    json_error('not_found', "no overleaf route for $method $sub", 404);
}

function _overleaf_require_admin(PDO $pdo, array $cfg): array {
    $u = Auth::requireUser($pdo, $cfg);
    if (($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', 'admin のみ', 403);
    }
    return $u;
}

// v897 教員 (自分自身) のメール = DBで一番プロジェクト数の多い owner_email。
//   外部との共同研究プロジェクト (他人がowner) は除外する。
function _overleaf_self_email(PDO $pdo): ?string {
    $em = $pdo->query("SELECT owner_email FROM overleaf_projects
        WHERE owner_email IS NOT NULL AND owner_email <> ''
        GROUP BY owner_email ORDER BY COUNT(*) DESC LIMIT 1")->fetchColumn();
    return $em ?: null;
}

function overleaf_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $selfEmail = _overleaf_self_email($pdo);
    // 各 project に対して「最新 snapshot」「24h 前 snapshot」「7d 前 snapshot」を抽出して
    // 文字数 + 差分を返す。 N 件 (最大 100) 想定。
    // v897 教員 (自分) 所有のみ表示 (外部共同研究プロジェクトは除外)
    $sql = "SELECT p.id, p.overleaf_id, p.name, p.owner_email, p.owner_name,
                   p.last_remote_updated_at, p.is_archived, p.is_trashed, p.first_seen_at
              FROM overleaf_projects p
             WHERE p.is_trashed = 0";
    $params = [];
    if ($selfEmail) { $sql .= " AND p.owner_email = ?"; $params[] = $selfEmail; }
    $sql .= " ORDER BY p.last_remote_updated_at DESC, p.id DESC LIMIT 200";
    $st0 = $pdo->prepare($sql);
    $st0->execute($params);
    $rows = $st0->fetchAll(PDO::FETCH_ASSOC);

    // v892 「メイン.tex」 (\\documentclass を含む主文書) があれば main_* を優先、 無ければ
    //   旧 snapshot のため legacy total_* に fallback。 これでサンプルファイルや過去ファイル
    //   が混ざった過大カウントを解消。
    $stLatest = $pdo->prepare("
        SELECT id, taken_at,
               COALESCE(main_char_count_total, total_char_count) AS total_char_count,
               COALESCE(main_char_count_body,  total_char_body)  AS total_char_body,
               COALESCE(main_jp_char_count,    total_jp_char_count) AS total_jp_char_count,
               COALESCE(main_word_count,       total_word_count) AS total_word_count,
               file_count, main_file_path
          FROM overleaf_snapshots
         WHERE project_id = ?
         ORDER BY taken_at DESC LIMIT 1");
    $stPast = $pdo->prepare("
        SELECT
               COALESCE(main_char_count_total, total_char_count) AS total_char_count,
               COALESCE(main_char_count_body,  total_char_body)  AS total_char_body,
               COALESCE(main_jp_char_count,    total_jp_char_count) AS total_jp_char_count,
               COALESCE(main_word_count,       total_word_count) AS total_word_count,
               taken_at
          FROM overleaf_snapshots
         WHERE project_id = ? AND taken_at <= (NOW() - INTERVAL ? HOUR)
         ORDER BY taken_at DESC LIMIT 1");
    $stSpark = $pdo->prepare("
        SELECT DATE(taken_at) AS d,
               MAX(COALESCE(main_char_count_total, total_char_count)) AS c,
               MAX(COALESCE(main_char_count_body,  total_char_body))  AS cb,
               MAX(COALESCE(main_jp_char_count,    total_jp_char_count)) AS jp,
               MAX(COALESCE(main_word_count,       total_word_count)) AS w
          FROM overleaf_snapshots
         WHERE project_id = ? AND taken_at >= (NOW() - INTERVAL 60 DAY)
         GROUP BY DATE(taken_at)
         ORDER BY d ASC");

    // v889 「1か月以上更新なし」 判定。 last_remote_updated_at が NULL のときは stale 扱い。
    $staleThresholdTs = time() - 30 * 86400;

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

        $lastRemoteTs = $r['last_remote_updated_at'] ? strtotime($r['last_remote_updated_at']) : null;
        $isStale = ($lastRemoteTs === null || $lastRemoteTs < $staleThresholdTs);

        $items[] = [
            'id'                     => $pid,
            'overleaf_id'            => $r['overleaf_id'],
            'name'                   => $r['name'],
            'owner_email'            => $r['owner_email'],
            'owner_name'             => $r['owner_name'],
            'last_remote_updated_at' => $r['last_remote_updated_at'],
            'is_archived'            => (int)$r['is_archived'] === 1,
            'is_stale'               => $isStale,       // v889 1か月以上更新なし
            'first_seen_at'          => $r['first_seen_at'],
            'latest' => $latest ? [
                'taken_at'            => $latest['taken_at'],
                'total_char_count'    => (int)$latest['total_char_count'],
                'total_char_body'     => (int)$latest['total_char_body'],
                'total_jp_char_count' => (int)$latest['total_jp_char_count'],
                'total_word_count'    => (int)$latest['total_word_count'],
                'file_count'          => (int)$latest['file_count'],
                'main_file_path'      => $latest['main_file_path'] ?? null,
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
            // v889 sparkline は 各 metric の値を含む (chart 切替用)
            'sparkline' => array_map(fn($s) => [
                'd'  => $s['d'],
                'c'  => (int)$s['c'],
                'cb' => (int)$s['cb'],
                'jp' => (int)$s['jp'],
                'w'  => (int)$s['w'],
            ], $spark),
        ];
    }

    json_response(['items' => $items]);
}

function overleaf_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $stP = $pdo->prepare("SELECT * FROM overleaf_projects WHERE id = ?");
    $stP->execute([$id]);
    $p = $stP->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', 'project not found', 404);
    // v897 教員 (自分) 所有以外は隠す
    $selfEmail = _overleaf_self_email($pdo);
    if ($selfEmail && $p['owner_email'] !== $selfEmail) {
        throw new ApiException('not_found', 'project not found', 404);
    }

    // 最新 snapshot (v892 main_* がある場合は優先、なければ legacy total_* に fallback)
    $stS = $pdo->prepare("SELECT id, taken_at, file_count, main_file_path,
        COALESCE(main_char_count_total, total_char_count) AS total_char_count,
        COALESCE(main_char_count_body,  total_char_body)  AS total_char_body,
        COALESCE(main_jp_char_count,    total_jp_char_count) AS total_jp_char_count,
        COALESCE(main_word_count,       total_word_count) AS total_word_count
        FROM overleaf_snapshots WHERE project_id = ? ORDER BY taken_at DESC LIMIT 1");
    $stS->execute([$id]);
    $latest = $stS->fetch(PDO::FETCH_ASSOC);

    // 直近 60 日全 snapshot (chart 用)
    $stHist = $pdo->prepare("SELECT id, taken_at,
        COALESCE(main_char_count_total, total_char_count) AS total_char_count,
        COALESCE(main_char_count_body,  total_char_body)  AS total_char_body,
        COALESCE(main_word_count,       total_word_count) AS total_word_count,
        COALESCE(main_jp_char_count,    total_jp_char_count) AS total_jp_char_count
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
            'main_file_path'      => $latest['main_file_path'] ?? null,
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
    Auth::requireUser($pdo, $cfg);
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

// ---------- v890 admin endpoints (cookie management + collector trigger) ----------

const _OVERLEAF_CONFIG_PATH = '/var/www/labpay/config/config.php';

function overleaf_admin_cookie_get(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    $cookie = $cfg['overleaf']['olauth_cookie'] ?? '';
    $masked = '';
    if ($cookie !== '') {
        $n = strlen($cookie);
        $masked = substr($cookie, 0, 8) . '...' . substr($cookie, -6) . " ({$n}文字)";
    }
    json_response(['has_cookie' => $cookie !== '', 'masked' => $masked]);
}

function overleaf_admin_cookie_set(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    $body = read_json_body();
    $cookie = trim((string)($body['cookie'] ?? ''));
    if ($cookie === '' || strlen($cookie) < 20 || strlen($cookie) > 2000) {
        throw new ApiException('bad_request', 'cookie が空 / 短すぎ / 長すぎ', 400);
    }
    // overleaf_session2 は URL エンコード文字列 (英数 + %._-/=:+) のみ想定
    if (!preg_match('/^[A-Za-z0-9%._\-\/=+:]+$/', $cookie)) {
        throw new ApiException('bad_request', 'cookie に不正な文字が含まれています', 400);
    }

    $path = _OVERLEAF_CONFIG_PATH;
    if (!is_writable($path)) {
        throw new ApiException('io_error', 'config.php が書き込み不可 (apache 所有か確認)', 500);
    }
    $src = @file_get_contents($path);
    if ($src === false) throw new ApiException('io_error', 'config.php 読み込み失敗', 500);

    $entry = "    'overleaf' => ['olauth_cookie' => '" . str_replace("'", "\\'", $cookie) . "'],\n";
    // 既存エントリ削除
    $src = preg_replace("/^\s*'overleaf'\s*=>\s*\[[^\]]*\]\s*,\s*\n/m", '', $src);
    // 末尾の `];` の直前に挿入
    $pos = strrpos($src, "];");
    if ($pos === false) throw new ApiException('io_error', 'config.php の array close `];` が見つからない', 500);
    $src = substr($src, 0, $pos) . $entry . substr($src, $pos);
    if (@file_put_contents($path, $src) === false) {
        throw new ApiException('io_error', 'config.php 書き込み失敗', 500);
    }
    json_response(['ok' => true]);
}

function overleaf_admin_verify(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    // config を再読込 (cookie 更新直後でも反映)
    $latest = require _OVERLEAF_CONFIG_PATH;
    $cookie = $latest['overleaf']['olauth_cookie'] ?? '';
    if ($cookie === '') {
        json_response(['ok' => false, 'reason' => 'cookie が未設定']);
        return;
    }
    if (!function_exists('curl_init')) {
        json_response(['ok' => false, 'reason' => 'PHP curl がない']);
        return;
    }
    $ch = curl_init('https://www.overleaf.com/project');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER     => ['Cookie: overleaf_session2=' . $cookie, 'User-Agent: Mozilla/5.0'],
        CURLOPT_TIMEOUT        => 15,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        json_response(['ok' => false, 'reason' => 'HTTP リクエスト失敗: ' . $err]);
        return;
    }
    $valid = ((int)$code === 200 && strpos((string)$resp, 'ol-prefetchedProjectsBlob') !== false);
    json_response([
        'ok'        => $valid,
        'http_code' => (int)$code,
        'reason'    => $valid ? 'cookie 有効' : '無効 (login にリダイレクトされた可能性、cookie 期限切れか取り違え)',
    ]);
}

function overleaf_admin_run(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    $venv = '/var/www/labpay/.venv-overleaf/bin/python';
    $script = '/var/www/labpay/scripts/overleaf_collector.py';
    if (!is_file($venv))   { throw new ApiException('not_found', 'venv 未セットアップ: ' . $venv, 500); }
    if (!is_file($script)) { throw new ApiException('not_found', 'collector script 不在', 500); }
    $log = '/tmp/overleaf_collect_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.log';
    // detach 起動 (戻りを待たない)
    $cmd = "nohup $venv $script > " . escapeshellarg($log) . " 2>&1 & echo $!";
    $pid = (int)trim((string)shell_exec($cmd));
    json_response(['ok' => true, 'pid' => $pid, 'log' => $log]);
}

function overleaf_admin_runs(PDO $pdo, array $cfg): void {
    _overleaf_require_admin($pdo, $cfg);
    $rows = $pdo->query("SELECT id, started_at, finished_at, ok, projects_seen, error_msg
        FROM overleaf_collector_runs ORDER BY id DESC LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
    $items = [];
    foreach ($rows as $r) {
        $items[] = [
            'id'            => (int)$r['id'],
            'started_at'    => $r['started_at'],
            'finished_at'   => $r['finished_at'],
            'ok'            => (int)$r['ok'] === 1,
            'projects_seen' => (int)$r['projects_seen'],
            'error_msg'     => $r['error_msg'],
        ];
    }
    json_response(['items' => $items]);
}
