<?php
// /api/cosense — Cosense (旧 Scrapbox) v2 REST API 連携。 v839 以降、認証は各ユーザの PAT
//   (Personal Access Token, ヘッダ x-personal-access-token) のみ。 legacy connect.sid cookie
//   経路は撤廃済み (鍵だけで十分なため、設定を一本化)。
//
//   研究ノートページ名規則 (https://github.com/nkmr-lab/scrapbox-helper-for-nkmrlab):
//     Page 名: YYYY.MM_研究ノート_<scrapbox_handle>
//     日付ヘッダ: [*( YYYY.MM.DD ...)]
//
//   GET  /api/cosense/research-note?ym=YYYY.MM    今月 / 指定月の自分のページ
//   GET  /api/cosense/research-note/days?count=2  直近 N 日セクション抽出 (今日 / 昨日)
//   POST /api/cosense/research-note/append        今日セクションに追記
//   GET  /api/cosense/page?title=...              任意ページ
//   GET  /api/cosense/me/status                   自分の PAT 設定状況
//   PATCH /api/cosense/me/pat     {pat:"..."}     自分の PAT を設定
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
    // v830 #editable 当日セクションを丸ごとロード + 差分保存する 2 endpoint
    if ($sub === 'research-note' && $method === 'GET' && ($seg[2] ?? '') === 'section') {
        cosense_research_note_section_get($pdo, $cfg, $uid); return;
    }
    if ($sub === 'research-note' && $method === 'POST' && ($seg[2] ?? '') === 'replace-section') {
        cosense_research_note_section_replace($pdo, $cfg, $uid); return;
    }
    // v834 月の日別統計 (カレンダーのヒート表示用)
    if ($sub === 'research-note' && $method === 'GET' && ($seg[2] ?? '') === 'month') {
        cosense_research_note_month_stats($pdo, $cfg, $uid); return;
    }
    // v910 #463 指定年月の研究ノートページを自動生成 (無ければ初期テンプレで作成)
    if ($sub === 'research-note' && $method === 'POST' && ($seg[2] ?? '') === 'create-monthly') {
        cosense_research_note_create_monthly($pdo, $cfg, $uid); return;
    }
    if ($sub === 'page' && $method === 'GET') {
        cosense_page_text($pdo, $cfg, $uid); return;
    }
    if ($sub === 'me' && $method === 'GET' && ($seg[2] ?? '') === 'status') {
        cosense_me_status($pdo, $cfg, $uid); return;
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
function cosense_user_pat(PDO $pdo, int $uid): ?string {
    $st = $pdo->prepare("SELECT cosense_pat FROM users WHERE id=?");
    $st->execute([$uid]);
    $c = trim((string)($st->fetchColumn() ?: ''));
    return $c !== '' ? $c : null;
}
// v825 Cosense page 名に使う handle。優先順:
//   1) users.cosense_page_handle (個別設定、例: 「中村聡史」)
//   2) users.display_name (LabPay 表示名、通常これが Cosense 表示名と同じ)
//   3) user_scrapbox_handles.scrapbox_name (Slack 同期用、英語名のこともある)
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
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => (string)$resp, 'err' => $err];
}

// v2 API でページを取得 (json)。 PAT 必須。構造: { title, lines: [{id, text}], ... }
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

// v2 API で preview → submit して commit する。 changes は配列。
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

// PAT 経由でページ text をロード (v2 lines → text に復元)。 PAT 未登録なら source='none'。
function cosense_load_page_text(PDO $pdo, array $cfg, int $uid, string $title): array {
    $pageUrl = cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title);
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        return ['source' => 'none', 'status' => 0, 'text' => null, 'page' => null, 'page_url' => $pageUrl];
    }
    $r = cosense_v2_get_page($cfg, $title, $pat);
    if ($r['ok']) {
        $lines = $r['page']['lines'] ?? [];
        $text = '';
        foreach ($lines as $ln) {
            $text .= ($text === '' ? '' : "\n") . (string)($ln['text'] ?? '');
        }
        return ['source' => 'v2-pat', 'status' => 200, 'text' => $text, 'page' => $r['page'], 'page_url' => $pageUrl];
    }
    // PAT で失敗 (404 等) → 空として扱う
    return ['source' => 'v2-pat', 'status' => $r['status'], 'text' => null, 'page' => null,
            'page_url' => $pageUrl, 'err' => $r['err'] ?? null];
}

