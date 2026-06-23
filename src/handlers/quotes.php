<?php
// v804 ラボ メン が 名言 を 登録 する 機能。
// 静的 配列 (quotes_daily.js) と 合算 して ホーム ウィジェット で 日 単位 で 1 件 表示。
declare(strict_types=1);

function route_quotes(PDO $pdo, array $cfg, string $method, array $seg): void {
    if ($method === 'GET'    && !isset($seg[1])) { quotes_list($pdo, $cfg);   return; }
    if ($method === 'POST'   && !isset($seg[1])) { quotes_create($pdo, $cfg); return; }
    if ($method === 'DELETE' && isset($seg[1]) && ctype_digit((string)$seg[1])) {
        quotes_delete($pdo, $cfg, (int)$seg[1]); return;
    }
    json_error('not_found', "no quotes route for $method", 404);
}

function quotes_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT q.id, q.user_id, q.quote_text, q.author, q.source, q.created_at,
                              u.display_name AS submitter_name
                         FROM quotes q LEFT JOIN users u ON u.id = q.user_id
                        WHERE q.deleted_at IS NULL
                     ORDER BY q.id DESC LIMIT 500");
    $items = array_map(fn($r) => [
        'id'             => (int)$r['id'],
        'user_id'        => (int)$r['user_id'],
        'submitter_name' => $r['submitter_name'],
        'quote'          => $r['quote_text'],
        'author'         => $r['author'],
        'source'         => $r['source'],
        'created_at'     => $r['created_at'],
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function quotes_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $text   = trim((string)($body['quote']  ?? ''));
    $author = trim((string)($body['author'] ?? ''));
    $source = trim((string)($body['source'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'quote が 必要', 400);
    if (mb_strlen($text)   > 500) throw new ApiException('bad_request', '名言 は 500 字 まで', 400);
    if (mb_strlen($author) > 100) throw new ApiException('bad_request', 'author は 100 字 まで', 400);
    if (mb_strlen($source) > 200) throw new ApiException('bad_request', 'source は 200 字 まで', 400);
    $pdo->prepare("INSERT INTO quotes (user_id, quote_text, author, source) VALUES (?,?,?,?)")
        ->execute([$uid, $text, $author, $source]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function quotes_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id FROM quotes WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', '名言 が ありません', 404);
    if ($cuid !== $uid && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '投稿者 / admin のみ 削除 可', 403);
    }
    $pdo->prepare("UPDATE quotes SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
