<?php
// v1164 実験協力者募集 (exp_recruits) — 中村さん要望
//   「どんな実験か、枠は何枠か、上限人数は何人かを書いておいて募集をかけ、
//    希望者はあいている枠を早いもの順で埋めていく」
//   + 「実施者が埋めても良い」 (creator が代理で参加者を追加できる)
//   + 「本人も確認できるようにする」 (参加者は自分の枠を見られる)
//
// API:
//   GET    /api/exp-recruits                      → 一覧 (open 優先、 直近 50 件)
//   POST   /api/exp-recruits                      → 作成 { title, description?, deadline_at?, slots:[{name, capacity}] }
//   GET    /api/exp-recruits/{id}                 → 詳細 (slots + 参加者)
//   POST   /api/exp-recruits/{id}/join            → { slot_id }  自分でエントリー (早い者勝ち)
//   DELETE /api/exp-recruits/{id}/leave           → { slot_id }  自分で取消
//   POST   /api/exp-recruits/{id}/assign          → { slot_id, user_id }  creator 代理追加
//   DELETE /api/exp-recruits/{id}/kick            → { slot_id, user_id }  creator が外す
//   POST   /api/exp-recruits/{id}/close           → creator が募集終了
//   DELETE /api/exp-recruits/{id}                 → soft delete (creator or admin)

declare(strict_types=1);

const EXP_TITLE_MAX = 200;
const EXP_DESC_MAX  = 4000;
const EXP_SLOT_NAME_MAX = 100;
const EXP_MAX_SLOTS = 40;
const EXP_MAX_CAPACITY = 100;

function route_exp_recruits(PDO $pdo, array $cfg, string $method, array $seg): void {
    if (!isset($seg[1])) {
        if ($method === 'GET')  { exp_recruits_list($pdo, $cfg);   return; }
        if ($method === 'POST') { exp_recruits_create($pdo, $cfg); return; }
    }
    if (ctype_digit((string)$seg[1])) {
        $rid = (int)$seg[1];
        if (!isset($seg[2]) && $method === 'GET')    { exp_recruits_get($pdo, $cfg, $rid); return; }
        if (!isset($seg[2]) && $method === 'DELETE') { exp_recruits_delete($pdo, $cfg, $rid); return; }
        $act = $seg[2] ?? '';
        if ($act === 'join'   && $method === 'POST')   { exp_recruits_join($pdo, $cfg, $rid); return; }
        if ($act === 'leave'  && $method === 'DELETE') { exp_recruits_leave($pdo, $cfg, $rid); return; }
        if ($act === 'assign' && $method === 'POST')   { exp_recruits_assign($pdo, $cfg, $rid); return; }
        if ($act === 'kick'   && $method === 'DELETE') { exp_recruits_kick($pdo, $cfg, $rid); return; }
        if ($act === 'close'  && $method === 'POST')   { exp_recruits_close($pdo, $cfg, $rid); return; }
    }
    throw new ApiException('not_found', "no exp-recruits route for $method", 404);
}

function _exp_recruit_shape(array $r, int $uid): array {
    return [
        'id'              => (int)$r['id'],
        'creator_user_id' => (int)$r['creator_user_id'],
        'creator_name'    => (string)($r['creator_name'] ?? ''),
        'creator_avatar'  => $r['creator_avatar'] ?? null,
        'title'           => (string)$r['title'],
        'description'     => (string)($r['description'] ?? ''),
        'status'          => (string)$r['status'],
        'deadline_at'     => $r['deadline_at'] ?? null,
        'created_at'      => (string)$r['created_at'],
        'closed_at'       => $r['closed_at'] ?? null,
        'is_mine'         => (int)$r['creator_user_id'] === $uid,
    ];
}

