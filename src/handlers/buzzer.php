<?php
// v872 #454 早押しクイズ。リアル現場 (ゼミ等) で出題者が口頭で出題、
// 参加者がスマホで「ボタン」をタップ → 1 番早かった人が回答権 (緑) +
// 他の人は順位と「1 位との差」が表示 (赤)。出題者が「次へ」で
// 全員早押しモードに戻る。
//
//   GET    /api/buzzer/sessions                  active 一覧
//   POST   /api/buzzer/sessions                  作成 { title }
//   GET    /api/buzzer/sessions/<id>             詳細 (現在ラウンド + タップランキング)
//   POST   /api/buzzer/sessions/<id>/new-round   起案者が「次へ」 (round_no++)
//   POST   /api/buzzer/sessions/<id>/tap         { elapsed_ms } 自分の早押しを送信
//   POST   /api/buzzer/sessions/<id>/end         起案者が終了
//   GET    /api/buzzer/sessions/<id>/poll        軽量ポーリング (round_no + taps だけ)

declare(strict_types=1);

function route_buzzer(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    if (($seg[1] ?? '') !== 'sessions') {
        json_error('not_found', "no buzzer route for {$seg[1]}", 404); return;
    }
    if (!isset($seg[2])) {
        if ($method === 'GET')  { buzzer_list($pdo, $uid); return; }
        if ($method === 'POST') { buzzer_create($pdo, $uid); return; }
        json_error('method_not_allowed', "no method", 405); return;
    }
    $sid = (int)$seg[2];
    if ($sid <= 0) { json_error('bad_request', 'invalid id', 400); return; }
    $action = $seg[3] ?? '';
    if ($action === '' && $method === 'GET')         { buzzer_detail($pdo, $uid, $sid);    return; }
    if ($action === 'new-round' && $method === 'POST'){ buzzer_new_round($pdo, $uid, $sid); return; }
    if ($action === 'tap'       && $method === 'POST'){ buzzer_tap($pdo, $uid, $sid);       return; }
    if ($action === 'end'       && $method === 'POST'){ buzzer_end($pdo, $uid, $sid);       return; }
    if ($action === 'poll'      && $method === 'GET') { buzzer_poll($pdo, $uid, $sid);      return; }
    json_error('not_found', 'no buzzer route', 404);
}

function buzzer_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare(
        "SELECT s.id, s.title, s.status, s.round_no, s.creator_user_id,
                u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                s.created_at, s.updated_at,
                (SELECT COUNT(DISTINCT user_id) FROM buzzer_taps t WHERE t.session_id=s.id) AS participants
           FROM buzzer_sessions s LEFT JOIN users u ON u.id=s.creator_user_id
          WHERE s.status='active' OR (s.status='ended' AND s.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY))
          ORDER BY s.status='active' DESC, s.updated_at DESC"
    );
    $st->execute();
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function buzzer_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? '早押し'));
    if ($title === '' || mb_strlen($title) > 160) { json_error('bad_request', 'title 1-160', 400); return; }
    $pdo->prepare("INSERT INTO buzzer_sessions (creator_user_id, title) VALUES (?,?)")->execute([$uid, $title]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function buzzer_detail(PDO $pdo, int $uid, int $sid): void {
    $st = $pdo->prepare(
        "SELECT s.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar
           FROM buzzer_sessions s LEFT JOIN users u ON u.id=s.creator_user_id WHERE s.id=?"
    );
    $st->execute([$sid]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) { json_error('not_found', 'session 不在', 404); return; }
    $s['round_no'] = (int)$s['round_no'];
    $s['is_creator'] = ((int)$s['creator_user_id'] === $uid);
    $s['taps'] = buzzer_taps_for_round($pdo, $sid, (int)$s['round_no']);
    json_response($s);
}

function buzzer_new_round(PDO $pdo, int $uid, int $sid): void {
    $creator = (int)$pdo->query("SELECT creator_user_id FROM buzzer_sessions WHERE id=$sid")->fetchColumn();
    if ($creator !== $uid) { json_error('forbidden', '起案者のみ', 403); return; }
    $pdo->prepare("UPDATE buzzer_sessions SET round_no=round_no+1, round_started_at=CURRENT_TIMESTAMP(3) WHERE id=?")
        ->execute([$sid]);
    $new = (int)$pdo->query("SELECT round_no FROM buzzer_sessions WHERE id=$sid")->fetchColumn();
    json_response(['ok' => true, 'round_no' => $new]);
}

function buzzer_tap(PDO $pdo, int $uid, int $sid): void {
    $st = $pdo->prepare("SELECT status, round_no FROM buzzer_sessions WHERE id=?");
    $st->execute([$sid]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) { json_error('not_found', 'session 不在', 404); return; }
    if ($s['status'] !== 'active') { json_error('bad_request', '終了済', 400); return; }
    $round = (int)$s['round_no'];
    if ($round < 1) { json_error('bad_request', 'まだラウンド開始されていません', 400); return; }
    $body = read_json_body();
    $elapsed = (int)($body['elapsed_ms'] ?? 0);
    if ($elapsed < 0 || $elapsed > 600000) { json_error('bad_request', 'elapsed_ms 不正', 400); return; }
    $pdo->prepare("INSERT IGNORE INTO buzzer_taps (session_id, round_no, user_id, elapsed_ms) VALUES (?,?,?,?)")
        ->execute([$sid, $round, $uid, $elapsed]);
    json_response(['ok' => true, 'taps' => buzzer_taps_for_round($pdo, $sid, $round)]);
}

function buzzer_end(PDO $pdo, int $uid, int $sid): void {
    $creator = (int)$pdo->query("SELECT creator_user_id FROM buzzer_sessions WHERE id=$sid")->fetchColumn();
    if ($creator !== $uid) { json_error('forbidden', '起案者のみ', 403); return; }
    $pdo->prepare("UPDATE buzzer_sessions SET status='ended' WHERE id=?")->execute([$sid]);
    json_response(['ok' => true]);
}

function buzzer_poll(PDO $pdo, int $uid, int $sid): void {
    $st = $pdo->prepare("SELECT round_no, status FROM buzzer_sessions WHERE id=?");
    $st->execute([$sid]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) { json_error('not_found', 'session 不在', 404); return; }
    $round = (int)$s['round_no'];
    json_response([
        'round_no' => $round,
        'status'   => $s['status'],
        'taps'     => buzzer_taps_for_round($pdo, $sid, $round),
    ]);
}

function buzzer_taps_for_round(PDO $pdo, int $sid, int $round): array {
    if ($round < 1) return [];
    $st = $pdo->prepare(
        "SELECT t.user_id, t.elapsed_ms, u.display_name, u.avatar_url
           FROM buzzer_taps t LEFT JOIN users u ON u.id=t.user_id
          WHERE t.session_id=? AND t.round_no=?
          ORDER BY t.elapsed_ms ASC, t.server_received_at ASC"
    );
    $st->execute([$sid, $round]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $i => &$r) {
        $r['rank']        = $i + 1;
        $r['elapsed_ms']  = (int)$r['elapsed_ms'];
        $r['user_id']     = (int)$r['user_id'];
    }
    unset($r);
    return $rows;
}
