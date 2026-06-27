<?php
// v860 #445 制覇 リスト。 ユーザ が 自由 に 「中野区 の パン屋」 のような 制覇 対象
// リスト を 作って、 アイテム を 追加 + 自分が 達成 した もの を チェック していく。
//
//   GET    /api/conquest/lists                       一覧 (公開 + 自分)
//   POST   /api/conquest/lists                       作成 { title, description?, visibility? }
//   GET    /api/conquest/lists/<id>                  詳細 + items + 自分の visited
//   PATCH  /api/conquest/lists/<id>                  編集 (owner) { title?, description?, visibility? }
//   DELETE /api/conquest/lists/<id>                  削除 (owner)
//   POST   /api/conquest/lists/<id>/items            アイテム 追加 { name, note? }
//   PATCH  /api/conquest/lists/<id>/items/<itemId>   編集 (owner) { name?, note? }
//   DELETE /api/conquest/lists/<id>/items/<itemId>   削除 (owner)
//   POST   /api/conquest/lists/<id>/items/<itemId>/visit  訪問 トグル { comment? }

declare(strict_types=1);

function route_conquest(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    // v865 #447 json_error は exit せず 単に レスポンス を 書き出す だけ なので、 呼んだ あと
    //   明示的 に return しないと 後続 が 動いて 多重 レスポンス や Undefined access が 起きる。
    //   ルータ も 各 ヘルパ も json_error 直後 に return を 添える 必要 あり。
    if ($sub !== 'lists') {
        json_error('not_found', "no conquest route for $sub", 404);
        return;
    }

    if (!isset($seg[2])) {
        if ($method === 'GET')  { conquest_list_index($pdo, $uid); return; }
        if ($method === 'POST') { conquest_list_create($pdo, $uid); return; }
        json_error('method_not_allowed', "method $method not allowed on /lists", 405);
        return;
    }

    $listId = (int)$seg[2];
    if ($listId <= 0) {
        json_error('bad_request', 'invalid list id', 400);
        return;
    }

    if (!isset($seg[3])) {
        if ($method === 'GET')    { conquest_list_detail($pdo, $uid, $listId); return; }
        if ($method === 'PATCH')  { conquest_list_update($pdo, $uid, $listId); return; }
        if ($method === 'DELETE') { conquest_list_delete($pdo, $uid, $listId); return; }
        json_error('method_not_allowed', "method $method not allowed", 405);
        return;
    }

    if ($seg[3] === 'items') {
        if (!isset($seg[4])) {
            if ($method === 'POST') { conquest_item_create($pdo, $uid, $listId); return; }
            json_error('method_not_allowed', "method $method not allowed on /items", 405);
            return;
        }
        $itemId = (int)$seg[4];
        if ($itemId <= 0) { json_error('bad_request', 'invalid item id', 400); return; }
        if (!isset($seg[5])) {
            if ($method === 'PATCH')  { conquest_item_update($pdo, $uid, $listId, $itemId); return; }
            if ($method === 'DELETE') { conquest_item_delete($pdo, $uid, $listId, $itemId); return; }
            json_error('method_not_allowed', "method $method not allowed", 405);
            return;
        }
        if ($seg[5] === 'visit' && $method === 'POST') {
            conquest_visit_toggle($pdo, $uid, $listId, $itemId);
            return;
        }
    }

    json_error('not_found', 'no conquest route', 404);
}

function conquest_list_index(PDO $pdo, int $uid): void {
    // 公開 リスト + 自分 の private (= 一覧 で 自分 用 も 見える)
    $st = $pdo->prepare(
        "SELECT cl.id, cl.title, cl.description, cl.visibility, cl.owner_id,
                u.display_name AS owner_name, u.avatar_url AS owner_avatar,
                cl.created_at, cl.updated_at,
                (SELECT COUNT(*) FROM conquest_items WHERE list_id = cl.id) AS item_count,
                (SELECT COUNT(*) FROM conquest_visits WHERE list_id = cl.id AND user_id = ?) AS my_visit_count
           FROM conquest_lists cl
           LEFT JOIN users u ON u.id = cl.owner_id
          WHERE cl.visibility = 'public' OR cl.owner_id = ?
          ORDER BY cl.updated_at DESC"
    );
    $st->execute([$uid, $uid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function conquest_list_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    $desc  = trim((string)($body['description'] ?? ''));
    $vis   = (string)($body['visibility'] ?? 'public');
    if ($title === '') { json_error('bad_request', 'title が 必要', 400); return; }
    if (mb_strlen($title) > 120) { json_error('bad_request', 'title は 120 文字 まで', 400); return; }
    if (!in_array($vis, ['public', 'private'], true)) $vis = 'public';
    $pdo->prepare("INSERT INTO conquest_lists (owner_id, title, description, visibility) VALUES (?,?,?,?)")
        ->execute([$uid, $title, $desc ?: null, $vis]);
    $id = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $id]);
}

