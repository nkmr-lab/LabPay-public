<?php
// /api/conf-deadlines — 学会 〆切 一覧 (#251)。
// 誰でも 登録 可、 全員 閲覧 可。 カテゴリ: 国際会議 / 国内研究会 / 論文誌 / その他。

declare(strict_types=1);

function route_conf_deadlines(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { cd_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { cd_create($pdo, $cfg); return; }
    if ($sub === 'upcoming' && $method === 'GET') { cd_upcoming($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        if (($seg[2] ?? '') === '' && $method === 'GET')    { cd_detail($pdo, $cfg, $id); return; }
        if (($seg[2] ?? '') === '' && $method === 'PATCH')  { cd_update($pdo, $cfg, $id); return; }
        if (($seg[2] ?? '') === '' && $method === 'DELETE') { cd_delete($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no conf-deadlines route for $method $sub", 404);
}

const CD_VALID_CATS = ['intl_conf','domestic_conf','journal','other'];

function cd_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $category = $_GET['category'] ?? null;
    $past = !empty($_GET['past']);
    $sql = "SELECT c.*, u.display_name AS creator_name
              FROM conf_deadlines c JOIN users u ON u.id = c.created_by_user_id
             WHERE c.deleted_at IS NULL";
    $args = [];
    if ($category && in_array($category, CD_VALID_CATS, true)) {
        $sql .= " AND c.category = ?";
        $args[] = $category;
    }
    if (!$past) {
        $sql .= " AND c.deadline_at >= NOW() - INTERVAL 1 DAY";
    }
    $sql .= " ORDER BY c.deadline_at ASC LIMIT 200";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function cd_upcoming(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $limit = max(1, min(20, (int)($_GET['limit'] ?? 5)));
    $st = $pdo->prepare("SELECT c.id, c.category, c.name, c.url, c.deadline_at,
                                TIMESTAMPDIFF(SECOND, NOW(), c.deadline_at) AS sec_ahead
                           FROM conf_deadlines c
                          WHERE c.deleted_at IS NULL AND c.deadline_at >= NOW()
                          ORDER BY c.deadline_at ASC LIMIT $limit");
    $st->execute();
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function cd_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT c.*, u.display_name AS creator_name
                           FROM conf_deadlines c JOIN users u ON u.id = c.created_by_user_id
                          WHERE c.id = ? AND c.deleted_at IS NULL");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '見つかりません', 404);
    json_response($r);
}

function cd_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    [$category, $name, $fullName, $url, $deadlineAt, $notifAt, $eventStart, $eventEnd, $location, $notes] = cd_validate($body);
    $pdo->prepare("INSERT INTO conf_deadlines
        (category, name, full_name, url, deadline_at, notification_at, event_start, event_end, location, notes, created_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        ->execute([$category, $name, $fullName, $url, $deadlineAt, $notifAt, $eventStart, $eventEnd, $location, $notes, (int)$u['id']]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function cd_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT created_by_user_id FROM conf_deadlines WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['created_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 または admin のみ', 403);
    }
    $body = read_json_body();
    [$category, $name, $fullName, $url, $deadlineAt, $notifAt, $eventStart, $eventEnd, $location, $notes] = cd_validate($body);
    $pdo->prepare("UPDATE conf_deadlines
        SET category=?, name=?, full_name=?, url=?, deadline_at=?, notification_at=?, event_start=?, event_end=?, location=?, notes=?
        WHERE id=?")
        ->execute([$category, $name, $fullName, $url, $deadlineAt, $notifAt, $eventStart, $eventEnd, $location, $notes, $id]);
    json_response(['ok' => true]);
}

function cd_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT created_by_user_id FROM conf_deadlines WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['created_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 または admin のみ', 403);
    }
    $pdo->prepare("UPDATE conf_deadlines SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

function cd_validate(array $body): array {
    $category = (string)($body['category'] ?? 'intl_conf');
    if (!in_array($category, CD_VALID_CATS, true)) throw new ApiException('bad_request', 'category 不正', 400);
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 200) throw new ApiException('bad_request', 'name 1..200', 400);
    $fullName = isset($body['full_name']) ? mb_substr((string)$body['full_name'], 0, 400) : null;
    if ($fullName === '') $fullName = null;
    $url = isset($body['url']) ? mb_substr((string)$body['url'], 0, 500) : null;
    if ($url === '') $url = null;
    $deadlineRaw = (string)($body['deadline_at'] ?? '');
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $deadlineRaw);
    if (!$dt) throw new ApiException('bad_request', 'deadline_at は ISO 日時', 400);
    $deadlineAt = $dt->format('Y-m-d H:i:s');
    $notifAt = null;
    if (!empty($body['notification_at'])) {
        $ndt = DateTime::createFromFormat('Y-m-d\TH:i', (string)$body['notification_at'])
            ?: DateTime::createFromFormat('Y-m-d H:i', (string)$body['notification_at'])
            ?: DateTime::createFromFormat('Y-m-d', (string)$body['notification_at']);
        if ($ndt) $notifAt = $ndt->format('Y-m-d H:i:s');
    }
    $eventStart = !empty($body['event_start']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$body['event_start']) ? $body['event_start'] : null;
    $eventEnd   = !empty($body['event_end'])   && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$body['event_end'])   ? $body['event_end']   : null;
    $location = isset($body['location']) ? mb_substr((string)$body['location'], 0, 200) : null;
    if ($location === '') $location = null;
    $notes = isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 2000) : null;
    if ($notes === '') $notes = null;
    return [$category, $name, $fullName, $url, $deadlineAt, $notifAt, $eventStart, $eventEnd, $location, $notes];
}
