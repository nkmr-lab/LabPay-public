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
    if ($id > 0 && ($seg[2] ?? '') === 'close'  && $method === 'POST') { tasks_close ($pdo, $cfg, $id); return; }
    if ($id > 0 && ($seg[2] ?? '') === 'attachments' && $method === 'POST' && !isset($seg[3])) {
        task_attachments_upload($pdo, $cfg, $id); return;
    }
    if ($id > 0 && ($seg[2] ?? '') === 'attachments' && isset($seg[3]) && $method === 'DELETE') {
        task_attachments_delete($pdo, $cfg, $id, (int)$seg[3]); return;
    }
    if ($id > 0 && ($seg[2] ?? '') === 'attachments' && isset($seg[3]) && $method === 'GET') {
        task_attachments_download($pdo, $cfg, $id, (int)$seg[3]); return;
    }
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
            "「{$title}」が期限切れで取消されました" . ($refund > 0 ? " ({$refund}pt 返金)" : ''),
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

// v790 #393 完了 時 入力 欄 (起案者 定義) を 検証 して JSON 文字列 で 返す。 null なら NULL 保存。
function tasks_validate_completion_fields($raw): ?string {
    if ($raw === null || $raw === '' || $raw === []) return null;
    if (is_string($raw)) {
        $dec = json_decode($raw, true);
        if (!is_array($dec)) throw new ApiException('bad_request', 'completion_fields は JSON 配列', 400);
        $raw = $dec;
    }
    if (!is_array($raw)) throw new ApiException('bad_request', 'completion_fields は 配列', 400);
    if (count($raw) > 10) throw new ApiException('bad_request', '完了 入力 欄 は 最大 10 個 まで', 400);
    $allowedTypes = ['text', 'textarea', 'select'];
    $out = [];
    $seenKeys = [];
    foreach ($raw as $f) {
        if (!is_array($f)) throw new ApiException('bad_request', '各 field は object', 400);
        $key = trim((string)($f['key'] ?? ''));
        $label = trim((string)($f['label'] ?? ''));
        $type = trim((string)($f['type'] ?? 'text'));
        if ($key === '' || $label === '') throw new ApiException('bad_request', 'key / label が 必須', 400);
        if (!preg_match('/^[A-Za-z0-9_-]{1,32}$/', $key)) {
            throw new ApiException('bad_request', 'key は 英数字 + _- のみ、 32 字 以内', 400);
        }
        if (isset($seenKeys[$key])) throw new ApiException('bad_request', 'key 重複: ' . $key, 400);
        $seenKeys[$key] = true;
        if (!in_array($type, $allowedTypes, true)) {
            throw new ApiException('bad_request', 'type は text/textarea/select のみ', 400);
        }
        $entry = [
            'key' => $key,
            'label' => mb_substr($label, 0, 100),
            'type' => $type,
            'required' => !empty($f['required']),
        ];
        if (!empty($f['placeholder'])) $entry['placeholder'] = mb_substr((string)$f['placeholder'], 0, 200);
        if ($type === 'select') {
            $opts = $f['options'] ?? [];
            if (!is_array($opts) || count($opts) < 1) {
                throw new ApiException('bad_request', 'select は options が 必要', 400);
            }
            $entry['options'] = array_values(array_map(fn($o) => mb_substr((string)$o, 0, 100), $opts));
        }
        $out[] = $entry;
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}

// v790 #393 完了 時 入力 値 を 定義 に 照らして 検証 + 正規化。
//   $fieldsDef = decoded array (= completion_fields_json)
//   $data      = client が 送って きた key→value (string)
//   戻り値: 正規化 した key→value の 配列 (JSON 化 して 保存 する 用)
function tasks_validate_completion_data($fieldsDef, $data): array {
    $out = [];
    if (!is_array($fieldsDef) || empty($fieldsDef)) return $out;
    if (!is_array($data)) $data = [];
    foreach ($fieldsDef as $field) {
        $k = $field['key'];
        $val = (string)($data[$k] ?? '');
        $val = trim($val);
        if ($val === '') {
            if (!empty($field['required'])) {
                throw new ApiException('bad_request', "「{$field['label']}」 は 入力 必須 です", 400);
            }
            continue;
        }
        if (mb_strlen($val) > 5000) {
            throw new ApiException('bad_request', "「{$field['label']}」 が 長 すぎ ます (5000 字 まで)", 400);
        }
        if ($field['type'] === 'select') {
            if (!in_array($val, $field['options'] ?? [], true)) {
                throw new ApiException('bad_request', "「{$field['label']}」 は 選択肢 から 選んで ください", 400);
            }
        }
        $out[$k] = $val;
    }
    return $out;
}

// Parse a free-text "時間枠" spec into a list of (start, end) DateTime pairs.
//
// Supported per-line patterns (use a multi-line spec to mix days):
//   6/15 11:00-15:00 30分刻み      -> generates 8 slots (start..start+30) until end
//   6/15 11:00-15:00 60分刻み      -> 4 slots
//   2026-06-15 11:00-15:00 30分刻み -> explicit year
//
// Year fallback: when omitted, use the current year — bumping to next year if the
// resulting date is already in the past.
function tasks_parse_slot_spec(string $spec, ?DateTimeImmutable $now = null): array {
    $now = $now ?? new DateTimeImmutable('now');
    $slots = [];
    foreach (preg_split('/\R/u', $spec) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        // YYYY-M(M)-D(D)  or  M(M)/D(D)  then  HH:MM-HH:MM  then  N分刻み
        $pat = '/^(?:(\d{4})[-\/])?(\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(\d+)\s*分刻み\s*$/u';
        if (!preg_match($pat, $line, $m)) continue;
        $year   = $m[1] !== '' ? (int)$m[1] : (int)$now->format('Y');
        $month  = (int)$m[2];
        $day    = (int)$m[3];
        $startH = (int)$m[4]; $startM = (int)$m[5];
        $endH   = (int)$m[6]; $endM   = (int)$m[7];
        $stride = (int)$m[8];
        if ($stride < 1 || $stride > 24 * 60) continue;
        try {
            $start = new DateTimeImmutable(sprintf('%04d-%02d-%02d %02d:%02d:00', $year, $month, $day, $startH, $startM));
            $end   = $start->setTime($endH, $endM);
        } catch (Throwable $e) { continue; }
        // Year omitted + day already passed → bump to next year.
        if ($m[1] === '' && $end < $now) {
            $start = $start->modify('+1 year');
            $end   = $end->modify('+1 year');
        }
        if ($end <= $start) continue;
        $cur = $start;
        while ($cur < $end) {
            $next = $cur->modify("+{$stride} minutes");
            if ($next > $end) break;
            $slots[] = [
                'start' => $cur->format('Y-m-d H:i:s'),
                'end'   => $next->format('Y-m-d H:i:s'),
            ];
            $cur = $next;
        }
        if (count($slots) > 200) break; // safety: cap absurd specs
    }
    return $slots;
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
        // v790 #393 completion_data_json も 返す (受諾 者 が 完了 報告 時 に 埋めた 値)
        $st2 = $pdo->prepare("SELECT id, status, slot_id, reported_at, approved_at, notes, completion_data_json, created_at
            FROM task_claims WHERE task_id=? AND user_id=? ORDER BY id DESC");
        $st2->execute([$taskId, $forUserId]);
        $myRows = $st2->fetchAll();
        foreach ($myRows as &$c) {
            $c['completion_data'] = !empty($c['completion_data_json'])
                ? json_decode((string)$c['completion_data_json'], true) : null;
            unset($c['completion_data_json']);
        }
        unset($c);
        $row['my_claims'] = $myRows;
    }
    // v790 #393 起案者 向け に 完了 入力 欄 定義 を decoded で 返す
    if (!empty($row['completion_fields_json'])) {
        $row['completion_fields'] = json_decode((string)$row['completion_fields_json'], true) ?: [];
    } else {
        $row['completion_fields'] = [];
    }

    // Slots (if any) — include per-slot claim counts so the picker can grey out
    // already-filled options.
    $stS = $pdo->prepare("
        SELECT s.id, s.started_at, s.ended_at, s.capacity,
               COALESCE((SELECT COUNT(*) FROM task_claims tc
                  WHERE tc.slot_id = s.id
                    AND tc.status IN ('claimed','reported','approved')), 0) AS taken
          FROM task_slots s
         WHERE s.task_id = ?
         ORDER BY s.started_at");
    $stS->execute([$taskId]);
    $row['slots'] = $stS->fetchAll();

    // Attachments. The download URL goes through /api/tasks/{id}/attachments/{att_id}
    // (not the raw /uploads path) so we can attribute hits and could later gate on
    // task visibility — currently all logged-in users can see all tasks anyway.
    $stA = $pdo->prepare("
        SELECT id, filename, size_bytes, mime, uploaded_by_user_id, created_at
          FROM task_attachments
         WHERE task_id = ? ORDER BY id");
    $stA->execute([$taskId]);
    $row['attachments'] = $stA->fetchAll();

    return $row;
}

// ---------- attachment upload / download / delete ----------
// Stored under public/uploads/tasks/{task_id}/{stored_name}. The bytes ARE
// also reachable via /uploads/... if someone discovers the path — accepted
// trade-off given the small lab scope, no auth-walled download required.
// Allowlist of MIME types — keeps an obvious foothold against drive-by uploads
// of executable content. Extend cautiously.
const TASK_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const TASK_ATTACHMENT_MIME = [
    'application/pdf'                                                         => 'pdf',
    'application/msword'                                                      => 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
    'application/vnd.ms-excel'                                                => 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'       => 'xlsx',
    'application/vnd.ms-powerpoint'                                           => 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'=> 'pptx',
    'application/zip'                                                         => 'zip',
    'application/x-zip-compressed'                                            => 'zip',
    'text/plain'                                                              => 'txt',
    'text/markdown'                                                           => 'md',
    'text/csv'                                                                => 'csv',
    'image/jpeg'                                                              => 'jpg',
    'image/png'                                                               => 'png',
    'image/gif'                                                               => 'gif',
    'image/webp'                                                              => 'webp',
    'image/heic'                                                              => 'heic',
    'image/heif'                                                              => 'heif',
];

function task_attachments_upload(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);

    // Authorization: only the requester can attach files. We could broaden this
    // (claimed workers, admin) but for the 原稿チェック flow the requester is
    // the only sensible uploader.
    $st = $pdo->prepare("SELECT requester_user_id, title, status FROM tasks WHERE id=?");
    $st->execute([$taskId]);
    $task = $st->fetch();
    if (!$task) throw new ApiException('not_found', "task $taskId not found", 404);
    if ((int)$task['requester_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '依頼者のみ添付できます', 403);
    }
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        throw new ApiException('no_file', 'multipart field "file" is required', 400);
    }

    $saved = save_uploaded_file($_FILES['file'], 'uploads/tasks/' . $taskId,
        TASK_ATTACHMENT_MAX_BYTES, TASK_ATTACHMENT_MIME);

    // Sanitize the client-supplied original filename for display only. The
    // on-disk name uses the helper-generated random stored_name.
    $orig = mb_substr(basename((string)($_FILES['file']['name'] ?? '')), 0, 255);
    if ($orig === '') $orig = 'attachment.' . $saved['ext'];

    $ins = $pdo->prepare("INSERT INTO task_attachments
        (task_id, filename, stored_name, size_bytes, mime, uploaded_by_user_id)
        VALUES (?,?,?,?,?,?)");
    $ins->execute([$taskId, $orig, $saved['stored_name'], $saved['size'], $saved['mime'], $u['id']]);
    $attId = (int)$pdo->lastInsertId();

    json_response([
        'ok' => true,
        'id' => $attId,
        'filename'   => $orig,
        'size_bytes' => $saved['size'],
        'mime'       => $saved['mime'],
    ]);
}

function task_attachments_download(PDO $pdo, array $cfg, int $taskId, int $attId): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM task_attachments WHERE id=? AND task_id=?");
    $st->execute([$attId, $taskId]);
    $att = $st->fetch();
    if (!$att) throw new ApiException('not_found', "attachment not found", 404);

    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $path = $publicDir . '/uploads/tasks/' . $taskId . '/' . $att['stored_name'];
    if (!is_file($path)) throw new ApiException('gone', 'file missing on disk', 410);

    // Stream the bytes inline-or-attachment with the original filename.
    if (!headers_sent()) {
        // Note: we already sent Content-Type: application/json from the front
        // controller. Override.
        header_remove('Content-Type');
    }
    header('Content-Type: ' . $att['mime']);
    header('Content-Length: ' . (int)$att['size_bytes']);
    // RFC 5987 filename* fallback for non-ASCII names.
    $asciiName = preg_replace('/[^\x20-\x7e]/', '_', $att['filename']);
    header('Content-Disposition: attachment; filename="' . addslashes($asciiName) . '"; '
        . "filename*=UTF-8''" . rawurlencode($att['filename']));
    readfile($path);
    exit;
}

function task_attachments_delete(PDO $pdo, array $cfg, int $taskId, int $attId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT a.*, t.requester_user_id
        FROM task_attachments a JOIN tasks t ON t.id=a.task_id
        WHERE a.id=? AND a.task_id=?");
    $st->execute([$attId, $taskId]);
    $att = $st->fetch();
    if (!$att) throw new ApiException('not_found', "attachment not found", 404);
    if ((int)$att['uploaded_by_user_id'] !== (int)$u['id']
        && (int)$att['requester_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '削除権限がありません', 403);
    }

    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $path = $publicDir . '/uploads/tasks/' . $taskId . '/' . $att['stored_name'];
    if (is_file($path)) @unlink($path);
    $pdo->prepare("DELETE FROM task_attachments WHERE id=?")->execute([$attId]);
    json_response(['ok' => true]);
}

// ---------- GET /api/tasks ----------
// Unified list: every task the caller has any relationship to —
// (a) tasks they created, (b) tasks they have an active claim on, (c) open tasks
// they could claim. Each row gets enough flags (is_mine / my_status / can_claim /
// pending_count) for the frontend to color-code without further roundtrips.
function tasks_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    tasks_sweep_expired($pdo, $cfg);
    $userGrade = tasks_user_grade($pdo, (int)$u['id']);
    $uid = (int)$u['id'];

    $st = $pdo->prepare("
        SELECT t.*, u.display_name AS requester_name, u.avatar_url AS requester_avatar_url,
               (SELECT COUNT(*) FROM task_claims WHERE task_id=t.id AND status='approved') AS approved_count,
               (SELECT COUNT(*) FROM task_claims WHERE task_id=t.id AND status IN ('claimed','reported')) AS pending_count,
               (SELECT status FROM task_claims
                  WHERE task_id=t.id AND user_id=? ORDER BY id DESC LIMIT 1) AS my_status,
               (SELECT COUNT(*) FROM task_claims
                  WHERE task_id=t.id AND user_id=?
                    AND status IN ('claimed','reported','approved')) AS my_active_count
          FROM tasks t
          JOIN users u ON u.id = t.requester_user_id
         WHERE t.requester_user_id = ?
            OR EXISTS (SELECT 1 FROM task_claims WHERE task_id=t.id AND user_id=?)
            OR (t.status = 'open' AND t.requester_user_id <> ?)
         ORDER BY t.id DESC");
    $st->execute([$uid, $uid, $uid, $uid, $uid]);
    $rows = $st->fetchAll();

    // 指名タスクで使う user_id → display_name の lookup を作る。各 task で個別に
    // SELECT すると N+1 になるので、全 task の assigned_user_ids を集めて 1 回で引く。
    $allAssignedIds = [];
    foreach ($rows as $r) {
        if (!empty($r['assigned_user_ids'])) {
            foreach (explode(',', (string)$r['assigned_user_ids']) as $aid) {
                $aid = (int)trim($aid);
                if ($aid > 0) $allAssignedIds[$aid] = true;
            }
        }
    }
    $nameById = [];
    if ($allAssignedIds) {
        $ids = array_keys($allAssignedIds);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $stN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
        $stN->execute($ids);
        foreach ($stN->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $nameById[(int)$row['id']] = (string)$row['display_name'];
        }
    }

    foreach ($rows as &$r) {
        $r['remaining']   = max(0, (int)$r['capacity'] - (int)$r['approved_count']);
        $r['is_mine']     = ((int)$r['requester_user_id'] === $uid);
        $myActive = (int)$r['my_active_count'];
        $perLimit = (int)$r['per_user_limit'];
        // 指名タスクの判定 (assigned_user_ids が空でなく、自分の id が含まれるか)
        $assignedIds = empty($r['assigned_user_ids'])
            ? null
            : array_map('intval', explode(',', (string)$r['assigned_user_ids']));
        $r['is_assigned_to_me'] = $assignedIds !== null && in_array($uid, $assignedIds, true);
        // 指名されてる人の名前リストを add (UI 表示用)。 lookup に無ければ 「user#42」 で fallback。
        $r['assigned_names'] = $assignedIds === null ? []
            : array_map(fn($aid) => $nameById[$aid] ?? "user#$aid", $assignedIds);
        // avatar 付きの assigned/approved リストを追加 (フロントが chip 表示するのに使う)。
        $r['assigned_users'] = $assignedIds === null ? []
            : array_values(array_filter(array_map(fn($aid) => $userById[$aid] ?? null, $assignedIds)));
        $approvedIds = $approvedByTask[(int)$r['id']] ?? [];
        $r['approved_users'] = array_values(array_filter(array_map(fn($aid) => $userById[$aid] ?? null, $approvedIds)));
        // can_claim: 指名タスクなら指名者本人だけ true、それ以外は従来の学年判定
        $audienceOk = $assignedIds !== null
            ? $r['is_assigned_to_me']
            : tasks_can_apply_to_grade($userGrade, $r['audience_grades']);
        $r['can_claim'] = $r['status'] === 'open'
            && !$r['is_mine']
            && $r['remaining'] > 0
            && ($perLimit === 0 || $myActive < $perLimit)
            && $audienceOk;
    }
    // 指名タスクは指名された本人 / 依頼者 / 既 claim 者 にだけ見せる。
    // (audience_grades の filter は SQL では効いていなくて PHP 側で「open は全員に
    // 見せる」状態だったので、指名タスクが全員に見えると煩いため frontend に
    // 投げる前に絞る)
    $rows = array_values(array_filter($rows, function ($r) use ($uid) {
        if (empty($r['assigned_user_ids'])) return true; // 通常タスク: そのまま
        if ((int)$r['requester_user_id'] === $uid)        return true; // 依頼者
        if (!empty($r['is_assigned_to_me']))              return true; // 指名された本人
        if (!empty($r['my_status']))                       return true; // 既に claim 履歴あり
        return false; // それ以外には見せない
    }));
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
        $claims = $st->fetchAll();
        // v790 #393 completion_data を decoded で 返す
        foreach ($claims as &$c) {
            $c['completion_data'] = !empty($c['completion_data_json'])
                ? json_decode((string)$c['completion_data_json'], true) : null;
            unset($c['completion_data_json']);
        }
        unset($c);
        $task['claims'] = $claims;
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
    // v790 #393 完了 時 入力 欄 (起案者 が 定義 する カスタム フィールド 群)。
    //   各 要素: { key:string, label:string, type:'text'|'textarea'|'select',
    //              required:bool, placeholder?:string, options?:string[] }
    $completionFieldsJson = tasks_validate_completion_fields($body['completion_fields'] ?? null);
    // 0 pt 許可 (ボランティア / お願いベースのタスク用)。
    $reward   = require_int_nonneg($body['reward']   ?? null, 'reward');
    $perLimit = require_int_nonneg($body['per_user_limit'] ?? 1, 'per_user_limit');
    // Optional time slot spec — parsed to (start, end) list. When present,
    // capacity becomes the slot count (1 person per slot by default).
    $slotsSpec = optional_text_field($body, 'slots_spec', 2000);
    $parsedSlots = $slotsSpec !== null ? tasks_parse_slot_spec($slotsSpec) : [];
    if ($slotsSpec !== null && empty($parsedSlots)) {
        throw new ApiException('bad_request',
            '時間枠の書式: 6/15 11:00-15:00 30分刻み (行ごとに複数日)', 400);
    }
    // If slots are provided, derive capacity from them. Otherwise require an
    // explicit capacity number like before.
    $capacity = !empty($parsedSlots)
        ? count($parsedSlots)
        : require_int_positive($body['capacity'] ?? null, 'capacity');

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

    // assigned_user_ids: 指名タスク。array or CSV を受ける。存在チェックして
    // CSV 文字列で保存。指定が空なら NULL (誰でも条件を満たせば claim 可)。
    $assignedCsv = null;
    $assignedIds = [];
    if (isset($body['assigned_user_ids'])) {
        $raw = $body['assigned_user_ids'];
        if (is_string($raw)) $raw = explode(',', $raw);
        if (is_array($raw)) {
            $assignedIds = array_values(array_unique(array_filter(array_map('intval', $raw))));
        }
        if ($assignedIds) {
            $place = implode(',', array_fill(0, count($assignedIds), '?'));
            $stCk = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
            $stCk->execute($assignedIds);
            $found = array_map('intval', array_column($stCk->fetchAll(PDO::FETCH_ASSOC), 'id'));
            if (count($found) !== count($assignedIds)) {
                throw new ApiException('bad_request', 'assigned_user_ids: 該当しない id があります', 400);
            }
            $assignedCsv = implode(',', $assignedIds);
        }
    }

    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }

    // 指名 = 「やる人として確定 (auto-claim)」 か 「audience filter (誰が claim 可)」 か。
    // - 依頼 mode (auto_claim=false): assigned_user_ids は audience filter として保存、
    //   本人が踏みに来るのを待つ。 capacity は body で指定された値。
    // - 割り当て mode (auto_claim=true): assigned_ids に task_claims を 'claimed' で
    //   先入れ。 capacity は assigned 人数に強制。
    // 後方互換: auto_claim 未指定 + assigned あり + 時間枠なし → 旧仕様の auto-claim。
    $explicitAutoClaim = $body['auto_claim'] ?? null;
    if ($explicitAutoClaim === null) {
        // legacy: 旧クライアントが assigned だけ送ってきたら auto-claim
        $autoClaim = !empty($assignedIds) && empty($parsedSlots);
    } else {
        $autoClaim = (bool)$explicitAutoClaim && !empty($assignedIds) && empty($parsedSlots);
    }
    $autoClaimIds = [];
    if ($autoClaim) {
        $autoClaimIds = array_values(array_filter(
            $assignedIds, fn($x) => $x !== (int)$u['id']));
        if (!$autoClaimIds) {
            throw new ApiException('bad_request',
                '割り当てるタスクは自分以外を 1 人以上指定してください', 400);
        }
        $capacity = count($autoClaimIds);
    }
    $totalEscrow = $reward * $capacity;
    // v874 #455 続報 admin が 「💰 システム 持ち出し」 を ON にした 場合 だけ、
    //   ESCROW へ の 入金 元 を LabPay system user (kind='system') に 切り替える。
    //   admin 以外 が送って きたら 無視 する (権限 ガード)。
    $fundedBySystem = (!empty($body['funded_by_system']) && (($u['role'] ?? '') === 'admin')) ? 1 : 0;

    $taskId = db_tx($pdo, function () use ($pdo, $u, $title, $description, $url, $reward,
                                            $capacity, $perLimit, $deadline, $aud, $assignedCsv,
                                            $completionMsg, $completionFieldsJson, $parsedSlots, $autoClaim, $autoClaimIds,
                                            $totalEscrow, $fundedBySystem) {
        // Insert task first to get id
        $ins = $pdo->prepare('INSERT INTO tasks
            (requester_user_id, title, description, completion_fields_json, url, reward, capacity, per_user_limit, funded_by_system, deadline, audience_grades, assigned_user_ids, completion_message)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([$u['id'], $title, $description, $completionFieldsJson, $url, $reward, $capacity, $perLimit, $fundedBySystem, $deadline, $aud, $assignedCsv, $completionMsg]);
        $taskId = (int)$pdo->lastInsertId();

        if (!empty($parsedSlots)) {
            $slotIns = $pdo->prepare('INSERT INTO task_slots (task_id, started_at, ended_at, capacity)
                VALUES (?,?,?,1)');
            foreach ($parsedSlots as $s) {
                $slotIns->execute([$taskId, $s['start'], $s['end']]);
            }
        }

        if ($autoClaim) {
            $cIns = $pdo->prepare("INSERT INTO task_claims (task_id, user_id, slot_id, status)
                VALUES (?,?,NULL,'claimed')");
            foreach ($autoClaimIds as $aid) {
                $cIns->execute([$taskId, $aid]);
            }
        }

        if ($totalEscrow > 0) {
            // v874 #455 続報 funded_by_system=1 のとき は LabPay system user (kind='system')
            //   を 出金 元 に する。 system user が なければ 通常 通り 起案者 から 引く (安全側)。
            $sourceUid = (int)$u['id'];
            if ($fundedBySystem) {
                $sysUid = (int)$pdo->query("SELECT id FROM users WHERE kind='system' LIMIT 1")->fetchColumn();
                if ($sysUid > 0) $sourceUid = $sysUid;
            }
            $userAcc = Ledger::accountIdForUser($pdo, $sourceUid);
            $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
            $memo = $fundedBySystem
                ? "タスク「{$title}」報酬預け (システム 持ち出し)"
                : "タスク「{$title}」報酬預け";
            Ledger::transfer($pdo, $userAcc, $escAcc, $totalEscrow, 'deposit', 'task', $taskId, $memo);
        }
        return $taskId;
    });

    // Slack 新規タスク通知 — fire-and-forget; never blocks the response.
    try {
        $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
        $taskLink = $baseUrl . '/#/tasks/' . $taskId;
        $deadlineLine = $deadline ? "\n⏰ 締切: " . $deadline : '';
        $audLine = $aud ? "\n🎓 対象: " . $aud : '';
        $urlLine = $url ? "\n🔗 " . $url : '';
        $msg = "📋 *新規タスク*  <{$taskLink}|{$title}>\n"
             . "依頼: {$u['display_name']}  ·  {$reward}pt × {$capacity}人"
             . $deadlineLine . $audLine . $urlLine;
        slack_notify($cfg, $msg);
    } catch (Throwable $e) { /* swallow */ }

    // 指名タスクなら指名された人に個別通知 (見落とし防止)。auto-claim 経路では
    // すでに「やる人」として登録済みなので、本人には承諾ではなく完了報告を促す文面に。
    foreach ($assignedIds as $aid) {
        if ($aid === (int)$u['id']) continue;
        if ($autoClaim) {
            $msg = "👉 {$u['display_name']} さんからあなた宛のタスク: 「{$title}」 ({$reward}pt) — 登録済み。完了したら「タスク」タブから報告してください";
        } else {
            $msg = "👉 {$u['display_name']} さんからあなた宛のタスク: 「{$title}」 ({$reward}pt)";
        }
        if ($deadline) $msg .= " · 締切 {$deadline}";
        notify_safely($pdo, $cfg, $aid, 'admin_notice', $msg, 'task', $taskId);
    }

    json_response(tasks_fetch_with_meta($pdo, $taskId, (int)$u['id']));
}

// ---------- PATCH /api/tasks/{id} ----------
// Requester-only edit of an open task. Reward/capacity changes settle the escrow
// difference automatically (top-up if going up, refund if going down).
function tasks_update(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();

    db_tx($pdo, function () use ($pdo, $taskId, $u, $body) {
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
        $newReward  = array_key_exists('reward', $body)         ? require_int_nonneg($body['reward'],     'reward')        : (int)$task['reward'];
        $newCap     = array_key_exists('capacity', $body)       ? require_int_positive($body['capacity'], 'capacity')      : (int)$task['capacity'];
        $newPerLim  = array_key_exists('per_user_limit', $body) ? require_int_nonneg($body['per_user_limit'], 'per_user_limit') : (int)$task['per_user_limit'];

        if ($newTitle === '' || mb_strlen($newTitle) > 200)
            throw new ApiException('bad_request', 'title length 1..200', 400);
        if ($newCap < $approved)
            throw new ApiException('bad_capacity', "承認済み {$approved} 件あるため募集人数を {$newCap} に減らせません", 400);

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

        // v790 #393 completion_fields の 更新 も 受け付ける
        if (array_key_exists('completion_fields', $body)) {
            $newCFields = tasks_validate_completion_fields($body['completion_fields']);
            $pdo->prepare('UPDATE tasks SET title=?, description=?, completion_fields_json=?, url=?, completion_message=?,
                reward=?, capacity=?, per_user_limit=?, deadline=?, audience_grades=? WHERE id=?')
                ->execute([$newTitle, $newDesc, $newCFields, $newUrl, $newCMsg,
                           $newReward, $newCap, $newPerLim, $newDeadline, $newAud, $taskId]);
        } else {
            $pdo->prepare('UPDATE tasks SET title=?, description=?, url=?, completion_message=?,
                reward=?, capacity=?, per_user_limit=?, deadline=?, audience_grades=? WHERE id=?')
                ->execute([$newTitle, $newDesc, $newUrl, $newCMsg,
                           $newReward, $newCap, $newPerLim, $newDeadline, $newAud, $taskId]);
        }
    });
    json_response(tasks_fetch_with_meta($pdo, $taskId, (int)$u['id']));
}

// ---------- POST /api/tasks/{id}/claim ----------
function tasks_claim(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $userGrade = tasks_user_grade($pdo, (int)$u['id']);
    $body = read_json_body();
    $slotId = isset($body['slot_id']) ? (int)$body['slot_id'] : 0;

    [$task, $claimId] = db_tx($pdo, function () use ($pdo, $taskId, $u, $userGrade, &$slotId) {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? FOR UPDATE');
        $st->execute([$taskId]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('not_found', 'task not found', 404);
        if ($task['status'] !== 'open') throw new ApiException('not_open', 'task is not open', 409);
        if ((int)$task['requester_user_id'] === (int)$u['id'])
            throw new ApiException('self_claim', '自分のタスクには参加できません', 400);
        // 指名タスクは指名された人だけが claim 可。指名がない場合は学年フィルタ適用。
        if (!empty($task['assigned_user_ids'])) {
            $assigned = array_map('intval', explode(',', (string)$task['assigned_user_ids']));
            if (!in_array((int)$u['id'], $assigned, true)) {
                throw new ApiException('not_assigned', '指名されていません', 403);
            }
        } elseif (!tasks_can_apply_to_grade($userGrade, $task['audience_grades'])) {
            throw new ApiException('audience', '対象外の学年です', 403);
        }

        $approved = tasks_approved_count($pdo, $taskId);
        if ($approved >= (int)$task['capacity'])
            throw new ApiException('full', '定員到達済みです', 409);

        $myActive = tasks_user_active_claim_count($pdo, $taskId, (int)$u['id']);
        if ((int)$task['per_user_limit'] > 0 && $myActive >= (int)$task['per_user_limit'])
            throw new ApiException('per_user_limit', '引き受け上限に達しています', 409);

        $hasSlots = (int)$pdo->query("SELECT COUNT(*) FROM task_slots WHERE task_id=" . (int)$taskId)->fetchColumn() > 0;
        if ($hasSlots) {
            if ($slotId <= 0) throw new ApiException('bad_request', '時間枠を選択してください', 400);
            $stSlot = $pdo->prepare("SELECT s.capacity,
                  (SELECT COUNT(*) FROM task_claims
                    WHERE slot_id = s.id AND status IN ('claimed','reported','approved')) AS taken
                FROM task_slots s WHERE s.id = ? AND s.task_id = ? FOR UPDATE");
            $stSlot->execute([$slotId, $taskId]);
            $slot = $stSlot->fetch();
            if (!$slot) throw new ApiException('not_found', '時間枠が見つかりません', 404);
            if ((int)$slot['taken'] >= (int)$slot['capacity'])
                throw new ApiException('slot_full', 'この時間枠は埋まっています', 409);
        } else {
            $slotId = 0;
        }

        $ins = $pdo->prepare("INSERT INTO task_claims (task_id, user_id, slot_id, status)
            VALUES (?,?,?,'claimed')");
        $ins->execute([$taskId, $u['id'], $slotId > 0 ? $slotId : null]);
        return [$task, (int)$pdo->lastInsertId()];
    });

    try {
        // Notify the requester so they know someone signed up.
        Notifier::notify($pdo, $cfg, (int)$task['requester_user_id'], 'task_claimed',
            "{$u['display_name']} が「{$task['title']}」を引き受けました", 'task', $taskId);
    } catch (Throwable $e) {}
    try {
        // Notify the CLAIMER too so the next time they open the app, they're
        // reminded what they signed up for and how to mark it done. Without
        // this, claimers often forget — they tap '引き受ける' and never see
        // a follow-up until the requester nudges them.
        $reward = (int)$task['reward'];
        $urlLine = !empty($task['url'])
            ? " · 作業: {$task['url']}"
            : '';
        $body = "✅ 「{$task['title']}」を引き受けました ({$reward}pt) — 完了したら「タスク」タブから完了報告してください{$urlLine}";
        Notifier::notify($pdo, $cfg, (int)$u['id'], 'task_my_claim',
            $body, 'task', $taskId);
    } catch (Throwable $e) {}
    json_response(['ok' => true, 'claim_id' => $claimId]);
}

// ---------- POST /api/tasks/{id}/claims/{claim_id}/report ----------
function tasks_report(PDO $pdo, array $cfg, int $taskId, int $claimId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $notes = optional_text_field($body, 'notes', 2000);

    // v790 #393 完了 時 入力 欄 の 検証
    $stTk = $pdo->prepare("SELECT completion_fields_json FROM tasks WHERE id=?");
    $stTk->execute([$taskId]);
    $defRaw = (string)($stTk->fetchColumn() ?: '');
    $fieldsDef = $defRaw !== '' ? (json_decode($defRaw, true) ?: []) : [];
    $completionData = tasks_validate_completion_data($fieldsDef, $body['completion_data'] ?? []);
    $completionDataJson = !empty($completionData) ? json_encode($completionData, JSON_UNESCAPED_UNICODE) : null;

    $upd = $pdo->prepare("UPDATE task_claims
        SET status='reported', notes=?, completion_data_json=?, reported_at=NOW()
        WHERE id=? AND task_id=? AND user_id=? AND status='claimed'");
    $upd->execute([$notes, $completionDataJson, $claimId, $taskId, $u['id']]);
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

    [$rewardForNotify, $claimantId, $title, $taskClosed, $completionMsg] = db_tx($pdo,
        function () use ($pdo, $taskId, $claimId, $u) {
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

            // 0pt タスクは ledger を動かさない (escrow ⇄ claimant のやり取り無し)。
            $ledgerId = null;
            if ((int)$task['reward'] > 0) {
                $escAcc      = Ledger::accountIdByCode($pdo, 'ESCROW');
                $claimantAcc = Ledger::accountIdForUser($pdo, (int)$claim['user_id']);
                $ledgerId = Ledger::transfer($pdo, $escAcc, $claimantAcc, (int)$task['reward'],
                    'task_reward', 'task', $taskId, "タスク「{$task['title']}」報酬");
            }

            $upd = $pdo->prepare("UPDATE task_claims SET status='approved', approved_at=NOW(),
                approved_by_user_id=?, ledger_id=? WHERE id=?");
            $upd->execute([$u['id'], $ledgerId, $claimId]);

            $taskClosed = false;
            $approved = tasks_approved_count($pdo, $taskId);
            if ($approved >= (int)$task['capacity']) {
                $pdo->prepare("UPDATE tasks SET status='closed', closed_at=NOW() WHERE id=?")->execute([$taskId]);
                $taskClosed = true;
            }
            return [
                (int)$task['reward'],
                (int)$claim['user_id'],
                (string)$task['title'],
                $taskClosed,
                $task['completion_message'] ?? null,
            ];
        });

    try {
        // Requester's thank-you message piggy-backs on the approval notification
        // so it surfaces immediately like note's purchase-time message.
        $body = "「{$title}」承認 — {$rewardForNotify}pt が付与されました"
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

// ---------- POST /api/tasks/{id}/close ----------
// v714 #309 取消 と 違って 「終了」 = もう 募集 締切 で OK、 完了 扱い に したい 場合。
//   - status を 'closed' に (cancelled では ない の で、 履歴 上 「✅ 終了」 表記)
//   - 未承認 capacity 分 の 報酬 は 起案者 に 返金 (cancel と 同じ)
//   - 進行 中 (claimed/reported) の claim は cancelled に。 引き受け 者 に は 通知。
function tasks_close(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);
    [$affectedClaimants, $taskTitle, $refund] = db_tx($pdo, function () use ($pdo, $taskId, $u) {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? AND requester_user_id=? FOR UPDATE');
        $st->execute([$taskId, $u['id']]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('forbidden', '依頼者のみ終了可能です', 403);
        if ($task['status'] !== 'open')
            throw new ApiException('not_open', 'task is not open', 409);
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
                'task', $taskId, "タスク「{$task['title']}」終了 返金");
        }
        $pdo->prepare("UPDATE tasks SET status='closed', closed_at=NOW() WHERE id=?")->execute([$taskId]);
        $pdo->prepare("UPDATE task_claims SET status='cancelled'
            WHERE task_id=? AND status IN ('claimed','reported')")->execute([$taskId]);
        return [$affectedClaimants, (string)$task['title'], $refund];
    });
    foreach ($affectedClaimants as $cid) {
        try {
            Notifier::notify($pdo, $cfg, (int)$cid, 'task_cancelled',
                "引き受け 中 の タスク 「{$taskTitle}」 が 依頼者 により 終了 されました", 'task', $taskId);
        } catch (Throwable $e) {}
    }
    json_response(['ok' => true, 'refunded' => $refund]);
}

// ---------- POST /api/tasks/{id}/cancel ----------
function tasks_cancel(PDO $pdo, array $cfg, int $taskId): void {
    $u = Auth::requireUser($pdo, $cfg);

    [$affectedClaimants, $taskTitle, $refund] = db_tx($pdo, function () use ($pdo, $taskId, $u) {
        $st = $pdo->prepare('SELECT * FROM tasks WHERE id=? AND requester_user_id=? FOR UPDATE');
        $st->execute([$taskId, $u['id']]);
        $task = $st->fetch();
        if (!$task) throw new ApiException('forbidden', '依頼者のみ取消可能です', 403);
        if ($task['status'] !== 'open')
            throw new ApiException('not_open', 'task is not open', 409);

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
        return [$affectedClaimants, (string)$task['title'], $refund];
    });
    foreach ($affectedClaimants as $cid) {
        try {
            Notifier::notify($pdo, $cfg, (int)$cid, 'task_cancelled',
                "引き受け中のタスク「{$taskTitle}」が依頼者により取り消されました", 'task', $taskId);
        } catch (Throwable $e) {}
    }
    json_response(['ok' => true, 'refunded' => $refund]);
}
