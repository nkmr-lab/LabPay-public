<?php
// /api/invitations — casual hang-out board (お昼に行く、ビアガーデン、スキーなど)。
// タスクと違って pt 動かない・承認なし・参加表明だけのライト構造。

declare(strict_types=1);

function route_invitations(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { invitations_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { invitations_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        if ($method === 'GET')                                             { invitations_detail($pdo, $cfg, $id); return; }
        if ($method === 'PATCH')                                           { invitations_patch($pdo, $cfg, $id); return; }
        if ($method === 'DELETE')                                          { invitations_cancel($pdo, $cfg, $id); return; }
        if (($seg[2] ?? '') === 'join'  && $method === 'POST')            { invitations_join($pdo, $cfg, $id);   return; }
        if (($seg[2] ?? '') === 'leave' && $method === 'POST')            { invitations_leave($pdo, $cfg, $id);  return; }
    }
    json_error('not_found', "no invitations route for $method $sub", 404);
}

function invitations_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $status = $_GET['status'] ?? 'open'; // open | all
    // 開始時刻を過ぎた募集は自動で終了に。発起人が「再募集」(PATCH) で
    // 復活させない限り、starts_at <= NOW() のものは募集中に出さない。
    $pdo->exec("UPDATE invitations
        SET closed_at = NOW()
        WHERE closed_at IS NULL
          AND starts_at IS NOT NULL
          AND starts_at <= NOW()");

    $where = $status === 'open' ? 'i.closed_at IS NULL' : '1=1';
    $st = $pdo->prepare("
        SELECT i.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
               (SELECT COUNT(*) FROM invitation_joins WHERE invitation_id = i.id) AS join_count,
               EXISTS(SELECT 1 FROM invitation_joins j
                  WHERE j.invitation_id = i.id AND j.user_id = ?) AS i_joined
          FROM invitations i
          JOIN users u ON u.id = i.creator_user_id
         WHERE $where
         ORDER BY (i.closed_at IS NULL) DESC,
                  COALESCE(i.starts_at, i.created_at) ASC,
                  i.id DESC");
    $st->execute([$u['id']]);
    $items = $st->fetchAll();
    // 各募集の参加者 avatar を 1 クエリで取って付ける (UI でリストに並べる用)。
    if ($items) {
        $ids = array_map(fn($r) => (int)$r['id'], $items);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $jst = $pdo->prepare("
            SELECT j.invitation_id, u.id, u.display_name, u.avatar_url
              FROM invitation_joins j
              JOIN users u ON u.id = j.user_id
             WHERE j.invitation_id IN ($place)
             ORDER BY j.invitation_id, j.joined_at");
        $jst->execute($ids);
        $byInv = [];
        foreach ($jst as $r) {
            $iid = (int)$r['invitation_id'];
            $byInv[$iid][] = [
                'id'           => (int)$r['id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
            ];
        }
        foreach ($items as &$it) {
            $it['joins'] = $byInv[(int)$it['id']] ?? [];
        }
        unset($it);
    }
    json_response(['items' => $items]);
}

function invitations_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    // 開始時刻を過ぎていれば list と同じく自動終了
    $pdo->prepare("UPDATE invitations
        SET closed_at = NOW()
        WHERE id = ? AND closed_at IS NULL
          AND starts_at IS NOT NULL AND starts_at <= NOW()")->execute([$id]);
    $st = $pdo->prepare("
        SELECT i.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar_url
          FROM invitations i JOIN users u ON u.id = i.creator_user_id
         WHERE i.id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) throw new ApiException('not_found', "invitation $id not found", 404);

    // Joined participants (name + avatar)
    $stJ = $pdo->prepare("
        SELECT u.id, u.display_name, u.avatar_url, j.joined_at
          FROM invitation_joins j
          JOIN users u ON u.id = j.user_id
         WHERE j.invitation_id = ?
         ORDER BY j.joined_at");
    $stJ->execute([$id]);
    $row['joins'] = $stJ->fetchAll();
    json_response($row);
}

function invitations_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $desc     = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    $location = isset($body['location'])    ? mb_substr((string)$body['location'], 0, 200) : null;
    $capacity = isset($body['capacity']) && $body['capacity'] !== '' && $body['capacity'] !== null
        ? max(1, min(1000, (int)$body['capacity'])) : null;
    $imageUrl = validate_product_image_url($body['image_url'] ?? null);
    // starts_at: accept Y-m-d H:i:s or datetime-local (Y-m-d\TH:i)
    $startsAt = null;
    if (!empty($body['starts_at'])) {
        $raw = str_replace('T', ' ', trim((string)$body['starts_at']));
        if (strlen($raw) === 16) $raw .= ':00';
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if ($dt) $startsAt = $dt->format('Y-m-d H:i:s');
    }
    $ins = $pdo->prepare("INSERT INTO invitations
        (creator_user_id, title, description, starts_at, location, capacity, image_url)
        VALUES (?,?,?,?,?,?,?)");
    $ins->execute([$u['id'], $title, $desc, $startsAt, $location, $capacity, $imageUrl]);
    $invId = (int)$pdo->lastInsertId();

    // Slack 通知: あれば
    try {
        $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
        $link = $baseUrl . '/#/invitations/' . $invId;
        $whenLine = $startsAt ? "\n🕒 " . $startsAt : '';
        $whereLine = $location ? "\n📍 " . $location : '';
        $capLine = $capacity ? "\n👥 上限 {$capacity} 人" : '';
        slack_notify($cfg, "🎉 *新規募集*  <{$link}|{$title}>\n発起人: {$u['display_name']}"
            . $whenLine . $whereLine . $capLine);
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true, 'id' => $invId]);
}

function invitations_join(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    db_tx($pdo, function () use ($pdo, $cfg, $id, $u) {
        $st = $pdo->prepare("SELECT * FROM invitations WHERE id=? FOR UPDATE");
        $st->execute([$id]);
        $inv = $st->fetch();
        if (!$inv) throw new ApiException('not_found', "invitation $id not found", 404);
        if ($inv['closed_at']) throw new ApiException('closed', '募集は終了しています', 409);
        if ($inv['capacity']) {
            $stC = $pdo->prepare("SELECT COUNT(*) FROM invitation_joins WHERE invitation_id=?");
            $stC->execute([$id]);
            if ((int)$stC->fetchColumn() >= (int)$inv['capacity']) {
                throw new ApiException('full', '定員に達しています', 409);
            }
        }
        $pdo->prepare("INSERT IGNORE INTO invitation_joins (invitation_id, user_id) VALUES (?,?)")
            ->execute([$id, $u['id']]);
        // Notify creator unless they're joining their own.
        if ((int)$inv['creator_user_id'] !== (int)$u['id']) {
            notify_safely($pdo, $cfg, (int)$inv['creator_user_id'], 'admin_notice',
                "🎉 「{$inv['title']}」に {$u['display_name']} さんが参加表明しました",
                'invitation', $id);
        }
    });
    json_response(['ok' => true]);
}

function invitations_leave(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM invitation_joins WHERE invitation_id=? AND user_id=?")
        ->execute([$id, $u['id']]);
    json_response(['ok' => true]);
}

// 発起人が編集する: starts_at (= 再募集) または image_url (= 表紙画像差し替え)。
// どちらか/両方を送れる。starts_at が送られた場合は closed_at を NULL に戻して再募集扱い。
function invitations_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, title FROM invitations WHERE id=?");
    $st->execute([$id]);
    $inv = $st->fetch();
    if (!$inv) throw new ApiException('not_found', "invitation $id not found", 404);
    if ((int)$inv['creator_user_id'] !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '発起人または admin だけが編集できます', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    $reopened = false;
    if (array_key_exists('starts_at', $body)) {
        $startsAt = null;
        if (!empty($body['starts_at'])) {
            $raw = str_replace('T', ' ', trim((string)$body['starts_at']));
            if (strlen($raw) === 16) $raw .= ':00';
            $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
            if (!$dt) throw new ApiException('bad_request', 'starts_at must be Y-m-d H:i', 400);
            if ($dt->getTimestamp() <= time()) {
                throw new ApiException('bad_request', '新しい開催日時は現在より未来にしてください', 400);
            }
            $startsAt = $dt->format('Y-m-d H:i:s');
        }
        $sets[] = 'starts_at = ?'; $args[] = $startsAt;
        $sets[] = 'closed_at = NULL';
        $reopened = true;
    }
    if (array_key_exists('image_url', $body)) {
        $img = validate_product_image_url($body['image_url']);
        if ($img === null) { $sets[] = 'image_url = NULL'; }
        else               { $sets[] = 'image_url = ?'; $args[] = $img; }
    }
    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $args[] = $id;
    $pdo->prepare('UPDATE invitations SET ' . implode(', ', $sets) . ' WHERE id=?')
        ->execute($args);
    json_response(['ok' => true, 'reopened' => $reopened]);
}

function invitations_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, title, closed_at FROM invitations WHERE id=?");
    $st->execute([$id]);
    $inv = $st->fetch();
    if (!$inv) throw new ApiException('not_found', "invitation $id not found", 404);
    if ((int)$inv['creator_user_id'] !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '発起人または admin だけが取消できます', 403);
    }
    if ($inv['closed_at']) {
        json_response(['ok' => true, 'already_closed' => true]);
        return;
    }
    $pdo->prepare("UPDATE invitations SET closed_at=NOW() WHERE id=?")->execute([$id]);
    // Notify joiners.
    $st = $pdo->prepare("SELECT user_id FROM invitation_joins WHERE invitation_id=?");
    $st->execute([$id]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        notify_safely($pdo, $cfg, (int)$uid, 'admin_notice',
            "「{$inv['title']}」は発起人により取消されました", 'invitation', $id);
    }
    json_response(['ok' => true]);
}
