<?php
// /api/chat — Slack 風 チャット (#248)。
// 3 つ の 固定 チャンネル (重要 / 連絡 / 相談) + 1対1 DM。
// room_key = 'ch:{slug}' or 'dm:{small_uid}-{big_uid}' で 一元 管理。

declare(strict_types=1);

const CHAT_MAX_BODY_LEN = 4000;
const CHAT_FETCH_LIMIT = 100;

function route_chat(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'rooms' && $method === 'GET' && ($seg[2] ?? '') === '') { chat_rooms_list($pdo, $cfg); return; }
    if ($sub === 'rooms' && ($seg[2] ?? '') !== '') {
        // v670 path_segments は URL decode しない ので、 ch%3Aimportant のまま 来る → 明示 decode
        $roomKey = urldecode((string)$seg[2]);
        $action  = $seg[3] ?? '';
        if ($action === 'messages' && $method === 'GET')  { chat_messages_list($pdo, $cfg, $roomKey); return; }
        if ($action === 'messages' && $method === 'POST') { chat_messages_send($pdo, $cfg, $roomKey); return; }
        if ($action === 'read'     && $method === 'PATCH'){ chat_room_read($pdo, $cfg, $roomKey);     return; }
    }
    if ($sub === 'messages' && ctype_digit((string)($seg[2] ?? '')) && $method === 'DELETE') {
        chat_message_delete($pdo, $cfg, (int)$seg[2]); return;
    }
    if ($sub === 'unread' && $method === 'GET') { chat_unread_total($pdo, $cfg); return; }
    json_error('not_found', "no chat route for $method $sub", 404);
}

// ─── helpers ─────────────────────────────────────
function chat_parse_room(string $roomKey): array {
    if (str_starts_with($roomKey, 'ch:')) {
        $slug = substr($roomKey, 3);
        if (!preg_match('/^[a-z0-9_-]{1,40}$/', $slug)) throw new ApiException('bad_request', 'invalid room', 400);
        return ['type' => 'ch', 'slug' => $slug];
    }
    if (str_starts_with($roomKey, 'dm:')) {
        $rest = substr($roomKey, 3);
        if (!preg_match('/^(\d+)-(\d+)$/', $rest, $m)) throw new ApiException('bad_request', 'invalid dm room', 400);
        $a = (int)$m[1]; $b = (int)$m[2];
        if ($a >= $b) throw new ApiException('bad_request', 'dm uid 順 が 不正 (小→大)', 400);
        return ['type' => 'dm', 'a' => $a, 'b' => $b];
    }
    throw new ApiException('bad_request', 'unknown room', 400);
}

function chat_canonical_dm_key(int $uidA, int $uidB): string {
    $a = min($uidA, $uidB); $b = max($uidA, $uidB);
    return "dm:$a-$b";
}

function chat_assert_access(PDO $pdo, int $myUid, array $room): void {
    if ($room['type'] === 'ch') {
        $st = $pdo->prepare("SELECT 1 FROM chat_channels WHERE slug = ?");
        $st->execute([$room['slug']]);
        if (!$st->fetchColumn()) throw new ApiException('not_found', 'チャンネル が ありません', 404);
        return;
    }
    if ($room['type'] === 'dm') {
        if ($myUid !== $room['a'] && $myUid !== $room['b']) throw new ApiException('forbidden', 'この DM の 参加者 では ありません', 403);
        return;
    }
}

