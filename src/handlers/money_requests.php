<?php
// /api/money-requests — 請求 (集金) 機能。
// * creator がメンバーを選んで amount (全員同額 or 指定額) を設定
// * 各 recipient は「支払い済」を method (cash/paypay/bank/proxy) 付きでチェック
// * creator は誰がどの方法で払ったかを見られる
// 支払いは外でやり取り。ledger は動かない。

declare(strict_types=1);

function route_money_requests(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { money_requests_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { money_requests_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { money_requests_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { money_requests_close($pdo, $cfg, $id);  return; }
        if ($next === 'pay'    && $method === 'PATCH') { money_requests_pay  ($pdo, $cfg, $id); return; }
        if ($next === 'unpay'  && $method === 'PATCH') { money_requests_unpay($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no money-requests route for $method $sub", 404);
}

// ─── LIST ────────────────────────────────────────────────────

function money_requests_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 自分が発起人 or 受取人 のいずれかにいる請求を返す。
    $st = $pdo->prepare("
        SELECT r.id, r.title, r.memo, r.closed_at, r.created_at,
               uc.display_name AS creator_name, uc.id AS creator_user_id,
               (SELECT COUNT(*) FROM money_request_recipients WHERE request_id = r.id) AS member_count,
               (SELECT COUNT(*) FROM money_request_recipients WHERE request_id = r.id AND paid_at IS NOT NULL) AS paid_count,
               (SELECT amount_yen FROM money_request_recipients WHERE request_id = r.id AND user_id = ?) AS my_amount,
               (SELECT paid_at    FROM money_request_recipients WHERE request_id = r.id AND user_id = ?) AS my_paid_at
          FROM money_requests r
          JOIN users uc ON uc.id = r.creator_user_id
         WHERE r.creator_user_id = ?
            OR EXISTS (SELECT 1 FROM money_request_recipients
                        WHERE request_id = r.id AND user_id = ?)
         ORDER BY r.closed_at IS NULL DESC, r.created_at DESC LIMIT 100");
    $st->execute([$u['id'], $u['id'], $u['id'], $u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

// ─── CREATE ──────────────────────────────────────────────────

function money_requests_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 5000) : null;
    $dryRun = !empty($body['dry_run']);  // true なら DB に作らず、通知本文だけ previews[] で返す
    $recipients = $body['recipients'] ?? null;
    if (!is_array($recipients) || !$recipients) {
        throw new ApiException('bad_request', 'recipients must be a non-empty array', 400);
    }
    // recipients は [{user_id, amount_yen}, ...]
    $rows = [];
    $userIds = [];
    foreach ($recipients as $r) {
        $uid = (int)($r['user_id'] ?? 0);
        $amt = (int)($r['amount_yen'] ?? 0);
        if ($uid <= 0 || $amt <= 0) {
            throw new ApiException('bad_request', 'recipients[].user_id と amount_yen は正の整数で', 400);
        }
        if (isset($userIds[$uid])) {
            throw new ApiException('bad_request', "recipient {$uid} が重複しています", 400);
        }
        $userIds[$uid] = true;
        $rows[] = ['user_id' => $uid, 'amount_yen' => $amt];
    }
    // ユーザー存在チェック
    $uids = array_keys($userIds);
    $place = implode(',', array_fill(0, count($uids), '?'));
    $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($uids);
    if (count($st->fetchAll()) !== count($uids)) {
        throw new ApiException('bad_request', 'unknown user_id in recipients', 400);
    }

    // recipients の名前を引いておく (preview に必要なので、send 経路と共通化)
    $stN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
    $stN->execute($uids);
    $names = [];
    foreach ($stN->fetchAll(PDO::FETCH_ASSOC) as $n) $names[(int)$n['id']] = $n['display_name'];

    // 通知本文を組み立てる (実送信 / preview 共通)。memo があれば改行つきで添える。
    $buildMsg = function(int $amount) use ($u, $title, $memo): string {
        $msg = "💴 {$u['display_name']} から請求: 「{$title}」¥" . number_format($amount);
        if ($memo !== null && trim($memo) !== '') {
            $msg .= "\nメモ: " . $memo;
        }
        return $msg;
    };

    // dry_run: DB を触らず、各人に届くはずの本文を previews[] で返すだけ
    if ($dryRun) {
        $previews = [];
        foreach ($rows as $r) {
            if ((int)$r['user_id'] === (int)$u['id']) continue;
            $previews[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $names[(int)$r['user_id']] ?? "user#{$r['user_id']}",
                'amount_yen'   => (int)$r['amount_yen'],
                'message'      => $buildMsg((int)$r['amount_yen']),
            ];
        }
        json_response(['ok' => true, 'dry_run' => true, 'previews' => $previews]);
        return;
    }

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("INSERT INTO money_requests (creator_user_id, title, memo) VALUES (?,?,?)");
        $st->execute([$u['id'], $title, $memo]);
        $rid = (int)$pdo->lastInsertId();
        $st = $pdo->prepare("INSERT INTO money_request_recipients (request_id, user_id, amount_yen) VALUES (?,?,?)");
        foreach ($rows as $r) $st->execute([$rid, $r['user_id'], $r['amount_yen']]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // recipients に通知 (発起人は除く)
    foreach ($rows as $r) {
        if ((int)$r['user_id'] === (int)$u['id']) continue;
        notify_safely($pdo, $cfg, (int)$r['user_id'], 'admin_notice',
            $buildMsg((int)$r['amount_yen']), 'money_request', $rid);
    }
    json_response(['ok' => true, 'id' => $rid]);
}

// ─── DETAIL ─────────────────────────────────────────────────

function money_requests_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT r.*,
               uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url,
               uc.paypay_id    AS creator_paypay_id,
               uc.bank_info    AS creator_bank_info
          FROM money_requests r
          JOIN users uc ON uc.id = r.creator_user_id
         WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'request not found', 404);

    // recipient は creator か、自分が含まれるときだけ全リストを見せる
    $stR = $pdo->prepare("
        SELECT rr.id, rr.user_id, rr.amount_yen, rr.paid_at, rr.paid_method,
               rr.paid_proxy_user_id, rr.paid_note,
               u.display_name, u.avatar_url, u.grade,
               up.display_name AS proxy_name
          FROM money_request_recipients rr
          JOIN users u ON u.id = rr.user_id
          LEFT JOIN users up ON up.id = rr.paid_proxy_user_id
         WHERE rr.request_id = ?
         ORDER BY rr.id");
    $stR->execute([$id]);
    $recipients = $stR->fetchAll(PDO::FETCH_ASSOC);

    $isCreator = (int)$r['creator_user_id'] === (int)$u['id'];
    $isRecipient = false;
    foreach ($recipients as $rec) if ((int)$rec['user_id'] === (int)$u['id']) $isRecipient = true;
    if (!$isCreator && !$isRecipient) {
        throw new ApiException('forbidden', 'この請求に関わっていません', 403);
    }
    $r['recipients'] = $recipients;
    json_response($r);
}

// ─── CLOSE (creator) ─────────────────────────────────────────

function money_requests_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, closed_at FROM money_requests WHERE id=?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'request not found', 404);
    if ((int)$r['creator_user_id'] !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '発起人または admin だけが閉じられます', 403);
    }
    if (!$r['closed_at']) {
        $pdo->prepare("UPDATE money_requests SET closed_at=NOW() WHERE id=?")->execute([$id]);
    }
    json_response(['ok' => true]);
}

// ─── PAY / UNPAY (recipient) ─────────────────────────────────

function money_requests_pay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $method = (string)($body['method'] ?? '');
    if (!in_array($method, ['cash','paypay','bank','proxy'], true)) {
        throw new ApiException('bad_request', "method must be cash|paypay|bank|proxy", 400);
    }
    $proxyId = null;
    if ($method === 'proxy') {
        $proxyId = (int)($body['proxy_user_id'] ?? 0);
        if ($proxyId <= 0) {
            throw new ApiException('bad_request', 'proxy_user_id required when method=proxy', 400);
        }
    }
    $note = isset($body['note']) ? mb_substr((string)$body['note'], 0, 500) : null;

    $st = $pdo->prepare("
        SELECT rr.id, rr.amount_yen, r.title, r.creator_user_id
          FROM money_request_recipients rr
          JOIN money_requests r ON r.id = rr.request_id
         WHERE rr.request_id = ? AND rr.user_id = ?");
    $st->execute([$id, $u['id']]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'あなた宛の請求が見つかりません', 404);

    $pdo->prepare("UPDATE money_request_recipients
        SET paid_at = NOW(), paid_method = ?, paid_proxy_user_id = ?, paid_note = ?
        WHERE id = ?")->execute([$method, $proxyId, $note, $row['id']]);

    // creator に通知
    if ((int)$row['creator_user_id'] !== (int)$u['id']) {
        $methodLabel = ['cash' => '現金', 'paypay' => 'PayPay', 'bank' => '銀行振込', 'proxy' => '立替'][$method] ?? $method;
        $msg = "💰 「{$row['title']}」: {$u['display_name']} から ¥" . number_format((int)$row['amount_yen']) . " ({$methodLabel}) 支払い済";
        notify_safely($pdo, $cfg, (int)$row['creator_user_id'], 'admin_notice', $msg, 'money_request', $id);
    }
    json_response(['ok' => true]);
}

function money_requests_unpay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id FROM money_request_recipients
        WHERE request_id = ? AND user_id = ?");
    $st->execute([$id, $u['id']]);
    $rid = (int)$st->fetchColumn();
    if (!$rid) throw new ApiException('not_found', 'あなた宛の請求が見つかりません', 404);
    $pdo->prepare("UPDATE money_request_recipients
        SET paid_at=NULL, paid_method=NULL, paid_proxy_user_id=NULL, paid_note=NULL
        WHERE id=?")->execute([$rid]);
    json_response(['ok' => true]);
}
