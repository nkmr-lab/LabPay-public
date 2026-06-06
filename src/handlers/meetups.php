<?php
// /api/meetups — 「次の待ち合わせ」 機能。 集合時刻 + 場所 + メンバー。 31 日 以内 (v434)。
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
        if ($next === ''        && $method === 'PATCH')  { meetups_edit($pdo, $cfg, $id);   return; }
        if ($next === 'cancel'  && $method === 'PATCH')  { meetups_cancel($pdo, $cfg, $id); return; }
        if ($next === 'participants' && $method === 'POST') { meetups_add_participants($pdo, $cfg, $id); return; }
        // v482 #71 メッセージ シェア
        if ($next === 'messages' && $method === 'GET')   { meetups_messages_list($pdo, $cfg, $id);   return; }
        if ($next === 'messages' && $method === 'POST')  { meetups_messages_create($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no meetups route for $method $sub", 404);
}

// v482 #71 待ち合わせ への シェア メッセージ (例: 「5 分 遅れます」 「先 に 中 に
//   入って ます」)。 参加者 と 起案者 のみ 閲覧 / 投稿 可。
function meetups_messages_assert_visible(PDO $pdo, int $meetupId, int $userId): array {
    $st = $pdo->prepare("SELECT id, creator_user_id, title, kind FROM meetups WHERE id=? AND deleted_at IS NULL");
    $st->execute([$meetupId]);
    $m = $st->fetch(PDO::FETCH_ASSOC);
    if (!$m) throw new ApiException('not_found', '見つかりません', 404);
    if ((int)$m['creator_user_id'] !== $userId) {
        $stP = $pdo->prepare("SELECT 1 FROM meetup_participants WHERE meetup_id=? AND user_id=?");
        $stP->execute([$meetupId, $userId]);
        if (!$stP->fetchColumn()) {
            throw new ApiException('forbidden', '参加者 のみ 閲覧 / 投稿 可', 403);
        }
    }
    return $m;
}

function meetups_messages_list(PDO $pdo, array $cfg, int $meetupId): void {
    $u = Auth::requireUser($pdo, $cfg);
    meetups_messages_assert_visible($pdo, $meetupId, (int)$u['id']);
    $st = $pdo->prepare("SELECT m.id, m.user_id, m.body, m.created_at,
                                u.display_name, u.avatar_url
                           FROM meetup_messages m
                           JOIN users u ON u.id = m.user_id
                          WHERE m.meetup_id = ?
                          ORDER BY m.id ASC LIMIT 500");
    $st->execute([$meetupId]);
    $items = array_map(fn($r) => [
        'id'           => (int)$r['id'],
        'user_id'      => (int)$r['user_id'],
        'display_name' => $r['display_name'],
        'avatar_url'   => $r['avatar_url'],
        'body'         => $r['body'],
        'created_at'   => $r['created_at'],
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function meetups_messages_create(PDO $pdo, array $cfg, int $meetupId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $m = meetups_messages_assert_visible($pdo, $meetupId, (int)$u['id']);
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', '本文 が 必要', 400);
    if (mb_strlen($text) > 1000) $text = mb_substr($text, 0, 1000);
    $pdo->prepare("INSERT INTO meetup_messages (meetup_id, user_id, body, created_at)
                   VALUES (?, ?, ?, NOW())")
        ->execute([$meetupId, (int)$u['id'], $text]);
    $msgId = (int)$pdo->lastInsertId();
    // 通知: 起案者 + 全 参加者 (自分 除く)
    $isDeadline = ((string)($m['kind'] ?? 'meetup')) === 'deadline';
    $icon = $isDeadline ? '📌' : '🤝';
    $stN = $pdo->prepare("SELECT DISTINCT user_id FROM (
        SELECT creator_user_id AS user_id FROM meetups WHERE id = ?
        UNION
        SELECT user_id FROM meetup_participants WHERE meetup_id = ?) x");
    $stN->execute([$meetupId, $meetupId]);
    $snip = mb_substr($text, 0, 80);
    foreach ($stN->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'meetup',
                "{$icon} {$u['display_name']}: {$snip}",
                'meetup', $meetupId);
        } catch (Throwable $_) {}
    }
    json_response(['id' => $msgId, 'ok' => true]);
}

// v468 編集 (起案者 + admin) — title / location / meetup_at / kind を 部分更新。
function meetups_edit(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, kind FROM meetups WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = mb_substr(trim((string)$body['title']), 0, 200);
        if ($t === '') $t = ($row['kind'] === 'deadline') ? '〆切' : '待ち合わせ';
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('location', $body)) {
        $loc = mb_substr(trim((string)$body['location']), 0, 500);
        $sets[] = 'location = ?'; $args[] = $loc !== '' ? $loc : null;
    }
    if (array_key_exists('meetup_at', $body)) {
        $raw = (string)$body['meetup_at'];
        $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'meetup_at は ISO 日時', 400);
        $when = $dt->format('Y-m-d H:i:s');
        $sets[] = 'meetup_at = ?'; $args[] = $when;
    }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE meetups SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

// v468 参加者 追加。 既存 メンバー は INSERT IGNORE で 重複 排除。
function meetups_add_participants(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, title, kind FROM meetups WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    // 起案者 / admin / 既参加 のいずれか は 追加 可能。
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        $stChk = $pdo->prepare("SELECT 1 FROM meetup_participants WHERE meetup_id=? AND user_id=?");
        $stChk->execute([$id, (int)$u['id']]);
        if (!$stChk->fetchColumn()) throw new ApiException('forbidden', '関係者 のみ 参加者を追加できます', 403);
    }
    $body = read_json_body();
    $newIds = $body['member_ids'] ?? [];
    if (!is_array($newIds)) throw new ApiException('bad_request', 'member_ids 配列', 400);
    $newIds = array_values(array_unique(array_filter(array_map('intval', $newIds))));
    if (!$newIds) { json_response(['ok' => true, 'added' => 0]); return; }
    // ユーザ存在確認
    $place = implode(',', array_fill(0, count($newIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($place)");
    $stU->execute($newIds);
    if ((int)$stU->fetchColumn() !== count($newIds)) {
        throw new ApiException('bad_request', '存在しない user_id', 400);
    }
    $stIns = $pdo->prepare("INSERT IGNORE INTO meetup_participants (meetup_id, user_id) VALUES (?, ?)");
    $added = 0;
    foreach ($newIds as $uid) {
        $stIns->execute([$id, $uid]);
        if ($stIns->rowCount() > 0) $added++;
    }
    // 通知 (追加 された 人 だけ)
    $isDeadline = ((string)($row['kind'] ?? 'meetup')) === 'deadline';
    $icon = $isDeadline ? '📌' : '🤝';
    $label = $isDeadline ? '〆切' : '待ち合わせ';
    foreach ($newIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'meetup',
                "{$icon} {$label} に 追加 されました: 「{$row['title']}」",
                'meetup', $id);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['ok' => true, 'added' => $added]);
}

function meetups_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v450 ?kind=meetup|deadline で 絞り込み。 未指定 = 両方。
    $kindFilter = (string)($_GET['kind'] ?? '');
    $where = "(m.creator_user_id = ? OR EXISTS(SELECT 1 FROM meetup_participants p WHERE p.meetup_id=m.id AND p.user_id=?))";
    $args = [$uid, $uid];
    if ($kindFilter === 'meetup' || $kindFilter === 'deadline') {
        $where .= " AND m.kind = ?";
        $args[] = $kindFilter;
    }
    $st = $pdo->prepare("
        SELECT m.id, m.title, m.kind, m.location, m.meetup_at, m.creator_user_id, m.cancelled_at, m.created_at,
               u.display_name AS creator_name,
               (SELECT COUNT(*) FROM meetup_participants p WHERE p.meetup_id=m.id) AS member_count
          FROM meetups m
          JOIN users u ON u.id = m.creator_user_id
         WHERE m.deleted_at IS NULL AND $where
         ORDER BY (m.meetup_at > NOW() AND m.cancelled_at IS NULL) DESC, m.meetup_at DESC, m.id DESC
         LIMIT 100");
    $st->execute($args);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    // v466 関係者 アバター を 同梱 (最大 5 名)。 ホーム の 進行中 カード で 「誰の
    // 待ち合わせ / 〆切 か」 を 顔で 把握 する 用。
    $ids = array_map(fn($r) => (int)$r['id'], $items);
    $parts = [];
    if ($ids) {
        $place = implode(',', array_fill(0, count($ids), '?'));
        $stP = $pdo->prepare("SELECT p.meetup_id, u.id AS uid, u.display_name, u.avatar_url
                                FROM meetup_participants p
                                JOIN users u ON u.id = p.user_id
                               WHERE p.meetup_id IN ($place)
                               ORDER BY u.id");
        $stP->execute($ids);
        foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $mid = (int)$row['meetup_id'];
            if (!isset($parts[$mid])) $parts[$mid] = [];
            $parts[$mid][] = [
                'user_id' => (int)$row['uid'],
                'display_name' => $row['display_name'],
                'avatar_url' => $row['avatar_url'],
            ];
        }
    }
    foreach ($items as &$it) {
        $mid = (int)$it['id'];
        $it['participants'] = array_slice($parts[$mid] ?? [], 0, 5);
    }
    unset($it);
    json_response(['items' => $items]);
}

function meetups_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    // v450 kind = 'meetup' (default) or 'deadline'
    $kind = (string)($body['kind'] ?? 'meetup');
    if ($kind !== 'meetup' && $kind !== 'deadline') $kind = 'meetup';
    $isDeadline = ($kind === 'deadline');
    $defaultTitle = $isDeadline ? '〆切' : '待ち合わせ';
    $title = isset($body['title']) ? mb_substr(trim((string)$body['title']), 0, 200) : '';
    if ($title === '') $title = $defaultTitle;
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
        throw new ApiException('bad_request', ($isDeadline ? '〆切時刻' : '集合時刻') . 'は今より先に', 400);
    }
    // v450 〆切は 365 日まで、 待ち合わせは 従来の 31 日まで。
    $maxAhead = $isDeadline ? 365 * 86400 : 31 * 86400;
    $maxLabel = $isDeadline ? '365 日' : '31 日';
    if ($whenTs > time() + $maxAhead) {
        throw new ApiException('bad_request', ($isDeadline ? '〆切時刻' : '集合時刻') . "は {$maxLabel} 以内に", 400);
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
    db_tx($pdo, function () use ($pdo, $u, $title, $kind, $location, $when, $memberIds, &$mid) {
        $ins = $pdo->prepare("INSERT INTO meetups (title, kind, location, meetup_at, creator_user_id, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())");
        $ins->execute([$title, $kind, $location, $when, (int)$u['id']]);
        $mid = (int)$pdo->lastInsertId();
        $stP = $pdo->prepare("INSERT INTO meetup_participants (meetup_id, user_id) VALUES (?, ?)");
        foreach ($memberIds as $uid) $stP->execute([$mid, $uid]);
    });
    // 通知 文言 を kind で 切り替え。 〆切 は 月日 + 時刻 まで 載せた 方が 一目で分かる。
    $icon  = $isDeadline ? '📌' : '🤝';
    $label = $isDeadline ? '〆切' : '待ち合わせ';
    $whenShort = $isDeadline ? date('n/j H:i', strtotime($when)) : substr($when, 11, 5);
    $locPart = $location ? " @ {$location}" : '';
    foreach ($memberIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'meetup',
                "{$icon} {$label}: 「{$title}」 {$whenShort}{$locPart}",
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
                          WHERE m.id = ? AND m.deleted_at IS NULL");
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
            'kind' => (string)($m['kind'] ?? 'meetup'),
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
    $st = $pdo->prepare("SELECT creator_user_id, cancelled_at, title, kind FROM meetups WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ取消可', 403);
    }
    if ($row['cancelled_at'] !== null) {
        json_response(['ok' => true, 'already' => true]); return;
    }
    $pdo->prepare("UPDATE meetups SET cancelled_at=NOW() WHERE id=?")->execute([$id]);
    $label = ((string)($row['kind'] ?? 'meetup') === 'deadline') ? '〆切' : '待ち合わせ';
    // 参加者に取消通知。
    $stP = $pdo->prepare("SELECT user_id FROM meetup_participants WHERE meetup_id=?");
    $stP->execute([$id]);
    foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $p) {
        if ((int)$p['user_id'] === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$p['user_id'], 'meetup',
                "❌ {$label}取消: 「{$row['title']}」", 'meetup', $id);
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
    // v458 soft-delete: 分析用 に サーバ側 残す
    $pdo->prepare("UPDATE meetups SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
