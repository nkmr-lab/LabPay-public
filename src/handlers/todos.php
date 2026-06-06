<?php
// /api/todos — 個人 TODO リスト。
// GET    /api/todos             → 自分の 全件 (未完 + 完了)
// POST   /api/todos {body}      → 追加
// PATCH  /api/todos/:id {done}  → 完了 ↔ 未完了 トグル
// PATCH  /api/todos/:id {body}  → 本文 編集
// DELETE /api/todos/:id         → 削除

declare(strict_types=1);

function route_todos(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { todos_list($pdo, (int)$u['id']);  return; }
    if ($sub === '' && $method === 'POST') { todos_create($pdo, (int)$u['id']); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        if ($method === 'PATCH')  { todos_patch($pdo, (int)$u['id'], $id);  return; }
        if ($method === 'DELETE') { todos_delete($pdo, (int)$u['id'], $id); return; }
    }
    json_error('not_found', "no todos route for $method $sub", 404);
}

function todos_list(PDO $pdo, int $uid): void {
    // v482 #72 due_at 付き。 v483 #75 url / notes / partner も。
    $st = $pdo->prepare("SELECT t.id, t.body, t.done_at, t.created_at, t.sort_order, t.due_at,
                                t.url, t.notes, t.partner_user_id, t.partner_label,
                                p.display_name AS partner_name, p.avatar_url AS partner_avatar
                           FROM user_todos t
                           LEFT JOIN users p ON p.id = t.partner_user_id
                          WHERE t.user_id = ?
                          ORDER BY (t.done_at IS NOT NULL),
                                   (t.due_at IS NULL),
                                   t.due_at ASC,
                                   t.sort_order ASC, t.id DESC");
    $st->execute([$uid]);
    $rows = array_map(fn($r) => [
        'id'              => (int)$r['id'],
        'body'            => $r['body'],
        'done'            => $r['done_at'] !== null,
        'done_at'         => $r['done_at'],
        'created_at'      => $r['created_at'],
        'due_at'          => $r['due_at'] ?? null,
        'sort_order'      => (int)$r['sort_order'],
        'url'             => $r['url'] ?? null,
        'notes'           => $r['notes'] ?? null,
        'partner_user_id' => $r['partner_user_id'] ? (int)$r['partner_user_id'] : null,
        'partner_name'    => $r['partner_name'] ?? null,
        'partner_avatar'  => $r['partner_avatar'] ?? null,
        'partner_label'   => $r['partner_label'] ?? null,
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $rows]);
}

function todos_normalize_due_at($raw): ?string {
    if ($raw === null || $raw === '') return null;
    $raw = (string)$raw;
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d', $raw);
    if (!$dt) throw new ApiException('bad_request', 'due_at は ISO 日時 か YYYY-MM-DD', 400);
    return $dt->format('Y-m-d H:i:s');
}

// v483 #75 url / notes / partner の バリデーション。
function todos_normalize_extras(array $body, PDO $pdo): array {
    $out = [];
    if (array_key_exists('url', $body)) {
        $u = trim((string)$body['url']);
        if ($u !== '' && mb_strlen($u) > 500) $u = mb_substr($u, 0, 500);
        $out['url'] = $u !== '' ? $u : null;
    }
    if (array_key_exists('notes', $body)) {
        $n = trim((string)$body['notes']);
        if ($n !== '' && mb_strlen($n) > 5000) $n = mb_substr($n, 0, 5000);
        $out['notes'] = $n !== '' ? $n : null;
    }
    if (array_key_exists('partner_user_id', $body)) {
        $pid = $body['partner_user_id'];
        if ($pid === null || $pid === '' || (int)$pid === 0) {
            $out['partner_user_id'] = null;
        } else {
            $pid = (int)$pid;
            $st = $pdo->prepare("SELECT 1 FROM users WHERE id=?");
            $st->execute([$pid]);
            if (!$st->fetchColumn()) throw new ApiException('bad_request', '存在しない partner_user_id', 400);
            $out['partner_user_id'] = $pid;
        }
    }
    if (array_key_exists('partner_label', $body)) {
        $l = trim((string)$body['partner_label']);
        if ($l !== '' && mb_strlen($l) > 120) $l = mb_substr($l, 0, 120);
        $out['partner_label'] = $l !== '' ? $l : null;
    }
    return $out;
}

function todos_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '' || mb_strlen($text) > 1000) {
        throw new ApiException('bad_request', 'body 1..1000', 400);
    }
    $due = array_key_exists('due_at', $body) ? todos_normalize_due_at($body['due_at']) : null;
    $extras = todos_normalize_extras($body, $pdo);
    $pdo->prepare("INSERT INTO user_todos (user_id, body, sort_order, due_at, url, notes, partner_user_id, partner_label)
                    VALUES (?, ?, 0, ?, ?, ?, ?, ?)")
        ->execute([$uid, $text, $due,
                   $extras['url'] ?? null,
                   $extras['notes'] ?? null,
                   $extras['partner_user_id'] ?? null,
                   $extras['partner_label'] ?? null]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function todos_patch(PDO $pdo, int $uid, int $id): void {
    $st = $pdo->prepare("SELECT 1 FROM user_todos WHERE id=? AND user_id=?");
    $st->execute([$id, $uid]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'todo が ありません', 404);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('done', $body)) {
        $sets[] = 'done_at = ' . ($body['done'] ? 'NOW()' : 'NULL');
    }
    if (array_key_exists('body', $body)) {
        $t = mb_substr(trim((string)$body['body']), 0, 1000);
        if ($t === '') throw new ApiException('bad_request', 'body は 1..1000', 400);
        $sets[] = 'body = ?'; $args[] = $t;
    }
    if (array_key_exists('due_at', $body)) {
        $due = todos_normalize_due_at($body['due_at']);
        $sets[] = 'due_at = ?'; $args[] = $due;
    }
    // v483 #75 url / notes / partner
    $extras = todos_normalize_extras($body, $pdo);
    foreach (['url','notes','partner_user_id','partner_label'] as $k) {
        if (array_key_exists($k, $extras)) {
            $sets[] = "$k = ?"; $args[] = $extras[$k];
        }
    }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE user_todos SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function todos_delete(PDO $pdo, int $uid, int $id): void {
    $pdo->prepare("DELETE FROM user_todos WHERE id=? AND user_id=?")
        ->execute([$id, $uid]);
    json_response(['ok' => true]);
}
