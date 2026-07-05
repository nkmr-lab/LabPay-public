<?php
// /api/kanban — Trello-like ボード (v934)。 ラボ共有 デフォルト、 全 members が 触れる。
//   ボード → リスト (列) → カード の 3 階層 + 担当者 / ラベル / チェックリスト / コメント / 履歴。
// permission: 起案者 / admin のみ edit/delete、 それ以外 は 一般メンバー でも カード追加/移動/コメント OK。

declare(strict_types=1);

function route_kanban(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === 'boards' && !isset($seg[2]) && $method === 'GET')  { kanban_boards_list($pdo, $cfg);   return; }
    if ($sub === 'boards' && !isset($seg[2]) && $method === 'POST') { kanban_boards_create($pdo, $cfg); return; }
    if ($sub === 'boards' && ctype_digit((string)($seg[2] ?? ''))) {
        $bid = (int)$seg[2];
        $next = $seg[3] ?? '';
        if ($next === '' && $method === 'GET')    { kanban_board_detail($pdo, $cfg, $bid); return; }
        if ($next === '' && $method === 'PATCH')  { kanban_board_edit($pdo, $cfg, $bid);   return; }
        if ($next === '' && $method === 'DELETE') { kanban_board_delete($pdo, $cfg, $bid); return; }
        if ($next === 'lists'      && $method === 'POST')  { kanban_list_create($pdo, $cfg, $bid); return; }
        if ($next === 'labels'     && $method === 'GET')   { kanban_labels_list($pdo, $cfg, $bid); return; }
        if ($next === 'labels'     && $method === 'POST')  { kanban_label_create($pdo, $cfg, $bid); return; }
        if ($next === 'activity'   && $method === 'GET')   { kanban_activity_list($pdo, $cfg, $bid); return; }
    }
    if ($sub === 'lists' && ctype_digit((string)($seg[2] ?? ''))) {
        $lid = (int)$seg[2];
        $next = $seg[3] ?? '';
        if ($next === '' && $method === 'PATCH')  { kanban_list_edit($pdo, $cfg, $lid);   return; }
        if ($next === '' && $method === 'DELETE') { kanban_list_delete($pdo, $cfg, $lid); return; }
        if ($next === 'reorder' && $method === 'PATCH') { kanban_list_reorder($pdo, $cfg, $lid); return; }
        if ($next === 'cards'   && $method === 'POST')  { kanban_card_create($pdo, $cfg, $lid); return; }
    }
    if ($sub === 'cards' && ctype_digit((string)($seg[2] ?? ''))) {
        $cid = (int)$seg[2];
        $next = $seg[3] ?? '';
        if ($next === '' && $method === 'GET')    { kanban_card_detail($pdo, $cfg, $cid); return; }
        if ($next === '' && $method === 'PATCH')  { kanban_card_edit($pdo, $cfg, $cid);   return; }
        if ($next === '' && $method === 'DELETE') { kanban_card_delete($pdo, $cfg, $cid); return; }
        if ($next === 'move'    && $method === 'PATCH') { kanban_card_move($pdo, $cfg, $cid); return; }
        if ($next === 'assignees' && $method === 'POST')  { kanban_card_add_assignee($pdo, $cfg, $cid); return; }
        if ($next === 'assignees' && ctype_digit((string)($seg[4] ?? '')) && $method === 'DELETE') {
            kanban_card_remove_assignee($pdo, $cfg, $cid, (int)$seg[4]); return;
        }
        if ($next === 'labels'    && $method === 'POST')  { kanban_card_add_label($pdo, $cfg, $cid); return; }
        if ($next === 'labels'    && ctype_digit((string)($seg[4] ?? '')) && $method === 'DELETE') {
            kanban_card_remove_label($pdo, $cfg, $cid, (int)$seg[4]); return;
        }
        if ($next === 'checklist' && $method === 'POST')  { kanban_checklist_add($pdo, $cfg, $cid);   return; }
        if ($next === 'comments'  && $method === 'POST')  { kanban_comment_add($pdo, $cfg, $cid);     return; }
    }
    if ($sub === 'labels' && ctype_digit((string)($seg[2] ?? ''))) {
        $labId = (int)$seg[2];
        if ($method === 'PATCH')  { kanban_label_edit($pdo, $cfg, $labId);   return; }
        if ($method === 'DELETE') { kanban_label_delete($pdo, $cfg, $labId); return; }
    }
    if ($sub === 'checklist' && ctype_digit((string)($seg[2] ?? ''))) {
        $itemId = (int)$seg[2];
        if ($method === 'PATCH')  { kanban_checklist_edit($pdo, $cfg, $itemId);   return; }
        if ($method === 'DELETE') { kanban_checklist_delete($pdo, $cfg, $itemId); return; }
    }
    if ($sub === 'comments' && ctype_digit((string)($seg[2] ?? ''))) {
        $comId = (int)$seg[2];
        if ($method === 'PATCH')  { kanban_comment_edit($pdo, $cfg, $comId);   return; }
        if ($method === 'DELETE') { kanban_comment_delete($pdo, $cfg, $comId); return; }
    }
    throw new ApiException('not_found', 'route not found', 404);
}

