<?php
// /api/cg2 — 自作 ゲーム v2 framework (#cg2)。
// p5.js で 描画、 sharedValues を 自動 同期 する 准 リアルタイム multiplayer。
// 詳細 設計 → docs/CUSTOM_GAMES_V2.md

declare(strict_types=1);

const CG2_MAX_JS_BYTES = 200_000;
const CG2_RAKE_PCT = 10;   // 場代 の 10% を SYSTEM、 残り 90% を 提供者 へ

function route_cg2(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    // /api/cg2/kinds
    if ($sub === 'kinds') {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')  { cg2_kinds_list($pdo, $cfg); return; }
        if ($next === '' && $method === 'POST') { cg2_kinds_create($pdo, $cfg); return; }
        if ($next !== '' && ($seg[3] ?? '') === 'script.js' && $method === 'GET') {
            cg2_kinds_script($pdo, $cfg, $next); return;
        }
        if ($next !== '' && ($seg[3] ?? '') === '' && $method === 'PATCH') {
            cg2_kinds_update($pdo, $cfg, $next); return;
        }
        if ($next !== '' && ($seg[3] ?? '') === '' && $method === 'DELETE') {
            cg2_kinds_delete($pdo, $cfg, $next); return;
        }
        if ($next !== '' && ($seg[3] ?? '') === 'games') {
            $gAction = $seg[4] ?? '';
            if ($gAction === '' && $method === 'GET')  { cg2_games_list($pdo, $cfg, $next); return; }
            if ($gAction === '' && $method === 'POST') { cg2_games_create($pdo, $cfg, $next); return; }
        }
    }
    // /api/cg2/games/{id}/...
    if ($sub === 'games' && ctype_digit((string)($seg[2] ?? ''))) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')          { cg2_games_detail($pdo, $cfg, $gid); return; }
        if ($action === 'join' && $method === 'POST')     { cg2_games_join($pdo, $cfg, $gid);   return; }
        if ($action === 'add-ai' && $method === 'POST')   { cg2_games_add_ai($pdo, $cfg, $gid); return; }
        if ($action === 'start' && $method === 'POST')    { cg2_games_start($pdo, $cfg, $gid);  return; }
        if ($action === 'cancel' && $method === 'POST')   { cg2_games_cancel($pdo, $cfg, $gid); return; }
        if ($action === 'shared' && $method === 'GET')    { cg2_shared_get($pdo, $cfg, $gid);   return; }
        if ($action === 'shared' && $method === 'POST')   { cg2_shared_post($pdo, $cfg, $gid);  return; }
        if ($action === 'finalize' && $method === 'POST') { cg2_games_finalize($pdo, $cfg, $gid); return; }
    }
    json_error('not_found', "no cg2 route for $method $sub", 404);
}