function exp_recruits_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("
        SELECT r.id, r.creator_user_id, r.title, r.description, r.status, r.deadline_at,
               r.created_at, r.closed_at,
               u.display_name AS creator_name, u.avatar_url AS creator_avatar
          FROM exp_recruits r
          JOIN users u ON u.id = r.creator_user_id
         WHERE r.deleted_at IS NULL
         ORDER BY (r.status = 'open') DESC, r.id DESC
         LIMIT 50");
    $st->execute();
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $item = _exp_recruit_shape($r, $uid);
        $slots = _exp_slot_summary($pdo, (int)$r['id'], $uid);
        $item['slot_count']      = count($slots);
        $item['capacity_total']  = array_sum(array_column($slots, 'capacity'));
        $item['filled_total']    = array_sum(array_column($slots, 'filled'));
        $item['my_slot_names']   = [];
        foreach ($slots as $s) if (!empty($s['is_me_in'])) $item['my_slot_names'][] = $s['name'];
        $items[] = $item;
    }
    json_response(['items' => $items]);
}

function _exp_slot_summary(PDO $pdo, int $rid, int $uid): array {
    $stS = $pdo->prepare("SELECT s.id, s.name, s.capacity, s.sort_order,
                                 (SELECT COUNT(*) FROM exp_recruit_participations p WHERE p.slot_id = s.id) AS filled,
                                 EXISTS(SELECT 1 FROM exp_recruit_participations p WHERE p.slot_id = s.id AND p.user_id = ?) AS is_me_in
                            FROM exp_recruit_slots s
                           WHERE s.recruit_id = ?
                           ORDER BY s.sort_order ASC, s.id ASC");
    $stS->execute([$uid, $rid]);
    $out = [];
    foreach ($stS->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[] = [
            'id'       => (int)$r['id'],
            'name'     => (string)$r['name'],
            'capacity' => (int)$r['capacity'],
            'filled'   => (int)$r['filled'],
            'is_me_in' => (int)$r['is_me_in'] === 1,
        ];
    }
    return $out;
}

function exp_recruits_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'タイトルを入れてください', 400);
    if (mb_strlen($title) > EXP_TITLE_MAX) $title = mb_substr($title, 0, EXP_TITLE_MAX);
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > EXP_DESC_MAX) $desc = mb_substr($desc, 0, EXP_DESC_MAX);
    $deadline = trim((string)($body['deadline_at'] ?? ''));
    $deadlineSql = null;
    if ($deadline !== '') {
        $ts = strtotime($deadline);
        if ($ts === false) throw new ApiException('bad_request', 'deadline_at の形式 (YYYY-MM-DD HH:MM) が不正', 400);
        $deadlineSql = date('Y-m-d H:i:s', $ts);
    }
    $slots = is_array($body['slots'] ?? null) ? $body['slots'] : [];
    if (!$slots) throw new ApiException('bad_request', '少なくとも 1 つの枠が必要です', 400);
    if (count($slots) > EXP_MAX_SLOTS) throw new ApiException('bad_request', '枠は最大 ' . EXP_MAX_SLOTS . ' 個までです', 400);
    // validate slots
    $cleanSlots = [];
    foreach ($slots as $i => $s) {
        $name = trim((string)($s['name'] ?? ''));
        if ($name === '') $name = '枠 ' . ($i + 1);
        if (mb_strlen($name) > EXP_SLOT_NAME_MAX) $name = mb_substr($name, 0, EXP_SLOT_NAME_MAX);
        // v1164 中村さん要望「1 枠に参加できる人数も指定したい。 1 人、 5 人、無制限」
        //   → capacity=0 を「無制限」の sentinel に、 それ以外は 1..EXP_MAX_CAPACITY。
        $cap = (int)($s['capacity'] ?? 1);
        if ($cap < 0) $cap = 1;
        if ($cap > EXP_MAX_CAPACITY) $cap = EXP_MAX_CAPACITY;
        $cleanSlots[] = ['name' => $name, 'capacity' => $cap];
    }
    $rid = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $desc, $deadlineSql, $cleanSlots, &$rid) {
        $st = $pdo->prepare("INSERT INTO exp_recruits (creator_user_id, title, description, deadline_at) VALUES (?, ?, ?, ?)");
        $st->execute([$uid, $title, $desc !== '' ? $desc : null, $deadlineSql]);
        $rid = (int)$pdo->lastInsertId();
        $stS = $pdo->prepare("INSERT INTO exp_recruit_slots (recruit_id, name, capacity, sort_order) VALUES (?, ?, ?, ?)");
        foreach ($cleanSlots as $i => $s) {
            $stS->execute([$rid, $s['name'], $s['capacity'], $i]);
        }
    });
    json_response(['ok' => true, 'id' => $rid]);
}