function conquest_list_detail(PDO $pdo, int $uid, int $listId): void {
    $st = $pdo->prepare(
        "SELECT cl.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar
           FROM conquest_lists cl LEFT JOIN users u ON u.id = cl.owner_id WHERE cl.id = ?"
    );
    $st->execute([$listId]);
    $list = $st->fetch(PDO::FETCH_ASSOC);
    if (!$list) { json_error('not_found', 'list 不在', 404); return; }
    if ($list['visibility'] === 'private' && (int)$list['owner_id'] !== $uid) {
        json_error('forbidden', '非公開 リスト', 403);
        return;
    }

    // items (with 自分 の visited フラグ)
    $st = $pdo->prepare(
        "SELECT ci.id, ci.name, ci.note, ci.idx, ci.added_by, ci.added_at,
                au.display_name AS added_by_name,
                EXISTS (SELECT 1 FROM conquest_visits cv WHERE cv.item_id = ci.id AND cv.user_id = ?) AS i_visited,
                (SELECT COUNT(*) FROM conquest_visits cv2 WHERE cv2.item_id = ci.id) AS total_visits
           FROM conquest_items ci
           LEFT JOIN users au ON au.id = ci.added_by
          WHERE ci.list_id = ?
          ORDER BY ci.idx ASC, ci.id ASC"
    );
    $st->execute([$uid, $listId]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$it) {
        $it['i_visited'] = (bool)$it['i_visited'];
        $it['total_visits'] = (int)$it['total_visits'];
    }
    unset($it);

    $list['items'] = $items;
    $list['is_mine'] = ((int)$list['owner_id'] === $uid);
    $list['my_visit_count'] = 0;
    foreach ($items as $it) if ($it['i_visited']) $list['my_visit_count']++;
    json_response($list);
}

function conquest_list_update(PDO $pdo, int $uid, int $listId): void {
    if (!conquest_require_owner($pdo, $uid, $listId)) return;
    $body = read_json_body();
    $sets = []; $vals = [];
    if (isset($body['title'])) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 120) { json_error('bad_request', 'title が 不正', 400); return; }
        $sets[] = "title = ?"; $vals[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        $sets[] = "description = ?"; $vals[] = $d === '' ? null : $d;
    }
    if (isset($body['visibility']) && in_array($body['visibility'], ['public', 'private'], true)) {
        $sets[] = "visibility = ?"; $vals[] = $body['visibility'];
    }
    if (!$sets) { json_response(['ok' => true, 'unchanged' => true]); return; }
    $vals[] = $listId;
    $pdo->prepare("UPDATE conquest_lists SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
    json_response(['ok' => true]);
}

function conquest_list_delete(PDO $pdo, int $uid, int $listId): void {
    if (!conquest_require_owner($pdo, $uid, $listId)) return;
    $pdo->prepare("DELETE FROM conquest_lists WHERE id = ?")->execute([$listId]);
    json_response(['ok' => true]);
}