// ─────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────

function _kanban_log(PDO $pdo, int $boardId, ?int $cardId, int $uid, string $action, array $details = []): void {
    try {
        $st = $pdo->prepare("INSERT INTO kanban_activity (board_id, card_id, user_id, action, details_json)
                             VALUES (?, ?, ?, ?, ?)");
        $st->execute([$boardId, $cardId, $uid, $action, $details ? json_encode($details, JSON_UNESCAPED_UNICODE) : null]);
    } catch (Throwable $_) {}
}

function _kanban_board_of_card(PDO $pdo, int $cardId): ?int {
    $st = $pdo->prepare("SELECT l.board_id FROM kanban_cards c JOIN kanban_lists l ON l.id = c.list_id WHERE c.id = ?");
    $st->execute([$cardId]);
    $b = (int)$st->fetchColumn();
    return $b ?: null;
}

function _kanban_board_of_list(PDO $pdo, int $listId): ?int {
    $st = $pdo->prepare("SELECT board_id FROM kanban_lists WHERE id = ?");
    $st->execute([$listId]);
    $b = (int)$st->fetchColumn();
    return $b ?: null;
}

function _kanban_next_sort_order(PDO $pdo, string $table, string $col, int $parent): int {
    $st = $pdo->prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM $table WHERE $col = ?");
    $st->execute([$parent]);
    return (int)$st->fetchColumn();
}

// ─────────────────────────────────────────────────────
// boards
// ─────────────────────────────────────────────────────

function kanban_boards_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $showArchived = (int)($_GET['archived'] ?? 0) === 1;
    $sql = "SELECT b.id, b.title, b.description, b.icon, b.owner_user_id, b.archived_at, b.created_at, b.updated_at,
                   u.display_name AS owner_name, u.avatar_url AS owner_avatar,
                   (SELECT COUNT(*) FROM kanban_lists l WHERE l.board_id = b.id AND l.archived_at IS NULL) AS list_count,
                   (SELECT COUNT(*) FROM kanban_cards c JOIN kanban_lists l ON l.id = c.list_id
                     WHERE l.board_id = b.id AND c.archived_at IS NULL AND l.archived_at IS NULL) AS card_count
              FROM kanban_boards b LEFT JOIN users u ON u.id = b.owner_user_id
             WHERE " . ($showArchived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL") . "
          ORDER BY b.updated_at DESC";
    $st = $pdo->query($sql);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function kanban_boards_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 200) $title = mb_substr($title, 0, 200);
    $desc = trim((string)($body['description'] ?? ''));
    $icon = trim((string)($body['icon'] ?? '📋'));
    if (mb_strlen($icon) > 5) $icon = mb_substr($icon, 0, 5);
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare("INSERT INTO kanban_boards (title, description, icon, owner_user_id)
                              VALUES (?, ?, ?, ?)");
        $ins->execute([$title, $desc ?: null, $icon ?: '📋', (int)$u['id']]);
        $bid = (int)$pdo->lastInsertId();
        // デフォルト の 3 列 (Todo / Doing / Done) を 作る
        $stL = $pdo->prepare("INSERT INTO kanban_lists (board_id, title, sort_order) VALUES (?, ?, ?)");
        $stL->execute([$bid, '📥 Todo',  0]);
        $stL->execute([$bid, '🚧 Doing', 1]);
        $stL->execute([$bid, '✅ Done',  2]);
        _kanban_log($pdo, $bid, null, (int)$u['id'], 'create_board', ['title' => $title]);
        $pdo->commit();
        json_response(['ok' => true, 'id' => $bid]);
    } catch (Throwable $e) {
        $pdo->rollBack(); throw $e;
    }
}

