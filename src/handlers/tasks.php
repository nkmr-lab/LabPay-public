<?php
// /api/tasks — lab task system with escrow.
// Flow: create (escrow deposit) → claim → report → approve (payout) | reject | cancel.

declare(strict_types=1);

function route_tasks(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET')   { tasks_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST')  { tasks_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0 && $method === 'GET'   && !isset($seg[2])) { tasks_detail($pdo, $cfg, $id); return; }
    if ($id > 0 && $method === 'PATCH' && !isset($seg[2])) { tasks_update($pdo, $cfg, $id); return; }
    if ($id > 0 && ($seg[2] ?? '') === 'claim'  && $method === 'POST') { tasks_claim($pdo, $cfg, $id); return; }
    if ($id > 0 && ($seg[2] ?? '') === 'cancel' && $method === 'POST') { tasks_cancel($pdo, $cfg, $id); return; }
    if ($id > 0 && ($seg[2] ?? '') === 'claims' && isset($seg[3])) {
        $claimId = (int)$seg[3];
        $action  = $seg[4] ?? '';
        if ($action === 'report'  && $method === 'POST') { tasks_report($pdo, $cfg, $id, $claimId); return; }
        if ($action === 'approve' && $method === 'POST') { tasks_approve($pdo, $cfg, $id, $claimId); return; }
        if ($action === 'reject'  && $method === 'POST') { tasks_reject($pdo, $cfg, $id, $claimId); return; }
    }

    json_error('not_found', "no tasks route for $method $sub", 404);
}

// ---------- helpers ----------