function conquest_item_create(PDO $pdo, int $uid, int $listId): void {
    // 公開 リスト なら 誰でも 追加 OK、 非公開 なら owner のみ
    $vis = conquest_visibility_or_404($pdo, $listId);
    if ($vis === null) return;
    if ($vis !== 'public') {
        if (conquest_owner_of($pdo, $listId) !== $uid) { json_error('forbidden', '所有者 のみ', 403); return; }
    }
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    $note = trim((string)($body['note'] ?? ''));
    if ($name === '') { json_error('bad_request', 'name が 必要', 400); return; }
    if (mb_strlen($name) > 160) { json_error('bad_request', 'name は 160 文字 まで', 400); return; }
    // 次 の idx = max + 1
    $st = $pdo->prepare("SELECT COALESCE(MAX(idx), 0) + 1 FROM conquest_items WHERE list_id = ?");
    $st->execute([$listId]);
    $nextIdx = (int)$st->fetchColumn();
    $pdo->prepare("INSERT INTO conquest_items (list_id, name, note, idx, added_by) VALUES (?,?,?,?,?)")
        ->execute([$listId, $name, $note ?: null, $nextIdx, $uid]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function conquest_item_update(PDO $pdo, int $uid, int $listId, int $itemId): void {
    if (!conquest_require_owner($pdo, $uid, $listId)) return;
    $body = read_json_body();
    $sets = []; $vals = [];
    if (isset($body['name'])) {
        $n = trim((string)$body['name']);
        if ($n === '' || mb_strlen($n) > 160) { json_error('bad_request', 'name 不正', 400); return; }
        $sets[] = "name = ?"; $vals[] = $n;
    }
    if (array_key_exists('note', $body)) {
        $note = trim((string)$body['note']);
        $sets[] = "note = ?"; $vals[] = $note === '' ? null : $note;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $vals[] = $itemId; $vals[] = $listId;
    $pdo->prepare("UPDATE conquest_items SET " . implode(', ', $sets) . " WHERE id = ? AND list_id = ?")->execute($vals);
    json_response(['ok' => true]);
}

function conquest_item_delete(PDO $pdo, int $uid, int $listId, int $itemId): void {
    if (!conquest_require_owner($pdo, $uid, $listId)) return;
    $pdo->prepare("DELETE FROM conquest_items WHERE id = ? AND list_id = ?")->execute([$itemId, $listId]);
    json_response(['ok' => true]);
}

function conquest_visit_toggle(PDO $pdo, int $uid, int $listId, int $itemId): void {
    $vis = conquest_visibility_or_404($pdo, $listId);
    if ($vis === null) return;
    if ($vis !== 'public') {
        $own = conquest_owner_of($pdo, $listId);
        if ($own !== $uid) { json_error('forbidden', '非公開 リスト', 403); return; }
    }
    // 既訪? なら 削除、 でなければ 追加
    $st = $pdo->prepare("SELECT 1 FROM conquest_visits WHERE item_id = ? AND user_id = ?");
    $st->execute([$itemId, $uid]);
    if ($st->fetchColumn()) {
        $pdo->prepare("DELETE FROM conquest_visits WHERE item_id = ? AND user_id = ?")->execute([$itemId, $uid]);
        json_response(['ok' => true, 'visited' => false]);
    } else {
        $body = read_json_body();
        $comment = trim((string)($body['comment'] ?? '')) ?: null;
        $pdo->prepare("INSERT INTO conquest_visits (list_id, item_id, user_id, comment) VALUES (?,?,?,?)")
            ->execute([$listId, $itemId, $uid, $comment]);
        json_response(['ok' => true, 'visited' => true]);
    }
}

// v865 #447 json_error が exit しない 仕様 のため、 list 不在 時 は null を 返して
//   caller 側 で return させる 形 に 変更。 caller が null チェック を 忘れる と
//   レスポンス が 重なる ので、 呼び 出し 側 は 必ず if ($vis === null) return; を 入れる。
function conquest_visibility_or_404(PDO $pdo, int $listId): ?string {
    $st = $pdo->prepare("SELECT visibility FROM conquest_lists WHERE id = ?");
    $st->execute([$listId]);
    $v = $st->fetchColumn();
    if ($v === false) { json_error('not_found', 'list 不在', 404); return null; }
    return (string)$v;
}

function conquest_owner_of(PDO $pdo, int $listId): int {
    $st = $pdo->prepare("SELECT owner_id FROM conquest_lists WHERE id = ?");
    $st->execute([$listId]);
    return (int)$st->fetchColumn();
}

// 所有者 チェック。 不一致 なら json_error を 投げて false を 返す → caller は 必ず
//   if (!conquest_require_owner(...)) return; の 形 で 使う 必要 あり。
function conquest_require_owner(PDO $pdo, int $uid, int $listId): bool {
    if (conquest_owner_of($pdo, $listId) !== $uid) {
        json_error('forbidden', '所有者 のみ 編集 可', 403);
        return false;
    }
    return true;
}
