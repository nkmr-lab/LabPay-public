<?php
// /api/meetups — 「次の待ち合わせ」 機能。 集合時刻 + 場所 + メンバー。 短時間 (24h まで)。
// 起案時に 自分以外の参加者へ push 通知。 タイマーや点呼と違って 応答ボタンは無く、
// 「集合する場所を 1 つ決めて 全員に同期する」 のが目的。

declare(strict_types=1);

function route_meetups(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { meetups_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { meetups_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''        && $method === 'GET')    { meetups_detail($pdo, $cfg, $id); return; }
        if ($next === ''        && $method === 'DELETE') { meetups_delete($pdo, $cfg, $id); return; }
        if ($next === 'cancel'  && $method === 'PATCH')  { meetups_cancel($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no meetups route for $method $sub", 404);
}

function meetups_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT m.id, m.title, m.location, m.meetup_at, m.creator_user_id, m.cancelled_at, m.created_at,
               u.display_name AS creator_name,
               (SELECT COUNT(*) FROM meetup_participants p WHERE p.meetup_id=m.id) AS member_count
          FROM meetups m
          JOIN users u ON u.id = m.creator_user_id
         WHERE m.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM meetup_participants p WHERE p.meetup_id=m.id AND p.user_id=?)
         ORDER BY (m.meetup_at > NOW() AND m.cancelled_at IS NULL) DESC, m.meetup_at DESC, m.id DESC
         LIMIT 100");
    $st->execute([$uid, $uid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function meetups_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = isset($body['title']) ? mb_substr(trim((string)$body['title']), 0, 200) : '';
    if ($title === '') $title = '待ち合わせ';
    $location = isset($body['location']) ? mb_substr(trim((string)$body['location']), 0, 500) : null;
    if ($location === '') $location = null;
    $raw = (string)($body['meetup_at'] ?? '');
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
    if (!$dt) throw new ApiException('bad_request', 'meetup_at は ISO 日時', 400);
    $when = $dt->format('Y-m-d H:i:s');
    $whenTs = strtotime($when);
    if ($whenTs <= time() + 30) {
        throw new ApiException('bad_request', '集合時刻は今より先に', 400);
    }
    if ($whenTs > time() + 24 * 3600) {
        throw new ApiException('bad_request', '集合時刻は 24 時間以内に', 400);
    }
    $memberIds = $body['member_ids'] ?? [];
    if (!is_array($memberIds)) throw new ApiException('bad_request', 'member_ids 配列', 400);
    $memberIds = array_values(array_unique(array_filter(array_map('intval', $memberIds))));
    // 起案者も自動で参加者に。
    if (!in_array((int)$u['id'], $memberIds, true)) $memberIds[] = (int)$u['id'];
    if (count($memberIds) > 200) {
        throw new ApiException('bad_request', '参加者は 200 人まで', 400);
    }
    $in = implode(',', array_fill(0, count($memberIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
    $stU->execute($memberIds);
    if ((int)$stU->fetchColumn() !== count($memberIds)) {
        throw new ApiException('bad_request', '存在しない user_id', 400);
    }
    $mid = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $location, $when, $memberIds, &$mid) {
        $ins = $pdo->prepare("INSERT INTO meetups (title, location, meetup_at, creator_user_id, created_at)
            VALUES (?, ?, ?, ?, NOW())");
        $ins->execute([$title, $location, $when, (int)$u['id']]);
        $mid = (int)$pdo->lastInsertId();
        $stP = $pdo->prepare("INSERT INTO meetup_participants (meetup_id, user_id) VALUES (?, ?)");
        foreach ($memberIds as $uid) $stP->execute([$mid, $uid]);
    });
    // 通知 「🤝 待ち合わせ: タイトル」 集合時刻 + 場所
    $whenShort = substr($when, 11, 5);
    $locPart = $location ? " @ {$location}" : '';
    foreach ($memberIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'meetup',
                "🤝 待ち合わせ: 「{$title}」 {$whenShort}{$locPart}",
                'meetup', $mid);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['id' => $mid]);
}

function meetups_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT m.*, u.display_name AS creator_name
                           FROM meetups m
                           JOIN users u ON u.id = m.creator_user_id
                          WHERE m.id = ?");
    $st->execute([$id]);
    $m = $st->fetch(PDO::FETCH_ASSOC);
    if (!$m) throw new ApiException('not_found', '待ち合わせが見つかりません', 404);
    $isCreator = (int)$m['creator_user_id'] === (int)$u['id'];
    $stP = $pdo->prepare("SELECT p.user_id, us.display_name, us.avatar_url, us.grade
                           FROM meetup_participants p
                           JOIN users us ON us.id = p.user_id
                          WHERE p.meetup_id = ?
                          ORDER BY CASE us.grade
                                     WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                     WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                     WHEN 'D'  THEN 5 ELSE 99 END,
                                   us.display_name");
    $stP->execute([$id]);
    $participants = $stP->fetchAll(PDO::FETCH_ASSOC);
    $isParticipant = false;
    foreach ($participants as $p) if ((int)$p['user_id'] === (int)$u['id']) { $isParticipant = true; break; }
    if (!$isCreator && !$isParticipant) {
        throw new ApiException('forbidden', 'この待ち合わせの参加者または起案者のみ閲覧可', 403);
    }
    json_response([
        'meetup' => [
            'id' => (int)$m['id'],
            'title' => $m['title'],
            'location' => $m['location'],
            'meetup_at' => $m['meetup_at'],
            'creator_user_id' => (int)$m['creator_user_id'],
            'creator_name' => $m['creator_name'],
            'cancelled_at' => $m['cancelled_at'],
            'created_at' => $m['created_at'],
        ],
        'is_creator' => $isCreator,
        'is_participant' => $isParticipant,
        'participants' => array_map(fn($p) => [
            'user_id' => (int)$p['user_id'],
            'display_name' => $p['display_name'],
            'avatar_url' => $p['avatar_url'],
            'grade' => $p['grade'] ?? '',
        ], $participants),
        'server_now' => date('Y-m-d H:i:s'),
    ]);
}

function meetups_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, cancelled_at, title FROM meetups WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '待ち合わせが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ取消可', 403);
    }
    if ($row['cancelled_at'] !== null) {
        json_response(['ok' => true, 'already' => true]); return;
    }
    $pdo->prepare("UPDATE meetups SET cancelled_at=NOW() WHERE id=?")->execute([$id]);
    // 参加者に取消通知。
    $stP = $pdo->prepare("SELECT user_id FROM meetup_participants WHERE meetup_id=?");
    $stP->execute([$id]);
    foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $p) {
        if ((int)$p['user_id'] === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$p['user_id'], 'meetup',
                "❌ 待ち合わせ取消: 「{$row['title']}」", 'meetup', $id);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['ok' => true]);
}

function meetups_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM meetups WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', '待ち合わせが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM meetups WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
