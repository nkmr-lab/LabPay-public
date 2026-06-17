<?php
// /api/custom-widgets — 自作 ウィジェット (#246)。
// ユーザ が JS を 書いて 登録 → ホーム に 表示 する 簡易 widget。
// 自分専用 (= owner) のみ。 共有 や stream は フェーズ 2 以降。

declare(strict_types=1);

const CW_MAX_JS_BYTES = 100_000;   // 1 ウィジェット 最大 100KB

function route_custom_widgets(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { cw_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { cw_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { cw_detail($pdo, $cfg, $id);  return; }
        if ($next === '' && $method === 'PATCH')  { cw_update($pdo, $cfg, $id);  return; }
        if ($next === '' && $method === 'DELETE') { cw_delete($pdo, $cfg, $id);  return; }
        if ($next === 'script.js' && $method === 'GET') { cw_serve_js($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no custom-widgets route for $method $sub", 404);
}

function cw_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, name, icon, description, enabled, sort_order, created_at, updated_at,
                                LENGTH(js_body) AS js_size
                           FROM custom_widgets WHERE owner_user_id = ?
                          ORDER BY sort_order ASC, id ASC");
    $st->execute([(int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function cw_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM custom_widgets WHERE id = ? AND owner_user_id = ?");
    $st->execute([$id, (int)$u['id']]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '見つかりません', 404);
    json_response($r);
}

function cw_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    [$name, $icon, $desc, $js] = cw_validate($body);
    $st = $pdo->prepare("INSERT INTO custom_widgets (owner_user_id, name, icon, description, js_body, enabled, sort_order)
                         VALUES (?,?,?,?,?,1,?)");
    $maxOrder = (int)($pdo->query("SELECT COALESCE(MAX(sort_order), 0) FROM custom_widgets WHERE owner_user_id = " . (int)$u['id'])->fetchColumn() ?: 0);
    $st->execute([(int)$u['id'], $name, $icon, $desc, $js, $maxOrder + 1]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function cw_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id FROM custom_widgets WHERE id = ? AND owner_user_id = ?");
    $st->execute([$id, (int)$u['id']]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', '見つかりません', 404);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body))        { $sets[] = 'name = ?';        $args[] = mb_substr(trim((string)$body['name']), 0, 80); }
    if (array_key_exists('icon', $body))        { $sets[] = 'icon = ?';        $args[] = mb_substr(trim((string)$body['icon']), 0, 8); }
    if (array_key_exists('description', $body)) { $sets[] = 'description = ?'; $args[] = mb_substr((string)$body['description'], 0, 500); }
    if (array_key_exists('js_body', $body))     {
        $js = (string)$body['js_body'];
        if (strlen($js) > CW_MAX_JS_BYTES) throw new ApiException('bad_request', 'JS が 大きすぎ ます', 400);
        $sets[] = 'js_body = ?'; $args[] = $js;
    }
    if (array_key_exists('enabled', $body))     { $sets[] = 'enabled = ?';     $args[] = ((int)$body['enabled']) ? 1 : 0; }
    if (array_key_exists('sort_order', $body))  { $sets[] = 'sort_order = ?';  $args[] = (int)$body['sort_order']; }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE custom_widgets SET " . implode(',', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function cw_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM custom_widgets WHERE id = ? AND owner_user_id = ?")->execute([$id, (int)$u['id']]);
    json_response(['ok' => true]);
}

function cw_serve_js(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT js_body FROM custom_widgets WHERE id = ? AND owner_user_id = ? AND enabled = 1");
    $st->execute([$id, (int)$u['id']]);
    $js = $st->fetchColumn();
    if ($js === false) {
        http_response_code(404);
        header('Content-Type: application/javascript; charset=utf-8');
        echo "// not found\n";
        return;
    }
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-cache, must-revalidate');
    echo (string)$js;
}

function cw_validate(array $body): array {
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 80) throw new ApiException('bad_request', 'name 1..80', 400);
    $icon = trim((string)($body['icon'] ?? '🧩'));
    if (mb_strlen($icon) > 8) throw new ApiException('bad_request', 'icon は 8 文字 まで', 400);
    if ($icon === '') $icon = '🧩';
    $desc = isset($body['description']) ? mb_substr((string)$body['description'], 0, 500) : null;
    $js = (string)($body['js_body'] ?? '');
    if ($js === '') throw new ApiException('bad_request', 'js_body 必須', 400);
    if (strlen($js) > CW_MAX_JS_BYTES) throw new ApiException('bad_request', 'JS が 大きすぎ ます', 400);
    return [$name, $icon, $desc, $js];
}