// Cancel any open task whose deadline has passed. Refunds unused escrow to requester
// and marks pending claims cancelled. Called at the top of list/detail to keep state fresh.
function tasks_sweep_expired(PDO $pdo, array $cfg): void {
    $st = $pdo->query("SELECT id FROM tasks
        WHERE status='open' AND deadline IS NOT NULL AND deadline < NOW()");
    $ids = array_column($st->fetchAll(), 'id');
    foreach ($ids as $id) {
        try { tasks_auto_expire_one($pdo, $cfg, (int)$id); }
        catch (Throwable $e) { error_log('[tasks] auto-expire failed for ' . $id . ': ' . $e->getMessage()); }
    }
}

function tasks_auto_expire_one(PDO $pdo, array $cfg, int $taskId): void {
    $pdo->beginTransaction();
    $title = ''; $requesterId = 0; $refund = 0;
    try {
        $st = $pdo->prepare("SELECT * FROM tasks WHERE id=? AND status='open' FOR UPDATE");
        $st->execute([$taskId]);
        $task = $st->fetch();
        if (!$task) { $pdo->rollBack(); return; }

        $approved = tasks_approved_count($pdo, $taskId);
        $refund   = ((int)$task['capacity'] - $approved) * (int)$task['reward'];
        if ($refund > 0) {
            $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
            $userAcc = Ledger::accountIdForUser($pdo, (int)$task['requester_user_id']);
            Ledger::transfer($pdo, $escAcc, $userAcc, $refund, 'refund',
                'task', $taskId, "タスク「{$task['title']}」期限切れ返金");
        }
        $pdo->prepare("UPDATE tasks SET status='cancelled', closed_at=NOW() WHERE id=?")->execute([$taskId]);
        $pdo->prepare("UPDATE task_claims SET status='cancelled'
            WHERE task_id=? AND status IN ('claimed','reported')")->execute([$taskId]);

        $title = (string)$task['title'];
        $requesterId = (int)$task['requester_user_id'];
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    try {
        Notifier::notify($pdo, $cfg, $requesterId, 'task_expired',
            "「$title」が期限切れで取消されました" . ($refund > 0 ? " ({$refund}pt 返金)" : ''),
            'task', $taskId);
    } catch (Throwable $e) {}
}

// Validate a task URL: optional, http(s) only, max 2000 chars, no embedded credentials.
function tasks_validate_url($raw): ?string {
    if ($raw === null) return null;
    $u = trim((string)$raw);
    if ($u === '') return null;
    if (strlen($u) > 2000) throw new ApiException('bad_request', 'url too long (max 2000)', 400);
    if (!filter_var($u, FILTER_VALIDATE_URL)) throw new ApiException('bad_request', 'url is not a valid URL', 400);
    $scheme = strtolower((string)parse_url($u, PHP_URL_SCHEME));
    if ($scheme !== 'http' && $scheme !== 'https') {
        throw new ApiException('bad_request', 'url must be http(s)', 400);
    }
    if (parse_url($u, PHP_URL_USER) !== null) {
        throw new ApiException('bad_request', 'url must not contain credentials', 400);
    }
    return $u;
}

function tasks_user_grade(PDO $pdo, int $userId): ?string {
    $st = $pdo->prepare('SELECT grade FROM users WHERE id=?');
    $st->execute([$userId]);
    return $st->fetchColumn() ?: null;
}

function tasks_can_apply_to_grade(?string $userGrade, ?string $audienceCsv): bool {
    if ($audienceCsv === null || trim($audienceCsv) === '') return true;
    $allowed = array_filter(array_map('trim', explode(',', $audienceCsv)));
    return in_array((string)$userGrade, $allowed, true);
}

// User-active claim count (claimed/reported/approved). Cancelled/rejected don't count.
function tasks_user_active_claim_count(PDO $pdo, int $taskId, int $userId): int {
    $st = $pdo->prepare("SELECT COUNT(*) FROM task_claims
        WHERE task_id=? AND user_id=? AND status IN ('claimed','reported','approved')");
    $st->execute([$taskId, $userId]);
    return (int)$st->fetchColumn();
}

function tasks_approved_count(PDO $pdo, int $taskId): int {
    $st = $pdo->prepare("SELECT COUNT(*) FROM task_claims WHERE task_id=? AND status='approved'");
    $st->execute([$taskId]);
    return (int)$st->fetchColumn();
}

// Pull task row + requester info + claim summary, for display.
function tasks_fetch_with_meta(PDO $pdo, int $taskId, ?int $forUserId = null): array {
    $st = $pdo->prepare("
        SELECT t.*, u.display_name AS requester_name, u.avatar_url AS requester_avatar_url
          FROM tasks t JOIN users u ON u.id = t.requester_user_id
         WHERE t.id = ?");
    $st->execute([$taskId]);
    $row = $st->fetch();
    if (!$row) throw new ApiException('not_found', "task $taskId not found", 404);
    $row['approved_count'] = tasks_approved_count($pdo, $taskId);
    $row['remaining']      = max(0, (int)$row['capacity'] - $row['approved_count']);
    if ($forUserId !== null) {
        $st2 = $pdo->prepare("SELECT id, status, reported_at, approved_at, notes, created_at
            FROM task_claims WHERE task_id=? AND user_id=? ORDER BY id DESC");
        $st2->execute([$taskId, $forUserId]);
        $row['my_claims'] = $st2->fetchAll();
    }
    return $row;
}

// ---------- GET /api/tasks?filter=... ----------
function tasks_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    tasks_sweep_expired($pdo, $cfg);
    $filter = $_GET['filter'] ?? 'available';
    $userGrade = tasks_user_grade($pdo, (int)$u['id']);

    if ($filter === 'mine') {
        // tasks I created
        $st = $pdo->prepare("
            SELECT t.*, u.display_name AS requester_name, u.avatar_url AS requester_avatar_url,
                   (SELECT COUNT(*) FROM task_claims WHERE task_id=t.id AND status='approved') AS approved_count,
                   (SELECT COUNT(*) FROM task_claims WHERE task_id=t.id AND status IN ('claimed','reported')) AS pending_count
              FROM tasks t JOIN users u ON u.id = t.requester_user_id
             WHERE t.requester_user_id = ? ORDER BY t.id DESC");
        $st->execute([$u['id']]);
    } elseif ($filter === 'active') {
        // tasks I'm working on (claimed or reported)
        $st = $pdo->prepare("
            SELECT t.*, u.display_name AS requester_name, u.avatar_url AS requester_avatar_url,
                   tc.status AS my_status
              FROM task_claims tc
              JOIN tasks t ON t.id = tc.task_id
              JOIN users u ON u.id = t.requester_user_id
             WHERE tc.user_id = ? AND tc.status IN ('claimed','reported')
             ORDER BY tc.id DESC");
        $st->execute([$u['id']]);
    } else {
        // 'available': open tasks I haven't filled my slot on, and audience matches
        $st = $pdo->prepare("
            SELECT t.*, u.display_name AS requester_name, u.avatar_url AS requester_avatar_url,
                   (SELECT COUNT(*) FROM task_claims WHERE task_id=t.id AND status='approved') AS approved_count,
                   (SELECT COUNT(*) FROM task_claims
                      WHERE task_id=t.id AND user_id=?
                        AND status IN ('claimed','reported','approved')) AS my_active
              FROM tasks t JOIN users u ON u.id = t.requester_user_id
             WHERE t.status = 'open' AND t.requester_user_id != ?
             ORDER BY t.id DESC");
        $st->execute([$u['id'], $u['id']]);
    }
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['remaining'] = isset($r['approved_count'])
            ? max(0, (int)$r['capacity'] - (int)$r['approved_count'])
            : null;
        if ($filter === 'available') {
            $myActive = (int)($r['my_active'] ?? 0);
            $perLimit = (int)$r['per_user_limit'];
            $r['can_claim'] = ($perLimit === 0 || $myActive < $perLimit)
                && $r['remaining'] > 0
                && tasks_can_apply_to_grade($userGrade, $r['audience_grades']);
        }
    }
    json_response(['items' => $rows]);
}

// ---------- GET /api/tasks/{id} ----------
function tasks_detail(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    tasks_sweep_expired($pdo, $cfg);
    $task = tasks_fetch_with_meta($pdo, $taskId, (int)$u['id']);

    // Requester sees all claims; non-requester sees only their own claims.
    if ((int)$task['requester_user_id'] === (int)$u['id']) {
        $st = $pdo->prepare("
            SELECT tc.*, u.display_name, u.avatar_url
              FROM task_claims tc JOIN users u ON u.id = tc.user_id
             WHERE tc.task_id = ? ORDER BY tc.id DESC");
        $st->execute([$taskId]);
        $task['claims'] = $st->fetchAll();
    }
    json_response($task);
}

// ---------- POST /api/tasks ----------
function tasks_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    $description   = optional_text_field($body, 'description', 5000);
    $url           = tasks_validate_url($body['url'] ?? null);
    $completionMsg = optional_text_field($body, 'completion_message', 2000);
    $reward   = require_int_positive($body['reward']   ?? null, 'reward');
    $capacity = require_int_positive($body['capacity'] ?? null, 'capacity');
    $perLimit = require_int_nonneg($body['per_user_limit'] ?? 1, 'per_user_limit');

    // Optional deadline (accept ISO Y-m-d H:i:s or Y-m-d\TH:i from <input type=datetime-local>)
    $deadline = null;
    if (isset($body['deadline']) && trim((string)$body['deadline']) !== '') {
        $raw = trim((string)$body['deadline']);
        $raw = str_replace('T', ' ', $raw);
        if (strlen($raw) === 16) $raw .= ':00';
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'deadline must be Y-m-d H:i:s', 400);
        if ($dt < (new DateTimeImmutable('now'))->modify('-1 minute')) {
            throw new ApiException('bad_request', '締切は未来の日時で', 400);
        }
        $deadline = $dt->format('Y-m-d H:i:s');
    }

    // audience_grades: accept either array or CSV string
    $aud = $body['audience_grades'] ?? null;
    if (is_array($aud)) $aud = implode(',', array_map('trim', $aud));
    if (is_string($aud)) $aud = trim($aud);
    if ($aud === '' || $aud === null) $aud = null;

    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $totalEscrow = $reward * $capacity;

    $pdo->beginTransaction();
    try {
        // Insert task first to get id
        $ins = $pdo->prepare('INSERT INTO tasks
            (requester_user_id, title, description, url, reward, capacity, per_user_limit, deadline, audience_grades, completion_message)
            VALUES (?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([$u['id'], $title, $description, $url, $reward, $capacity, $perLimit, $deadline, $aud, $completionMsg]);
        $taskId = (int)$pdo->lastInsertId();

        // Move escrow: requester → ESCROW
        $userAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
        $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
        Ledger::transfer($pdo, $userAcc, $escAcc, $totalEscrow, 'deposit',
            'task', $taskId, "タスク「$title」報酬預け");

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    json_response(tasks_fetch_with_meta($pdo, $taskId, (int)$u['id']));
}

// ---------- PATCH /api/tasks/{id} ----------
// Requester-only edit of an open task. Reward/capacity changes settle the escrow
// difference automatically (top-up if going up, refund if going down).
function tasks_update(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? FOR UPDATE');
        $st->execute([$taskId]);
        $task = $st->fetch();
        if (!$task)
            throw new ApiException('not_found', 'task not found', 404);
        if ((int)$task['requester_user_id'] !== (int)$u['id'])
            throw new ApiException('forbidden', '依頼者のみ編集可能です', 403);
        if ($task['status'] !== 'open')
            throw new ApiException('not_open', 'task is not open', 409);

        $approved   = tasks_approved_count($pdo, $taskId);
        $newTitle   = array_key_exists('title', $body) ? trim((string)$body['title']) : (string)$task['title'];
        $newDesc    = patch_text_field($body, 'description',        5000, $task['description']);
        $newUrl     = array_key_exists('url', $body) ? tasks_validate_url($body['url']) : ($task['url'] ?? null);
        $newCMsg    = patch_text_field($body, 'completion_message', 2000, $task['completion_message'] ?? null);
        $newReward  = array_key_exists('reward', $body)         ? require_int_positive($body['reward'],   'reward')        : (int)$task['reward'];
        $newCap     = array_key_exists('capacity', $body)       ? require_int_positive($body['capacity'], 'capacity')      : (int)$task['capacity'];
        $newPerLim  = array_key_exists('per_user_limit', $body) ? require_int_nonneg($body['per_user_limit'], 'per_user_limit') : (int)$task['per_user_limit'];

        if ($newTitle === '' || mb_strlen($newTitle) > 200)
            throw new ApiException('bad_request', 'title length 1..200', 400);
        if ($newCap < $approved)
            throw new ApiException('bad_capacity', "承認済み {$approved} 件あるため募集人数を {$newCap} に減らせません", 400);

        // Deadline (NULL clears it)
        $newDeadline = $task['deadline'];
        if (array_key_exists('deadline', $body)) {
            $d = $body['deadline'];
            if ($d === null || trim((string)$d) === '') {
                $newDeadline = null;
            } else {
                $raw = str_replace('T', ' ', trim((string)$d));
                if (strlen($raw) === 16) $raw .= ':00';
                $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
                if (!$dt) throw new ApiException('bad_request', 'deadline must be Y-m-d H:i:s', 400);
                if ($dt < (new DateTimeImmutable('now'))->modify('-1 minute'))
                    throw new ApiException('bad_request', '締切は未来の日時で', 400);
                $newDeadline = $dt->format('Y-m-d H:i:s');
            }
        }

        // Audience grades
        $newAud = $task['audience_grades'];
        if (array_key_exists('audience_grades', $body)) {
            $aud = $body['audience_grades'];
            if (is_array($aud)) $aud = implode(',', array_map('trim', $aud));
            if (is_string($aud)) $aud = trim($aud);
            $newAud = ($aud === '' || $aud === null) ? null : $aud;
        }

        // Escrow settlement: pay only on the *unpaid* slots; approved slots are already settled.
        $oldUnpaid = (int)$task['reward'] * ((int)$task['capacity'] - $approved);
        $newUnpaid = $newReward * ($newCap - $approved);
        $delta = $newUnpaid - $oldUnpaid;
        if ($delta !== 0) {
            $userAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
            $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
            if ($delta > 0) {
                Ledger::transfer($pdo, $userAcc, $escAcc, $delta, 'deposit',
                    'task', $taskId, "タスク「{$newTitle}」変更による追加預け");
            } else {
                Ledger::transfer($pdo, $escAcc, $userAcc, -$delta, 'refund',
                    'task', $taskId, "タスク「{$newTitle}」変更による差額返金");
            }
        }

        $pdo->prepare('UPDATE tasks SET title=?, description=?, url=?, completion_message=?,
            reward=?, capacity=?, per_user_limit=?, deadline=?, audience_grades=? WHERE id=?')
            ->execute([$newTitle, $newDesc, $newUrl, $newCMsg,
                       $newReward, $newCap, $newPerLim, $newDeadline, $newAud, $taskId]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    json_response(tasks_fetch_with_meta($pdo, $taskId, (int)$u['id']));
}

// ---------- POST /api/tasks/{id}/claim ----------
function tasks_claim(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $userGrade = tasks_user_grade($pdo, (int)$u['id']);

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? FOR UPDATE');
        $st->execute([$taskId]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('not_found', 'task not found', 404);
        if ($task['status'] !== 'open') throw new ApiException('not_open', 'task is not open', 409);
        if ((int)$task['requester_user_id'] === (int)$u['id'])
            throw new ApiException('self_claim', '自分のタスクには参加できません', 400);
        if (!tasks_can_apply_to_grade($userGrade, $task['audience_grades']))
            throw new ApiException('audience', '対象外の学年です', 403);

        $approved = tasks_approved_count($pdo, $taskId);
        if ($approved >= (int)$task['capacity'])
            throw new ApiException('full', '定員到達済みです', 409);

        $myActive = tasks_user_active_claim_count($pdo, $taskId, (int)$u['id']);
        if ((int)$task['per_user_limit'] > 0 && $myActive >= (int)$task['per_user_limit'])
            throw new ApiException('per_user_limit', '引き受け上限に達しています', 409);

        $ins = $pdo->prepare("INSERT INTO task_claims (task_id, user_id, status) VALUES (?,?,'claimed')");
        $ins->execute([$taskId, $u['id']]);
        $claimId = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    try {
        Notifier::notify($pdo, $cfg, (int)$task['requester_user_id'], 'task_claimed',
            "{$u['display_name']} が「{$task['title']}」を引き受けました", 'task', $taskId);
    } catch (Throwable $e) {}
    json_response(['ok' => true, 'claim_id' => $claimId]);
}

// ---------- POST /api/tasks/{id}/claims/{claim_id}/report ----------
function tasks_report(PDO $pdo, array $cfg, int $taskId, int $claimId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $notes = optional_text_field($body, 'notes', 2000);

    $upd = $pdo->prepare("UPDATE task_claims
        SET status='reported', notes=?, reported_at=NOW()
        WHERE id=? AND task_id=? AND user_id=? AND status='claimed'");
    $upd->execute([$notes, $claimId, $taskId, $u['id']]);
    if ($upd->rowCount() === 0)
        throw new ApiException('bad_state', 'claim not found or not in claimed state', 409);

    $task = tasks_fetch_with_meta($pdo, $taskId);
    try {
        $body = "{$u['display_name']} が「{$task['title']}」を完了報告しました — 承認をお願いします"
              . notification_quote($notes);
        Notifier::notify($pdo, $cfg, (int)$task['requester_user_id'], 'task_reported',
            $body, 'task', $taskId);
    } catch (Throwable $e) {}
    json_response(['ok' => true]);
}

// ---------- POST /api/tasks/{id}/claims/{claim_id}/approve ----------
function tasks_approve(PDO $pdo, array $cfg, int $taskId, int $claimId): void {
    $u = Auth::requireUser($pdo, $cfg);

    $rewardForNotify = 0; $claimantId = 0; $title = ''; $taskClosed = false;
    $completionMsg = null;
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? AND requester_user_id=? FOR UPDATE');
        $st->execute([$taskId, $u['id']]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('forbidden', '依頼者のみ承認できます', 403);
        if ($task['status'] !== 'open')
            throw new ApiException('not_open', 'task is not open', 409);

        $st2 = $pdo->prepare("SELECT * FROM task_claims
            WHERE id=? AND task_id=? AND status='reported' FOR UPDATE");
        $st2->execute([$claimId, $taskId]);
        $claim = $st2->fetch();
        if (!$claim) throw new ApiException('bad_state', '報告済みの請求が見つかりません', 409);

        $escAcc      = Ledger::accountIdByCode($pdo, 'ESCROW');
        $claimantAcc = Ledger::accountIdForUser($pdo, (int)$claim['user_id']);
        $ledgerId = Ledger::transfer($pdo, $escAcc, $claimantAcc, (int)$task['reward'],
            'task_reward', 'task', $taskId, "タスク「{$task['title']}」報酬");

        $upd = $pdo->prepare("UPDATE task_claims SET status='approved', approved_at=NOW(),
            approved_by_user_id=?, ledger_id=? WHERE id=?");
        $upd->execute([$u['id'], $ledgerId, $claimId]);

        // Auto-close when capacity reached
        $approved = tasks_approved_count($pdo, $taskId);
        if ($approved >= (int)$task['capacity']) {
            $pdo->prepare("UPDATE tasks SET status='closed', closed_at=NOW() WHERE id=?")->execute([$taskId]);
            $taskClosed = true;
        }
        $rewardForNotify = (int)$task['reward'];
        $claimantId      = (int)$claim['user_id'];
        $title           = (string)$task['title'];
        $completionMsg   = $task['completion_message'] ?? null;

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    try {
        // Requester's thank-you message piggy-backs on the approval notification
        // so it surfaces immediately like note's purchase-time message.
        $body = "「$title」承認 — {$rewardForNotify}pt が付与されました"
              . notification_quote($completionMsg);
        Notifier::notify($pdo, $cfg, $claimantId, 'task_approved', $body, 'task', $taskId);
    } catch (Throwable $e) {}
    json_response(['ok' => true, 'task_closed' => $taskClosed, 'completion_message' => $completionMsg]);
}

// ---------- POST /api/tasks/{id}/claims/{claim_id}/reject ----------
function tasks_reject(PDO $pdo, array $cfg, int $taskId, int $claimId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $upd = $pdo->prepare("UPDATE task_claims tc
        JOIN tasks t ON t.id = tc.task_id
        SET tc.status='rejected'
        WHERE tc.id=? AND tc.task_id=? AND t.requester_user_id=?
          AND tc.status IN ('claimed','reported')");
    $upd->execute([$claimId, $taskId, $u['id']]);
    if ($upd->rowCount() === 0)
        throw new ApiException('bad_state', '却下できない状態です', 409);
    json_response(['ok' => true]);
}

// ---------- POST /api/tasks/{id}/cancel ----------
function tasks_cancel(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);

    $affectedClaimants = [];
    $taskTitle = '';
    $refund = 0;
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? AND requester_user_id=? FOR UPDATE');
        $st->execute([$taskId, $u['id']]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('forbidden', '依頼者のみ取消可能です', 403);
        if ($task['status'] !== 'open')
            throw new ApiException('not_open', 'task is not open', 409);
        $taskTitle = (string)$task['title'];

        // Collect pending claimants for notification
        $aq = $pdo->prepare("SELECT DISTINCT user_id FROM task_claims
            WHERE task_id=? AND status IN ('claimed','reported')");
        $aq->execute([$taskId]);
        $affectedClaimants = array_column($aq->fetchAll(), 'user_id');

        $approved = tasks_approved_count($pdo, $taskId);
        $refund   = ((int)$task['capacity'] - $approved) * (int)$task['reward'];
        if ($refund > 0) {
            $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
            $userAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
            Ledger::transfer($pdo, $escAcc, $userAcc, $refund, 'refund',
                'task', $taskId, "タスク「{$task['title']}」取消返金");
        }

        $pdo->prepare("UPDATE tasks SET status='cancelled', closed_at=NOW() WHERE id=?")->execute([$taskId]);
        $pdo->prepare("UPDATE task_claims SET status='cancelled'
            WHERE task_id=? AND status IN ('claimed','reported')")->execute([$taskId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    foreach ($affectedClaimants as $cid) {
        try {
            Notifier::notify($pdo, $cfg, (int)$cid, 'task_cancelled',
                "引き受け中のタスク「$taskTitle」が依頼者により取り消されました", 'task', $taskId);
        } catch (Throwable $e) {}
    }
    json_response(['ok' => true, 'refunded' => $refund]);
}
