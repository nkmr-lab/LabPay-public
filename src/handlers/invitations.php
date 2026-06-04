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
    // v368: signup_closes_at <= NOW() も 募集締切として自動 close。
    // v370: starts_at_has_time=0 (日付だけ) の場合は その日の終わり (= +1 day) で 判定。
    $pdo->exec("UPDATE invitations
        SET closed_at = NOW()
        WHERE closed_at IS NULL
          AND (
            (starts_at IS NOT NULL AND starts_at_has_time = 1 AND starts_at <= NOW())
            OR
            (starts_at IS NOT NULL AND starts_at_has_time = 0 AND DATE_ADD(starts_at, INTERVAL 1 DAY) <= NOW())
            OR
            (signup_closes_at IS NOT NULL AND signup_closes_at <= NOW())
          )");

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
          AND (
            (starts_at IS NOT NULL AND starts_at_has_time = 1 AND starts_at <= NOW())
            OR
            (starts_at IS NOT NULL AND starts_at_has_time = 0 AND DATE_ADD(starts_at, INTERVAL 1 DAY) <= NOW())
            OR
            (signup_closes_at IS NOT NULL AND signup_closes_at <= NOW())
          )")->execute([$id]);
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

// v370 starts_at の パース ヘルパ。 ["YYYY-MM-DD HH:MM:SS" or null, has_time(0|1)] を返す。
//   * 空                  → [null, 1]  (時刻フラグはどうでもよい)
//   * "Y-m-d"             → [Y-m-d 00:00:00, 0]
//   * "Y-m-d H:i" or 秒付き → [Y-m-d H:i:00, 1]
function invitations_parse_starts_at($raw): array {
    if ($raw === null || $raw === '' || $raw === false) return [null, 1];
    $s = str_replace('T', ' ', trim((string)$raw));
    // 「Y-m-d」 のみ (10 文字、 ハイフン 2 つ) は 日付モード
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d', $s);
        if (!$dt) throw new ApiException('bad_request', 'starts_at は Y-m-d', 400);
        return [$dt->format('Y-m-d') . ' 00:00:00', 0];
    }
    if (strlen($s) === 16) $s .= ':00';
    $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $s);
    if (!$dt) throw new ApiException('bad_request', 'starts_at は Y-m-d または Y-m-d H:i', 400);
    return [$dt->format('Y-m-d H:i:s'), 1];
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
    // v370 starts_at は Y-m-d (日付だけ) も許容。 has_time フラグで 区別。
    //   * "Y-m-d"            → starts_at_has_time=0 (00:00:00 で保存)
    //   * "Y-m-d H:i" / 秒付き → starts_at_has_time=1
    [$startsAt, $startsHasTime] = invitations_parse_starts_at($body['starts_at'] ?? null);
    // v368 募集締切 (signup_closes_at) — 常に時刻付き
    $signupClosesAt = null;
    if (!empty($body['signup_closes_at'])) {
        $raw = str_replace('T', ' ', trim((string)$body['signup_closes_at']));
        if (strlen($raw) === 16) $raw .= ':00';
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'signup_closes_at は Y-m-d H:i', 400);
        if ($dt->getTimestamp() <= time()) {
            throw new ApiException('bad_request', '募集締切は現在より未来にしてください', 400);
        }
        if ($startsAt !== null && $startsHasTime && $dt->getTimestamp() > strtotime($startsAt)) {
            throw new ApiException('bad_request', '募集締切は 開催日時 より前にしてください', 400);
        }
        $signupClosesAt = $dt->format('Y-m-d H:i:s');
    }
    // v370 事前参加者 (任意)。 自分以外の human user_id を 受理。 存在チェック。
    $preJoinIds = $body['pre_join_user_ids'] ?? [];
    if (!is_array($preJoinIds)) $preJoinIds = [];
    $preJoinIds = array_values(array_unique(array_filter(array_map('intval', $preJoinIds))));
    $preJoinIds = array_diff($preJoinIds, [(int)$u['id']]); // 発起人は別途 join するので除く
    if ($preJoinIds) {
        $in = implode(',', array_fill(0, count($preJoinIds), '?'));
        $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in) AND kind='human'");
        $stU->execute($preJoinIds);
        if ((int)$stU->fetchColumn() !== count($preJoinIds)) {
            throw new ApiException('bad_request', '存在しない user_id が含まれます', 400);
        }
        if ($capacity !== null && (1 + count($preJoinIds)) > $capacity) {
            throw new ApiException('bad_request', '事前参加者の人数が上限を超えています', 400);
        }
    }
    $ins = $pdo->prepare("INSERT INTO invitations
        (creator_user_id, title, description, starts_at, starts_at_has_time, signup_closes_at, location, capacity, image_url)
        VALUES (?,?,?,?,?,?,?,?,?)");
    $ins->execute([$u['id'], $title, $desc, $startsAt, $startsHasTime, $signupClosesAt, $location, $capacity, $imageUrl]);
    $invId = (int)$pdo->lastInsertId();

    // v370 発起人を 自動で 参加表明済 に + 事前参加者も 同時 join。
    db_tx($pdo, function () use ($pdo, $invId, $u, $preJoinIds) {
        $stJ = $pdo->prepare("INSERT IGNORE INTO invitation_joins (invitation_id, user_id) VALUES (?, ?)");
        $stJ->execute([$invId, (int)$u['id']]);
        foreach ($preJoinIds as $uid) $stJ->execute([$invId, $uid]);
    });
    // 事前参加者には 通知 (自分以外なので 全員に対して送る)。
    foreach ($preJoinIds as $uid) {
        try {
            notify_safely($pdo, $cfg, (int)$uid, 'admin_notice',
                "🎉 「{$title}」 に 事前参加者として 登録されました", 'invitation', $invId);
        } catch (Throwable $_) { /* swallow */ }
    }

    // Slack 通知: あれば
    try {
        $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
        $link = $baseUrl . '/#/invitations/' . $invId;
        $whenLine = $startsAt ? "\n🕒 " . $startsAt : '';
        $signupLine = $signupClosesAt ? "\n⏰ 募集締切 " . $signupClosesAt : '';
        $whereLine = $location ? "\n📍 " . $location : '';
        $capLine = $capacity ? "\n👥 上限 {$capacity} 人" : '';
        slack_notify($cfg, "🎉 *新規募集*  <{$link}|{$title}>\n発起人: {$u['display_name']}"
            . $whenLine . $signupLine . $whereLine . $capLine);
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
        // v368: signup_closes_at を 過ぎていれば 参加表明できない (closed_at の lazy update より早期 reject)
        if (!empty($inv['signup_closes_at']) && strtotime((string)$inv['signup_closes_at']) <= time()) {
            throw new ApiException('closed', '募集締切を過ぎています', 409);
        }
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
        [$startsAt, $startsHasTime] = invitations_parse_starts_at($body['starts_at']);
        // 再募集時 (= reopen フラグ付き) は 過去日時を弾く。 通常編集ならゆるくする。
        if (!empty($body['reopen']) && $startsAt !== null) {
            $ts = $startsHasTime ? strtotime($startsAt) : strtotime($startsAt) + 86400;
            if ($ts <= time()) {
                throw new ApiException('bad_request', '新しい開催日時は現在より未来にしてください', 400);
            }
        }
        $sets[] = 'starts_at = ?'; $args[] = $startsAt;
        $sets[] = 'starts_at_has_time = ?'; $args[] = $startsHasTime;
        if (!empty($body['reopen'])) {
            $sets[] = 'closed_at = NULL';
            $reopened = true;
        }
    }
    if (array_key_exists('signup_closes_at', $body)) {
        $sca = null;
        if (!empty($body['signup_closes_at'])) {
            $raw = str_replace('T', ' ', trim((string)$body['signup_closes_at']));
            if (strlen($raw) === 16) $raw .= ':00';
            $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
            if (!$dt) throw new ApiException('bad_request', 'signup_closes_at は Y-m-d H:i', 400);
            $sca = $dt->format('Y-m-d H:i:s');
        }
        $sets[] = 'signup_closes_at = ?'; $args[] = $sca;
    }
    if (array_key_exists('image_url', $body)) {
        $img = validate_product_image_url($body['image_url']);
        if ($img === null) { $sets[] = 'image_url = NULL'; }
        else               { $sets[] = 'image_url = ?'; $args[] = $img; }
    }
    // v369 編集対応: title / description / location / capacity も 同時に更新可。
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) {
            throw new ApiException('bad_request', 'title length 1..200', 400);
        }
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = $body['description'];
        if ($d === null || trim((string)$d) === '') {
            $sets[] = 'description = NULL';
        } else {
            $sets[] = 'description = ?'; $args[] = mb_substr((string)$d, 0, 5000);
        }
    }
    if (array_key_exists('location', $body)) {
        $l = $body['location'];
        if ($l === null || trim((string)$l) === '') {
            $sets[] = 'location = NULL';
        } else {
            $sets[] = 'location = ?'; $args[] = mb_substr((string)$l, 0, 200);
        }
    }
    if (array_key_exists('capacity', $body)) {
        $c = $body['capacity'];
        if ($c === null || $c === '') {
            $sets[] = 'capacity = NULL';
        } else {
            $iv = (int)$c;
            if ($iv < 1 || $iv > 1000) {
                throw new ApiException('bad_request', 'capacity は 1..1000', 400);
            }
            $sets[] = 'capacity = ?'; $args[] = $iv;
        }
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
