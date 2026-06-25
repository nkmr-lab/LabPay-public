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
    // v830 #editable 当日セクションを丸ごとロード + 差分保存 する 2 endpoint
    if ($sub === 'research-note' && $method === 'GET' && ($seg[2] ?? '') === 'section') {
        cosense_research_note_section_get($pdo, $cfg, $uid); return;
    }
    if ($sub === 'research-note' && $method === 'POST' && ($seg[2] ?? '') === 'replace-section') {
        cosense_research_note_section_replace($pdo, $cfg, $uid); return;
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
        cosense_me_set_pat($pdo, $cfg, $uid); return;
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

    // v829 #418 「日付ヘッダの直下、 既存内容があればその末尾」 = 「今日の日付セクションの末尾」 に挿入する。
    //
    //   1. 日付ヘッダ行を探す (= [*( YYYY.MM.DD ...)])
    //   2. ヘッダの次の行から、 次の日付ヘッダが現れるまでスキャン
    //      → その「次の日付ヘッダ」 の前 = 現セクションの末尾
    //   3. 次の日付ヘッダがなければ `_end` (= ページ末尾) を anchor に
    //   4. 日付ヘッダ自体が存在しなければ、 ヘッダ + 内容を全部ページ末尾に追加
    $dateRe = '/^\[\*\(\s*' . preg_quote($date, '/') . '/u';
    $headerLineId = null;
    $nextDateLineId = null;
    foreach ($lines as $i => $ln) {
        $t = (string)($ln['text'] ?? '');
        if (preg_match($dateRe, $t)) {
            $headerLineId = $ln['id'] ?? null;
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
    $changes = [];
    $makeLineId = function (): string {
        // Cosense の lineId は ランダム 16進。 12 byte = 24 桁 hex。
        return bin2hex(random_bytes(12));
    };

    // anchor 決定: ヘッダなしならヘッダごと末尾、 ありなら現セクションの末尾。
    if ($headerLineId === null) {
        $wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][((int)date('w', strtotime($date)))];
        $headerNewId = $makeLineId();
        $changes[] = ['_insert' => '_end', 'lines' => ['id' => $headerNewId, 'text' => sprintf('[*( %s %s )]', $date, $wd)]];
        foreach ($bodyLines as $bl) {
            $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(), 'text' => ' ' . $bl]];
        }
    } else {
        // 「セクションの末尾」 = 次の日付ヘッダの直前。 次がなければページ末尾。
        $anchor = $nextDateLineId ?? '_end';
        foreach ($bodyLines as $bl) {
            // 順次評価: 同じ anchor の前に挿入を繰り返すと、 結果的に anchor の直前に
            //   入れた順番で並ぶ (Cosense API はこの順番を保つ)。
            $changes[] = ['_insert' => $anchor, 'lines' => ['id' => $makeLineId(), 'text' => ' ' . $bl]];
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

// ───────── editable section (v830) ─────────

// 指定日のセクション (= [*( YYYY.MM.DD ...)] ヘッダの直下から、次の日付ヘッダの直前まで) を
//   ヘッダを除く本文行だけの配列 + テキスト形式 で返す。 textarea のロード元。
function cosense_research_note_section_get(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Scrapbox の鍵が未登録です', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', '研究ノートの名前 (handle) が未設定', 412);
    }
    $date = trim((string)($_GET['date'] ?? ''));
    if (!preg_match('/^20\d{2}\.\d{2}\.\d{2}$/', $date)) {
        throw new ApiException('bad_request', 'date は YYYY.MM.DD', 400);
    }
    $ym = substr($date, 0, 7);
    $title = $ym . '_研究ノート_' . $handle;
    $r = cosense_v2_get_page($cfg, $title, $pat);
    $existsPage = $r['ok'];
    $pageId = $existsPage ? ($r['page']['id'] ?? null) : null;
    $allLines = $existsPage ? ($r['page']['lines'] ?? []) : [];

    [$headerIdx, $headerLineId, $nextAnchorId, $bodyLines] = cosense_locate_section($allLines, $date);

    json_response([
        'ok' => true,
        'title' => $title,
        'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
        'date' => $date,
        'exists_page' => $existsPage,
        'exists_section' => $headerIdx >= 0,
        'page_id' => $pageId,
        'header_line_id' => $headerLineId,
        'next_anchor' => $nextAnchorId,
        'lines' => $bodyLines,
        'body_text' => implode("\n", array_column($bodyLines, 'text')),
    ]);
}

