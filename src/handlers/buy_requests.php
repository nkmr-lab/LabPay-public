<?php
// v1080 /api/buy-requests — 「これ買ってほしい」依頼を LabPay 上で管理する
//   ゆるい機能。従来 #want_to_buy Slack チャンネルでやっていたやりとりの置き換え。
//   * 依頼者: URL + タイトル + 数量 + 理由 + 想定価格 + 緊急度で依頼を投げる
//   * 一覧は全メンバー閲覧可 (open/bought/declined でフィルタ)
//   * 「買った」「却下」の状態変更は admin のみ (中村さん想定)
//   * 依頼者本人は「取消」できる (自分の open な依頼のみ)
//   * LabPay 台帳のお金は動かさない (Slack 運用と同じ、現物受け渡し + 実費記録のみ)

declare(strict_types=1);

function route_buy_requests(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { buy_requests_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { buy_requests_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { buy_requests_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { buy_requests_patch ($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { buy_requests_cancel($pdo, $cfg, $id); return; }
        if ($next === 'buy'      && $method === 'PATCH') { buy_requests_mark_bought  ($pdo, $cfg, $id); return; }
        if ($next === 'decline'  && $method === 'PATCH') { buy_requests_mark_declined($pdo, $cfg, $id); return; }
        if ($next === 'reopen'   && $method === 'PATCH') { buy_requests_reopen       ($pdo, $cfg, $id); return; }
        // v1082 中村さん「もう一度お願いするボタン」→ 既存 (bought/declined/cancelled) を
        //   コピーして新規 open 依頼を作る。依頼者本人だけ。
        if ($next === 'reask'    && $method === 'POST')  { buy_requests_reask        ($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no buy-requests route for $method $sub", 404);
}

// ─── LIST ────────────────────────────────────────────────────
// query params: ?status=open|bought|declined|cancelled|all (デフォルト all)、
//               ?mine=1 (自分の依頼のみ)、?limit=100
function buy_requests_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $status = (string)($_GET['status'] ?? 'all');
    $mine   = !empty($_GET['mine']);
    $limit  = max(1, min(500, (int)($_GET['limit'] ?? 100)));

    $where = [];
    $params = [];
    if (in_array($status, ['open','bought','declined','cancelled'], true)) {
        $where[] = 'b.status = ?';
        $params[] = $status;
    }
    if ($mine) {
        $where[] = 'b.requester_user_id = ?';
        $params[] = (int)$u['id'];
    }
    $sql = "SELECT b.id, b.url, b.title, b.reason, b.quantity, b.price_estimate,
                   b.urgency, b.status, b.actual_price, b.fulfiller_note,
                   b.bought_at, b.created_at, b.updated_at,
                   b.requester_user_id, ur.display_name AS requester_name, ur.avatar_url AS requester_avatar,
                   b.fulfiller_user_id, uf.display_name AS fulfiller_name
              FROM buy_requests b
              JOIN users ur ON ur.id = b.requester_user_id
         LEFT JOIN users uf ON uf.id = b.fulfiller_user_id";
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    // open→urgent、それ以外は新しい順
    $sql .= ' ORDER BY (b.status="open") DESC, (b.status="open" AND b.urgency="urgent") DESC, b.created_at DESC LIMIT ' . $limit;

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']                 = (int)$r['id'];
        $r['quantity']           = (int)$r['quantity'];
        $r['price_estimate']     = $r['price_estimate'] !== null ? (int)$r['price_estimate'] : null;
        $r['actual_price']       = $r['actual_price'] !== null ? (int)$r['actual_price'] : null;
        $r['requester_user_id']  = (int)$r['requester_user_id'];
        $r['fulfiller_user_id']  = $r['fulfiller_user_id'] !== null ? (int)$r['fulfiller_user_id'] : null;
        $r['is_mine']            = ($r['requester_user_id'] === (int)$u['id']);
    }
    // 集計 (どのタブに何件あるか)
    $counts = ['open' => 0, 'bought' => 0, 'declined' => 0, 'cancelled' => 0];
    $stC = $pdo->query("SELECT status, COUNT(*) c FROM buy_requests GROUP BY status");
    foreach ($stC as $c) $counts[$c['status']] = (int)$c['c'];
    json_response(['items' => $rows, 'counts' => $counts, 'is_admin' => $u['role'] === 'admin']);
}

// ─── CREATE ──────────────────────────────────────────────────
function buy_requests_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $url        = trim((string)require_field($body, 'url'));
    $title      = trim((string)require_field($body, 'title'));
    $reason     = trim((string)($body['reason'] ?? ''));
    $qty        = max(1, min(9999, (int)($body['quantity'] ?? 1)));
    $priceEst   = isset($body['price_estimate']) && $body['price_estimate'] !== '' ? max(0, (int)$body['price_estimate']) : null;
    $urgency    = (string)($body['urgency'] ?? 'normal');
    if (!in_array($urgency, ['normal', 'urgent'], true)) $urgency = 'normal';

    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        throw new ApiException('bad_request', 'URL は http:// or https:// で始まる必要があります', 400);
    }
    if (mb_strlen($url) > 2048) throw new ApiException('bad_request', 'URL が長すぎます (最大 2048)', 400);
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'タイトルは 1〜200 文字', 400);
    if (mb_strlen($reason) > 2000) throw new ApiException('bad_request', '理由は 2000 文字以下', 400);

    $ins = $pdo->prepare("INSERT INTO buy_requests
        (requester_user_id, url, title, reason, quantity, price_estimate, urgency)
        VALUES (?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$u['id'], $url, $title, $reason, $qty, $priceEst, $urgency]);
    $id = (int)$pdo->lastInsertId();

    // 通知: 全 admin に in-app + Slack (「新しい購入依頼が来たよ」)
    $urgencyMark = $urgency === 'urgent' ? '🚨 [緊急] ' : '';
    $priceMark   = $priceEst !== null ? " (想定 {$priceEst}円)" : '';
    $qtyMark     = $qty > 1 ? " × {$qty}" : '';
    $body_notify = "🛒 {$urgencyMark}{$u['display_name']} さんが購入依頼: 「{$title}」{$qtyMark}{$priceMark}";
    notify_admins($pdo, $cfg, 'admin_notice', $body_notify, 'buy_request', $id);
    slack_notify($cfg, $body_notify . "\n{$url}", null, '#/buy-requests');

    json_response(['ok' => true, 'id' => $id]);
}

// ─── DETAIL ──────────────────────────────────────────────────
function buy_requests_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT b.*, ur.display_name AS requester_name, ur.avatar_url AS requester_avatar,
                                uf.display_name AS fulfiller_name
                           FROM buy_requests b
                           JOIN users ur ON ur.id = b.requester_user_id
                      LEFT JOIN users uf ON uf.id = b.fulfiller_user_id
                          WHERE b.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    $r['id']                = (int)$r['id'];
    $r['quantity']          = (int)$r['quantity'];
    $r['price_estimate']    = $r['price_estimate'] !== null ? (int)$r['price_estimate'] : null;
    $r['actual_price']      = $r['actual_price'] !== null ? (int)$r['actual_price'] : null;
    $r['requester_user_id'] = (int)$r['requester_user_id'];
    $r['fulfiller_user_id'] = $r['fulfiller_user_id'] !== null ? (int)$r['fulfiller_user_id'] : null;
    $r['is_mine']           = ($r['requester_user_id'] === (int)$u['id']);
    $r['is_admin']          = $u['role'] === 'admin';
    json_response($r);
}

// ─── PATCH (依頼者本人による内容編集、 open な間だけ) ───────────
function buy_requests_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '編集できるのは依頼者本人か admin のみ', 403);
    }
    if ($r['status'] !== 'open') {
        throw new ApiException('bad_request', 'open な依頼のみ編集可能', 400);
    }
    $body = read_json_body();
    $sets = [];
    $params = [];
    if (isset($body['url'])) {
        $url = trim((string)$body['url']);
        if ($url === '' || !preg_match('#^https?://#i', $url)) throw new ApiException('bad_request', 'URL は http(s)://', 400);
        if (mb_strlen($url) > 2048) throw new ApiException('bad_request', 'URL が長すぎ', 400);
        $sets[] = 'url = ?'; $params[] = $url;
    }
    if (isset($body['title'])) {
        $title = trim((string)$body['title']);
        if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'タイトルは 1〜200 文字', 400);
        $sets[] = 'title = ?'; $params[] = $title;
    }
    if (array_key_exists('reason', $body)) {
        $reason = trim((string)$body['reason']);
        if (mb_strlen($reason) > 2000) throw new ApiException('bad_request', '理由は 2000 文字以下', 400);
        $sets[] = 'reason = ?'; $params[] = $reason;
    }
    if (isset($body['quantity'])) {
        $sets[] = 'quantity = ?'; $params[] = max(1, min(9999, (int)$body['quantity']));
    }
    if (array_key_exists('price_estimate', $body)) {
        $sets[] = 'price_estimate = ?';
        $params[] = ($body['price_estimate'] === '' || $body['price_estimate'] === null) ? null : max(0, (int)$body['price_estimate']);
    }
    if (isset($body['urgency'])) {
        $urgency = (string)$body['urgency'];
        if (!in_array($urgency, ['normal','urgent'], true)) $urgency = 'normal';
        $sets[] = 'urgency = ?'; $params[] = $urgency;
    }
    if (!$sets) { json_response(['ok' => true, 'unchanged' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE buy_requests SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    json_response(['ok' => true]);
}

// ─── CANCEL (依頼者本人による取消) ───────────────────────────
function buy_requests_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id'] && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '取消できるのは依頼者本人か admin のみ', 403);
    }
    if ($r['status'] !== 'open') {
        throw new ApiException('bad_request', 'open な依頼のみ取消可能', 400);
    }
    $pdo->prepare("UPDATE buy_requests SET status='cancelled', fulfiller_user_id=? WHERE id=?")
        ->execute([$u['id'], $id]);
    json_response(['ok' => true]);
}

