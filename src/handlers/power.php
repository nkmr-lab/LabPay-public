<?php
// v1026 サンプルサイズ / 検定力 の 設定 保存 + 共有 (中村さん要望「名前を付けて保存できる
//   ようにしたい。 また、 共有できるようにもしたい」)。
//
//   ルート:
//     GET    /api/power              → 自分の 保存一覧
//     POST   /api/power              → 新規 保存 (body: name, config)
//     GET    /api/power/{id}         → 詳細 (自分の or 共有中の もの)
//     PATCH  /api/power/{id}         → name 変更 (自分のみ)
//     DELETE /api/power/{id}         → 削除 (自分のみ)
//     POST   /api/power/{id}/share   → 共有ON (share_token 発行)
//     POST   /api/power/{id}/unshare → 共有OFF
//     GET    /api/power/r/{token}    → share_token で 誰でも 閲覧 (LabPay 認証済)

declare(strict_types=1);

function route_power(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === 'r' && isset($seg[2]) && $method === 'GET') {
        power_get_shared($pdo, $cfg, (string)$seg[2]);
        return;
    }
    if ($sub === '' && $method === 'GET')  { power_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { power_create($pdo, $cfg); return; }

    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { power_get($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { power_patch($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { power_delete($pdo, $cfg, $id); return; }
        if ($next === 'share'   && $method === 'POST') { power_share($pdo, $cfg, $id, true);  return; }
        if ($next === 'unshare' && $method === 'POST') { power_share($pdo, $cfg, $id, false); return; }
    }
    throw new ApiException('not_found', "no power route for $method $sub", 404);
}

function power_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, name, share_token, is_shared, created_at, updated_at
                           FROM power_analyses WHERE user_id = ? ORDER BY id DESC LIMIT 100");
    $st->execute([$uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$r) { $r['id'] = (int)$r['id']; $r['is_shared'] = (int)$r['is_shared'] === 1; }
    unset($r);
    json_response(['items' => $items]);
}

function power_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $name = trim((string)require_field($body, 'name'));
    if ($name === '' || mb_strlen($name) > 200) {
        throw new ApiException('bad_request', 'name は 1-200 字', 400);
    }
    $config = $body['config'] ?? null;
    if (!is_array($config)) throw new ApiException('bad_request', 'config (object) が必要', 400);
    $configJson = json_encode($config, JSON_UNESCAPED_UNICODE);
    if (strlen($configJson) > 4000) {
        throw new ApiException('bad_request', 'config が大きすぎます', 400);
    }
    $pdo->prepare("INSERT INTO power_analyses (user_id, name, config_json) VALUES (?,?,?)")
        ->execute([$uid, $name, $configJson]);
    $id = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $id]);
}

function power_get(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT p.*, u.display_name AS owner_name
                           FROM power_analyses p JOIN users u ON u.id = p.user_id
                          WHERE p.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $isOwner = (int)$r['user_id'] === $uid;
    $isShared = (int)$r['is_shared'] === 1;
    if (!$isOwner && !$isShared) throw new ApiException('forbidden', 'アクセス権 が ありません', 403);
    json_response([
        'id'           => (int)$r['id'],
        'name'         => $r['name'],
        'config'       => json_decode($r['config_json'], true) ?: [],
        'share_token'  => $r['share_token'],
        'is_shared'    => $isShared,
        'owner_name'   => $r['owner_name'],
        'is_owner'     => $isOwner,
        'created_at'   => $r['created_at'],
        'updated_at'   => $r['updated_at'],
    ]);
}

function power_get_shared(PDO $pdo, array $cfg, string $token): void {
    Auth::requireUser($pdo, $cfg);   // LabPay 認証必須 (公開ではないが、 ラボ内で共有)
    $st = $pdo->prepare("SELECT p.*, u.display_name AS owner_name
                           FROM power_analyses p JOIN users u ON u.id = p.user_id
                          WHERE p.share_token = ? AND p.is_shared = 1");
    $st->execute([$token]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found or not shared', 404);
    json_response([
        'id'           => (int)$r['id'],
        'name'         => $r['name'],
        'config'       => json_decode($r['config_json'], true) ?: [],
        'share_token'  => $r['share_token'],
        'is_shared'    => true,
        'owner_name'   => $r['owner_name'],
        'is_owner'     => false,
        'created_at'   => $r['created_at'],
    ]);
}

function power_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body)) {
        $name = trim((string)$body['name']);
        if ($name === '' || mb_strlen($name) > 200) throw new ApiException('bad_request', 'name 長さ 1-200', 400);
        $sets[] = 'name = ?'; $args[] = $name;
    }
    if (array_key_exists('config', $body) && is_array($body['config'])) {
        $configJson = json_encode($body['config'], JSON_UNESCAPED_UNICODE);
        if (strlen($configJson) > 4000) throw new ApiException('bad_request', 'config が大きすぎます', 400);
        $sets[] = 'config_json = ?'; $args[] = $configJson;
    }
    if (!$sets) throw new ApiException('bad_request', '変更なし', 400);
    $args[] = $id; $args[] = $uid;
    $pdo->prepare("UPDATE power_analyses SET " . implode(', ', $sets) . " WHERE id = ? AND user_id = ?")
        ->execute($args);
    json_response(['ok' => true]);
}

function power_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $pdo->prepare("DELETE FROM power_analyses WHERE id = ? AND user_id = ?")->execute([$id, $uid]);
    json_response(['ok' => true]);
}

function power_share(PDO $pdo, array $cfg, int $id, bool $on): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT share_token FROM power_analyses WHERE id = ? AND user_id = ?");
    $st->execute([$id, $uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ($on) {
        $token = $row['share_token'];
        if (!$token) {
            for ($i = 0; $i < 30; $i++) {
                $t = bin2hex(random_bytes(3));    // 6 hex
                try {
                    $pdo->prepare("UPDATE power_analyses SET is_shared = 1, share_token = ? WHERE id = ?")
                        ->execute([$t, $id]);
                    $token = $t; break;
                } catch (Throwable $_) { /* uniq 衝突 → retry */ }
            }
            if (!$token) throw new RuntimeException('share_token 発行失敗');
        } else {
            $pdo->prepare("UPDATE power_analyses SET is_shared = 1 WHERE id = ?")->execute([$id]);
        }
        json_response(['ok' => true, 'is_shared' => true, 'share_token' => $token]);
    } else {
        $pdo->prepare("UPDATE power_analyses SET is_shared = 0 WHERE id = ?")->execute([$id]);
        json_response(['ok' => true, 'is_shared' => false, 'share_token' => $row['share_token']]);
    }
}
