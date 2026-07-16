<?php
// v1126 setlog (LabPay 版 Vlog) — 1 日を短いクリップ (画像 + 短キャプション) で断片記録、
//   自動で日別まとめ + みんなの今日のフィード。元祖 setlog は 2秒動画だが LabPay MVP は
//   画像のみ (upload.js の /api/uploads/image を再利用)。
//
// API:
//   GET  /api/setlog/today                          → みんなの今日のクリップ (時系列)
//   GET  /api/setlog?user_id=X&date=YYYY-MM-DD      → 指定日のユーザのクリップ (自分/他人問わず)
//   POST /api/setlog { image_url, caption? }        → クリップ投稿
//   DELETE /api/setlog/{id}                         → 削除 (自分だけ)
//   GET  /api/setlog/mine-days                      → 自分のクリップがある日一覧 (最近 30 日)

declare(strict_types=1);

function route_setlog(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'today'      && $method === 'GET')  { setlog_today($pdo, $cfg);   return; }
    if ($sub === 'mine-days'  && $method === 'GET')  { setlog_mine_days($pdo, $cfg); return; }
    if ($sub === '' && $method === 'GET')  { setlog_list($pdo, $cfg);    return; }
    if ($sub === '' && $method === 'POST') { setlog_create($pdo, $cfg);  return; }
    if (ctype_digit((string)$sub) && $method === 'DELETE') { setlog_delete($pdo, $cfg, (int)$sub); return; }
    throw new ApiException('not_found', "no setlog route for $method $sub", 404);
}

function _setlog_shape(array $r, int $uid): array {
    return [
        'id'           => (int)$r['id'],
        'user_id'      => (int)$r['user_id'],
        'user_name'    => (string)($r['user_name'] ?? ''),
        'user_avatar'  => $r['user_avatar'] ?? null,
        'image_url'    => (string)$r['image_url'],
        'caption'      => (string)($r['caption'] ?? ''),
        'taken_at'     => (string)$r['taken_at'],
        'is_mine'      => ((int)$r['user_id'] === $uid),
    ];
}

function _setlog_base_sql(): string {
    return "SELECT c.id, c.user_id, c.image_url, c.caption, c.taken_at,
                       u.display_name AS user_name, u.avatar_url AS user_avatar
                  FROM setlog_clips c JOIN users u ON u.id = c.user_id
                 WHERE c.deleted_at IS NULL";
}

function setlog_today(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->query(_setlog_base_sql() . " AND DATE(c.taken_at) = CURDATE() ORDER BY c.taken_at DESC LIMIT 500");
    $items = array_map(fn($r) => _setlog_shape($r, (int)$u['id']), $st->fetchAll(PDO::FETCH_ASSOC));
    // ユーザごとに束ねる (day 内タイムライン、ユーザ別)
    $byUser = [];
    foreach ($items as $it) {
        $byUser[$it['user_id']] ??= ['user_id' => $it['user_id'], 'user_name' => $it['user_name'], 'user_avatar' => $it['user_avatar'], 'clips' => []];
        $byUser[$it['user_id']]['clips'][] = $it;
    }
    json_response(['users' => array_values($byUser)]);
}

function setlog_mine_days(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT DATE(taken_at) AS d, COUNT(*) AS n, MIN(taken_at) AS first_at, MAX(taken_at) AS last_at
                            FROM setlog_clips WHERE user_id = ? AND deleted_at IS NULL AND taken_at > NOW() - INTERVAL 60 DAY
                        GROUP BY DATE(taken_at) ORDER BY d DESC");
    $st->execute([$uid]);
    json_response(['days' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function setlog_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $targetUid = (int)($_GET['user_id'] ?? $u['id']);
    $date = (string)($_GET['date'] ?? date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');
    $st = $pdo->prepare(_setlog_base_sql() . " AND c.user_id = ? AND DATE(c.taken_at) = ? ORDER BY c.taken_at ASC");
    $st->execute([$targetUid, $date]);
    $items = array_map(fn($r) => _setlog_shape($r, (int)$u['id']), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items, 'user_id' => $targetUid, 'date' => $date]);
}

function setlog_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $img = trim((string)($body['image_url'] ?? ''));
    if ($img === '') throw new ApiException('bad_request', 'image_url 必要 (/api/uploads/image で upload 済 URL)', 400);
    if (mb_strlen($img) > 500) throw new ApiException('bad_request', 'image_url too long', 400);
    $cap = trim((string)($body['caption'] ?? ''));
    if (mb_strlen($cap) > 80) $cap = mb_substr($cap, 0, 80);
    $st = $pdo->prepare("INSERT INTO setlog_clips (user_id, image_url, caption) VALUES (?, ?, ?)");
    $st->execute([(int)$u['id'], $img, $cap ?: null]);
    $id = (int)$pdo->lastInsertId();
    $rr = $pdo->prepare(_setlog_base_sql() . " AND c.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'clip' => _setlog_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'])]);
}

function setlog_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM setlog_clips WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'clip なし', 404);
    if ((int)$r['user_id'] !== (int)$u['id']) throw new ApiException('forbidden', '自分のクリップのみ削除可', 403);
    $pdo->prepare("UPDATE setlog_clips SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}
