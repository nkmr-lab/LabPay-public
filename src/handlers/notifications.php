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
        // v512 ページング: ?before_id=N で 「id < N」 の範囲を取りに行く。
        //   id が降順 (新しい順) なので、 末尾の最古の id を返して クライアントが次回
        //   before_id に渡せばカーソルベース pagination が成り立つ。
        $beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
        $args = [$uid];
        $sql = 'SELECT id, type, body, ref_type, ref_id, read_at, created_at
                  FROM notifications
                 WHERE user_id = ?';
        if ($unreadOnly) $sql .= ' AND read_at IS NULL';
        if ($beforeId > 0) { $sql .= ' AND id < ?'; $args[] = $beforeId; }
        $sql .= ' ORDER BY id DESC LIMIT ?';
        $st = $pdo->prepare($sql);
        foreach ($args as $i => $v) $st->bindValue($i + 1, $v, PDO::PARAM_INT);
        $st->bindValue(count($args) + 1, $limit, PDO::PARAM_INT);
        $st->execute();
        $items = $st->fetchAll();
        // has_more 判定: 取得件数 == limit なら 次がある可能性あり (本来は LIMIT+1 で
        //   ちゃんと判定すべきだが、 通知は 数千件規模なので簡易判定で十分)。
        json_response([
            'items'    => $items,
            'has_more' => count($items) === $limit,
        ]);
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

    // 既読を未読に戻す。 通知を流し見してしまった時のセーフネット。
    if (is_numeric($sub) && ($seg[2] ?? '') === 'unread' && $method === 'PATCH') {
        $nid = (int)$sub;
        $st = $pdo->prepare('UPDATE notifications SET read_at=NULL WHERE id=? AND user_id=?');
        $st->execute([$nid, $uid]);
        json_response(['ok' => true, 'updated' => $st->rowCount()]);
        return;
    }

    json_error('not_found', "no notifications route for $method $sub", 404);
}
