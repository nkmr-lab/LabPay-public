<?php
// v1208 年度別 名言/迷言 の 登録 + 投票 (中村さん要望)
//   who / when / where / what / context を 記録、 fiscal_year (April-March) で 集計、
//   1 人 1 票 の toggle 投票 (年度末 に 投票 する 想定 だが、 実装上 は 常時 有効)。
declare(strict_types=1);

function route_sayings(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { sayings_list  ($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { sayings_create($pdo, $cfg); return; }
    if ($sub === 'years' && $method === 'GET') { sayings_years($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'PATCH')  { sayings_patch ($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { sayings_delete($pdo, $cfg, $id); return; }
        if ($next === 'vote' && $method === 'POST') { sayings_vote_toggle($pdo, $cfg, $id); return; }
    }
    throw new ApiException('not_found', "no sayings route for $method $sub", 404);
}

// April-March 年度 (「2026-04-01 〜 2027-03-31」 の 期間 は fiscal_year = 2026)
function _saying_fiscal_year_of(string $dateStr): int {
    $d = new DateTimeImmutable($dateStr);
    $y = (int)$d->format('Y');
    $m = (int)$d->format('n');
    return $m >= 4 ? $y : ($y - 1);
}

function _saying_shape(array $r): array {
    return [
        'id'                 => (int)$r['id'],
        'said_by_user_id'    => $r['said_by_user_id'] !== null ? (int)$r['said_by_user_id'] : null,
        'said_by_name'       => (string)$r['said_by_name'],
        'said_by_avatar'     => $r['said_by_avatar'] ?? null,
        'said_at'            => (string)$r['said_at'],
        'place'              => $r['place'] !== null ? (string)$r['place'] : null,
        'body'               => (string)$r['body'],
        'context'            => $r['context'] !== null ? (string)$r['context'] : null,
        'fiscal_year'        => (int)$r['fiscal_year'],
        'created_by_user_id' => (int)$r['created_by_user_id'],
        'created_by_name'    => (string)($r['creator_name'] ?? ''),
        'vote_count'         => (int)($r['vote_count'] ?? 0),
        'my_voted'           => (int)($r['my_voted'] ?? 0) === 1,
        'created_at'         => (string)$r['created_at'],
        'updated_at'         => (string)$r['updated_at'],
    ];
}

// GET /api/sayings?year=YYYY&sort=votes|date
function sayings_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $year = isset($_GET['year']) ? (int)$_GET['year'] : _saying_fiscal_year_of(date('Y-m-d'));
    $sort = (string)($_GET['sort'] ?? 'date');   // 'date' | 'votes'
    $orderBy = $sort === 'votes' ? "vote_count DESC, s.said_at DESC, s.id DESC" : "s.said_at DESC, s.id DESC";
    $st = $pdo->prepare("SELECT s.*, u.display_name AS said_by_name_from_user, u.avatar_url AS said_by_avatar,
                                cu.display_name AS creator_name,
                                (SELECT COUNT(*) FROM lab_saying_votes v WHERE v.saying_id = s.id) AS vote_count,
                                (SELECT COUNT(*) FROM lab_saying_votes v WHERE v.saying_id = s.id AND v.voter_user_id = ?) AS my_voted
                           FROM lab_sayings s
                      LEFT JOIN users u  ON u.id = s.said_by_user_id
                      LEFT JOIN users cu ON cu.id = s.created_by_user_id
                          WHERE s.fiscal_year = ? AND s.deleted_at IS NULL
                       ORDER BY $orderBy");
    $st->execute([$uid, $year]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        // said_by_user_id が セットされ ていて users.display_name が あれば そちら を 優先
        if ($r['said_by_user_id'] !== null && !empty($r['said_by_name_from_user'])) {
            $r['said_by_name'] = $r['said_by_name_from_user'];
        }
        $items[] = _saying_shape($r);
    }
    // 年度 リンク 用 に current year を 返す
    $cur = _saying_fiscal_year_of(date('Y-m-d'));
    json_response(['items' => $items, 'year' => $year, 'current_year' => $cur, 'sort' => $sort]);
}

// GET /api/sayings/years — 存在する 年度 の 一覧 (件数付き)
function sayings_years(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT fiscal_year, COUNT(*) AS n
                         FROM lab_sayings WHERE deleted_at IS NULL
                        GROUP BY fiscal_year ORDER BY fiscal_year DESC");
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[] = ['fiscal_year' => (int)$r['fiscal_year'], 'count' => (int)$r['n']];
    }
    $cur = _saying_fiscal_year_of(date('Y-m-d'));
    json_response(['items' => $out, 'current_year' => $cur]);
}

// POST /api/sayings  body: { said_by_user_id?|said_by_name, said_at, place?, body, context? }
function sayings_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $saidByUid = isset($body['said_by_user_id']) && $body['said_by_user_id'] ? (int)$body['said_by_user_id'] : null;
    $saidByName = trim((string)($body['said_by_name'] ?? ''));
    // ユーザ id が 指定されて 名前 が 空 なら DB から 補完
    if ($saidByUid !== null && $saidByName === '') {
        $q = $pdo->prepare("SELECT display_name FROM users WHERE id = ?");
        $q->execute([$saidByUid]);
        $saidByName = (string)($q->fetchColumn() ?: '');
    }
    if ($saidByName === '') throw new ApiException('bad_request', '発言者名 (said_by_name) が 必要', 400);
    if (mb_strlen($saidByName) > 80) $saidByName = mb_substr($saidByName, 0, 80);
    $saidAt = (string)($body['said_at'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $saidAt)) throw new ApiException('bad_request', 'said_at は YYYY-MM-DD', 400);
    $place = trim((string)($body['place'] ?? ''));
    if (mb_strlen($place) > 120) $place = mb_substr($place, 0, 120);
    $body_text = trim((string)($body['body'] ?? ''));
    if ($body_text === '') throw new ApiException('bad_request', '発言内容 (body) が 必要', 400);
    if (mb_strlen($body_text) > 4000) $body_text = mb_substr($body_text, 0, 4000);
    $context = trim((string)($body['context'] ?? ''));
    if (mb_strlen($context) > 4000) $context = mb_substr($context, 0, 4000);
    $fy = _saying_fiscal_year_of($saidAt);
    $ins = $pdo->prepare("INSERT INTO lab_sayings
                            (said_by_user_id, said_by_name, said_at, place, body, context, fiscal_year, created_by_user_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$saidByUid, $saidByName, $saidAt, $place ?: null, $body_text, $context ?: null, $fy, (int)$u['id']]);
    $sid = (int)$pdo->lastInsertId();
    _sayings_return_one($pdo, $sid, (int)$u['id']);
}

function sayings_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM lab_sayings WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) throw new ApiException('not_found', 'saying なし', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$s['created_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ 編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $params = [];
    if (array_key_exists('said_by_user_id', $body)) {
        $sets[] = 'said_by_user_id = ?';
        $params[] = $body['said_by_user_id'] ? (int)$body['said_by_user_id'] : null;
    }
    if (array_key_exists('said_by_name', $body)) {
        $n = trim((string)$body['said_by_name']);
        if ($n === '') throw new ApiException('bad_request', 'said_by_name 空不可', 400);
        if (mb_strlen($n) > 80) $n = mb_substr($n, 0, 80);
        $sets[] = 'said_by_name = ?'; $params[] = $n;
    }
    if (array_key_exists('said_at', $body)) {
        $d = (string)$body['said_at'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) throw new ApiException('bad_request', 'said_at 形式', 400);
        $sets[] = 'said_at = ?'; $params[] = $d;
        $sets[] = 'fiscal_year = ?'; $params[] = _saying_fiscal_year_of($d);
    }
    if (array_key_exists('place', $body)) {
        $v = trim((string)$body['place']); if (mb_strlen($v) > 120) $v = mb_substr($v, 0, 120);
        $sets[] = 'place = ?'; $params[] = $v ?: null;
    }
    if (array_key_exists('body', $body)) {
        $v = trim((string)$body['body']);
        if ($v === '') throw new ApiException('bad_request', 'body 空不可', 400);
        if (mb_strlen($v) > 4000) $v = mb_substr($v, 0, 4000);
        $sets[] = 'body = ?'; $params[] = $v;
    }
    if (array_key_exists('context', $body)) {
        $v = trim((string)$body['context']); if (mb_strlen($v) > 4000) $v = mb_substr($v, 0, 4000);
        $sets[] = 'context = ?'; $params[] = $v ?: null;
    }
    if (!$sets) { _sayings_return_one($pdo, $id, (int)$u['id']); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE lab_sayings SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    _sayings_return_one($pdo, $id, (int)$u['id']);
}

function sayings_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT created_by_user_id FROM lab_sayings WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'saying なし', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['created_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ 削除可', 403);
    }
    $pdo->prepare("UPDATE lab_sayings SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// POST /api/sayings/{id}/vote  → toggle (既にあれば消す、 無ければ入れる)
function sayings_vote_toggle(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $chk = $pdo->prepare("SELECT id FROM lab_saying_votes WHERE saying_id = ? AND voter_user_id = ?");
    $chk->execute([$id, $uid]);
    $existing = $chk->fetchColumn();
    if ($existing) {
        $pdo->prepare("DELETE FROM lab_saying_votes WHERE id = ?")->execute([(int)$existing]);
        $voted = false;
    } else {
        // saying が 生きている か 確認
        $q = $pdo->prepare("SELECT id FROM lab_sayings WHERE id = ? AND deleted_at IS NULL");
        $q->execute([$id]);
        if (!$q->fetchColumn()) throw new ApiException('not_found', 'saying なし', 404);
        $pdo->prepare("INSERT INTO lab_saying_votes (saying_id, voter_user_id) VALUES (?, ?)")->execute([$id, $uid]);
        $voted = true;
    }
    $count = (int)$pdo->query("SELECT COUNT(*) FROM lab_saying_votes WHERE saying_id = " . (int)$id)->fetchColumn();
    json_response(['ok' => true, 'voted' => $voted, 'vote_count' => $count]);
}

function _sayings_return_one(PDO $pdo, int $id, int $uid): void {
    $st = $pdo->prepare("SELECT s.*, u.display_name AS said_by_name_from_user, u.avatar_url AS said_by_avatar,
                                cu.display_name AS creator_name,
                                (SELECT COUNT(*) FROM lab_saying_votes v WHERE v.saying_id = s.id) AS vote_count,
                                (SELECT COUNT(*) FROM lab_saying_votes v WHERE v.saying_id = s.id AND v.voter_user_id = ?) AS my_voted
                           FROM lab_sayings s
                      LEFT JOIN users u  ON u.id = s.said_by_user_id
                      LEFT JOIN users cu ON cu.id = s.created_by_user_id
                          WHERE s.id = ?");
    $st->execute([$uid, $id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'saying なし', 404);
    if ($r['said_by_user_id'] !== null && !empty($r['said_by_name_from_user'])) {
        $r['said_by_name'] = $r['said_by_name_from_user'];
    }
    json_response(['ok' => true, 'saying' => _saying_shape($r)]);
}