function kanban_board_detail(PDO $pdo, array $cfg, int $bid): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT b.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar
                          FROM kanban_boards b LEFT JOIN users u ON u.id = b.owner_user_id
                         WHERE b.id = ?");
    $st->execute([$bid]);
    $board = $st->fetch(PDO::FETCH_ASSOC);
    if (!$board) throw new ApiException('not_found', 'not found', 404);

    // Lists
    $stL = $pdo->prepare("SELECT id, title, sort_order FROM kanban_lists
                          WHERE board_id = ? AND archived_at IS NULL
                       ORDER BY sort_order, id");
    $stL->execute([$bid]);
    $lists = $stL->fetchAll(PDO::FETCH_ASSOC);
    if (!$lists) { $board['lists'] = []; json_response($board); return; }
    $listIds = array_map(fn($l) => (int)$l['id'], $lists);
    $place = implode(',', array_fill(0, count($listIds), '?'));

    // Cards (with assignees / labels 集約)
    $stC = $pdo->prepare("SELECT c.id, c.list_id, c.title, c.description, c.sort_order,
                                 c.due_at, c.is_done, c.created_by_user_id, c.created_at, c.updated_at,
                                 u.display_name AS created_by_name, u.avatar_url AS created_by_avatar,
                                 (SELECT COUNT(*) FROM kanban_checklist_items ci WHERE ci.card_id = c.id) AS check_total,
                                 (SELECT COUNT(*) FROM kanban_checklist_items ci WHERE ci.card_id = c.id AND ci.is_done = 1) AS check_done,
                                 (SELECT COUNT(*) FROM kanban_card_comments   cm WHERE cm.card_id = c.id) AS comment_count
                            FROM kanban_cards c LEFT JOIN users u ON u.id = c.created_by_user_id
                           WHERE c.list_id IN ($place) AND c.archived_at IS NULL
                        ORDER BY c.sort_order, c.id");
    $stC->execute($listIds);
    $cardsRaw = $stC->fetchAll(PDO::FETCH_ASSOC);
    $cardIds = array_map(fn($c) => (int)$c['id'], $cardsRaw);
    $cardsById = [];
    foreach ($cardsRaw as $c) {
        $c['assignees'] = [];
        $c['labels'] = [];
        $cardsById[(int)$c['id']] = $c;
    }

    if ($cardIds) {
        $cplace = implode(',', array_fill(0, count($cardIds), '?'));
        // Assignees
        $stA = $pdo->prepare("SELECT ca.card_id, ca.user_id, u.display_name, u.avatar_url
                                FROM kanban_card_assignees ca JOIN users u ON u.id = ca.user_id
                               WHERE ca.card_id IN ($cplace)");
        $stA->execute($cardIds);
        foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cardsById[(int)$r['card_id']]['assignees'][] = [
                'user_id' => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url' => $r['avatar_url'],
            ];
        }
        // Labels
        $stLb = $pdo->prepare("SELECT cl.card_id, l.id, l.name, l.color
                                 FROM kanban_card_labels cl JOIN kanban_labels l ON l.id = cl.label_id
                                WHERE cl.card_id IN ($cplace)");
        $stLb->execute($cardIds);
        foreach ($stLb->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cardsById[(int)$r['card_id']]['labels'][] = [
                'id' => (int)$r['id'], 'name' => $r['name'], 'color' => $r['color'],
            ];
        }
    }
    // Group cards by list
    $cardsByList = [];
    foreach ($cardsById as $c) $cardsByList[(int)$c['list_id']][] = $c;
    foreach ($lists as &$l) {
        $l['cards'] = $cardsByList[(int)$l['id']] ?? [];
    }
    unset($l);

    // Board labels (for chip picker)
    $stBL = $pdo->prepare("SELECT id, name, color, sort_order FROM kanban_labels
                            WHERE board_id = ? ORDER BY sort_order, id");
    $stBL->execute([$bid]);
    $labels = $stBL->fetchAll(PDO::FETCH_ASSOC);

    $board['lists'] = $lists;
    $board['labels'] = $labels;
    json_response($board);
}

function kanban_board_edit(PDO $pdo, array $cfg, int $bid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT owner_user_id FROM kanban_boards WHERE id = ?");
    $st->execute([$bid]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($owner !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者 or admin のみ 編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空 不可', 400);
        $sets[] = 'title = ?'; $args[] = mb_substr($t, 0, 200);
    }
    if (array_key_exists('description', $body)) {
        $sets[] = 'description = ?'; $args[] = trim((string)$body['description']) ?: null;
    }
    if (array_key_exists('icon', $body)) {
        $sets[] = 'icon = ?'; $args[] = mb_substr(trim((string)$body['icon']) ?: '📋', 0, 5);
    }
    if (array_key_exists('archived', $body)) {
        $sets[] = 'archived_at = ?'; $args[] = !empty($body['archived']) ? date('Y-m-d H:i:s') : null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $bid;
    $pdo->prepare("UPDATE kanban_boards SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    _kanban_log($pdo, $bid, null, (int)$u['id'], 'edit_board', $body);
    json_response(['ok' => true]);
}

function kanban_board_delete(PDO $pdo, array $cfg, int $bid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT owner_user_id FROM kanban_boards WHERE id = ?");
    $st->execute([$bid]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($owner !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者 or admin のみ 削除可', 403);
    }
    $pdo->prepare("DELETE FROM kanban_boards WHERE id = ?")->execute([$bid]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// lists
// ─────────────────────────────────────────────────────

function kanban_list_create(PDO $pdo, array $cfg, int $bid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $ex = $pdo->prepare("SELECT 1 FROM kanban_boards WHERE id = ? AND archived_at IS NULL");
    $ex->execute([$bid]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', 'board なし', 404);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 100) $title = mb_substr($title, 0, 100);
    $order = _kanban_next_sort_order($pdo, 'kanban_lists', 'board_id', $bid);
    $ins = $pdo->prepare("INSERT INTO kanban_lists (board_id, title, sort_order) VALUES (?, ?, ?)");
    $ins->execute([$bid, $title, $order]);
    $lid = (int)$pdo->lastInsertId();
    _kanban_log($pdo, $bid, null, (int)$u['id'], 'create_list', ['title' => $title]);
    json_response(['ok' => true, 'id' => $lid]);
}

function kanban_list_edit(PDO $pdo, array $cfg, int $lid): void {
    Auth::requireUser($pdo, $cfg);
    $bid = _kanban_board_of_list($pdo, $lid);
    if (!$bid) throw new ApiException('not_found', 'not found', 404);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空 不可', 400);
        $sets[] = 'title = ?'; $args[] = mb_substr($t, 0, 100);
    }
    if (array_key_exists('archived', $body)) {
        $sets[] = 'archived_at = ?'; $args[] = !empty($body['archived']) ? date('Y-m-d H:i:s') : null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $lid;
    $pdo->prepare("UPDATE kanban_lists SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function kanban_list_delete(PDO $pdo, array $cfg, int $lid): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM kanban_lists WHERE id = ?")->execute([$lid]);
    json_response(['ok' => true]);
}

function kanban_list_reorder(PDO $pdo, array $cfg, int $lid): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $newOrder = (int)($body['sort_order'] ?? 0);
    $pdo->prepare("UPDATE kanban_lists SET sort_order = ? WHERE id = ?")->execute([$newOrder, $lid]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// cards
// ─────────────────────────────────────────────────────

function kanban_card_create(PDO $pdo, array $cfg, int $lid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $bid = _kanban_board_of_list($pdo, $lid);
    if (!$bid) throw new ApiException('not_found', 'list なし', 404);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 500) $title = mb_substr($title, 0, 500);
    $desc = trim((string)($body['description'] ?? ''));
    $due  = isset($body['due_at']) && $body['due_at'] !== '' ? (string)$body['due_at'] : null;
    $order = _kanban_next_sort_order($pdo, 'kanban_cards', 'list_id', $lid);
    $ins = $pdo->prepare("INSERT INTO kanban_cards (list_id, title, description, sort_order, due_at, created_by_user_id)
                          VALUES (?, ?, ?, ?, ?, ?)");
    $ins->execute([$lid, $title, $desc ?: null, $order, $due, (int)$u['id']]);
    $cid = (int)$pdo->lastInsertId();
    _kanban_log($pdo, $bid, $cid, (int)$u['id'], 'create_card', ['title' => $title]);
    json_response(['ok' => true, 'id' => $cid]);
}

function kanban_card_detail(PDO $pdo, array $cfg, int $cid): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT c.*, l.board_id, l.title AS list_title,
                                u.display_name AS created_by_name, u.avatar_url AS created_by_avatar
                           FROM kanban_cards c JOIN kanban_lists l ON l.id = c.list_id
                           LEFT JOIN users u ON u.id = c.created_by_user_id
                          WHERE c.id = ?");
    $st->execute([$cid]);
    $card = $st->fetch(PDO::FETCH_ASSOC);
    if (!$card) throw new ApiException('not_found', 'not found', 404);
    $card['id'] = (int)$card['id']; $card['list_id'] = (int)$card['list_id']; $card['board_id'] = (int)$card['board_id'];

    // assignees
    $stA = $pdo->prepare("SELECT ca.user_id, u.display_name, u.avatar_url
                            FROM kanban_card_assignees ca JOIN users u ON u.id = ca.user_id
                           WHERE ca.card_id = ?");
    $stA->execute([$cid]);
    $card['assignees'] = $stA->fetchAll(PDO::FETCH_ASSOC);

    // labels
    $stL = $pdo->prepare("SELECT l.id, l.name, l.color
                            FROM kanban_card_labels cl JOIN kanban_labels l ON l.id = cl.label_id
                           WHERE cl.card_id = ?");
    $stL->execute([$cid]);
    $card['labels'] = $stL->fetchAll(PDO::FETCH_ASSOC);

    // checklist
    $stCl = $pdo->prepare("SELECT id, text, is_done, sort_order FROM kanban_checklist_items
                            WHERE card_id = ? ORDER BY sort_order, id");
    $stCl->execute([$cid]);
    $card['checklist'] = $stCl->fetchAll(PDO::FETCH_ASSOC);

    // comments
    $stCm = $pdo->prepare("SELECT cm.id, cm.user_id, cm.body, cm.created_at, cm.updated_at,
                                  u.display_name, u.avatar_url
                             FROM kanban_card_comments cm JOIN users u ON u.id = cm.user_id
                            WHERE cm.card_id = ? ORDER BY cm.id DESC");
    $stCm->execute([$cid]);
    $card['comments'] = $stCm->fetchAll(PDO::FETCH_ASSOC);

    json_response($card);
}

function kanban_card_edit(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $bid = _kanban_board_of_card($pdo, $cid);
    if (!$bid) throw new ApiException('not_found', 'not found', 404);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空 不可', 400);
        $sets[] = 'title = ?'; $args[] = mb_substr($t, 0, 500);
    }
    if (array_key_exists('description', $body)) {
        $sets[] = 'description = ?'; $args[] = trim((string)$body['description']) ?: null;
    }
    if (array_key_exists('due_at', $body)) {
        $due = (string)$body['due_at'];
        $sets[] = 'due_at = ?'; $args[] = $due !== '' ? $due : null;
    }
    if (array_key_exists('is_done', $body)) {
        $sets[] = 'is_done = ?'; $args[] = !empty($body['is_done']) ? 1 : 0;
    }
    if (array_key_exists('archived', $body)) {
        $sets[] = 'archived_at = ?'; $args[] = !empty($body['archived']) ? date('Y-m-d H:i:s') : null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $cid;
    $pdo->prepare("UPDATE kanban_cards SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    _kanban_log($pdo, $bid, $cid, (int)$u['id'], 'edit_card', $body);
    json_response(['ok' => true]);
}

function kanban_card_delete(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $bid = _kanban_board_of_card($pdo, $cid);
    $pdo->prepare("DELETE FROM kanban_cards WHERE id = ?")->execute([$cid]);
    if ($bid) _kanban_log($pdo, $bid, null, (int)$u['id'], 'delete_card', ['card_id' => $cid]);
    json_response(['ok' => true]);
}

// カード を list_id + sort_order で 移動 (D&D の 結果)。
function kanban_card_move(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $listId = (int)($body['list_id'] ?? 0);
    $newOrder = (int)($body['sort_order'] ?? 0);
    if ($listId <= 0) throw new ApiException('bad_request', 'list_id 必要', 400);
    // 現在 の list_id を 取得 (移動 元)
    $stCur = $pdo->prepare("SELECT list_id FROM kanban_cards WHERE id = ?");
    $stCur->execute([$cid]);
    $curList = (int)$stCur->fetchColumn();
    if (!$curList) throw new ApiException('not_found', 'not found', 404);
    // target list の 既存 card 順 を 再計算 (新 位置 以降 を +1、 新 card は 指定 位置 に)
    $pdo->beginTransaction();
    try {
        // move 先 の 既存 cards の sort_order を シフト
        $stShift = $pdo->prepare("UPDATE kanban_cards SET sort_order = sort_order + 1
                                   WHERE list_id = ? AND sort_order >= ? AND id != ?");
        $stShift->execute([$listId, $newOrder, $cid]);
        // card 本体 の list_id + sort_order 更新
        $pdo->prepare("UPDATE kanban_cards SET list_id = ?, sort_order = ? WHERE id = ?")
            ->execute([$listId, $newOrder, $cid]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack(); throw $e;
    }
    $bid = _kanban_board_of_card($pdo, $cid);
    if ($bid) _kanban_log($pdo, $bid, $cid, (int)$u['id'], 'move_card', ['to_list' => $listId, 'to_order' => $newOrder]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// assignees
// ─────────────────────────────────────────────────────

function kanban_card_add_assignee(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $uid = (int)($body['user_id'] ?? 0);
    if ($uid <= 0) throw new ApiException('bad_request', 'user_id 必要', 400);
    $pdo->prepare("INSERT IGNORE INTO kanban_card_assignees (card_id, user_id) VALUES (?, ?)")
        ->execute([$cid, $uid]);
    $bid = _kanban_board_of_card($pdo, $cid);
    if ($bid) {
        _kanban_log($pdo, $bid, $cid, (int)$u['id'], 'assign', ['user_id' => $uid]);
        if ($uid !== (int)$u['id']) {
            $stC = $pdo->prepare("SELECT title FROM kanban_cards WHERE id = ?");
            $stC->execute([$cid]);
            $ct = (string)$stC->fetchColumn();
            try {
                notify_safely($pdo, $cfg, $uid, 'admin_notice',
                    "📋 かんばん: 「{$ct}」 の 担当 に アサイン されました /#/kanban/boards/{$bid}",
                    'kanban_card', $cid);
            } catch (Throwable $_) {}
        }
    }
    json_response(['ok' => true]);
}

function kanban_card_remove_assignee(PDO $pdo, array $cfg, int $cid, int $uid): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM kanban_card_assignees WHERE card_id = ? AND user_id = ?")
        ->execute([$cid, $uid]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// labels
// ─────────────────────────────────────────────────────

function kanban_labels_list(PDO $pdo, array $cfg, int $bid): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, name, color, sort_order FROM kanban_labels
                          WHERE board_id = ? ORDER BY sort_order, id");
    $st->execute([$bid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function kanban_label_create(PDO $pdo, array $cfg, int $bid): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    $color = (string)($body['color'] ?? 'gray');
    if (!in_array($color, ['gray','red','orange','yellow','green','blue','purple','pink'], true)) $color = 'gray';
    if ($name === '') throw new ApiException('bad_request', 'name 必要', 400);
    if (mb_strlen($name) > 50) $name = mb_substr($name, 0, 50);
    $order = _kanban_next_sort_order($pdo, 'kanban_labels', 'board_id', $bid);
    $ins = $pdo->prepare("INSERT INTO kanban_labels (board_id, name, color, sort_order) VALUES (?, ?, ?, ?)");
    $ins->execute([$bid, $name, $color, $order]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function kanban_label_edit(PDO $pdo, array $cfg, int $labId): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body))  { $sets[] = 'name = ?'; $args[] = mb_substr(trim((string)$body['name']), 0, 50); }
    if (array_key_exists('color', $body)) {
        $c = (string)$body['color'];
        if (!in_array($c, ['gray','red','orange','yellow','green','blue','purple','pink'], true)) $c = 'gray';
        $sets[] = 'color = ?'; $args[] = $c;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $labId;
    $pdo->prepare("UPDATE kanban_labels SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function kanban_label_delete(PDO $pdo, array $cfg, int $labId): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM kanban_labels WHERE id = ?")->execute([$labId]);
    json_response(['ok' => true]);
}

function kanban_card_add_label(PDO $pdo, array $cfg, int $cid): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $lid = (int)($body['label_id'] ?? 0);
    if ($lid <= 0) throw new ApiException('bad_request', 'label_id 必要', 400);
    $pdo->prepare("INSERT IGNORE INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)")
        ->execute([$cid, $lid]);
    json_response(['ok' => true]);
}

function kanban_card_remove_label(PDO $pdo, array $cfg, int $cid, int $lid): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM kanban_card_labels WHERE card_id = ? AND label_id = ?")
        ->execute([$cid, $lid]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// checklist
// ─────────────────────────────────────────────────────

function kanban_checklist_add(PDO $pdo, array $cfg, int $cid): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'text 必要', 400);
    if (mb_strlen($text) > 500) $text = mb_substr($text, 0, 500);
    $order = _kanban_next_sort_order($pdo, 'kanban_checklist_items', 'card_id', $cid);
    $ins = $pdo->prepare("INSERT INTO kanban_checklist_items (card_id, text, sort_order) VALUES (?, ?, ?)");
    $ins->execute([$cid, $text, $order]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function kanban_checklist_edit(PDO $pdo, array $cfg, int $itemId): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('text', $body))    { $sets[] = 'text = ?';    $args[] = mb_substr(trim((string)$body['text']), 0, 500); }
    if (array_key_exists('is_done', $body)) { $sets[] = 'is_done = ?'; $args[] = !empty($body['is_done']) ? 1 : 0; }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $itemId;
    $pdo->prepare("UPDATE kanban_checklist_items SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function kanban_checklist_delete(PDO $pdo, array $cfg, int $itemId): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM kanban_checklist_items WHERE id = ?")->execute([$itemId]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// comments
// ─────────────────────────────────────────────────────

function kanban_comment_add(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', '本文 必要', 400);
    $ins = $pdo->prepare("INSERT INTO kanban_card_comments (card_id, user_id, body) VALUES (?, ?, ?)");
    $ins->execute([$cid, (int)$u['id'], $text]);
    $comId = (int)$pdo->lastInsertId();
    // アサインメンバー全員 (投稿者 除く) に 通知
    $bid = _kanban_board_of_card($pdo, $cid);
    if ($bid) {
        _kanban_log($pdo, $bid, $cid, (int)$u['id'], 'add_comment', ['comment_id' => $comId]);
        $stA = $pdo->prepare("SELECT user_id FROM kanban_card_assignees WHERE card_id = ? AND user_id != ?");
        $stA->execute([$cid, (int)$u['id']]);
        foreach ($stA as $row) {
            try {
                notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice',
                    "💬 {$u['display_name']} が カード に コメント: 「" . mb_substr($text, 0, 40) . "」 /#/kanban/boards/{$bid}",
                    'kanban_card', $cid);
            } catch (Throwable $_) {}
        }
    }
    json_response(['ok' => true, 'id' => $comId]);
}

function kanban_comment_edit(PDO $pdo, array $cfg, int $comId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM kanban_card_comments WHERE id = ?");
    $st->execute([$comId]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'not found', 404);
    if ($owner !== (int)$u['id']) throw new ApiException('forbidden', '本人 のみ 編集可', 403);
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', '本文 空 不可', 400);
    $pdo->prepare("UPDATE kanban_card_comments SET body = ? WHERE id = ?")->execute([$text, $comId]);
    json_response(['ok' => true]);
}

function kanban_comment_delete(PDO $pdo, array $cfg, int $comId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM kanban_card_comments WHERE id = ?");
    $st->execute([$comId]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($owner !== (int)$u['id'] && !$isAdmin) throw new ApiException('forbidden', '本人 or admin のみ 削除可', 403);
    $pdo->prepare("DELETE FROM kanban_card_comments WHERE id = ?")->execute([$comId]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// activity
// ─────────────────────────────────────────────────────

function kanban_activity_list(PDO $pdo, array $cfg, int $bid): void {
    Auth::requireUser($pdo, $cfg);
    $limit = min(200, max(10, (int)($_GET['limit'] ?? 100)));
    $st = $pdo->prepare("SELECT a.id, a.card_id, a.user_id, a.action, a.details_json, a.created_at,
                                u.display_name, u.avatar_url
                           FROM kanban_activity a JOIN users u ON u.id = a.user_id
                          WHERE a.board_id = ?
                       ORDER BY a.id DESC LIMIT $limit");
    $st->execute([$bid]);
    $items = array_map(function ($r) {
        $r['details'] = $r['details_json'] ? (json_decode((string)$r['details_json'], true) ?: []) : [];
        unset($r['details_json']);
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}