// 指定日のセクション本文を新しい text で置き換える (= 差分のみコミット)。
//   body = { date: "YYYY.MM.DD", text: "改行区切り の 新 本文" }
//   text の各行は そのまま Cosense に書き込まれる (=リード スペース等もユーザー入力をそのまま使用)。
function cosense_research_note_section_replace(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Scrapbox の鍵が未登録です', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', '研究ノートの名前 (handle) が未設定', 412);
    }
    $body = read_json_body();
    $date = trim((string)($body['date'] ?? ''));
    if (!preg_match('/^(20\d{2})\.(\d{2})\.(\d{2})$/', $date, $m)) {
        throw new ApiException('bad_request', 'date は YYYY.MM.DD', 400);
    }
    $newText = (string)($body['text'] ?? '');
    if (mb_strlen($newText) > 50000) {
        throw new ApiException('bad_request', '本文が長すぎます (50000 文字以内)', 400);
    }
    $ym = $m[1] . '.' . $m[2];
    $title = $ym . '_研究ノート_' . $handle;
    $r = cosense_v2_get_page($cfg, $title, $pat);
    $existsPage = $r['ok'];
    $pageId = $existsPage ? ($r['page']['id'] ?? null) : null;
    $allLines = $existsPage ? ($r['page']['lines'] ?? []) : [];
    [$headerIdx, $headerLineId, $nextAnchorId, $oldBodyLines] = cosense_locate_section($allLines, $date);

    // 新しい text を行分解。 末尾の空行は削る (UI 側で余計な空行が付くのを防ぐ)。
    $newLines = preg_split('/\r?\n/', $newText);
    while (count($newLines) > 0 && trim((string)end($newLines)) === '') {
        array_pop($newLines);
    }
    $makeLineId = fn () => bin2hex(random_bytes(12));
    $changes = [];
    $stats = ['inserts' => 0, 'updates' => 0, 'deletes' => 0, 'header_created' => false];

    if ($headerIdx < 0) {
        // セクションがない → ヘッダ + 内容を末尾に追加
        if (count($newLines) === 0) {
            json_response(['ok' => true, 'noop' => true, 'message' => '内容が空のためスキップ']);
            return;
        }
        $wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][(int)date('w', strtotime($date))];
        $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(), 'text' => sprintf('[*( %s %s )]', $date, $wd)]];
        $stats['header_created'] = true;
        foreach ($newLines as $bl) {
            $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(), 'text' => $bl]];
            $stats['inserts']++;
        }
    } else {
        // 既存セクション → 行ごとに diff (greedy by-index)
        $anchor = $nextAnchorId ?? '_end';
        $nOld = count($oldBodyLines);
        $nNew = count($newLines);
        $minN = min($nOld, $nNew);
        for ($i = 0; $i < $minN; $i++) {
            if ((string)$oldBodyLines[$i]['text'] !== (string)$newLines[$i]) {
                $changes[] = ['_update' => $oldBodyLines[$i]['id'], 'lines' => ['text' => $newLines[$i]]];
                $stats['updates']++;
            }
        }
        for ($i = $minN; $i < $nNew; $i++) {
            $changes[] = ['_insert' => $anchor, 'lines' => ['id' => $makeLineId(), 'text' => $newLines[$i]]];
            $stats['inserts']++;
        }
        for ($i = $minN; $i < $nOld; $i++) {
            $changes[] = ['_delete' => $oldBodyLines[$i]['id']];
            $stats['deletes']++;
        }
        if (empty($changes)) {
            json_response(['ok' => true, 'noop' => true, 'message' => '変更なし']);
            return;
        }
    }

    if ($pageId === null && $existsPage) {
        throw new ApiException('internal', 'pageId が取れません', 500);
    }
    $c = cosense_v2_commit($cfg, $pat, $pageId, $changes);
    if (!$c['ok']) {
        json_response_no_exit([
            'ok' => false,
            'stage' => $c['stage'] ?? 'unknown',
            'status' => $c['status'] ?? null,
            'body' => $c['body'] ?? null,
        ], 502);
        return;
    }
    json_response([
        'ok' => true,
        'commitId' => $c['commitId'],
        'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
        'stats' => $stats,
        'change_count' => count($changes),
    ]);
}

