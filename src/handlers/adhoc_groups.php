<?php
// /api/groups — 暫定グループ (ad-hoc groups for short-lived contexts:
// 出張中, 旅行, 学会, 飲み会連幹事). Creator picks members; everyone in the
// group can post items (memo / url / time) into a shared feed and launch
// ルーレット or 飲み会割り勘 pre-filled with the group's members.

declare(strict_types=1);

function route_groups(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { groups_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { groups_create($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { groups_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { groups_close($pdo, $cfg, $id);  return; }
        if ($next === 'items' && $method === 'POST')                { group_items_add($pdo, $cfg, $id);    return; }
        if ($next === 'items' && isset($seg[3]) && $method === 'DELETE') { group_items_del($pdo, $cfg, $id, (int)$seg[3]); return; }
        if ($next === 'members' && $method === 'POST')              { group_members_add($pdo, $cfg, $id);  return; }
        if ($next === 'members' && isset($seg[3]) && $method === 'DELETE') { group_members_del($pdo, $cfg, $id, (int)$seg[3]); return; }
    }
    json_error('not_found', "no groups route for $method $sub", 404);
}

// Helpers
function group_assert_member(PDO $pdo, int $groupId, int $userId): void {
    $st = $pdo->prepare("SELECT 1 FROM adhoc_group_members WHERE group_id=? AND user_id=?");
    $st->execute([$groupId, $userId]);
    if ($st->fetchColumn() === false) {
        throw new ApiException('forbidden', 'メンバーではありません', 403);
    }
}
function group_assert_creator_or_admin(PDO $pdo, int $groupId, array $u): void {
    $st = $pdo->prepare("SELECT creator_user_id FROM adhoc_groups WHERE id=?");
    $st->execute([$groupId]);
    $cid = (int)$st->fetchColumn();
    if ($cid === 0) throw new ApiException('not_found', 'group not found', 404);
    if ($cid !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '作成者または admin だけが操作できます', 403);
    }
}

// ─── LIST + CREATE ───────────────────────────────────────────

function groups_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT g.id, g.title, g.description, g.closed_at, g.created_at,
               uc.display_name AS creator_name,
               (SELECT COUNT(*) FROM adhoc_group_members WHERE group_id = g.id) AS member_count
          FROM adhoc_groups g
          JOIN users uc ON uc.id = g.creator_user_id
          JOIN adhoc_group_members m ON m.group_id = g.id AND m.user_id = ?
         ORDER BY g.closed_at IS NULL DESC, g.created_at DESC LIMIT 50");
    $st->execute([$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function groups_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $description = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    $memberIds = array_values(array_unique(array_filter(array_map('intval', (array)($body['member_ids'] ?? [])))));
    // Creator is always a member.
    $memberIds[] = (int)$u['id'];
    $memberIds = array_values(array_unique($memberIds));

    // Verify members exist.
    $place = implode(',', array_fill(0, count($memberIds), '?'));
    $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($memberIds);
    $found = array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
    if (count($found) !== count($memberIds)) {
        throw new ApiException('bad_request', 'one or more member_ids not found', 400);
    }

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("INSERT INTO adhoc_groups (creator_user_id, title, description) VALUES (?,?,?)");
        $st->execute([$u['id'], $title, $description]);
        $gid = (int)$pdo->lastInsertId();
        $st = $pdo->prepare("INSERT INTO adhoc_group_members (group_id, user_id) VALUES (?,?)");
        foreach ($memberIds as $uid) $st->execute([$gid, $uid]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // Notify non-creator members.
    foreach ($memberIds as $uid) {
        if ($uid === (int)$u['id']) continue;
        notify_safely($pdo, $cfg, $uid, 'admin_notice',
            "👥 暫定グループ「{$title}」に追加されました", 'group', $gid);
    }
    json_response(['ok' => true, 'id' => $gid]);
}

// ─── DETAIL ──────────────────────────────────────────────────

function groups_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $st = $pdo->prepare("
        SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url
          FROM adhoc_groups g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.id = ?");
    $st->execute([$id]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'group not found', 404);

    $stM = $pdo->prepare("
        SELECT u.id, u.display_name, u.avatar_url, u.grade, m.joined_at
          FROM adhoc_group_members m
          JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?
         ORDER BY m.joined_at");
    $stM->execute([$id]);
    $g['members'] = $stM->fetchAll(PDO::FETCH_ASSOC);

    $stI = $pdo->prepare("
        SELECT i.*, u.display_name AS author_name, u.avatar_url AS author_avatar_url
          FROM adhoc_group_items i
          JOIN users u ON u.id = i.created_by_user_id
         WHERE i.group_id = ?
         ORDER BY i.id DESC LIMIT 100");
    $stI->execute([$id]);
    $g['items'] = $stI->fetchAll(PDO::FETCH_ASSOC);

    json_response($g);
}

function groups_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $pdo->prepare("UPDATE adhoc_groups SET closed_at = NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─── ITEMS ───────────────────────────────────────────────────

function group_items_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? 'memo');
    if (!in_array($kind, ['memo','url','time'], true)) {
        throw new ApiException('bad_request', 'kind must be memo/url/time', 400);
    }
    $text = isset($body['body']) ? mb_substr((string)$body['body'], 0, 5000) : null;
    $url  = null;
    if ($kind === 'url') {
        $raw = trim((string)($body['url'] ?? ''));
        if (!preg_match('#^https?://#', $raw)) {
            throw new ApiException('bad_request', 'url must start with http(s)://', 400);
        }
        $url = mb_substr($raw, 0, 2000);
    }
    $when = null;
    if ($kind === 'time') {
        $raw = trim((string)($body['scheduled_at'] ?? ''));
        $raw = str_replace('T', ' ', $raw);
        if (strlen($raw) === 16) $raw .= ':00';
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'scheduled_at must be Y-m-d H:i', 400);
        $when = $dt->format('Y-m-d H:i:s');
    }
    $st = $pdo->prepare("INSERT INTO adhoc_group_items
        (group_id, kind, body, url, scheduled_at, created_by_user_id)
        VALUES (?,?,?,?,?,?)");
    $st->execute([$id, $kind, $text, $url, $when, $u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function group_items_del(PDO $pdo, array $cfg, int $groupId, int $itemId): void {
    $u = Auth::requireUser($pdo, $cfg);
    // Only the item's author can delete (admin override too).
    $st = $pdo->prepare("SELECT created_by_user_id FROM adhoc_group_items
        WHERE id = ? AND group_id = ?");
    $st->execute([$itemId, $groupId]);
    $owner = (int)$st->fetchColumn();
    if ($owner === 0) throw new ApiException('not_found', 'item not found', 404);
    if ($owner !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '投稿者のみ削除可能', 403);
    }
    $pdo->prepare("DELETE FROM adhoc_group_items WHERE id=?")->execute([$itemId]);
    json_response(['ok' => true]);
}

// ─── MEMBERS ─────────────────────────────────────────────────

function group_members_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $body = read_json_body();
    $uid = (int)require_field($body, 'user_id');
    $st = $pdo->prepare("SELECT display_name FROM users WHERE id=? AND kind='human'");
    $st->execute([$uid]);
    $name = $st->fetchColumn();
    if ($name === false) throw new ApiException('not_found', 'user not found', 404);
    $pdo->prepare("INSERT IGNORE INTO adhoc_group_members (group_id, user_id) VALUES (?,?)")
        ->execute([$id, $uid]);
    $stT = $pdo->prepare("SELECT title FROM adhoc_groups WHERE id=?");
    $stT->execute([$id]); $title = (string)$stT->fetchColumn();
    notify_safely($pdo, $cfg, $uid, 'admin_notice',
        "👥 暫定グループ「{$title}」に追加されました", 'group', $id);
    json_response(['ok' => true]);
}

function group_members_del(PDO $pdo, array $cfg, int $groupId, int $uid): void {
    $u = Auth::requireUser($pdo, $cfg);
    // Self-remove is OK; otherwise creator/admin only.
    if ($uid !== (int)$u['id']) group_assert_creator_or_admin($pdo, $groupId, $u);
    $pdo->prepare("DELETE FROM adhoc_group_members WHERE group_id=? AND user_id=?")
        ->execute([$groupId, $uid]);
    json_response(['ok' => true]);
}