// ─── rooms list ──────────────────────────────────
function chat_rooms_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $rooms = [];

    // channels (= 全員 が 入る)
    $stC = $pdo->query("SELECT slug, name, icon, description, sort_order FROM chat_channels ORDER BY sort_order ASC");
    $channelSlugs = [];
    foreach ($stC->fetchAll(PDO::FETCH_ASSOC) as $c) {
        $key = 'ch:' . $c['slug'];
        $channelSlugs[] = $key;
        $rooms[] = [
            'room_key'    => $key,
            'type'        => 'ch',
            'name'        => $c['name'],
            'icon'        => $c['icon'],
            'description' => $c['description'],
        ];
    }

    // DM = 自分 が 参加 した もの の room_key 一覧 (chat_messages から)
    $stD = $pdo->prepare("SELECT DISTINCT room_key FROM chat_messages
                          WHERE room_key LIKE 'dm:%'
                            AND (room_key LIKE CONCAT('dm:', ?, '-%') OR room_key LIKE CONCAT('dm:%-', ?))
                          ORDER BY room_key");
    $stD->execute([$uid, $uid]);
    foreach ($stD->fetchAll(PDO::FETCH_COLUMN) as $key) {
        $parsed = chat_parse_room($key);
        $otherUid = $parsed['a'] === $uid ? $parsed['b'] : $parsed['a'];
        $stU = $pdo->prepare("SELECT display_name, avatar_url FROM users WHERE id = ?");
        $stU->execute([$otherUid]);
        $other = $stU->fetch(PDO::FETCH_ASSOC);
        $rooms[] = [
            'room_key'   => $key,
            'type'       => 'dm',
            'name'       => $other['display_name'] ?? '?',
            'icon'       => '💬',
            'avatar_url' => $other['avatar_url'] ?? null,
            'other_uid'  => $otherUid,
        ];
    }

    // 各 room の 最新 msg + unread count を 付与
    foreach ($rooms as &$r) {
        $stL = $pdo->prepare("SELECT id, sender_user_id, body, created_at FROM chat_messages
                                WHERE room_key = ? AND deleted_at IS NULL
                                ORDER BY id DESC LIMIT 1");
        $stL->execute([$r['room_key']]);
        $last = $stL->fetch(PDO::FETCH_ASSOC);
        $r['last_message'] = $last ?: null;

        $stR = $pdo->prepare("SELECT last_read_id FROM chat_reads WHERE user_id = ? AND room_key = ?");
        $stR->execute([$uid, $r['room_key']]);
        $lastRead = (int)($stR->fetchColumn() ?: 0);

        $stU = $pdo->prepare("SELECT COUNT(*) FROM chat_messages WHERE room_key = ? AND id > ? AND deleted_at IS NULL AND sender_user_id <> ?");
        $stU->execute([$r['room_key'], $lastRead, $uid]);
        $r['unread'] = (int)$stU->fetchColumn();
    }
    unset($r);

    json_response(['rooms' => $rooms]);
}

// ─── messages list ───────────────────────────────
function chat_messages_list(PDO $pdo, array $cfg, string $roomKey): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $room = chat_parse_room($roomKey);
    chat_assert_access($pdo, $uid, $room);
    $sinceId = (int)($_GET['since_id'] ?? 0);
    $limit = max(1, min(CHAT_FETCH_LIMIT, (int)($_GET['limit'] ?? 50)));
    if ($sinceId > 0) {
        $st = $pdo->prepare("SELECT m.id, m.sender_user_id, m.body, m.created_at, m.edited_at, m.deleted_at,
                                    u.display_name AS sender_name, u.avatar_url AS sender_avatar
                               FROM chat_messages m JOIN users u ON u.id = m.sender_user_id
                              WHERE m.room_key = ? AND m.id > ?
                              ORDER BY m.id ASC LIMIT $limit");
        $st->execute([$roomKey, $sinceId]);
        $items = $st->fetchAll(PDO::FETCH_ASSOC);
    } else {
        // 初回: 末尾 N 件
        $st = $pdo->prepare("SELECT m.id, m.sender_user_id, m.body, m.created_at, m.edited_at, m.deleted_at,
                                    u.display_name AS sender_name, u.avatar_url AS sender_avatar
                               FROM chat_messages m JOIN users u ON u.id = m.sender_user_id
                              WHERE m.room_key = ?
                              ORDER BY m.id DESC LIMIT $limit");
        $st->execute([$roomKey]);
        $items = array_reverse($st->fetchAll(PDO::FETCH_ASSOC));
    }
    json_response(['items' => $items]);
}

// ─── send ────────────────────────────────────────
function chat_messages_send(PDO $pdo, array $cfg, string $roomKey): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $room = chat_parse_room($roomKey);
    chat_assert_access($pdo, $uid, $room);
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', '本文 が 空', 400);
    if (mb_strlen($text) > CHAT_MAX_BODY_LEN) throw new ApiException('bad_request', '本文 が 長すぎ', 400);
    $pdo->prepare("INSERT INTO chat_messages (room_key, sender_user_id, body) VALUES (?,?,?)")
        ->execute([$roomKey, $uid, $text]);
    $msgId = (int)$pdo->lastInsertId();
    // 自分 は 自動 既読
    chat_set_read($pdo, $uid, $roomKey, $msgId);

    // 通知 (DM の 相手 のみ。 channel は 通知 しない = うるさい ので)
    if ($room['type'] === 'dm') {
        $otherUid = $room['a'] === $uid ? $room['b'] : $room['a'];
        $snippet = mb_substr($text, 0, 80);
        try {
            Notifier::notify($pdo, $cfg, $otherUid, 'admin_notice',
                "💬 {$u['display_name']} から DM: " . $snippet,
                'chat', $msgId);
        } catch (Throwable $_) {}
    } elseif ($room['type'] === 'ch' && $room['slug'] === 'important') {
        // 重要 チャンネル は 全員 に 通知 (Slack 風 @channel 相当)
        $snippet = mb_substr($text, 0, 80);
        try {
            $stU = $pdo->query("SELECT id FROM users WHERE kind='human'");
            foreach ($stU->fetchAll(PDO::FETCH_COLUMN) as $targetUid) {
                if ((int)$targetUid === $uid) continue;
                try {
                    Notifier::notify($pdo, $cfg, (int)$targetUid, 'admin_notice',
                        "🚨 重要: {$u['display_name']}: " . $snippet,
                        'chat', $msgId);
                } catch (Throwable $_) {}
            }
        } catch (Throwable $_) {}
    }
    json_response(['id' => $msgId]);
}

// ─── read marker ─────────────────────────────────
function chat_room_read(PDO $pdo, array $cfg, string $roomKey): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $room = chat_parse_room($roomKey);
    chat_assert_access($pdo, $uid, $room);
    $body = read_json_body();
    $lastReadId = (int)($body['last_read_id'] ?? 0);
    chat_set_read($pdo, $uid, $roomKey, $lastReadId);
    json_response(['ok' => true]);
}