// 指定日の セクション を $allLines から探す。
// 返り値: [headerIdx, headerLineId, nextAnchorId, bodyLines]
//   headerIdx     : ヘッダ行のインデックス。 見つからなければ -1
//   headerLineId  : ヘッダ行の id (null も可)
//   nextAnchorId  : 「次の日付ヘッダ」 の id (= セクション末尾 anchor)。 次がなければ null
//   bodyLines     : [{id, text}, ...] ヘッダを除く本文行
function cosense_locate_section(array $allLines, string $date): array {
    $dateRe = '/^\[\*\(\s*' . preg_quote($date, '/') . '/u';
    $headerIdx = -1;
    $headerLineId = null;
    $nextAnchorId = null;
    $bodyLines = [];
    foreach ($allLines as $i => $ln) {
        $t = (string)($ln['text'] ?? '');
        if ($headerIdx === -1) {
            if (preg_match($dateRe, $t)) {
                $headerIdx = $i;
                $headerLineId = $ln['id'] ?? null;
            }
            continue;
        }
        // header 見つかった後
        if (preg_match('/^\[\*\(\s*20\d{2}\.\d{2}\.\d{2}/u', $t)) {
            $nextAnchorId = $ln['id'] ?? null;
            break;
        }
        $bodyLines[] = ['id' => $ln['id'] ?? '', 'text' => $t];
    }
    return [$headerIdx, $headerLineId, $nextAnchorId, $bodyLines];
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

function cosense_me_set_pat(PDO $pdo, array $cfg, int $uid): void {
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

    // v829 #418 保存と同時に「実際に Cosense で読み取りできるか」をテスト。
    //   貼り付け後すぐ入力欄が空になるので、 toast に結果を出して安心感を与える。
    $test = null;
    if ($p !== null) {
        $handle = cosense_user_handle($pdo, $uid);
        if ($handle !== null) {
            $title = date('Y.m') . '_研究ノート_' . $handle;
            $r = cosense_v2_get_page($cfg, $title, $p);
            if ($r['ok']) {
                $linesN = is_array($r['page']['lines'] ?? null) ? count($r['page']['lines']) : 0;
                $test = ['ok' => true, 'message' => '✅ 読み取り成功 (' . $title . ' を ' . $linesN . ' 行取得)'];
            } else {
                $status = $r['status'] ?? '?';
                $hint = $status === 401 ? '鍵が無効か期限切れ' : ($status === 404 ? 'ページがまだ存在しないだけ (= 鍵自体は OK)' : ('HTTP ' . $status));
                $test = ['ok' => $status === 404, 'status' => $status, 'message' => $status === 404
                    ? '☑ 鍵は有効 (' . $title . ' はまだ未作成)'
                    : '⚠ 読み取り失敗: ' . $hint];
            }
        } else {
            $test = ['ok' => false, 'message' => 'handle が未設定のためテスト省略'];
        }
    }

    json_response([
        'ok' => true,
        'has_pat' => $p !== null,
        'pat_tail' => $p !== null ? mb_substr($p, -6) : null,
        'test' => $test,
    ]);
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
