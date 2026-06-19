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
    $st = $pdo->prepare("SELECT c.id, c.category, c.name, c.location, c.url, c.deadline_at,
                                c.deadline_label, c.deadline_is_aoe, c.extra_deadlines,
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
    $v = cd_validate($body);
    $pdo->prepare("INSERT INTO conf_deadlines
        (category, name, full_name, url, deadline_at, deadline_label, deadline_is_aoe, extra_deadlines,
         notification_at, event_start, event_end, location, notes, created_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        ->execute([$v['category'], $v['name'], $v['full_name'], $v['url'], $v['deadline_at'],
                   $v['deadline_label'], $v['deadline_is_aoe'], $v['extra_deadlines'],
                   $v['notification_at'], $v['event_start'], $v['event_end'], $v['location'], $v['notes'], (int)$u['id']]);
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
    $v = cd_validate($body);
    $pdo->prepare("UPDATE conf_deadlines
        SET category=?, name=?, full_name=?, url=?, deadline_at=?, deadline_label=?, deadline_is_aoe=?, extra_deadlines=?,
            notification_at=?, event_start=?, event_end=?, location=?, notes=?
        WHERE id=?")
        ->execute([$v['category'], $v['name'], $v['full_name'], $v['url'], $v['deadline_at'],
                   $v['deadline_label'], $v['deadline_is_aoe'], $v['extra_deadlines'],
                   $v['notification_at'], $v['event_start'], $v['event_end'], $v['location'], $v['notes'], $id]);
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

function cd_parse_datetime(string $raw): ?string {
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
    return $dt ? $dt->format('Y-m-d H:i:s') : null;
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
    $deadlineAt = cd_parse_datetime((string)($body['deadline_at'] ?? ''));
    if (!$deadlineAt) throw new ApiException('bad_request', 'deadline_at は ISO 日時', 400);
    // v691 #275 メイン 締切 の ラベル (原稿 / 申込 / アブスト etc.) と AOE フラグ
    $deadlineLabel = isset($body['deadline_label']) ? mb_substr(trim((string)$body['deadline_label']), 0, 50) : null;
    if ($deadlineLabel === '') $deadlineLabel = null;
    $deadlineIsAoe = !empty($body['deadline_is_aoe']) ? 1 : 0;
    // v691 #275 追加 の サブ 締切 (申込 / アブスト 等)。 配列 of {label, deadline_at, is_aoe}
    $extraJson = null;
    if (!empty($body['extra_deadlines']) && is_array($body['extra_deadlines'])) {
        $clean = [];
        foreach ($body['extra_deadlines'] as $e) {
            if (!is_array($e)) continue;
            $dl = cd_parse_datetime((string)($e['deadline_at'] ?? ''));
            if (!$dl) continue;
            $lbl = mb_substr(trim((string)($e['label'] ?? '')), 0, 50);
            if ($lbl === '') $lbl = '締切';
            $clean[] = [
                'label' => $lbl,
                'deadline_at' => $dl,
                'is_aoe' => !empty($e['is_aoe']) ? 1 : 0,
            ];
            if (count($clean) >= 10) break;
        }
        if ($clean) $extraJson = json_encode($clean, JSON_UNESCAPED_UNICODE);
    }
    $notifAt = null;
    if (!empty($body['notification_at'])) {
        $ndt = cd_parse_datetime((string)$body['notification_at']);
        if (!$ndt) {
            $ndt2 = DateTime::createFromFormat('Y-m-d', (string)$body['notification_at']);
            if ($ndt2) $ndt = $ndt2->format('Y-m-d 00:00:00');
        }
        if ($ndt) $notifAt = $ndt;
    }
    $eventStart = !empty($body['event_start']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$body['event_start']) ? $body['event_start'] : null;
    $eventEnd   = !empty($body['event_end'])   && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$body['event_end'])   ? $body['event_end']   : null;
    $location = isset($body['location']) ? mb_substr((string)$body['location'], 0, 200) : null;
    if ($location === '') $location = null;
    $notes = isset($body['notes']) ? mb_substr((string)$body['notes'], 0, 2000) : null;
    if ($notes === '') $notes = null;
    return [
        'category' => $category, 'name' => $name, 'full_name' => $fullName, 'url' => $url,
        'deadline_at' => $deadlineAt, 'deadline_label' => $deadlineLabel, 'deadline_is_aoe' => $deadlineIsAoe,
        'extra_deadlines' => $extraJson, 'notification_at' => $notifAt,
        'event_start' => $eventStart, 'event_end' => $eventEnd, 'location' => $location, 'notes' => $notes,
    ];
}