// ─── MARK BOUGHT (admin のみ) ────────────────────────────────
function buy_requests_mark_bought(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ($r['status'] !== 'open') {
        throw new ApiException('bad_request', 'open な依頼のみ買った印を付けられる', 400);
    }
    $body = read_json_body();
    $actualPrice = (isset($body['actual_price']) && $body['actual_price'] !== '') ? max(0, (int)$body['actual_price']) : null;
    $note        = trim((string)($body['fulfiller_note'] ?? ''));
    if (mb_strlen($note) > 2000) throw new ApiException('bad_request', 'note は 2000 文字以下', 400);
    $pdo->prepare("UPDATE buy_requests
                      SET status='bought', fulfiller_user_id=?, bought_at=NOW(),
                          actual_price=?, fulfiller_note=? WHERE id=?")
        ->execute([$u['id'], $actualPrice, $note, $id]);

    // 通知: 依頼者本人に in-app + 全体 Slack (受渡ロケ共有)
    $priceLine = $actualPrice !== null ? " (実費 {$actualPrice}円)" : '';
    $noteLine  = $note !== '' ? " / {$note}" : '';
    notify_safely($pdo, $cfg, (int)$r['requester_user_id'], 'admin_notice',
        "🛒✅ 買いました: 「{$r['title']}」{$priceLine}{$noteLine}", 'buy_request', $id);
    slack_notify($cfg, "✅ 買った: 「{$r['title']}」{$priceLine}{$noteLine}", null, '#/buy-requests');

    json_response(['ok' => true]);
}

// ─── MARK DECLINED (admin のみ) ──────────────────────────────
function buy_requests_mark_declined(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ($r['status'] !== 'open') {
        throw new ApiException('bad_request', 'open な依頼のみ却下可', 400);
    }
    $body = read_json_body();
    $note = trim((string)($body['fulfiller_note'] ?? ''));
    if (mb_strlen($note) > 2000) throw new ApiException('bad_request', 'note は 2000 文字以下', 400);
    $pdo->prepare("UPDATE buy_requests
                      SET status='declined', fulfiller_user_id=?, fulfiller_note=? WHERE id=?")
        ->execute([$u['id'], $note, $id]);

    $noteLine = $note !== '' ? "\n理由: {$note}" : '';
    notify_safely($pdo, $cfg, (int)$r['requester_user_id'], 'admin_notice',
        "🛒❌ 却下: 「{$r['title']}」{$noteLine}", 'buy_request', $id);

    json_response(['ok' => true]);
}

// ─── REASK (依頼者本人: 既存 closed 依頼をコピーして新規 open を作る) ────
//   v1082 中村さん「もう一度お願いするボタンがあると良い」→ 買った/却下/取消の
//   依頼をコピーして新規に open で出し直す。依頼者本人のみ。 admin にも通知される
//   (新規依頼と同じ)。
function buy_requests_reask(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ((int)$r['requester_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', 'もう一度お願いできるのは依頼者本人のみ', 403);
    }
    if ($r['status'] === 'open') {
        throw new ApiException('bad_request', 'すでに依頼中です', 400);
    }
    $ins = $pdo->prepare("INSERT INTO buy_requests
        (requester_user_id, url, title, reason, quantity, price_estimate, urgency)
        VALUES (?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$u['id'], $r['url'], $r['title'], $r['reason'],
                   (int)$r['quantity'], $r['price_estimate'], $r['urgency']]);
    $newId = (int)$pdo->lastInsertId();

    // 通知は新規依頼と同じ (admin へ)
    $urgencyMark = $r['urgency'] === 'urgent' ? '🚨 [緊急] ' : '';
    $priceMark   = $r['price_estimate'] !== null ? " (想定 {$r['price_estimate']}円)" : '';
    $qtyMark     = (int)$r['quantity'] > 1 ? " × {$r['quantity']}" : '';
    $notify = "🛒🔁 {$urgencyMark}{$u['display_name']} さんがもう一度依頼: 「{$r['title']}」{$qtyMark}{$priceMark}";
    notify_admins($pdo, $cfg, 'admin_notice', $notify, 'buy_request', $newId);
    slack_notify($cfg, $notify . "\n{$r['url']}", null, '#/buy-requests');

    json_response(['ok' => true, 'id' => $newId]);
}

// ─── REOPEN (admin: 買った/却下の状態を open に戻す。誤操作リカバリ用) ─
function buy_requests_reopen(PDO $pdo, array $cfg, int $id): void {
    Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->prepare("SELECT status FROM buy_requests WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', "buy_request $id not found", 404);
    if ($r['status'] === 'open') { json_response(['ok' => true, 'unchanged' => true]); return; }
    $pdo->prepare("UPDATE buy_requests SET status='open', fulfiller_user_id=NULL, bought_at=NULL,
                                            actual_price=NULL, fulfiller_note=NULL WHERE id=?")
        ->execute([$id]);
    json_response(['ok' => true]);
}