function chat_set_read(PDO $pdo, int $uid, string $roomKey, int $lastReadId): void {
    $pdo->prepare("INSERT INTO chat_reads (user_id, room_key, last_read_id)
                   VALUES (?,?,?)
                   ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))")
        ->execute([$uid, $roomKey, $lastReadId]);
}

// ─── delete (sender / admin のみ) ────────────────
function chat_message_delete(PDO $pdo, array $cfg, int $msgId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT sender_user_id FROM chat_messages WHERE id = ?");
    $st->execute([$msgId]);
    $senderUid = (int)$st->fetchColumn();
    if (!$senderUid) throw new ApiException('not_found', 'メッセージ が ありません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($senderUid !== (int)$u['id'] && !$isAdmin) throw new ApiException('forbidden', '送信者 のみ', 403);
    $pdo->prepare("UPDATE chat_messages SET deleted_at = NOW() WHERE id = ?")->execute([$msgId]);
    json_response(['ok' => true]);
}

// ─── 全 unread 集計 (= ホーム / トップバー 用) ─
function chat_unread_total(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT COUNT(*) FROM chat_messages m
                          LEFT JOIN chat_reads r ON r.user_id = ? AND r.room_key = m.room_key
                         WHERE m.deleted_at IS NULL
                           AND m.sender_user_id <> ?
                           AND m.id > COALESCE(r.last_read_id, 0)
                           AND (
                             m.room_key LIKE 'ch:%'
                             OR (m.room_key LIKE 'dm:%' AND (m.room_key LIKE CONCAT('dm:', ?, '-%') OR m.room_key LIKE CONCAT('dm:%-', ?)))
                           )");
    $st->execute([$uid, $uid, $uid, $uid]);
    json_response(['unread' => (int)$st->fetchColumn()]);
}
