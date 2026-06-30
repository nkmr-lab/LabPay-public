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

// 表示対象 (= 自分が宛先) の active な共有を返す:
//   ・group_id IS NULL かつ target_user_ids IS NULL → ラボ全体宛 (全員見える)
//   ・group_id があるかつ自分がそのグループメンバー → グループ宛 (見える)
//   ・target_user_ids に自分が含まれる → 個人宛 (見える) ※ v742 #353
//   ・creator が自分 → 自分の投稿 (常に見える)
function ss_active(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $gst = $pdo->prepare('SELECT group_id FROM adhoc_group_members WHERE user_id = ?');
    $gst->execute([$uid]);
    $gids = array_map('intval', array_column($gst->fetchAll(PDO::FETCH_ASSOC), 'group_id'));

    // 共有を全部取って PHP 側で可視性判定 (target_user_ids は JSON 文字列、
    //   行数はたかがしれているので単純化)。
    $sql = "SELECT s.id, s.creator_user_id, s.group_id, s.target_user_ids, s.image_url, s.body,
                   s.created_at, s.expires_at,
                   u.display_name AS creator_name, u.avatar_url AS creator_avatar_url,
                   g.title AS group_name
              FROM screen_shares s
              JOIN users u ON u.id = s.creator_user_id
         LEFT JOIN adhoc_groups g ON g.id = s.group_id
             WHERE s.deleted_at IS NULL AND s.expires_at > NOW()
          ORDER BY s.created_at DESC LIMIT 200";
    $st = $pdo->prepare($sql);
    $st->execute();
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $isMine = (int)$r['creator_user_id'] === $uid;
        $gid = $r['group_id'] !== null ? (int)$r['group_id'] : null;
        $targetIds = [];
        if (!empty($r['target_user_ids'])) {
            $dec = json_decode((string)$r['target_user_ids'], true);
            if (is_array($dec)) $targetIds = array_map('intval', $dec);
        }
        $visible = $isMine;
        if (!$visible) {
            if (!empty($targetIds)) {
                $visible = in_array($uid, $targetIds, true);
            } elseif ($gid !== null) {
                $visible = in_array($gid, $gids, true);
            } else {
                $visible = true;       // 全体 broadcast
            }
        }
        if (!$visible) continue;
        // 宛先ラベル用に target user 名を引く (重い場合は後日 join)
        $targetNames = [];
        if (!empty($targetIds)) {
            $place = implode(',', array_fill(0, count($targetIds), '?'));
            $stN = $pdo->prepare("SELECT display_name FROM users WHERE id IN ($place) ORDER BY display_name");
            $stN->execute($targetIds);
            $targetNames = $stN->fetchAll(PDO::FETCH_COLUMN);
        }
        $items[] = [
            'id'                 => (int)$r['id'],
            'creator_user_id'    => (int)$r['creator_user_id'],
            'creator_name'       => $r['creator_name'],
            'creator_avatar_url' => $r['creator_avatar_url'],
            'group_id'           => $gid,
            'group_name'         => $r['group_name'],
            'target_user_ids'    => $targetIds,
            'target_user_names'  => $targetNames,
            'image_url'          => $r['image_url'],
            'body'               => $r['body'],
            'created_at'         => $r['created_at'],
            'expires_at'         => $r['expires_at'],
            'is_mine'            => $isMine,
        ];
    }
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
    // v742 #353 個人 (複数可) 宛を受ける。 target_user_ids が与えられたら該当 user 限定。
    //   group_id と target_user_ids は排他 (同時指定は target_user_ids を優先)。
    $targetIdsJson = null;
    if (isset($body['target_user_ids']) && is_array($body['target_user_ids'])) {
        $ids = [];
        foreach ($body['target_user_ids'] as $v) {
            $i = (int)$v;
            if ($i > 0 && $i !== (int)$u['id']) $ids[] = $i;
        }
        $ids = array_values(array_unique($ids));
        if (!empty($ids)) {
            $place = implode(',', array_fill(0, count($ids), '?'));
            $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE kind='human' AND id IN ($place)");
            $chk->execute($ids);
            if ((int)$chk->fetchColumn() !== count($ids)) {
                throw new ApiException('bad_request', '宛先ユーザーが見つかりません', 400);
            }
            $targetIdsJson = json_encode($ids);
            $groupId = null;   // 個人宛が優先
        }
    }
    $expiresIn = (int)($body['expires_in_min'] ?? 60);
    $expiresIn = max(5, min(1440, $expiresIn));  // 5 分..24 時間
    $ins = $pdo->prepare("INSERT INTO screen_shares
        (creator_user_id, group_id, target_user_ids, image_url, body, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))");
    $ins->execute([(int)$u['id'], $groupId, $targetIdsJson, $imageUrl, $text, $expiresIn]);
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
