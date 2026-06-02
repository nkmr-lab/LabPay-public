<?php
// /api/nomikai — 飲み会割り勘. Creator posts {title, total_yen, participants:
// [{user_id, alcohol, weight}, ...]}; server computes per-head amount, stores
// the session + per-participant rows, and notifies every participant of their
// share. Each participant can later mark paid via PATCH.

declare(strict_types=1);

function route_nomikai(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')   { nomikai_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST')  { nomikai_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        if ($method === 'GET')                                      { nomikai_detail($pdo, $cfg, $id); return; }
        if ($method === 'DELETE')                                   { nomikai_close($pdo, $cfg, $id);  return; }
        if (($seg[2] ?? '') === 'pay' && $method === 'PATCH')       { nomikai_pay($pdo, $cfg, $id);    return; }
        if (($seg[2] ?? '') === 'unpay' && $method === 'PATCH')     { nomikai_unpay($pdo, $cfg, $id);  return; }
    }
    json_error('not_found', "no nomikai route for $method $sub", 404);
}

function nomikai_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // List sessions the user is involved in (creator OR participant).
    $st = $pdo->prepare("
        SELECT s.id, s.title, s.total_yen, s.closed_at, s.created_at,
               u.display_name AS creator_name,
               (SELECT COUNT(*) FROM nomikai_participants WHERE session_id = s.id) AS member_count,
               (SELECT COUNT(*) FROM nomikai_participants WHERE session_id = s.id AND paid_at IS NOT NULL) AS paid_count,
               EXISTS(SELECT 1 FROM nomikai_participants WHERE session_id = s.id AND user_id = ?) AS i_join
          FROM nomikai_sessions s
          JOIN users u ON u.id = s.creator_user_id
         WHERE s.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM nomikai_participants WHERE session_id = s.id AND user_id = ?)
         ORDER BY s.id DESC LIMIT 50");
    $st->execute([$u['id'], $u['id'], $u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function nomikai_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT s.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               u.paypay_id AS creator_paypay_id, u.bank_info AS creator_bank_info
          FROM nomikai_sessions s JOIN users u ON u.id = s.creator_user_id
         WHERE s.id = ?");
    $st->execute([$id]);
    $session = $st->fetch(PDO::FETCH_ASSOC);
    if (!$session) throw new ApiException('not_found', "nomikai $id not found", 404);
    $session['total_yen'] = (int)$session['total_yen'];

    $st = $pdo->prepare("
        SELECT p.*, u.display_name, u.avatar_url, u.grade, u.paypay_id, u.bank_info,
               pu.display_name AS proxy_name
          FROM nomikai_participants p
          JOIN users u ON u.id = p.user_id
          LEFT JOIN users pu ON pu.id = p.paid_proxy_user_id
         WHERE p.session_id = ?
         ORDER BY p.id");
    $st->execute([$id]);
    $session['participants'] = array_map(function ($r) {
        $r['amount_yen'] = (int)$r['amount_yen'];
        $r['alcohol']    = (int)$r['alcohol'];
        $r['weight']     = (float)$r['weight'];
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response($session);
}

function nomikai_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $total = (int)require_field($body, 'total_yen');
    if ($total < 1 || $total > 10_000_000) {
        throw new ApiException('bad_request', 'total_yen 1..10000000', 400);
    }
    $notes = isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 5000) : null;
    $parts = $body['participants'] ?? null;
    if (!is_array($parts) || count($parts) < 1) {
        throw new ApiException('bad_request', 'participants required', 400);
    }

    // Normalize: each entry = {user_id, alcohol (bool), weight (float)}.
    $norm = [];
    foreach ($parts as $p) {
        $uid = (int)($p['user_id'] ?? 0);
        if ($uid < 1) continue;
        $norm[] = [
            'user_id' => $uid,
            'alcohol' => !empty($p['alcohol']) ? 1 : 0,
            'weight'  => max(0.1, min(10.0, (float)($p['weight'] ?? 1.0))),
        ];
    }
    if (!$norm) throw new ApiException('bad_request', 'no valid participants', 400);

    // Dedup by user_id (server-side defense; client should already enforce).
    $byUid = [];
    foreach ($norm as $n) $byUid[$n['user_id']] = $n;
    $norm = array_values($byUid);

    // Verify all user_ids exist.
    $ids = array_column($norm, 'user_id');
    $place = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($ids);
    $found = array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
    if (count($found) !== count($ids)) {
        throw new ApiException('bad_request', 'one or more user_ids not found', 400);
    }

    // Compute per-head amount: amount_i = round(total * weight_i / sum(weight)).
    // Rounding error (rounding 100/3 three times leaves the creator's row absorbing
    // ±1 yen) is assigned to whichever row is the creator's, falling back to the
    // first if the creator isn't in the list.
    $sumW = 0; foreach ($norm as $n) $sumW += $n['weight'];
    $sumW = max(1e-9, $sumW);
    $allocated = 0;
    foreach ($norm as &$n) {
        $n['amount_yen'] = (int)round($total * $n['weight'] / $sumW);
        $allocated += $n['amount_yen'];
    }
    unset($n);
    $delta = $total - $allocated;
    if ($delta !== 0) {
        $absorbIdx = 0;
        foreach ($norm as $i => $n) if ($n['user_id'] === (int)$u['id']) { $absorbIdx = $i; break; }
        $norm[$absorbIdx]['amount_yen'] += $delta;
    }

    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare("INSERT INTO nomikai_sessions (creator_user_id, title, total_yen, notes)
            VALUES (?,?,?,?)");
        $ins->execute([$u['id'], $title, $total, $notes]);
        $sid = (int)$pdo->lastInsertId();
        $pIns = $pdo->prepare("INSERT INTO nomikai_participants
            (session_id, user_id, amount_yen, alcohol, weight) VALUES (?,?,?,?,?)");
        foreach ($norm as $n) {
            $pIns->execute([$sid, $n['user_id'], $n['amount_yen'], $n['alcohol'], $n['weight']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // Notify every participant of their share (skip the creator themselves).
    foreach ($norm as $n) {
        if ($n['user_id'] === (int)$u['id']) continue;
        $body = "🍻 飲み会「{$title}」分担: {$n['amount_yen']}円 を {$u['display_name']} さんへ";
        notify_safely($pdo, $cfg, $n['user_id'], 'admin_notice', $body, 'nomikai', $sid);
    }
    json_response(['ok' => true, 'id' => $sid]);
}

function nomikai_pay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $method  = (string)($body['method'] ?? 'cash');
    if (!in_array($method, ['cash','paypay','bank','proxy'], true)) {
        throw new ApiException('bad_request', "method must be cash/paypay/bank/proxy", 400);
    }
    $proxyId = ($method === 'proxy') ? (int)($body['proxy_user_id'] ?? 0) : null;
    if ($method === 'proxy' && !$proxyId) {
        throw new ApiException('bad_request', "proxy_user_id required when method=proxy", 400);
    }
    // A participant can only mark THEIR OWN row paid. Admin/creator overrides
    // could be added later but aren't worth the complexity now.
    $st = $pdo->prepare("UPDATE nomikai_participants
        SET paid_at = NOW(), paid_method = ?, paid_proxy_user_id = ?
        WHERE session_id = ? AND user_id = ?");
    $st->execute([$method, $proxyId, $id, $u['id']]);
    if ($st->rowCount() === 0) {
        throw new ApiException('not_found', "not a participant of this session", 404);
    }
    // Tell the creator (skip if they paid themselves).
    $stC = $pdo->prepare("SELECT creator_user_id FROM nomikai_sessions WHERE id=?");
    $stC->execute([$id]);
    $cid = (int)$stC->fetchColumn();
    if ($cid && $cid !== (int)$u['id']) {
        notify_safely($pdo, $cfg, $cid, 'admin_notice',
            "💰 {$u['display_name']} さんが支払い済 (飲み会 #{$id})", 'nomikai', $id);
    }
    json_response(['ok' => true]);
}

function nomikai_unpay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("UPDATE nomikai_participants
        SET paid_at = NULL, paid_method = NULL, paid_proxy_user_id = NULL
        WHERE session_id = ? AND user_id = ?");
    $st->execute([$id, $u['id']]);
    json_response(['ok' => true]);
}

function nomikai_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM nomikai_sessions WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if ($cid === 0) throw new ApiException('not_found', "nomikai $id not found", 404);
    if ($cid !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '主催者または admin だけが close できます', 403);
    }
    $pdo->prepare("UPDATE nomikai_sessions SET closed_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}