function exp_recruits_get(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT r.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar
                           FROM exp_recruits r JOIN users u ON u.id = r.creator_user_id
                          WHERE r.id = ? AND r.deleted_at IS NULL");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '募集が見つかりません', 404);
    $recruit = _exp_recruit_shape($r, $uid);
    // slots + participants (with names)
    $stS = $pdo->prepare("SELECT id, name, capacity, sort_order FROM exp_recruit_slots WHERE recruit_id = ? ORDER BY sort_order, id");
    $stS->execute([$rid]);
    $slots = [];
    foreach ($stS->fetchAll(PDO::FETCH_ASSOC) as $s) {
        $slots[] = [
            'id'           => (int)$s['id'],
            'name'         => (string)$s['name'],
            'capacity'     => (int)$s['capacity'],
            'participants' => [],
        ];
    }
    if ($slots) {
        $slotIds = array_column($slots, 'id');
        $ph = implode(',', array_fill(0, count($slotIds), '?'));
        $stP = $pdo->prepare("SELECT p.id, p.slot_id, p.user_id, p.source, p.created_at,
                                     u.display_name AS user_name, u.avatar_url AS user_avatar
                                FROM exp_recruit_participations p
                                JOIN users u ON u.id = p.user_id
                               WHERE p.slot_id IN ($ph)
                               ORDER BY p.created_at ASC");
        $stP->execute($slotIds);
        $bySlot = [];
        foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $bySlot[(int)$p['slot_id']][] = [
                'id'          => (int)$p['id'],
                'user_id'     => (int)$p['user_id'],
                'user_name'   => (string)$p['user_name'],
                'user_avatar' => $p['user_avatar'],
                'source'      => (string)$p['source'],
                'is_me'       => (int)$p['user_id'] === $uid,
                'created_at'  => (string)$p['created_at'],
            ];
        }
        foreach ($slots as &$s) {
            $s['participants'] = $bySlot[$s['id']] ?? [];
            $s['filled']       = count($s['participants']);
            $s['is_me_in']     = (bool)array_filter($s['participants'], fn($p) => $p['is_me']);
        }
        unset($s);
    }
    json_response([
        'recruit' => $recruit,
        'slots'   => $slots,
    ]);
}