// ─── KINDS ───────────────────────────────────────────────
function cg2_kinds_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT k.id, k.slug, k.name, k.icon, k.description, k.min_players, k.max_players, k.fee, k.provider_user_id,
                              u.display_name AS provider_name, k.enabled, k.updated_at, LENGTH(k.js_body) AS js_size
                         FROM cg2_kinds k LEFT JOIN users u ON u.id = k.provider_user_id
                        WHERE k.enabled = 1
                        ORDER BY k.id ASC");
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function cg2_kinds_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    [$slug, $name, $icon, $desc, $minP, $maxP, $fee, $js] = cg2_validate_kind($body);
    $st = $pdo->prepare("INSERT INTO cg2_kinds (slug, name, icon, description, min_players, max_players, fee, provider_user_id, js_body)
                         VALUES (?,?,?,?,?,?,?,?,?)");
    try {
        $st->execute([$slug, $name, $icon, $desc, $minP, $maxP, $fee, (int)$u['id'], $js]);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) throw new ApiException('bad_request', 'slug が 既に 使われて います', 400);
        throw $e;
    }
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function cg2_kinds_update(PDO $pdo, array $cfg, string $slug): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, provider_user_id FROM cg2_kinds WHERE slug = ?");
    $st->execute([$slug]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['provider_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '提供者 または admin のみ', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body))        { $sets[] = 'name = ?';        $args[] = mb_substr(trim((string)$body['name']), 0, 80); }
    if (array_key_exists('icon', $body))        { $sets[] = 'icon = ?';        $args[] = mb_substr(trim((string)$body['icon']), 0, 8); }
    if (array_key_exists('description', $body)) { $sets[] = 'description = ?'; $args[] = mb_substr((string)$body['description'], 0, 500); }
    if (array_key_exists('min_players', $body)) { $sets[] = 'min_players = ?'; $args[] = max(1, (int)$body['min_players']); }
    if (array_key_exists('max_players', $body)) { $sets[] = 'max_players = ?'; $args[] = max(1, (int)$body['max_players']); }
    if (array_key_exists('fee', $body))         { $sets[] = 'fee = ?';         $args[] = max(0, (int)$body['fee']); }
    if (array_key_exists('js_body', $body))     {
        $js = (string)$body['js_body'];
        if (strlen($js) > CG2_MAX_JS_BYTES) throw new ApiException('bad_request', 'JS が 大きすぎ ます', 400);
        $sets[] = 'js_body = ?'; $args[] = $js;
    }
    if (array_key_exists('enabled', $body))     { $sets[] = 'enabled = ?';     $args[] = ((int)$body['enabled']) ? 1 : 0; }
    if (!$sets) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = (int)$row['id'];
    $pdo->prepare("UPDATE cg2_kinds SET " . implode(',', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function cg2_kinds_delete(PDO $pdo, array $cfg, string $slug): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, provider_user_id FROM cg2_kinds WHERE slug = ?");
    $st->execute([$slug]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['provider_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '提供者 または admin のみ', 403);
    }
    $pdo->prepare("DELETE FROM cg2_kinds WHERE id = ?")->execute([(int)$row['id']]);
    json_response(['ok' => true]);
}

function cg2_kinds_script(PDO $pdo, array $cfg, string $slug): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT js_body FROM cg2_kinds WHERE slug = ? AND enabled = 1");
    $st->execute([$slug]);
    $js = $st->fetchColumn();
    if ($js === false) {
        http_response_code(404);
        header('Content-Type: application/javascript; charset=utf-8');
        echo "// kind not found\n";
        return;
    }
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-cache, must-revalidate');
    echo (string)$js;
}

// ─── GAMES ───────────────────────────────────────────────
function cg2_games_list(PDO $pdo, array $cfg, string $slug): void {
    $u = Auth::requireUser($pdo, $cfg);
    $k = cg2_kind_by_slug($pdo, $slug);
    $st = $pdo->prepare("SELECT g.id, g.host_user_id, g.status, g.players_json, g.created_at, g.started_at, g.finished_at, g.result_text,
                                uh.display_name AS host_name
                           FROM cg2_games g JOIN users uh ON uh.id = g.host_user_id
                          WHERE g.kind_id = ?
                          ORDER BY (g.status='playing') DESC, (g.status='waiting') DESC, g.id DESC LIMIT 100");
    $st->execute([(int)$k['id']]);
    json_response(['kind' => $k, 'items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function cg2_games_create(PDO $pdo, array $cfg, string $slug): void {
    $u = Auth::requireUser($pdo, $cfg);
    $k = cg2_kind_by_slug($pdo, $slug);
    $uid = (int)$u['id'];
    $players = [['uid' => $uid, 'name' => $u['display_name'], 'is_ai' => false]];
    $gid = 0;
    db_tx($pdo, function () use ($pdo, $k, $uid, $players, &$gid) {
        $pdo->prepare("INSERT INTO cg2_games (kind_id, host_user_id, status, players_json) VALUES (?,?,?,?)")
            ->execute([(int)$k['id'], $uid, 'waiting', json_encode($players, JSON_UNESCAPED_UNICODE)]);
        $gid = (int)$pdo->lastInsertId();
    });
    json_response(['id' => $gid]);
}

function cg2_games_detail(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $g = cg2_game_by_id($pdo, $gid);
    $k = cg2_kind_by_id($pdo, (int)$g['kind_id']);
    json_response([
        'game' => $g,
        'kind' => $k,
        'is_host' => (int)$g['host_user_id'] === (int)$u['id'],
    ]);
}

function cg2_games_join(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    db_tx($pdo, function () use ($pdo, $gid, $u, $uid) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '募集中 では ありません', 400);
        $k = cg2_kind_by_id($pdo, (int)$g['kind_id']);
        $players = json_decode($g['players_json'], true) ?: [];
        foreach ($players as $p) if ((int)$p['uid'] === $uid) throw new ApiException('bad_request', '既に 参加 済み', 400);
        if (count($players) >= (int)$k['max_players']) throw new ApiException('bad_request', '満員', 400);
        $players[] = ['uid' => $uid, 'name' => $u['display_name'], 'is_ai' => false];
        $pdo->prepare("UPDATE cg2_games SET players_json = ? WHERE id = ?")
            ->execute([json_encode($players, JSON_UNESCAPED_UNICODE), $gid]);
    });
    json_response(['ok' => true]);
}

function cg2_games_add_ai(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    db_tx($pdo, function () use ($pdo, $gid, $u) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['host_user_id'] !== (int)$u['id']) throw new ApiException('forbidden', '起案者 のみ', 403);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '募集中 では ありません', 400);
        $k = cg2_kind_by_id($pdo, (int)$g['kind_id']);
        $players = json_decode($g['players_json'], true) ?: [];
        // mixed 不可: 人間 が 2 人 以上 いる 場合 AI 追加 NG
        $humanCount = 0;
        foreach ($players as $p) if (empty($p['is_ai'])) $humanCount++;
        if ($humanCount >= 2) throw new ApiException('bad_request', '人間 が 2 人 以上 いる 卓 に AI は 入れられません', 400);
        if (count($players) >= (int)$k['max_players']) throw new ApiException('bad_request', '満員', 400);
        // bot user を 1 体 拾う
        $stB = $pdo->query("SELECT id, display_name FROM users WHERE kind='bot' AND email LIKE 'ai-%@labpay.local' ORDER BY id LIMIT 10");
        $bots = $stB->fetchAll(PDO::FETCH_ASSOC);
        $usedBots = array_map(fn($p) => (int)$p['uid'], $players);
        $pickBot = null;
        foreach ($bots as $b) {
            if (!in_array((int)$b['id'], $usedBots, true)) { $pickBot = $b; break; }
        }
        if (!$pickBot) throw new ApiException('bad_request', 'AI user の 空き が ありません', 400);
        $players[] = ['uid' => (int)$pickBot['id'], 'name' => $pickBot['display_name'], 'is_ai' => true];
        $pdo->prepare("UPDATE cg2_games SET players_json = ? WHERE id = ?")
            ->execute([json_encode($players, JSON_UNESCAPED_UNICODE), $gid]);
    });
    json_response(['ok' => true]);
}

function cg2_games_start(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    db_tx($pdo, function () use ($pdo, $cfg, $gid, $u) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['host_user_id'] !== (int)$u['id']) throw new ApiException('forbidden', '起案者 のみ', 403);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '募集中 では ありません', 400);
        $k = cg2_kind_by_id($pdo, (int)$g['kind_id']);
        $players = json_decode($g['players_json'], true) ?: [];
        if (count($players) < (int)$k['min_players']) {
            throw new ApiException('bad_request', sprintf('最低 %d 人 で 開始', (int)$k['min_players']), 400);
        }
        // 場代 徴収 (人間 のみ 全員 から)
        $fee = (int)$k['fee'];
        if ($fee > 0) {
            foreach ($players as $p) {
                if (!empty($p['is_ai'])) continue;
                if (Ledger::balanceOfUser($pdo, (int)$p['uid']) < $fee) {
                    throw new ApiException('insufficient_balance', "user#{$p['uid']} の ポイント不足 で 開始 不可", 400);
                }
            }
            foreach ($players as $p) {
                if (!empty($p['is_ai'])) continue;
                Ledger::transfer($pdo, (int)$p['uid'], 1, $fee, 'cg2_fee', 'cg2', $gid, "cg2 {$k['slug']} #{$gid} 場代");
            }
        }
        $pdo->prepare("UPDATE cg2_games SET status='playing', started_at=NOW() WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function cg2_games_cancel(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    db_tx($pdo, function () use ($pdo, $gid, $u) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['host_user_id'] !== (int)$u['id']) throw new ApiException('forbidden', '起案者 のみ', 403);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '募集中 のみ キャンセル 可', 400);
        $pdo->prepare("UPDATE cg2_games SET status='cancelled', finished_at=NOW() WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

// ─── SHARED VALUES ───────────────────────────────────────
function cg2_shared_get(PDO $pdo, array $cfg, int $gid): void {
    Auth::requireUser($pdo, $cfg);
    $since = (int)($_GET['since'] ?? 0);
    $st = $pdo->prepare("SELECT shared_values_json, shared_seq, status FROM cg2_games WHERE id = ?");
    $st->execute([$gid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['shared_seq'] <= $since) {
        http_response_code(304);
        return;
    }
    json_response([
        'seq'    => (int)$row['shared_seq'],
        'values' => json_decode($row['shared_values_json'] ?: '{}', true) ?: new stdClass(),
        'status' => $row['status'],
    ]);
}

function cg2_shared_post(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $changes = $body['changes'] ?? null;
    if (!is_array($changes) && !is_object($changes)) {
        // 全文 投稿 (host.start で 初期化 時) も 許可
        $changes = $body['values'] ?? null;
    }
    if ($changes === null) throw new ApiException('bad_request', 'changes / values が 必要', 400);

    db_tx($pdo, function () use ($pdo, $gid, $u, $body, $changes) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        // 参加者 のみ 書ける
        $players = json_decode($g['players_json'], true) ?: [];
        $isParticipant = false;
        foreach ($players as $p) if ((int)$p['uid'] === (int)$u['id']) $isParticipant = true;
        if (!$isParticipant) throw new ApiException('forbidden', '参加者 のみ', 403);
        if ($g['status'] !== 'playing' && $g['status'] !== 'waiting') {
            throw new ApiException('bad_request', 'playing/waiting のみ 更新 可', 400);
        }
        $values = json_decode($g['shared_values_json'] ?: '{}', true) ?: [];
        if (!empty($body['replace'])) {
            $values = is_array($changes) ? $changes : [];
        } else {
            foreach ((array)$changes as $k => $v) $values[$k] = $v;
        }
        $newSeq = (int)$g['shared_seq'] + 1;
        $pdo->prepare("UPDATE cg2_games SET shared_values_json = ?, shared_seq = ? WHERE id = ?")
            ->execute([json_encode($values, JSON_UNESCAPED_UNICODE), $newSeq, $gid]);
    });
    // 帰り 値 として 新 seq + 全 values を 返す (= 自分 で merge 不要)
    $st = $pdo->prepare("SELECT shared_seq, shared_values_json FROM cg2_games WHERE id = ?");
    $st->execute([$gid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    json_response([
        'seq' => (int)$r['shared_seq'],
        'values' => json_decode($r['shared_values_json'] ?: '{}', true) ?: new stdClass(),
    ]);
}

// ─── FINALIZE (= notifyResult が 呼ばれた と host が 報告) ────────
function cg2_games_finalize(PDO $pdo, array $cfg, int $gid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    $opts = is_array($body['opts'] ?? null) ? $body['opts'] : [];
    if ($text === '') $text = '(結果 なし)';
    db_tx($pdo, function () use ($pdo, $cfg, $gid, $u, $text, $opts) {
        $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['host_user_id'] !== (int)$u['id']) throw new ApiException('forbidden', 'host のみ', 403);
        if ($g['status'] !== 'playing') {
            json_response(['ok' => true, 'already' => true]);
            return;
        }
        $k = cg2_kind_by_id($pdo, (int)$g['kind_id']);
        // 場代 を 提供者 90% / SYSTEM 10% に 分配 (provider 未設定 なら 全額 SYSTEM)
        $players = json_decode($g['players_json'], true) ?: [];
        $humanCount = 0;
        foreach ($players as $p) if (empty($p['is_ai'])) $humanCount++;
        $totalFee = (int)$k['fee'] * $humanCount;
        if ($totalFee > 0) {
            $rake = (int)floor($totalFee * CG2_RAKE_PCT / 100);
            $providerCut = $totalFee - $rake;
            // SYSTEM (1) には 既に 全額 入って いる (cg2_games_start で transfer)
            // → provider が いれば SYSTEM → provider に share を 払い直す
            if (!empty($k['provider_user_id']) && $providerCut > 0) {
                Ledger::transfer($pdo, 1, (int)$k['provider_user_id'], $providerCut, 'cg2_provider_share', 'cg2', $gid, "cg2 {$k['slug']} #{$gid} 場代 提供者 取り分");
            }
        }
        $pdo->prepare("UPDATE cg2_games SET status='finished', result_text=?, result_json=?, finished_at=NOW() WHERE id = ?")
            ->execute([mb_substr($text, 0, 500), json_encode($opts, JSON_UNESCAPED_UNICODE), $gid]);
        // 参加者 に 通知
        foreach ($players as $p) {
            if (!empty($p['is_ai'])) continue;
            try {
                Notifier::notify($pdo, $cfg, (int)$p['uid'], 'admin_notice',
                    "🎮 {$k['icon']} {$k['name']} #{$gid} 終了: " . mb_substr($text, 0, 100),
                    'cg2', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

// ─── helpers ─────────────────────────────────────────────
function cg2_kind_by_slug(PDO $pdo, string $slug): array {
    $st = $pdo->prepare("SELECT * FROM cg2_kinds WHERE slug = ?");
    $st->execute([$slug]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'kind が ありません: ' . $slug, 404);
    return $r;
}
function cg2_kind_by_id(PDO $pdo, int $id): array {
    $st = $pdo->prepare("SELECT * FROM cg2_kinds WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'kind が ありません', 404);
    return $r;
}
function cg2_game_by_id(PDO $pdo, int $id): array {
    $st = $pdo->prepare("SELECT * FROM cg2_games WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'game が ありません', 404);
    return $r;
}
function cg2_validate_kind(array $body): array {
    $slug = trim((string)($body['slug'] ?? ''));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{0,39}$/', $slug)) throw new ApiException('bad_request', 'slug は 英小文字 / 数字 / - のみ (1-40)', 400);
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 80) throw new ApiException('bad_request', 'name 1..80', 400);
    $icon = mb_substr(trim((string)($body['icon'] ?? '🎮')), 0, 8);
    if ($icon === '') $icon = '🎮';
    $desc = isset($body['description']) ? mb_substr((string)$body['description'], 0, 500) : null;
    $minP = max(1, (int)($body['min_players'] ?? 2));
    $maxP = max($minP, (int)($body['max_players'] ?? 2));
    $fee  = max(0, (int)($body['fee'] ?? 0));
    $js = (string)($body['js_body'] ?? '');
    if ($js === '') throw new ApiException('bad_request', 'js_body 必須', 400);
    if (strlen($js) > CG2_MAX_JS_BYTES) throw new ApiException('bad_request', 'JS が 大きすぎ ます', 400);
    return [$slug, $name, $icon, $desc, $minP, $maxP, $fee, $js];
}