// ───────── handlers ─────────

function cosense_my_research_note(PDO $pdo, array $cfg, int $uid): void {
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        json_response(['has_handle' => false, 'message' => 'Scrapbox handle 未登録 (admin 経由で登録を)']);
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
        json_response(['has_handle' => false, 'message' => 'Scrapbox handle 未登録 (admin 経由で登録を)']);
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

    json_response([
        'has_handle'    => true,
        'handle'        => $handle,
        'has_pat'       => $hasPat,
        // legacy 互換 (v839 までは cookie_present だった)。 PAT 一本化後は has_pat と同義。
        'cookie_present'=> $hasPat,
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
//   today なら当月ページ、 yesterday なら当月 or 先月を自動判定して append。
function cosense_research_note_append(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Cosense PAT が未登録です。設定 → Cosense 連携で登録してください', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', 'Scrapbox handle 未登録 (admin 経由で登録を)', 412);
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

    // ページを取得して lines + pageId を取り出す
    $r = cosense_v2_get_page($cfg, $title, $pat);
    $existsPage = $r['ok'];
    $pageId = $existsPage ? ($r['page']['id'] ?? null) : null;
    $lines = $existsPage ? ($r['page']['lines'] ?? []) : [];

    // v829 #418 「日付ヘッダの直下、既存内容があればその末尾」 = 「今日の日付セクションの末尾」に挿入する。
    //
    //   1. 日付ヘッダ行を探す (= [*( YYYY.MM.DD ...)])
    //   2. ヘッダの次の行から、次の日付ヘッダが現れるまでスキャン
    //      → その「次の日付ヘッダ」の前 = 現セクションの末尾
    //   3. 次の日付ヘッダがなければ `_end` (= ページ末尾) を anchor に
    //   4. 日付ヘッダ自体が存在しなければ、ヘッダ + 内容を全部ページ末尾に追加
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

    // 入力 text を行分解 + 各行に id を振る
    $bodyLines = preg_split('/\r?\n/', $text);
    $changes = [];
    $makeLineId = function (): string {
        // Cosense の lineId はランダム 16進。 12 byte = 24 桁 hex。
        return bin2hex(random_bytes(12));
    };

    // anchor 決定: ヘッダなしならヘッダごと末尾、ありなら現セクションの末尾。
    if ($headerLineId === null) {
        $wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][((int)date('w', strtotime($date)))];
        $headerNewId = $makeLineId();
        $changes[] = ['_insert' => '_end', 'lines' => ['id' => $headerNewId, 'text' => sprintf('[*( %s %s )]', $date, $wd)]];
        foreach ($bodyLines as $bl) {
            $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(), 'text' => ' ' . $bl]];
        }
    } else {
        // 「セクションの末尾」 = 次の日付ヘッダの直前。次がなければページ末尾。
        $anchor = $nextDateLineId ?? '_end';
        foreach ($bodyLines as $bl) {
            // 順次評価: 同じ anchor の前に挿入を繰り返すと、結果的に anchor の直前に
            //   入れた順番で並ぶ (Cosense API はこの順番を保つ)。
            $changes[] = ['_insert' => $anchor, 'lines' => ['id' => $makeLineId(), 'text' => ' ' . $bl]];
        }
    }

    if ($pageId === null && $existsPage) {
        throw new ApiException('internal', 'pageId が取れませんでした', 500);
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

// v834 ETag 付きで JSON を返す。 If-None-Match と一致すれば 304。
function cosense_send_json_etagged(array $resp): void {
    $body = json_encode($resp, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $etag = '"' . md5($body) . '"';
    $ifNone = trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
    if ($ifNone === $etag) {
        http_response_code(304);
        header('ETag: ' . $etag);
        header('Cache-Control: no-cache');
        exit;
    }
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    echo $body;
    exit;
}

// ───────── editable section (v830) ─────────

// 指定日のセクション (= [*( YYYY.MM.DD ...)] ヘッダの直下から、次の日付ヘッダの直前まで) を
//   ヘッダを除く本文行だけの配列 + テキスト形式で返す。 textarea のロード元。
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

    cosense_send_json_etagged([
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
//   body = { date: "YYYY.MM.DD", text: "改行区切りの新本文" }
//   text の各行はそのまま Cosense に書き込まれる (=リードスペース等もユーザー入力をそのまま使用)。
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

    // 新しい text を行分解。末尾の空行は削る (UI 側で余計な空行が付くのを防ぐ)。
    $newLines = preg_split('/\r?\n/', $newText);
    while (count($newLines) > 0 && trim((string)end($newLines)) === '') {
        array_pop($newLines);
    }
    // v831 #418-2 次の日付ヘッダがある場合は、本文の末尾に空行を 1 行入れる
    //   (= 次の日付セクションとの間に視覚的な切れ目を作る)。
    if ($nextAnchorId !== null && count($newLines) > 0) {
        $newLines[] = '';
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

// 指定日のセクションを $allLines から探す。
// 返り値: [headerIdx, headerLineId, nextAnchorId, bodyLines]
//   headerIdx     : ヘッダ行のインデックス。見つからなければ -1
//   headerLineId  : ヘッダ行の id (null も可)
//   nextAnchorId  : 「次の日付ヘッダ」の id (= セクション末尾 anchor)。次がなければ null
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

// v834 指定月の研究ノートページを開いて、日別の line_count / char_count を集計する。
//   GET /api/cosense/research-note/month?ym=YYYY.MM
//   ETag 対応 (= 内容が変わってなければ 304)。
function cosense_research_note_month_stats(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Scrapboxの鍵が未登録です', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', '名前が未設定', 412);
    }
    $ym = trim((string)($_GET['ym'] ?? ''));
    if (!preg_match('/^20\d{2}\.\d{2}$/', $ym)) {
        throw new ApiException('bad_request', 'ym は YYYY.MM', 400);
    }
    $title = $ym . '_研究ノート_' . $handle;
    $r = cosense_v2_get_page($cfg, $title, $pat);
    $existsPage = $r['ok'];
    $allLines = $existsPage ? ($r['page']['lines'] ?? []) : [];

    // 全日付セクションを集計
    // v838 #422 PC向けに preview (各日の本文先頭 2 行連結 / 最大 80 文字) も返す。
    //   カレンダーのセル内に直接「3 lines: 論文要約 + ミーティング」のように表示する用。
    $days = [];
    $curDate = null;
    $previewLines = [];
    $flushPreview = function() use (&$days, &$curDate, &$previewLines) {
        if ($curDate !== null && isset($days[$curDate])) {
            $joined = mb_substr(trim(implode(' / ', $previewLines)), 0, 80);
            $days[$curDate]['preview'] = $joined;
        }
        $previewLines = [];
    };
    foreach ($allLines as $ln) {
        $t = (string)($ln['text'] ?? '');
        if (preg_match('/^\[\*\(\s*(20\d{2}\.\d{2}\.\d{2})/u', $t, $m)) {
            $flushPreview();
            $curDate = $m[1];
            if (!isset($days[$curDate])) {
                $days[$curDate] = ['line_count' => 0, 'char_count' => 0, 'preview' => ''];
            }
            continue;
        }
        if ($curDate !== null && isset($days[$curDate])) {
            $tt = trim($t);
            if ($tt !== '') {
                $days[$curDate]['line_count']++;
                $days[$curDate]['char_count'] += mb_strlen($tt);
                if (count($previewLines) < 2) {
                    // Scrapbox 記法 [* xxx] や [url] を素のテキストに
                    $plain = preg_replace('/\[\*+\s+([^\]]+)\]/u', '$1', $tt);
                    $plain = preg_replace('/\[https?:\/\/\S+\s*([^\]]*)\]/u', '$1', $plain);
                    $plain = preg_replace('/\[(https?:\/\/\S+)\]/u', '$1', $plain);
                    $plain = trim($plain);
                    if ($plain !== '') $previewLines[] = $plain;
                }
            }
        }
    }
    $flushPreview();

    cosense_send_json_etagged([
        'ok' => true,
        'ym' => $ym,
        'title' => $title,
        'page_url' => cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title),
        'exists_page' => $existsPage,
        'days' => (object)$days, // 空オブジェクト保証
    ]);
}

// v910 #463 指定年月の研究ノートページを 「無ければ 初期テンプレ で作成」 する。
//   既存の セクション エディタ でも 「保存 時 に 未作成 なら 作成」 動作 は している が、
//   ユーザ が 「先に 月 の 骨格 だけ 作りたい」 「未来 の 月 を 先取り 用意 したい」 を
//   1 タップ でできるように。 既に あれば no-op (already_exists=true) で 返す。
function cosense_research_note_create_monthly(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Scrapbox の鍵が未登録です', 412);
    }
    $handle = cosense_user_handle($pdo, $uid);
    if ($handle === null) {
        throw new ApiException('precondition', '研究ノートの名前 (handle) が未設定', 412);
    }
    $body = read_json_body();
    $ym = trim((string)($body['ym'] ?? ''));
    if (!preg_match('/^(20\d{2})\.(\d{2})$/', $ym, $m)) {
        throw new ApiException('bad_request', 'ym は YYYY.MM 形式', 400);
    }
    $title = $ym . '_研究ノート_' . $handle;
    $pageUrl = cosense_base($cfg) . '/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($title);
    // 既存チェック
    $r = cosense_v2_get_page($cfg, $title, $pat);
    if ($r['ok']) {
        json_response([
            'ok' => true,
            'already_exists' => true,
            'title' => $title,
            'page_url' => $pageUrl,
        ]);
        return;
    }
    // 新規作成: シンプルな初期テンプレ。 実際の日別セクションは 従来通り セクション エディタ から追記。
    $makeLineId = fn () => bin2hex(random_bytes(12));
    $yyyy = $m[1]; $mm = $m[2];
    $templateLines = [
        $title,
        '',
        sprintf('[* %s年%s月の研究ノート]', $yyyy, $mm),
        '',
        '(このページは LabPay の 「研究ノート」 アプリ から自動生成されました。 日ごとのセクションは 各日を選んで 編集 → 保存 で自動追記されます。)',
    ];
    $changes = [];
    foreach ($templateLines as $t) {
        $changes[] = ['_insert' => '_end', 'lines' => ['id' => $makeLineId(), 'text' => $t]];
    }
    $c = cosense_v2_commit($cfg, $pat, null, $changes);
    if (!$c['ok']) {
        json_response_no_exit([
            'ok' => false,
            'stage' => $c['stage'] ?? 'unknown',
            'status' => $c['status'] ?? null,
            'body' => $c['body'] ?? null,
            'reason' => '作成に失敗しました (Scrapbox API エラー)',
        ], 502);
        return;
    }
    json_response([
        'ok' => true,
        'created' => true,
        'title' => $title,
        'commitId' => $c['commitId'] ?? null,
        'page_url' => $pageUrl,
    ]);
}

// ───────── me settings ─────────

function cosense_me_status(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    // page handle の内訳 (どこから来ているか)
    $stu = $pdo->prepare("SELECT cosense_page_handle, display_name FROM users WHERE id=?");
    $stu->execute([$uid]);
    $r = $stu->fetch(PDO::FETCH_ASSOC) ?: [];
    json_response([
        'has_pat'          => $pat !== null,
        'pat_tail'         => $pat !== null ? mb_substr($pat, -6) : null,
        'handle'                 => cosense_user_handle($pdo, $uid),
        'page_handle_explicit'   => $r['cosense_page_handle'] ?? null,
        'display_name_fallback'  => $r['display_name'] ?? null,
        'pat_settings_url'       => cosense_base($cfg) . '/settings/personal-access-tokens',
    ]);
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
        // 印字可能ASCII (0x21〜0x7E、=や+や/含む) のみ。空白文字や日本語の混入だけ弾く。
        if (!preg_match('/^[\x21-\x7E]+$/', $p)) {
            throw new ApiException('bad_request', '鍵に空白や記号以外の文字が混ざっています。もう一度コピーし直してください', 400);
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
        if (mb_strlen($h) > 100) throw new ApiException('bad_request', 'handle は 100 文字以内', 400);
        if (preg_match('/[\/\\\\\\r\\n\\t]/u', $h)) throw new ApiException('bad_request', '/ \\ 改行タブは使えません', 400);
    } else {
        $h = null;
    }
    $pdo->prepare("UPDATE users SET cosense_page_handle=? WHERE id=?")->execute([$h, $uid]);
    json_response(['ok' => true, 'has_page_handle' => $h !== null, 'effective' => cosense_user_handle($pdo, $uid)]);
}
