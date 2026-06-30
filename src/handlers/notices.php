<?php
// /api/notices — 重要連絡 / 学会情報を同じテーブルでカテゴリ分けして管理。
// 投稿: 全メンバー。編集 / 削除: 投稿者 or admin。

declare(strict_types=1);

const NOTICE_CATEGORIES = ['important', 'conference'];

function route_notices(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { notices_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { notices_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        if ($method === 'PATCH')  { notices_patch($pdo, $cfg, $id);  return; }
        if ($method === 'DELETE') { notices_delete($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no notices route for $method $sub", 404);
}

function notices_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $cat = (string)($_GET['category'] ?? '');
    $params = [];
    $where = '';
    if (in_array($cat, NOTICE_CATEGORIES, true)) {
        $where = ' WHERE n.category = ?';
        $params[] = $cat;
    }
    $st = $pdo->prepare("SELECT n.id, n.category, n.title, n.body, n.url, n.pinned,
                                n.created_at, n.updated_at,
                                n.posted_by_user_id, u.display_name AS posted_by_name
                           FROM notices n
                           JOIN users u ON u.id = n.posted_by_user_id
                          $where
                          ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC
                          LIMIT 200");
    $st->execute($params);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function notices_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $cat = (string)($body['category'] ?? '');
    if (!in_array($cat, NOTICE_CATEGORIES, true)) {
        throw new ApiException('bad_request', 'category 不正', 400);
    }
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $text = isset($body['body']) ? mb_substr((string)$body['body'], 0, 4000) : null;
    if ($text === '') $text = null;
    $url = isset($body['url']) ? trim((string)$body['url']) : '';
    if ($url !== '' && !preg_match('#^https?://#i', $url)) {
        throw new ApiException('bad_request', 'url は http(s)', 400);
    }
    if ($url === '') $url = null;
    $pinned = !empty($body['pinned']) ? 1 : 0;
    $ins = $pdo->prepare("INSERT INTO notices (category, title, body, url, posted_by_user_id, pinned, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([$cat, $title, $text, $url, (int)$u['id'], $pinned]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function notices_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT posted_by_user_id FROM notices WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '連絡が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['posted_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者または admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $params = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) throw new ApiException('bad_request', 'title 1..200', 400);
        $sets[] = 'title = ?'; $params[] = $t;
    }
    if (array_key_exists('body', $body)) {
        $tx = isset($body['body']) ? mb_substr((string)$body['body'], 0, 4000) : null;
        if ($tx === '') $tx = null;
        $sets[] = 'body = ?'; $params[] = $tx;
    }
    if (array_key_exists('url', $body)) {
        $url = isset($body['url']) ? trim((string)$body['url']) : '';
        if ($url !== '' && !preg_match('#^https?://#i', $url)) {
            throw new ApiException('bad_request', 'url は http(s)', 400);
        }
        if ($url === '') $url = null;
        $sets[] = 'url = ?'; $params[] = $url;
    }
    if (array_key_exists('pinned', $body)) {
        $sets[] = 'pinned = ?'; $params[] = !empty($body['pinned']) ? 1 : 0;
    }
    if (array_key_exists('category', $body)) {
        $cat = (string)$body['category'];
        if (!in_array($cat, NOTICE_CATEGORIES, true)) {
            throw new ApiException('bad_request', 'category 不正', 400);
        }
        $sets[] = 'category = ?'; $params[] = $cat;
    }
    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $sets[] = 'updated_at = NOW()';
    $params[] = $id;
    $pdo->prepare("UPDATE notices SET " . implode(', ', $sets) . " WHERE id = ?")
        ->execute($params);
    json_response(['ok' => true]);
}

function notices_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT posted_by_user_id FROM notices WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '連絡が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['posted_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '投稿者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM notices WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
