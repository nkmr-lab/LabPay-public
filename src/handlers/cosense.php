<?php
// /api/cosense — Cosense (旧 Scrapbox) REST API 連携。 nkmr-lab project は private な ので
//   config.php の cosense.session_cookie (connect.sid 値) で 認証 する。
//   研究 ノート ページ 名 規則: 「YYYY.MM_研究ノート_<scrapbox_handle>」、 日付 ヘッダ: 「[*( YYYY.MM.DD ...)]」
//   GET  /api/cosense/research-note?ym=YYYY.MM   今月 or 指定 月 の 自分 の 研究ノート 1 件
//   GET  /api/cosense/research-note/days?count=2 直近 N 日 の 日付 セクション を 抽出 (今日 / 昨日)
//   GET  /api/cosense/page?title=...             任意 ページ の text を 取得 (admin or dev)
declare(strict_types=1);

function route_cosense(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === 'research-note' && $method === 'GET' && !isset($seg[2])) {
        cosense_my_research_note($pdo, $cfg, (int)$u['id']);
        return;
    }
    if ($sub === 'research-note' && $method === 'GET' && ($seg[2] ?? '') === 'days') {
        cosense_my_research_note_days($pdo, $cfg, (int)$u['id']);
        return;
    }
    if ($sub === 'research-note' && $method === 'POST' && ($seg[2] ?? '') === 'append') {
        cosense_research_note_append($pdo, $cfg, (int)$u['id']);
        return;
    }
    if ($sub === 'page' && $method === 'GET') {
        cosense_page_text($pdo, $cfg);
        return;
    }
    // v822 自分 の Cosense cookie を 登録 / 更新 / 解除
    if ($sub === 'me' && $method === 'GET' && ($seg[2] ?? '') === 'status') {
        cosense_me_status($pdo, $cfg, (int)$u['id']);
        return;
    }
    if ($sub === 'me' && $method === 'PATCH' && ($seg[2] ?? '') === 'cookie') {
        cosense_me_set_cookie($pdo, (int)$u['id']);
        return;
    }
    json_error('not_found', "no cosense route for $method $sub", 404);
}

// 自分 の cookie 設定 状況 を 返す
function cosense_me_status(PDO $pdo, array $cfg, int $uid): void {
    $c = cosense_user_cookie($pdo, $uid);
    json_response([
        'has_self_cookie'    => $c !== null,
        'self_cookie_tail'   => $c !== null ? mb_substr($c, -6) : null,
        'has_shared_cookie'  => cosense_cookie($cfg) !== null,
        'handle'             => cosense_user_handle($pdo, $uid),
    ]);
}

// 自分 の cookie を 設定 / 削除。 body = { cookie: "s%3A..." | "" }
function cosense_me_set_cookie(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $c = trim((string)($body['cookie'] ?? ''));
    if ($c !== '') {
        // 簡易 バリデ: connect.sid は s%3A から 始まる 長い 文字列
        if (mb_strlen($c) > 500) throw new ApiException('bad_request', 'cookie が 長過ぎ ます', 400);
        if (!str_starts_with($c, 's%3A') && !str_starts_with($c, 's:')) {
            throw new ApiException('bad_request', 'connect.sid 値 (s%3A... で 始まる 文字列) を 貼り 付けて ください', 400);
        }
    } else {
        $c = null;
    }
    $pdo->prepare("UPDATE users SET cosense_session_cookie=? WHERE id=?")->execute([$c, $uid]);
    json_response(['ok' => true, 'has_self_cookie' => $c !== null]);
}

// v822 Phase B 用 stub: 書き込み エンドポイント (実装 は 別 turn)。
function cosense_research_note_append(PDO $pdo, array $cfg, int $uid): void {
    $cookie = cosense_user_cookie($pdo, $uid);
    if ($cookie === null) {
        throw new ApiException('precondition', '本人 の Cosense cookie が 未 登録 です。 設定 → Cosense 連携 で 登録 して ください', 412);
    }
    throw new ApiException('not_implemented', 'サーバ 経由 の Cosense 書き込み は 未 実装 (Socket.io commit 実装 中)。 当面 は 「✏️ Cosense で 書く」 ボタン で 新規 タブ から 書き込んで ください', 501);
}

