<?php
// /api/cosense — Cosense (旧 Scrapbox) v2 REST API 連携。 認証 は 各 ユーザ の PAT (Personal Access
//   Token, ヘッダ x-personal-access-token) を 優先。 PAT 未 登録 の 場合 は legacy connect.sid
//   cookie (users.cosense_session_cookie or config の 共有 cookie) で 旧 API を 叩いて 読み取り のみ。
//
//   研究 ノート ページ 名 規則 (https://github.com/nkmr-lab/scrapbox-helper-for-nkmrlab):
//     Page 名: YYYY.MM_研究ノート_<scrapbox_handle>
//     日付 ヘッダ: [*( YYYY.MM.DD ...)]
//
//   GET  /api/cosense/research-note?ym=YYYY.MM    今月 / 指定 月 の 自分 の ページ
//   GET  /api/cosense/research-note/days?count=2  直近 N 日 セクション 抽出 (今日 / 昨日)
//   POST /api/cosense/research-note/append        今日 セクション に 追記 (PAT 必須)
//   GET  /api/cosense/page?title=...              任意 ページ
//   GET  /api/cosense/me/status                   自分 の cookie/PAT 設定 状況
//   PATCH /api/cosense/me/cookie  {cookie:"s%3A..."}  自分 の cookie を 設定 (legacy)
//   PATCH /api/cosense/me/pat     {pat:"..."}         自分 の PAT を 設定 (推奨)
declare(strict_types=1);

function route_cosense(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';
    if ($sub === 'research-note' && $method === 'GET' && !isset($seg[2])) {
        cosense_my_research_note($pdo, $cfg, $uid); return;
    }
    if ($sub === 'research-note' && $method === 'GET' && ($seg[2] ?? '') === 'days') {
        cosense_my_research_note_days($pdo, $cfg, $uid); return;
    }
    if ($sub === 'research-note' && $method === 'POST' && ($seg[2] ?? '') === 'append') {
        cosense_research_note_append($pdo, $cfg, $uid); return;
    }
    if ($sub === 'page' && $method === 'GET') {
        cosense_page_text($pdo, $cfg, $uid); return;
    }
    if ($sub === 'me' && $method === 'GET' && ($seg[2] ?? '') === 'status') {
        cosense_me_status($pdo, $cfg, $uid); return;
    }
    if ($sub === 'me' && $method === 'PATCH' && ($seg[2] ?? '') === 'cookie') {
        cosense_me_set_cookie($pdo, $uid); return;
    }
    if ($sub === 'me' && $method === 'PATCH' && ($seg[2] ?? '') === 'pat') {
        cosense_me_set_pat($pdo, $uid); return;
    }
    if ($sub === 'me' && $method === 'PATCH' && ($seg[2] ?? '') === 'page-handle') {
        cosense_me_set_page_handle($pdo, $uid); return;
    }
    json_error('not_found', "no cosense route for $method $sub", 404);
}

// ───────── helpers ─────────

