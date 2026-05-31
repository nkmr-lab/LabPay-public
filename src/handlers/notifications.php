<?php
// /api/notifications, /api/notifications/{id}/read, /api/notifications/read_all, /api/notifications/unread_count.

declare(strict_types=1);

function route_notifications(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET') {
        $unreadOnly = !empty($_GET['unread']);
        $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        $sql = 'SELECT id, type, body, ref_type, ref_id, read_at, created_at
                  FROM notifications
                 WHERE user_id = ?';
        if ($unreadOnly) $sql .= ' AND read_at IS NULL';
        $sql .= ' ORDER BY id DESC LIMIT ?';
        $st = $pdo->prepare($sql);
        $st->bindValue(1, $uid, PDO::PARAM_INT);
        $st->bindValue(2, $limit, PDO::PARAM_INT);
        $st->execute();
        json_response(['items' => $st->fetchAll()]);
        return;
    }

    if ($sub === 'unread_count' && $method === 'GET') {
        $st = $pdo->prepare('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL');
        $st->execute([$uid]);
        json_response(['unread' => (int)$st->fetchColumn()]);
        return;
    }

    if ($sub === 'read_all' && $method === 'PATCH') {
        $pdo->prepare('UPDATE notifications SET read_at=NOW() WHERE user_id=? AND read_at IS NULL')
            ->execute([$uid]);
        json_response(['ok' => true]);
        return;
    }

    if (is_numeric($sub) && ($seg[2] ?? '') === 'read' && $method === 'PATCH') {
        $nid = (int)$sub;
        $st = $pdo->prepare('UPDATE notifications SET read_at=NOW() WHERE id=? AND user_id=? AND read_at IS NULL');
        $st->execute([$nid, $uid]);
        json_response(['ok' => true, 'updated' => $st->rowCount()]);
        return;
    }

    json_error('not_found', "no notifications route for $method $sub", 404);
}