// Cosense API base URL を 返す。 既定 は https://scrapbox.io。
function cosense_base(array $cfg): string {
    return (string)($cfg['cosense']['base_url'] ?? 'https://scrapbox.io');
}

function cosense_project(array $cfg): string {
    return (string)($cfg['cosense']['project'] ?? 'nkmr-lab');
}

// 共有 (admin) cookie を 取り出す。 未 設定 なら null。
function cosense_cookie(array $cfg): ?string {
    $c = trim((string)($cfg['cosense']['session_cookie'] ?? ''));
    return $c !== '' ? $c : null;
}

// v822 ユーザ 個別 の cookie を 取り出す (= users.cosense_session_cookie)。 未 登録 なら null。
function cosense_user_cookie(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT cosense_session_cookie FROM users WHERE id=?");
    $st->execute([$uid]);
    $c = trim((string)($st->fetchColumn() ?: ''));
    return $c !== '' ? $c : null;
}

// 「読み取り」 で 使う cookie を 決める: 本人 cookie が あれば 本人、 なければ 共有。
function cosense_effective_cookie(PDO $pdo, array $cfg, int $uid): ?string {
    return cosense_user_cookie($pdo, $uid) ?? cosense_cookie($cfg);
}

// scrapbox handle を 引く。 未 登録 なら null。
function cosense_user_handle(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT scrapbox_name FROM user_scrapbox_handles WHERE user_id=?");
    $st->execute([$uid]);
    $h = $st->fetchColumn();
    return $h ? (string)$h : null;
}

// 内部 helper: Cosense API を curl で 叩いて 本文 + status を 返す。
function cosense_http_get(string $url, ?string $cookie): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: LabPay/cosense-client',
            'Accept: */*',
        ],
    ]);
    if ($cookie !== null) {
        curl_setopt($ch, CURLOPT_COOKIE, 'connect.sid=' . $cookie);
    }
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => (string)$body, 'err' => $err];
}

// ページ text 全文 を 取得。 404 なら 空、 401 なら 例外。
function cosense_fetch_page_text(array $cfg, string $title, ?string $cookieOverride = null): array {
    $cookie = $cookieOverride ?? cosense_cookie($cfg);
    $project = cosense_project($cfg);
    $url = cosense_base($cfg) . '/api/pages/' . rawurlencode($project) . '/' . rawurlencode($title) . '/text';
    $res = cosense_http_get($url, $cookie);
    return [
        'status' => $res['status'],
        'text'   => $res['status'] === 200 ? $res['body'] : null,
        'err'    => $res['status'] >= 400 ? ($res['err'] ?: 'HTTP ' . $res['status']) : null,
        'url'    => cosense_base($cfg) . '/' . rawurlencode($project) . '/' . rawurlencode($title),
        'title'  => $title,
        'cookie_present' => $cookie !== null,
    ];
}

// 今月 の (or 指定 月 の) 自分 の 研究ノート ページ を まるごと 返す。
function cosense_my_research_note(PDO $pdo, array $cfg, int $uid): void {
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        json_response([
            'has_handle' => false,
            'message'    => 'Scrapbox handle が 未 登録 です。 admin に 登録 を 依頼 して ください。',
        ]);
        return;
    }
    $ym = (string)($_GET['ym'] ?? date('Y.m'));
    if (!preg_match('/^20\d{2}\.\d{2}$/', $ym)) {
        throw new ApiException('bad_request', 'ym は YYYY.MM 形式 (例: 2026.06)', 400);
    }
    $title = $ym . '_研究ノート_' . $handle;
    $cookie = cosense_effective_cookie($pdo, $cfg, $uid);
    $res = cosense_fetch_page_text($cfg, $title, $cookie);
    json_response([
        'has_handle'  => true,
        'handle'      => $handle,
        'ym'          => $ym,
        'title'       => $res['title'],
        'page_url'    => $res['url'],
        'status'      => $res['status'],
        'text'        => $res['text'],
        'cookie_present' => $res['cookie_present'],
        'cookie_source'  => cosense_user_cookie($pdo, $uid) !== null ? 'self' : 'shared',
        'err'         => $res['err'],
    ]);
}

