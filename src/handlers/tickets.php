<?php
// v1122 チケット生成アプリ (MVP)
//   誰でも発行 → 対象者が pt を払って使う → 発行者に pt が入る (ラボ内サービス市場)
//
// API:
//   GET    /api/tickets                   → active + 自分が対象のチケット一覧
//   POST   /api/tickets                   → 発行
//   GET    /api/tickets/{id}              → 詳細 (使用履歴付き)
//   PATCH  /api/tickets/{id}              → 編集 (発行者のみ、uses_count=0 時)
//   POST   /api/tickets/{id}/use          → 使う (pt 徴収 + 履歴)
//   POST   /api/tickets/{id}/revoke       → 発行者が停止
//   GET    /api/tickets/mine              → 自分が発行 / 使った
//
// 将来: グループ発行 (承認必要 + 山分け) / 全体承認フローは別実装

declare(strict_types=1);

const TK_MIN_PRICE = 5;
const TK_MAX_PRICE = 2000;
const TK_MAX_USES = 100;
const GRADES_TK = ['B3','B4','M1','M2','D'];

function route_tickets(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { tk_list  ($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { tk_create($pdo, $cfg); return; }
    if ($sub === 'mine' && $method === 'GET') { tk_mine($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''        && $method === 'GET')   { tk_detail($pdo, $cfg, $id); return; }
        if ($next === ''        && $method === 'PATCH') { tk_patch($pdo, $cfg, $id);  return; }
        if ($next === 'use'     && $method === 'POST')  { tk_use($pdo, $cfg, $id);    return; }
        if ($next === 'revoke'  && $method === 'POST')  { tk_revoke($pdo, $cfg, $id); return; }
    }
    throw new ApiException('not_found', "no tickets route for $method $sub", 404);
}

function _tk_check_expiry(PDO $pdo): void {
    // 期限切れは status を 'expired' に (軽い掃除、毎リクエスト実行しても軽量な UPDATE)
    $pdo->exec("UPDATE tickets SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < NOW()");
}

function _tk_shape(array $r, int $requesterId, string $requesterGrade = ''): array {
    $remaining = max(0, (int)$r['max_uses'] - (int)$r['uses_count']);
    $isMine = ((int)$r['issuer_user_id'] === $requesterId);
    $applicable = true;
    if ($r['target_scope'] === 'grade' && $r['target_grade'] !== null) {
        $applicable = ($requesterGrade === $r['target_grade']);
    }
    return [
        'id'             => (int)$r['id'],
        'title'          => (string)$r['title'],
        'description'    => (string)($r['description'] ?? ''),
        'usable_in'      => (string)($r['usable_in'] ?? ''),
        'issuer_user_id' => (int)$r['issuer_user_id'],
        'issuer_name'    => (string)($r['issuer_name'] ?? ''),
        'issuer_avatar'  => $r['issuer_avatar'] ?? null,
        'price'          => (int)$r['price'],
        'max_uses'       => (int)$r['max_uses'],
        'uses_count'     => (int)$r['uses_count'],
        'remaining'      => $remaining,
        'target_scope'   => (string)$r['target_scope'],
        'target_grade'   => $r['target_grade'] ?: null,
        'expires_at'     => $r['expires_at'] ?: null,
        'image_url'      => $r['image_url'] ?: null,
        'emoji'          => $r['emoji'] ?: null,
        'status'         => (string)$r['status'],
        'created_at'     => (string)$r['created_at'],
        'is_mine'        => $isMine,
        'applicable'     => $applicable,
        'can_use'        => (!$isMine && $applicable && $r['status'] === 'active' && $remaining > 0),
    ];
}

function _tk_select_base(): string {
    return "SELECT t.*, u.display_name AS issuer_name, u.avatar_url AS issuer_avatar
              FROM tickets t LEFT JOIN users u ON u.id = t.issuer_user_id";
}

function tk_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    _tk_check_expiry($pdo);
    $st = $pdo->query(_tk_select_base() . " WHERE t.status = 'active' ORDER BY t.id DESC LIMIT 200");
    $items = array_map(fn($r) => _tk_shape($r, (int)$u['id'], (string)($u['grade'] ?? '')), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function tk_mine(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 発行したチケット + 使った履歴
    $iss = $pdo->prepare(_tk_select_base() . " WHERE t.issuer_user_id = ? ORDER BY t.id DESC LIMIT 100");
    $iss->execute([$uid]);
    $issued = array_map(fn($r) => _tk_shape($r, $uid, (string)($u['grade'] ?? '')), $iss->fetchAll(PDO::FETCH_ASSOC));
    $use = $pdo->prepare("SELECT k.id AS use_id, k.used_at, k.note,
                                 t.id, t.title, t.emoji, t.image_url, t.price,
                                 u.display_name AS issuer_name, u.avatar_url AS issuer_avatar
                            FROM ticket_uses k
                            JOIN tickets t ON t.id = k.ticket_id
                       LEFT JOIN users u ON u.id = t.issuer_user_id
                           WHERE k.user_id = ?
                        ORDER BY k.used_at DESC LIMIT 100");
    $use->execute([$uid]);
    json_response(['issued' => $issued, 'used' => $use->fetchAll(PDO::FETCH_ASSOC)]);
}

function tk_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare(_tk_select_base() . " WHERE t.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'ticket なし', 404);
    $shape = _tk_shape($r, (int)$u['id'], (string)($u['grade'] ?? ''));
    // 履歴
    $h = $pdo->prepare("SELECT k.used_at, k.note, k.user_id, u.display_name, u.avatar_url
                          FROM ticket_uses k JOIN users u ON u.id = k.user_id
                         WHERE k.ticket_id = ? ORDER BY k.used_at DESC");
    $h->execute([$id]);
    $shape['uses'] = $h->fetchAll(PDO::FETCH_ASSOC);
    json_response(['ticket' => $shape]);
}

function tk_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > 2000) $desc = mb_substr($desc, 0, 2000);
    $usable = trim((string)($body['usable_in'] ?? ''));
    if (mb_strlen($usable) > 400) $usable = mb_substr($usable, 0, 400);
    $price = (int)($body['price'] ?? 0);
    if ($price < TK_MIN_PRICE || $price > TK_MAX_PRICE) throw new ApiException('bad_request', sprintf('price %d-%d', TK_MIN_PRICE, TK_MAX_PRICE), 400);
    $maxUses = (int)($body['max_uses'] ?? 1);
    if ($maxUses < 1 || $maxUses > TK_MAX_USES) throw new ApiException('bad_request', sprintf('max_uses 1-%d', TK_MAX_USES), 400);
    $scope = in_array($body['target_scope'] ?? 'all', ['all','grade'], true) ? $body['target_scope'] : 'all';
    $grade = null;
    if ($scope === 'grade') {
        $grade = trim((string)($body['target_grade'] ?? ''));
        if (!in_array($grade, GRADES_TK, true)) throw new ApiException('bad_request', 'target_grade は B3/B4/M1/M2/D', 400);
    }
    $expires = null;
    if (!empty($body['expires_at'])) {
        try {
            $dt = new DateTime((string)$body['expires_at']);
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $expires = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $_) {}
    }
    $emoji = trim((string)($body['emoji'] ?? ''));
    if (mb_strlen($emoji) > 8) $emoji = mb_substr($emoji, 0, 8);
    $imageUrl = trim((string)($body['image_url'] ?? '')) ?: null;
    $st = $pdo->prepare("INSERT INTO tickets
        (title, description, usable_in, issuer_user_id, price, max_uses, target_scope, target_grade, expires_at, image_url, emoji)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([$title, $desc ?: null, $usable ?: null, (int)$u['id'], $price, $maxUses, $scope, $grade, $expires, $imageUrl, $emoji ?: null]);
    $id = (int)$pdo->lastInsertId();
    $rr = $pdo->prepare(_tk_select_base() . " WHERE t.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'ticket' => _tk_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'], (string)($u['grade'] ?? ''))]);
}

function tk_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM tickets WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'ticket なし', 404);
    if ((int)$r['issuer_user_id'] !== (int)$u['id']) throw new ApiException('forbidden', '発行者のみ編集可', 403);
    if ((int)$r['uses_count'] > 0) throw new ApiException('bad_request', '既に使用されているため編集不可 (revoke して作り直しを)', 400);
    $body = read_json_body();
    $sets = []; $params = [];
    foreach ([['title', 200], ['description', 2000], ['usable_in', 400]] as [$k, $max]) {
        if (array_key_exists($k, $body)) {
            $v = trim((string)$body[$k]);
            if ($k === 'title' && $v === '') throw new ApiException('bad_request', 'title 空不可', 400);
            if (mb_strlen($v) > $max) $v = mb_substr($v, 0, $max);
            $sets[] = "$k = ?"; $params[] = $v ?: null;
        }
    }
    if (array_key_exists('price', $body)) {
        $p = (int)$body['price'];
        if ($p < TK_MIN_PRICE || $p > TK_MAX_PRICE) throw new ApiException('bad_request', 'price 範囲外', 400);
        $sets[] = 'price = ?'; $params[] = $p;
    }
    if (array_key_exists('max_uses', $body)) {
        $mu = (int)$body['max_uses'];
        if ($mu < 1 || $mu > TK_MAX_USES) throw new ApiException('bad_request', 'max_uses 範囲外', 400);
        $sets[] = 'max_uses = ?'; $params[] = $mu;
    }
    if (array_key_exists('expires_at', $body)) {
        $ex = null;
        if (!empty($body['expires_at'])) {
            try { $dt = new DateTime((string)$body['expires_at']); $dt->setTimezone(new DateTimeZone(date_default_timezone_get())); $ex = $dt->format('Y-m-d H:i:s'); }
            catch (Throwable $_) {}
        }
        $sets[] = 'expires_at = ?'; $params[] = $ex;
    }
    if (array_key_exists('emoji', $body)) {
        $e = trim((string)$body['emoji']);
        if (mb_strlen($e) > 8) $e = mb_substr($e, 0, 8);
        $sets[] = 'emoji = ?'; $params[] = $e ?: null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE tickets SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    $rr = $pdo->prepare(_tk_select_base() . " WHERE t.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'ticket' => _tk_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'], (string)($u['grade'] ?? ''))]);
}

function tk_use(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $note = trim((string)($body['note'] ?? ''));
    if (mb_strlen($note) > 400) $note = mb_substr($note, 0, 400);
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM tickets WHERE id = ? FOR UPDATE");
        $st->execute([$id]);
        $t = $st->fetch(PDO::FETCH_ASSOC);
        if (!$t) { $pdo->rollBack(); throw new ApiException('not_found', 'ticket なし', 404); }
        if ($t['status'] !== 'active') { $pdo->rollBack(); throw new ApiException('bad_request', 'このチケットは使えません (' . $t['status'] . ')', 400); }
        if ((int)$t['issuer_user_id'] === $uid) { $pdo->rollBack(); throw new ApiException('bad_request', '自分の発行チケットは使えません', 400); }
        if ($t['expires_at'] && strtotime($t['expires_at']) < time()) { $pdo->rollBack(); throw new ApiException('bad_request', '有効期限切れ', 400); }
        if ((int)$t['uses_count'] >= (int)$t['max_uses']) { $pdo->rollBack(); throw new ApiException('bad_request', '既に売切', 400); }
        if ($t['target_scope'] === 'grade' && $t['target_grade']) {
            $userGrade = (string)($u['grade'] ?? '');
            if ($userGrade !== $t['target_grade']) { $pdo->rollBack(); throw new ApiException('forbidden', "対象は {$t['target_grade']} のみ", 403); }
        }
        $price = (int)$t['price'];
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $price) { $pdo->rollBack(); throw new ApiException('insufficient_balance', "残高不足 (要 {$price}pt、現在 {$bal}pt)", 400); }
        // 支払: user → issuer
        Ledger::transfer($pdo, $uid, (int)$t['issuer_user_id'], $price, 'ticket_use', 'ticket', $id, "🎫 " . $t['title']);
        // 使用履歴
        $pdo->prepare("INSERT INTO ticket_uses (ticket_id, user_id, note) VALUES (?, ?, ?)")->execute([$id, $uid, $note ?: null]);
        $newCount = (int)$t['uses_count'] + 1;
        $newStatus = $newCount >= (int)$t['max_uses'] ? 'sold_out' : 'active';
        $pdo->prepare("UPDATE tickets SET uses_count = ?, status = ? WHERE id = ?")->execute([$newCount, $newStatus, $id]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 発行者へ通知
    try {
        global $CFG;
        $userName = (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        $st = $pdo->prepare("SELECT issuer_user_id, title, price FROM tickets WHERE id = ?");
        $st->execute([$id]);
        $t2 = $st->fetch(PDO::FETCH_ASSOC);
        $msg = "🎫 「{$t2['title']}」を {$userName} さんが使いました (+{$t2['price']}pt)" . ($note ? " — {$note}" : '');
        notify_safely($pdo, $CFG, (int)$t2['issuer_user_id'], 'admin_notice', $msg, 'ticket', $id);
    } catch (Throwable $_) {}
    $rr = $pdo->prepare(_tk_select_base() . " WHERE t.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'ticket' => _tk_shape($rr->fetch(PDO::FETCH_ASSOC), $uid, (string)($u['grade'] ?? ''))]);
}

function tk_revoke(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM tickets WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'ticket なし', 404);
    if (!$isAdmin && (int)$r['issuer_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '発行者 or admin のみ', 403);
    }
    if ($r['status'] !== 'active') throw new ApiException('bad_request', '既に停止', 400);
    $pdo->prepare("UPDATE tickets SET status='revoked', revoked_at=NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}