function cosense_base(array $cfg): string {
    return (string)($cfg['cosense']['base_url'] ?? 'https://scrapbox.io');
}
function cosense_project(array $cfg): string {
    return (string)($cfg['cosense']['project'] ?? 'nkmr-lab');
}
function cosense_shared_cookie(array $cfg): ?string {
    $c = trim((string)($cfg['cosense']['session_cookie'] ?? ''));
    return $c !== '' ? $c : null;
}
function cosense_user_cookie(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT cosense_session_cookie FROM users WHERE id=?");
    $st->execute([$uid]);
    $c = trim((string)($st->fetchColumn() ?: ''));
    return $c !== '' ? $c : null;
}
function cosense_user_pat(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT cosense_pat FROM users WHERE id=?");
    $st->execute([$uid]);
    $c = trim((string)($st->fetchColumn() ?: ''));
    return $c !== '' ? $c : null;
}
// v825 Cosense page 名 に 使う handle。 優先 順:
//   1) users.cosense_page_handle (個別 設定、 例: 「中村聡史」)
//   2) users.display_name (LabPay 表示名、 通常 これ が Cosense 表示名 と 同じ)
//   3) user_scrapbox_handles.scrapbox_name (Slack 同期 用、 英語 名 の こと も ある)
function cosense_user_handle(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT cosense_page_handle, display_name FROM users WHERE id=?");
    $st->execute([$uid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    $h = trim((string)($r['cosense_page_handle'] ?? ''));
    if ($h !== '') return $h;
    $dn = trim((string)($r['display_name'] ?? ''));
    if ($dn !== '') return $dn;
    $st2 = $pdo->prepare("SELECT scrapbox_name FROM user_scrapbox_handles WHERE user_id=?");
    $st2->execute([$uid]);
    $sn = trim((string)($st2->fetchColumn() ?: ''));
    return $sn !== '' ? $sn : null;
}

// 内部 helper: HTTP 共通 curl ラッパー。
function cosense_http(string $method, string $url, array $opts = []): array {
    $headers = ['User-Agent: LabPay/cosense-client', 'Accept: application/json'];
    if (!empty($opts['pat'])) {
        $headers[] = 'x-personal-access-token: ' . $opts['pat'];
    }
    if (!empty($opts['json'])) {
        $headers[] = 'Content-Type: application/json';
        $body = json_encode($opts['json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } else {
        $body = null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    if (!empty($opts['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, 'connect.sid=' . $opts['cookie']);
    }
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => (string)$resp, 'err' => $err];
}

// v2 API で ページ を 取得 (json)。 PAT 必須。 構造: { title, lines: [{id, text}], ... }
function cosense_v2_get_page(array $cfg, string $title, string $pat): array {
    $url = cosense_base($cfg) . '/api/pages/v2/' . rawurlencode(cosense_project($cfg))
         . '/' . rawurlencode($title);
    $res = cosense_http('GET', $url, ['pat' => $pat]);
    if ($res['status'] === 200) {
        $j = json_decode($res['body'], true);
        return ['ok' => true, 'page' => is_array($j) ? $j : null, 'status' => 200];
    }
    return ['ok' => false, 'status' => $res['status'], 'err' => $res['body']];
}

// v2 API で preview → submit して commit する。 changes は 配列。
function cosense_v2_commit(array $cfg, string $pat, ?string $pageId, array $changes): array {
    $base = cosense_base($cfg) . '/api/pages/v2/' . rawurlencode(cosense_project($cfg));
    $previewBody = $pageId !== null
        ? ['pageId' => $pageId, 'changes' => $changes]
        : ['changes' => $changes];
    $p = cosense_http('POST', $base . '/page-edit-for-ai/preview', ['pat' => $pat, 'json' => $previewBody]);
    if ($p['status'] !== 200) {
        return ['ok' => false, 'stage' => 'preview', 'status' => $p['status'], 'body' => $p['body']];
    }
    $pj = json_decode($p['body'], true);
    $previewId = is_array($pj) ? ($pj['previewId'] ?? null) : null;
    if (!$previewId) return ['ok' => false, 'stage' => 'preview', 'reason' => 'no previewId', 'body' => $p['body']];
    $s = cosense_http('POST', $base . '/page-edit-for-ai/submit', ['pat' => $pat, 'json' => ['previewId' => $previewId]]);
    if ($s['status'] !== 200) {
        return ['ok' => false, 'stage' => 'submit', 'status' => $s['status'], 'body' => $s['body']];
    }
    $sj = json_decode($s['body'], true);
    return ['ok' => true, 'commitId' => $sj['commitId'] ?? null, 'page' => $sj['page'] ?? null];
}

// 旧 API (text endpoint) で ページ text を 取得 (cookie 経由、 PAT 不要)。
function cosense_legacy_get_text(array $cfg, string $title, ?string $cookie): array {
    $url = cosense_base($cfg) . '/api/pages/' . rawurlencode(cosense_project($cfg))
         . '/' . rawurlencode($title) . '/text';
    $res = cosense_http('GET', $url, ['cookie' => $cookie]);
    return [
        'status' => $res['status'],
        'text'   => $res['status'] === 200 ? $res['body'] : null,
    ];
}

// 「ページ text を ロード」 の 統一 経路。 PAT が あれば v2 から lines を text に 復元、
// 無ければ legacy cookie で text を 取る。
function cosense_load_page_text(PDO $pdo, array $cfg, int $uid, string $title): array {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat !== null) {
        $r = cosense_v2_get_page($cfg, $title, $pat);
        if ($r['ok']) {
            $lines = $r['page']['lines'] ?? [];
            $text = '';
            foreach ($lines as $ln) {
                $text .= ($text === '' ? '' : "\n") . (string)($ln['text'] ?? '');
            }
            return [
                'source' => 'v2-pat',
                'status' => 200,
                'text'   => $text,
                'page'   => $r['page'],
                'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
            ];
        }
        // PAT で 失敗 (404 等) → 空 として 扱う
        return [
            'source' => 'v2-pat',
            'status' => $r['status'],
            'text'   => null,
            'page'   => null,
            'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
            'err'    => $r['err'] ?? null,
        ];
    }
    // legacy fallback (cookie)
    $cookie = cosense_user_cookie($pdo, $uid) ?? cosense_shared_cookie($cfg);
    if ($cookie === null) {
        return ['source' => 'none', 'status' => 0, 'text' => null, 'page' => null,
            'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title)];
    }
    $r = cosense_legacy_get_text($cfg, $title, $cookie);
    return [
        'source' => 'legacy-cookie',
        'status' => $r['status'],
        'text'   => $r['text'],
        'page'   => null,
        'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
    ];
}

// ───────── handlers ─────────

function cosense_my_research_note(PDO $pdo, array $cfg, int $uid): void {
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        json_response(['has_handle' => false, 'message' => 'Scrapbox handle 未 登録 (admin 経由 で 登録 を)']);
        return;
    }
    $ym = (string)($_GET['ym'] ?? date('Y.m'));
    if (!preg_match('/^20\d{2}\.\d{2}$/', $ym)) {
        throw new ApiException('bad_request', 'ym は YYYY.MM 形式', 400);
    }
    $title = $ym . '_研究ノート_' . $handle;
    $r = cosense_load_page_text($pdo, $cfg, $uid, $title);
    json_response([
        'has_handle' => true,
        'handle'     => $handle,
        'ym'         => $ym,
        'title'      => $title,
        'page_url'   => $r['page_url'],
        'status'     => $r['status'],
        'text'       => $r['text'],
        'source'     => $r['source'],
    ]);
}

function cosense_my_research_note_days(PDO $pdo, array $cfg, int $uid): void {
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        json_response(['has_handle' => false, 'message' => 'Scrapbox handle 未 登録 (admin 経由 で 登録 を)']);
        return;
    }
    $count = max(1, min(31, (int)($_GET['count'] ?? 2)));
    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    $thisYm = $now->format('Y.m');
    $lastYm = $now->modify('first day of previous month')->format('Y.m');
    $titles = [
        $thisYm . '_研究ノート_' . $handle,
        $lastYm . '_研究ノート_' . $handle,
    ];

    $combined = '';
    $pages = [];
    $sourceAny = 'none';
    foreach ($titles as $title) {
        $r = cosense_load_page_text($pdo, $cfg, $uid, $title);
        $sourceAny = $r['source'];
        $pages[] = [
            'title'    => $title,
            'page_url' => $r['page_url'],
            'status'   => $r['status'],
            'has_text' => $r['text'] !== null && $r['text'] !== '',
        ];
        if ($r['text']) {
            $combined .= ($combined !== '' ? "\n" : '') . $r['text'];
        }
    }
    $sections = cosense_split_by_date_header($combined);
    usort($sections, fn($a, $b) => strcmp($b['date'], $a['date']));
    $recent = array_slice($sections, 0, $count);

    $hasPat = cosense_user_pat($pdo, $uid) !== null;
    $hasCookie = cosense_user_cookie($pdo, $uid) !== null;
    $hasShared = cosense_shared_cookie($cfg) !== null;

    json_response([
        'has_handle'    => true,
        'handle'        => $handle,
        'cookie_present'=> $hasPat || $hasCookie || $hasShared,
        'cookie_source' => $hasPat ? 'self-pat' : ($hasCookie ? 'self-cookie' : ($hasShared ? 'shared-cookie' : 'none')),
        'pages'         => $pages,
        'recent'        => $recent,
        'today'         => $now->format('Y.m.d'),
        'yesterday'     => $now->modify('-1 day')->format('Y.m.d'),
        'can_write'     => $hasPat,
    ]);
}

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

function cosense_page_text(PDO $pdo, array $cfg, int $uid): void {
    $title = trim((string)($_GET['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) {
        throw new ApiException('bad_request', 'title 1..300', 400);
    }
    $r = cosense_load_page_text($pdo, $cfg, $uid, $title);
    json_response([
        'title'    => $title,
        'page_url' => $r['page_url'],
        'status'   => $r['status'],
        'text'     => $r['text'],
        'source'   => $r['source'],
    ]);
}

// POST /api/cosense/research-note/append
//   body = { date: "YYYY.MM.DD", text: "本文" }
//   today なら 当月 ページ、 yesterday なら 当月 or 先月 を 自動 判定 して append。
function cosense_research_note_append(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Cosense PAT が 未 登録 で す。 設定 → Cosense 連携 で 登録 して ください', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', 'Scrapbox handle 未 登録 (admin 経由 で 登録 を)', 412);
    }
    $body = read_json_body();
    $date = trim((string)($body['date'] ?? ''));
    if (!preg_match('/^(20\d{2})\.(\d{2})\.(\d{2})$/', $date, $m)) {
        throw new ApiException('bad_request', 'date は YYYY.MM.DD', 400);
    }
    $text = (string)($body['text'] ?? '');
    if ($text === '' || mb_strlen($text) > 20000) {
        throw new ApiException('bad_request', 'text 1..20000', 400);
    }
    $ym = $m[1] . '.' . $m[2];
    $title = $ym . '_研究ノート_' . $handle;

    // ページ を 取得 して lines + pageId を 取り出す
    $r = cosense_v2_get_page($cfg, $title, $pat);
    $existsPage = $r['ok'];
    $pageId = $existsPage ? ($r['page']['id'] ?? null) : null;
    $lines = $existsPage ? ($r['page']['lines'] ?? []) : [];

    // 日付 ヘッダ 行 が ある か 探す
    $dateRe = '/^\[\*\(\s*' . preg_quote($date, '/') . '/u';
    $headerLineId = null;
    $nextDateLineId = null;
    foreach ($lines as $i => $ln) {
        $t = (string)($ln['text'] ?? '');
        if (preg_match($dateRe, $t)) {
            $headerLineId = $ln['id'] ?? null;
            // この ヘッダ の 「次 の 日付 ヘッダ 行 の id」 を 探す = ここ より 後 の 最初 の 日付 ヘッダ
            for ($j = $i + 1; $j < count($lines); $j++) {
                $tj = (string)($lines[$j]['text'] ?? '');
                if (preg_match('/^\[\*\(\s*20\d{2}\.\d{2}\.\d{2}/u', $tj)) {
                    $nextDateLineId = $lines[$j]['id'] ?? null;
                    break;
                }
            }
            break;
        }
    }

    // 入力 text を 行 分解 + 各 行 に id を 振る
    $bodyLines = preg_split('/\r?\n/', $text);
    $now = time();
    $changes = [];
    $makeLineId = function (int $i) use ($now): string {
        // Cosense の lineId は 24 桁 hex の よう な もの。 簡易 に random で 生成。
        return bin2hex(random_bytes(12));
    };

    if ($headerLineId === null) {
        // 日付 ヘッダ ごと 新規 に 末尾 へ 追加
        $wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][((int)date('w', strtotime($date)))];
        $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(0), 'text' => sprintf('[*( %s %s )]', $date, $wd)]];
        foreach ($bodyLines as $i => $bl) {
            $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId($i + 1), 'text' => ' ' . $bl]];
        }
    } else {
        // 既存 の 日付 ヘッダ 直下 (= 次 の 日付 ヘッダ の 前) に 挿入
        $anchor = $nextDateLineId ?? '_end';
        foreach ($bodyLines as $i => $bl) {
            $changes[] = ['_insert' => $anchor, 'lines' => ['id' => $makeLineId($i), 'text' => ' ' . $bl]];
        }
    }

    if ($pageId === null && $existsPage) {
        throw new ApiException('internal', 'pageId が 取れ ません でした', 500);
    }

    $c = cosense_v2_commit($cfg, $pat, $pageId, $changes);
    if (!$c['ok']) {
        json_response_no_exit([
            'ok' => false,
            'stage' => $c['stage'] ?? 'unknown',
            'status' => $c['status'] ?? null,
            'body' => $c['body'] ?? null,
            'reason' => $c['reason'] ?? null,
        ], 502);
        return;
    }
    json_response([
        'ok' => true,
        'commitId' => $c['commitId'],
        'page'     => $c['page'],
        'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
        'inserted_lines' => count($changes),
    ]);
}