// 直近 N 日 の 日付 セクション を 抽出 (デフォルト 2 日: 今日 + 昨日)
function cosense_my_research_note_days(PDO $pdo, array $cfg, int $uid): void {
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        json_response(['has_handle' => false, 'message' => 'Scrapbox handle 未 登録']);
        return;
    }
    $count = max(1, min(31, (int)($_GET['count'] ?? 2)));
    // 月 が またぐ ケース に 備え、 今月 + 先月 を 両方 取りに 行く
    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    $thisYm = $now->format('Y.m');
    $lastYm = $now->modify('first day of previous month')->format('Y.m');

    $titles = [
        $thisYm . '_研究ノート_' . $handle,
        $lastYm . '_研究ノート_' . $handle,
    ];

    $cookie = cosense_effective_cookie($pdo, $cfg, $uid);
    $combined = '';
    $pages = [];
    foreach ($titles as $title) {
        $res = cosense_fetch_page_text($cfg, $title, $cookie);
        $pages[] = [
            'title'    => $title,
            'page_url' => $res['url'],
            'status'   => $res['status'],
            'has_text' => $res['text'] !== null && $res['text'] !== '',
        ];
        if ($res['text']) {
            $combined .= ($combined !== '' ? "\n" : '') . $res['text'];
        }
    }

    // 日付 ヘッダ で セクション 分割。 ヘッダ パターン: ^\[\*\(\s*(20\d{2})\.(\d{2})\.(\d{2})
    $sections = cosense_split_by_date_header($combined);
    // 新しい 順 に sort
    usort($sections, fn($a, $b) => strcmp($b['date'], $a['date']));
    // 上位 $count 日 を 返す
    $recent = array_slice($sections, 0, $count);

    json_response([
        'has_handle'     => true,
        'handle'         => $handle,
        'cookie_present' => $cookie !== null,
        'cookie_source'  => cosense_user_cookie($pdo, $uid) !== null ? 'self' : (cosense_cookie($cfg) !== null ? 'shared' : 'none'),
        'pages'          => $pages,
        'recent'         => $recent,
        'today'          => $now->format('Y.m.d'),
        'yesterday'      => $now->modify('-1 day')->format('Y.m.d'),
    ]);
}

// text を 日付 ヘッダ ([* (YYYY.MM.DD ...)]) で 区切って [{date, header, body}] 配列 を 返す。
function cosense_split_by_date_header(string $text): array {
    $lines = preg_split('/\r?\n/', $text);
    $sections = [];
    $cur = null;
    foreach ($lines as $ln) {
        if (preg_match('/^\[\*\(\s*(20\d{2})\.(\d{2})\.(\d{2})/u', $ln, $m)) {
            if ($cur !== null) $sections[] = $cur;
            $cur = [
                'date'   => sprintf('%s.%s.%s', $m[1], $m[2], $m[3]),
                'header' => $ln,
                'body'   => '',
            ];
        } else if ($cur !== null) {
            $cur['body'] .= ($cur['body'] !== '' ? "\n" : '') . $ln;
        }
    }
    if ($cur !== null) $sections[] = $cur;
    return $sections;
}

// 任意 ページ の text を 取得 (admin / debug 用)。
function cosense_page_text(PDO $pdo, array $cfg): void {
    $title = trim((string)($_GET['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) {
        throw new ApiException('bad_request', 'title 1..300', 400);
    }
    $res = cosense_fetch_page_text($cfg, $title);
    json_response([
        'title'         => $res['title'],
        'page_url'      => $res['url'],
        'status'        => $res['status'],
        'text'          => $res['text'],
        'cookie_present'=> $res['cookie_present'],
        'err'           => $res['err'],
    ]);
}
