<?php
// v718 #314 一時的な画像共有機能。「とにかく今これ見て」用。
//   ・ラボ全体 or 特定グループ宛に画像 (+ 短文) を投稿
//   ・expires_at まで「アクティブ」扱い。 deleted_at で起案者/admin が即時消せる
//   ・home の widget 等から大きく表示することを想定

function route_screen_shares(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === 'active' && $method === 'GET')  { ss_active($pdo, $cfg); return; }
    if ($sub === ''       && $method === 'POST') { ss_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        if ($method === 'DELETE') { ss_dismiss($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no screen-shares route for $method $sub", 404);
}

// ラボ全体宛 (group_id IS NULL) + 自分が所属するグループ宛をマージで返す。
function ss_active(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 自分の所属グループを取得
    $gst = $pdo->prepare('SELECT group_id FROM adhoc_group_members WHERE user_id = ?');
    $gst->execute([$uid]);
    $gids = array_map('intval', array_column($gst->fetchAll(PDO::FETCH_ASSOC), 'group_id'));
    $where = 's.deleted_at IS NULL AND s.expires_at > NOW() AND (s.group_id IS NULL';
    $args = [];
    if ($gids) {
        $place = implode(',', array_fill(0, count($gids), '?'));
        $where .= " OR s.group_id IN ($place)";
        $args = $gids;
    }
    $where .= ')';
    $sql = "SELECT s.id, s.creator_user_id, s.group_id, s.image_url, s.body,
                   s.created_at, s.expires_at,
                   u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
                   g.name AS group_name
              FROM screen_shares s
              JOIN users u ON u.id = s.creator_user_id
         LEFT JOIN adhoc_groups g ON g.id = s.group_id
             WHERE $where
          ORDER BY s.created_at DESC";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = array_map(fn($r) => [
        'id'                 => (int)$r['id'],
        'creator_user_id'    => (int)$r['creator_user_id'],
        'creator_name'       => $r['creator_name'],
        'creator_avatar_url' => $r['creator_avatar_url'],
        'group_id'           => $r['group_id'] !== null ? (int)$r['group_id'] : null,
        'group_name'         => $r['group_name'],
        'image_url'          => $r['image_url'],
        'body'               => $r['body'],
        'created_at'         => $r['created_at'],
        'expires_at'         => $r['expires_at'],
        'is_mine'            => (int)$r['creator_user_id'] === $uid,
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function ss_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $imageUrl = trim((string)($body['image_url'] ?? ''));
    if ($imageUrl === '' || mb_strlen($imageUrl) > 500) {
        throw new ApiException('bad_request', 'image_url 必須 (1..500)', 400);
    }
    $text = isset($body['body']) ? mb_substr(trim((string)$body['body']), 0, 1000) : null;
    if ($text === '') $text = null;
    $groupId = null;
    if (isset($body['group_id']) && $body['group_id'] !== '' && $body['group_id'] !== null) {
        $gid = (int)$body['group_id'];
        $chk = $pdo->prepare("SELECT 1 FROM adhoc_groups WHERE id=?");
        $chk->execute([$gid]);
        if (!$chk->fetchColumn()) throw new ApiException('bad_request', '指定のグループが見つかりません', 400);
        $groupId = $gid;
    }
    $expiresIn = (int)($body['expires_in_min'] ?? 60);
    $expiresIn = max(5, min(1440, $expiresIn));  // 5 分..24 時間
    $ins = $pdo->prepare("INSERT INTO screen_shares
        (creator_user_id, group_id, image_url, body, created_at, expires_at)
        VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))");
    $ins->execute([(int)$u['id'], $groupId, $imageUrl, $text, $expiresIn]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function ss_dismiss(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM screen_shares WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', '共有が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cuid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("UPDATE screen_shares SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