function _exp_assert_recruit_open(PDO $pdo, int $rid): array {
    $st = $pdo->prepare("SELECT * FROM exp_recruits WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '募集がありません', 404);
    if ($r['status'] !== 'open') throw new ApiException('bad_state', 'この募集は締め切られました', 409);
    if (!empty($r['deadline_at']) && strtotime((string)$r['deadline_at']) <= time()) {
        throw new ApiException('bad_state', '締切を過ぎました', 409);
    }
    return $r;
}

function _exp_add_participation(PDO $pdo, int $slotId, int $rid, int $userId, string $source): void {
    // capacity check inside transaction
    db_tx($pdo, function () use ($pdo, $slotId, $rid, $userId, $source) {
        $stS = $pdo->prepare("SELECT id, capacity FROM exp_recruit_slots WHERE id = ? AND recruit_id = ? FOR UPDATE");
        $stS->execute([$slotId, $rid]);
        $s = $stS->fetch(PDO::FETCH_ASSOC);
        if (!$s) throw new ApiException('not_found', '枠がありません', 404);
        // v1164 capacity=0 は無制限
        $cap = (int)$s['capacity'];
        if ($cap > 0) {
            $stC = $pdo->prepare("SELECT COUNT(*) FROM exp_recruit_participations WHERE slot_id = ?");
            $stC->execute([$slotId]);
            $filled = (int)$stC->fetchColumn();
            if ($filled >= $cap) throw new ApiException('full', 'この枠は満員です', 409);
        }
        $stE = $pdo->prepare("SELECT 1 FROM exp_recruit_participations WHERE slot_id = ? AND user_id = ?");
        $stE->execute([$slotId, $userId]);
        if ($stE->fetchColumn()) throw new ApiException('duplicate', '既にこの枠に登録されています', 409);
        $pdo->prepare("INSERT INTO exp_recruit_participations (slot_id, user_id, source) VALUES (?, ?, ?)")
            ->execute([$slotId, $userId, $source]);
    });
}

function exp_recruits_join(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    _exp_assert_recruit_open($pdo, $rid);
    $body = read_json_body();
    $slotId = (int)($body['slot_id'] ?? 0);
    if ($slotId <= 0) throw new ApiException('bad_request', 'slot_id が必要', 400);
    _exp_add_participation($pdo, $slotId, $rid, $uid, 'self_signup');
    json_response(['ok' => true]);
}

function exp_recruits_leave(PDO $pdo, array $cfg, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $slotId = (int)($body['slot_id'] ?? 0);
    if ($slotId <= 0) throw new ApiException('bad_request', 'slot_id が必要', 400);
    // 自分の分だけ削除可
    $st = $pdo->prepare("DELETE p FROM exp_recruit_participations p
                          JOIN exp_recruit_slots s ON s.id = p.slot_id
                         WHERE p.slot_id = ? AND p.user_id = ? AND s.recruit_id = ?");
    $st->execute([$slotId, $uid, $rid]);
    json_response(['ok' => true, 'removed' => $st->rowCount()]);
}

function _exp_assert_creator(PDO $pdo, array $cfg, int $rid): array {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = ($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM exp_recruits WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$rid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '募集がありません', 404);
    if ((int)$r['creator_user_id'] !== $uid && !$isAdmin) {
        throw new ApiException('forbidden', '実施者 (or 管理者) のみ操作可能です', 403);
    }
    return $r;
}

function exp_recruits_assign(PDO $pdo, array $cfg, int $rid): void {
    $r = _exp_assert_creator($pdo, $cfg, $rid);
    if ($r['status'] !== 'open') throw new ApiException('bad_state', '締切済みの募集には追加できません', 409);
    $body = read_json_body();
    $slotId = (int)($body['slot_id'] ?? 0);
    $userId = (int)($body['user_id'] ?? 0);
    if ($slotId <= 0 || $userId <= 0) throw new ApiException('bad_request', 'slot_id / user_id が必要', 400);
    $stU = $pdo->prepare("SELECT id FROM users WHERE id = ? AND kind='human'");
    $stU->execute([$userId]);
    if (!$stU->fetchColumn()) throw new ApiException('not_found', '指定ユーザが見つかりません', 404);
    _exp_add_participation($pdo, $slotId, $rid, $userId, 'assigned_by_creator');
    json_response(['ok' => true]);
}

function exp_recruits_kick(PDO $pdo, array $cfg, int $rid): void {
    _exp_assert_creator($pdo, $cfg, $rid);
    $body = read_json_body();
    $slotId = (int)($body['slot_id'] ?? 0);
    $userId = (int)($body['user_id'] ?? 0);
    if ($slotId <= 0 || $userId <= 0) throw new ApiException('bad_request', 'slot_id / user_id が必要', 400);
    $st = $pdo->prepare("DELETE p FROM exp_recruit_participations p
                          JOIN exp_recruit_slots s ON s.id = p.slot_id
                         WHERE p.slot_id = ? AND p.user_id = ? AND s.recruit_id = ?");
    $st->execute([$slotId, $userId, $rid]);
    json_response(['ok' => true, 'removed' => $st->rowCount()]);
}

function exp_recruits_close(PDO $pdo, array $cfg, int $rid): void {
    _exp_assert_creator($pdo, $cfg, $rid);
    $pdo->prepare("UPDATE exp_recruits SET status='closed', closed_at=NOW() WHERE id=? AND deleted_at IS NULL")
        ->execute([$rid]);
    json_response(['ok' => true]);
}

function exp_recruits_delete(PDO $pdo, array $cfg, int $rid): void {
    _exp_assert_creator($pdo, $cfg, $rid);
    $pdo->prepare("UPDATE exp_recruits SET deleted_at = NOW() WHERE id = ?")->execute([$rid]);
    json_response(['ok' => true]);
}
