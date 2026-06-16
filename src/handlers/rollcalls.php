<?php
// /api/rollcalls — 点呼 (roll call)。 「いる？」 「起きてる？」 を集めるための簡易仕組み。
// 構造は投票に似ているが 選択肢 / 集計可視性などは無く、 「応答済 / 未応答」 のみ。
// 任意メモ (例: 「起きました」 「あと 5 分で行く」)。

declare(strict_types=1);

function route_rollcalls(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { rollcalls_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { rollcalls_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''        && $method === 'GET')    { rollcalls_detail($pdo, $cfg, $id);  return; }
        if ($next === ''        && $method === 'PATCH')  { rollcalls_patch($pdo, $cfg, $id);   return; }
        if ($next === ''        && $method === 'DELETE') { rollcalls_delete($pdo, $cfg, $id);  return; }
        if ($next === 'respond' && $method === 'POST')   { rollcalls_respond($pdo, $cfg, $id); return; }
        if ($next === 'close'   && $method === 'PATCH')  { rollcalls_close($pdo, $cfg, $id);   return; }
        if ($next === 'remind'  && $method === 'POST')   { rollcalls_remind($pdo, $cfg, $id);  return; }
    }
    json_error('not_found', "no rollcalls route for $method $sub", 404);
}

function rollcalls_autoclose(PDO $pdo): void {
    $pdo->exec("UPDATE roll_calls SET status='closed', closed_at=NOW()
                 WHERE status='open' AND deadline_at <= NOW()");
}

function rollcalls_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    rollcalls_autoclose($pdo);
    $st = $pdo->prepare("
        SELECT r.id, r.title, r.deadline_at, r.status, r.created_at, r.closed_at,
               r.creator_user_id, u.display_name AS creator_name,
               EXISTS(SELECT 1 FROM roll_call_targets t2 WHERE t2.roll_call_id=r.id AND t2.user_id=? AND t2.responded_at IS NOT NULL) AS has_responded,
               EXISTS(SELECT 1 FROM roll_call_targets t3 WHERE t3.roll_call_id=r.id AND t3.user_id=?)                                  AS is_target,
               (SELECT COUNT(*) FROM roll_call_targets t4 WHERE t4.roll_call_id=r.id) AS target_count,
               (SELECT COUNT(*) FROM roll_call_targets t5 WHERE t5.roll_call_id=r.id AND t5.responded_at IS NOT NULL) AS responded_count
          FROM roll_calls r
          JOIN users u ON u.id = r.creator_user_id
         WHERE r.deleted_at IS NULL
           AND (r.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM roll_call_targets t WHERE t.roll_call_id=r.id AND t.user_id=?))
         ORDER BY (r.status='open') DESC, r.deadline_at DESC, r.id DESC
         LIMIT 200");
    $st->execute([(int)$u['id'], (int)$u['id'], (int)$u['id'], (int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function rollcalls_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $bodyText = isset($body['body']) ? mb_substr((string)$body['body'], 0, 500) : null;
    if ($bodyText === '') $bodyText = null;
    $raw = (string)($body['deadline_at'] ?? '');
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
    if (!$dt) throw new ApiException('bad_request', 'deadline_at は ISO 日時', 400);
    $deadline = $dt->format('Y-m-d H:i:s');
    if (strtotime($deadline) <= time() + 10) {
        throw new ApiException('bad_request', '締切は現在より先に', 400);
    }
    // 締切は最大 24h までに制限 (= 短時間 「みんないる？」 用)。
    if (strtotime($deadline) > time() + 24 * 3600) {
        throw new ApiException('bad_request', '締切は 24 時間以内に', 400);
    }
    $targetIds = $body['target_ids'] ?? [];
    if (!is_array($targetIds) || !count($targetIds)) {
        throw new ApiException('bad_request', '対象者を 1 人以上選んでください', 400);
    }
    $targetIds = array_values(array_unique(array_filter(array_map('intval', $targetIds))));
    if (!count($targetIds) || count($targetIds) > 200) {
        throw new ApiException('bad_request', '対象者数 1〜200', 400);
    }
    $in = implode(',', array_fill(0, count($targetIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
    $stU->execute($targetIds);
    if ((int)$stU->fetchColumn() !== count($targetIds)) {
        throw new ApiException('bad_request', '存在しない user_id が含まれます', 400);
    }
    $rcId = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $bodyText, $deadline, $targetIds, &$rcId) {
        $ins = $pdo->prepare("INSERT INTO roll_calls (title, body, creator_user_id, deadline_at, status, created_at)
            VALUES (?, ?, ?, ?, 'open', NOW())");
        $ins->execute([$title, $bodyText, (int)$u['id'], $deadline]);
        $rcId = (int)$pdo->lastInsertId();
        // v482 #73 起案者 が 対象 に 含まれて いる 場合、 既に 「答えてる」 状態 で
        //   挿入。 起案 した 人 = 「いる」 の が 自明 なので、 自分 への 「答えてね」 通知 を
        //   出さない ため。
        $creatorUid = (int)$u['id'];
        $stT = $pdo->prepare("INSERT INTO roll_call_targets (roll_call_id, user_id, responded_at, note)
                               VALUES (?, ?, ?, ?)");
        foreach ($targetIds as $uid) {
            if ((int)$uid === $creatorUid) {
                $stT->execute([$rcId, $uid, date('Y-m-d H:i:s'), '起案']);
            } else {
                $stT->execute([$rcId, $uid, null, null]);
            }
        }
    });
    // 通知。 「📣 点呼: 起きてる？ (締切 22:30)」 のような body で受信側が分かりやすく。
    $deadlineShort = substr($deadline, 11, 5);   // HH:MM
    foreach ($targetIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'rollcall',
                "📣 点呼: 「{$title}」 (締切 {$deadlineShort})",
                'rollcall', $rcId);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['id' => $rcId]);
}

function rollcalls_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    rollcalls_autoclose($pdo);
    $st = $pdo->prepare("SELECT r.*, u.display_name AS creator_name
                           FROM roll_calls r
                           JOIN users u ON u.id = r.creator_user_id
                          WHERE r.id = ? AND r.deleted_at IS NULL");
    $st->execute([$id]);
    $rc = $st->fetch(PDO::FETCH_ASSOC);
    if (!$rc) throw new ApiException('not_found', '点呼が見つかりません', 404);
    $isCreator = (int)$rc['creator_user_id'] === (int)$u['id'];
    // 対象者 (学年順)。 応答済 / 未応答 + メモ。
    $stT = $pdo->prepare("SELECT t.user_id, t.responded_at, t.note,
                                 us.display_name, us.avatar_url, us.grade
                            FROM roll_call_targets t
                            JOIN users us ON us.id = t.user_id
                           WHERE t.roll_call_id = ?
                           ORDER BY CASE us.grade
                                      WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                      WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                      WHEN 'D'  THEN 5 ELSE 99 END,
                                    us.display_name");
    $stT->execute([$id]);
    $targets = $stT->fetchAll(PDO::FETCH_ASSOC);
    $isTarget = false;
    $myResponse = null;
    foreach ($targets as $t) {
        if ((int)$t['user_id'] === (int)$u['id']) {
            $isTarget = true;
            $myResponse = [
                'responded_at' => $t['responded_at'],
                'note'         => $t['note'],
            ];
        }
    }
    if (!$isCreator && !$isTarget) {
        throw new ApiException('forbidden', 'この点呼の対象者または起案者のみ閲覧可', 403);
    }
    json_response([
        'rollcall' => [
            'id' => (int)$rc['id'],
            'title' => $rc['title'],
            'body' => $rc['body'],
            'creator_user_id' => (int)$rc['creator_user_id'],
            'creator_name'    => $rc['creator_name'],
            'deadline_at'     => $rc['deadline_at'],
            'status'          => $rc['status'],
            'created_at'      => $rc['created_at'],
            'closed_at'       => $rc['closed_at'],
        ],
        'is_creator' => $isCreator,
        'is_target'  => $isTarget,
        'targets'    => array_map(fn($t) => [
            'user_id'      => (int)$t['user_id'],
            'display_name' => $t['display_name'],
            'avatar_url'   => $t['avatar_url'],
            'grade'        => $t['grade'] ?? '',
            'has_responded'=> $t['responded_at'] !== null,
            'responded_at' => $t['responded_at'],
            'note'         => $t['note'],
        ], $targets),
        'my_response' => $myResponse,
    ]);
}

function rollcalls_respond(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    rollcalls_autoclose($pdo);
    $body = read_json_body();
    $note = isset($body['note']) ? trim((string)$body['note']) : '';
    if ($note !== '') $note = mb_substr($note, 0, 300);
    if ($note === '') $note = null;
    $st = $pdo->prepare("SELECT status FROM roll_calls WHERE id = ?");
    $st->execute([$id]);
    $rc = $st->fetch(PDO::FETCH_ASSOC);
    if (!$rc) throw new ApiException('not_found', '点呼が見つかりません', 404);
    if ((string)$rc['status'] !== 'open') {
        throw new ApiException('closed', '締め切られた点呼には応答できません', 400);
    }
    $stT = $pdo->prepare("SELECT 1 FROM roll_call_targets WHERE roll_call_id=? AND user_id=?");
    $stT->execute([$id, (int)$u['id']]);
    if ($stT->fetchColumn() === false) {
        throw new ApiException('forbidden', 'この点呼の対象者ではありません', 403);
    }
    $pdo->prepare("UPDATE roll_call_targets SET responded_at=NOW(), note=? WHERE roll_call_id=? AND user_id=?")
        ->execute([$note, $id, (int)$u['id']]);
    json_response(['ok' => true]);
}

function rollcalls_remind(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    rollcalls_autoclose($pdo);
    $st = $pdo->prepare("SELECT title, creator_user_id, deadline_at, status FROM roll_calls WHERE id=?");
    $st->execute([$id]);
    $rc = $st->fetch(PDO::FETCH_ASSOC);
    if (!$rc) throw new ApiException('not_found', '点呼が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$rc['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ催促可', 403);
    }
    if ((string)$rc['status'] !== 'open') {
        throw new ApiException('closed', '締切後は催促できません', 400);
    }
    $stT = $pdo->prepare("SELECT user_id FROM roll_call_targets WHERE roll_call_id=? AND responded_at IS NULL");
    $stT->execute([$id]);
    $ids = array_map('intval', array_column($stT->fetchAll(PDO::FETCH_ASSOC), 'user_id'));
    $deadlineShort = substr((string)$rc['deadline_at'], 11, 5);
    $sent = 0;
    foreach ($ids as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'rollcall',
                "📣 点呼まだですよ: 「{$rc['title']}」 (締切 {$deadlineShort})",
                'rollcall', $id);
            $sent++;
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['ok' => true, 'sent' => $sent, 'unresponded' => count($ids)]);
}

// v651 起案者 (admin) のみ。 open な 点呼 の title / body / deadline を 変更可能。
// 締切 は 現在 から 24h 以内 (新規 作成 と 同じ 上限。 既存 が 24h 超えてても 新値 さえ
// 24h 以内 なら 受け付ける)。
function rollcalls_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $st = $pdo->prepare("SELECT creator_user_id, status FROM roll_calls WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '点呼が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ編集可', 403);
    }
    if ((string)$row['status'] !== 'open') {
        throw new ApiException('closed', '締切済の点呼は編集できません', 400);
    }
    $sets = [];
    $args = [];
    if (array_key_exists('title', $body)) {
        $title = trim((string)$body['title']);
        if ($title === '' || mb_strlen($title) > 200) {
            throw new ApiException('bad_request', 'title 1..200', 400);
        }
        $sets[] = 'title = ?'; $args[] = $title;
    }
    if (array_key_exists('body', $body)) {
        $bt = (string)$body['body'];
        $bt = $bt === '' ? null : mb_substr($bt, 0, 500);
        $sets[] = 'body = ?'; $args[] = $bt;
    }
    if (array_key_exists('deadline_at', $body)) {
        $raw = (string)$body['deadline_at'];
        $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'deadline_at は ISO 日時', 400);
        $deadline = $dt->format('Y-m-d H:i:s');
        if (strtotime($deadline) <= time() + 10) {
            throw new ApiException('bad_request', '締切は現在より先に', 400);
        }
        if (strtotime($deadline) > time() + 24 * 3600) {
            throw new ApiException('bad_request', '締切は 24 時間以内に', 400);
        }
        $sets[] = 'deadline_at = ?'; $args[] = $deadline;
    }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE roll_calls SET " . implode(',', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function rollcalls_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status FROM roll_calls WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '点呼が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ締切可', 403);
    }
    if ((string)$row['status'] !== 'open') {
        json_response(['ok' => true, 'already' => true]);
        return;
    }
    $pdo->prepare("UPDATE roll_calls SET status='closed', closed_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function rollcalls_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM roll_calls WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', '点呼が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    // v458 soft-delete (分析用 残す)
    $pdo->prepare("UPDATE roll_calls SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