// ───────── me settings ─────────

function cosense_me_status(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    $cookie = cosense_user_cookie($pdo, $uid);
    // page handle の 内訳 (どこ から 来て いる か)
    $stu = $pdo->prepare("SELECT cosense_page_handle, display_name FROM users WHERE id=?");
    $stu->execute([$uid]);
    $r = $stu->fetch(PDO::FETCH_ASSOC) ?: [];
    json_response([
        'has_pat'          => $pat !== null,
        'pat_tail'         => $pat !== null ? mb_substr($pat, -6) : null,
        'has_self_cookie'  => $cookie !== null,
        'self_cookie_tail' => $cookie !== null ? mb_substr($cookie, -6) : null,
        'has_shared_cookie'=> cosense_shared_cookie($cfg) !== null,
        'handle'                 => cosense_user_handle($pdo, $uid),
        'page_handle_explicit'   => $r['cosense_page_handle'] ?? null,
        'display_name_fallback'  => $r['display_name'] ?? null,
        'pat_settings_url'       => cosense_base($cfg) . '/settings/personal-access-tokens',
    ]);
}

function cosense_me_set_cookie(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $c = trim((string)($body['cookie'] ?? ''));
    if ($c !== '') {
        if (mb_strlen($c) > 500) throw new ApiException('bad_request', 'cookie が 長過ぎ ます', 400);
        if (!str_starts_with($c, 's%3A') && !str_starts_with($c, 's:')) {
            throw new ApiException('bad_request', 'connect.sid 値 (s%3A... で 始まる 文字列) を 貼って ください', 400);
        }
    } else {
        $c = null;
    }
    $pdo->prepare("UPDATE users SET cosense_session_cookie=? WHERE id=?")->execute([$c, $uid]);
    json_response(['ok' => true, 'has_self_cookie' => $c !== null]);
}

function cosense_me_set_pat(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $p = trim((string)($body['pat'] ?? ''));
    if ($p !== '') {
        if (mb_strlen($p) < 8) {
            throw new ApiException('bad_request', '鍵が短すぎます (8文字以上)', 400);
        }
        if (mb_strlen($p) > 500) {
            throw new ApiException('bad_request', '鍵が長すぎます (500文字以下)', 400);
        }
        // 印字可能ASCII (0x21〜0x7E、=や+や/含む) のみ。 空白文字や日本語の混入だけ弾く。
        if (!preg_match('/^[\x21-\x7E]+$/', $p)) {
            throw new ApiException('bad_request', '鍵に空白や記号以外の文字が混ざっています。 もう一度コピーし直してください', 400);
        }
    } else {
        $p = null;
    }
    $pdo->prepare("UPDATE users SET cosense_pat=? WHERE id=?")->execute([$p, $uid]);
    json_response(['ok' => true, 'has_pat' => $p !== null]);
}

function cosense_me_set_page_handle(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $h = trim((string)($body['handle'] ?? ''));
    if ($h !== '') {
        if (mb_strlen($h) > 100) throw new ApiException('bad_request', 'handle は 100 文字 以内', 400);
        if (preg_match('/[\/\\\\\\r\\n\\t]/u', $h)) throw new ApiException('bad_request', '/ \\ 改行 タブ は 使えません', 400);
    } else {
        $h = null;
    }
    $pdo->prepare("UPDATE users SET cosense_page_handle=? WHERE id=?")->execute([$h, $uid]);
    json_response(['ok' => true, 'has_page_handle' => $h !== null, 'effective' => cosense_user_handle($pdo, $uid)]);
}
