<?php
// v618-v619 #236 自作ゲーム フレームワーク。 PHP ソース改変なし、 DB 管理。
//   ゲーム kind は custom_game_kinds テーブルに 登録。 管理画面 から 追加可能 (admin 推奨)。
//   ゲームロジック は すべて JS (js_module_url で 指定)。 サーバは state_json を 不透明な
//   コンテナとして 保存するだけ。
//
//   セキュリティ モデル: 1pt 程度の低額対戦を想定。
//   - 手番ユーザだけが /move を呼べる (turn_user_id 一致チェック)
//   - クライアントが 計算した new_state / finished / winner_user_id を 信頼して 保存
//   - 「対戦相手の クライアントも 同じ JS ロジックで 再計算」 することで 健全性を保つ
//
//   API:
//     GET  /api/custom-games/list                       有効な kind 一覧
//     POST /api/custom-games/kinds                      新規 kind 登録 (admin)
//     PATCH /api/custom-games/kinds/:kind               kind 編集 (admin)
//     DELETE /api/custom-games/kinds/:kind              kind 無効化 (admin、 既存卓は残る)
//     GET  /api/custom-games/:kind/games                対戦卓 一覧 (recent 30)
//     POST /api/custom-games/:kind/games                起案 (1pt buy-in)
//     GET  /api/custom-games/:kind/games/:id            詳細
//     POST /api/custom-games/:kind/games/:id/join       参加 (1pt)
//     POST /api/custom-games/:kind/games/:id/move       手を打つ
//     POST /api/custom-games/:kind/games/:id/cancel     ロビーで キャンセル

declare(strict_types=1);

function cg_kind_meta(PDO $pdo, string $kind): array {
    $st = $pdo->prepare("SELECT kind, display_name, description, icon, fee, provider_share_pct,
                                js_module_url, is_active, created_by_user_id
                           FROM custom_game_kinds WHERE kind=?");
    $st->execute([$kind]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', "未知のゲーム種別: $kind", 404);
    if (!(int)$row['is_active']) throw new ApiException('not_found', "無効化された ゲーム種別: $kind", 404);
    $row['fee'] = (int)$row['fee'];
    $row['provider_share_pct'] = (int)$row['provider_share_pct'];
    $row['created_by_user_id'] = $row['created_by_user_id'] !== null ? (int)$row['created_by_user_id'] : null;
    return $row;
}

function route_custom_games(PDO $pdo, array $cfg, string $method, array $seg): void {
    // v620 GET /api/custom-games/kinds/:kind/script.js は 認証不要 (ES module の
    //   dynamic import が cookies を 自動付与しないため)。 game logic に 機密情報なし。
    if (($seg[1] ?? '') === 'kinds' && isset($seg[2]) && ($seg[3] ?? '') === 'script.js' && $method === 'GET') {
        cg_kinds_serve_js($pdo, (string)$seg[2]);
        return;
    }

    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = ($u['role'] ?? '') === 'admin';

    // GET /api/custom-games/list : 有効な kind 一覧
    if (($seg[1] ?? '') === 'list' && $method === 'GET') {
        $st = $pdo->query("SELECT k.kind, k.display_name, k.description, k.icon, k.fee,
                                  k.provider_share_pct, k.js_module_url,
                                  (k.js_source IS NOT NULL) AS has_js_source,
                                  k.created_by_user_id, u.display_name AS created_by_name
                             FROM custom_game_kinds k LEFT JOIN users u ON u.id=k.created_by_user_id
                            WHERE k.is_active=1 ORDER BY k.display_name");
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['fee'] = (int)$r['fee'];
            $r['provider_share_pct'] = (int)$r['provider_share_pct'];
            $r['has_js_source'] = (bool)$r['has_js_source'];
            $r['created_by_user_id'] = $r['created_by_user_id'] !== null ? (int)$r['created_by_user_id'] : null;
        }
        json_response(['items' => $rows]);
        return;
    }

    // v619/v620 kind CRUD。 v620 から ユーザ単位の所有 + 任意ユーザが 新規登録可能。
    //   - GET (一覧): 認証ユーザは全件閲覧可
    //   - POST (新規): 認証ユーザ なら誰でも (created_by_user_id に自分)
    //   - PATCH/DELETE: owner or admin
    if (($seg[1] ?? '') === 'kinds') {
        if (!isset($seg[2])) {
            if ($method === 'GET')  { cg_kinds_list_all($pdo); return; }
            if ($method === 'POST') { cg_kinds_create($pdo, $uid); return; }
        }
        $kind = (string)$seg[2];
        if ($method === 'PATCH')  { cg_kinds_update($pdo, $uid, $isAdmin, $kind); return; }
        if ($method === 'DELETE') { cg_kinds_deactivate($pdo, $uid, $isAdmin, $kind); return; }
    }

    if (!isset($seg[1]) || !isset($seg[2])) throw new ApiException('not_found', 'no route', 404);
    $kind = (string)$seg[1];
    if ($seg[2] !== 'games') throw new ApiException('not_found', 'no route', 404);
    $meta = cg_kind_meta($pdo, $kind);

    if (!isset($seg[3])) {
        if ($method === 'GET')  { cg_list($pdo, $uid, $kind); return; }
        if ($method === 'POST') { cg_create($pdo, $uid, $kind, $meta); return; }
    }
    $gid = (int)$seg[3];
    $action = $seg[4] ?? '';
    if ($action === '' && $method === 'GET')         { cg_detail($pdo, $uid, $gid); return; }
    if ($action === 'join'   && $method === 'POST')  { cg_join($pdo, $uid, $gid, $meta); return; }
    if ($action === 'move'   && $method === 'POST')  { cg_move($pdo, $uid, $gid, $meta); return; }
    if ($action === 'cancel' && $method === 'POST')  { cg_cancel($pdo, $uid, $gid); return; }
    json_error('not_found', "no custom-games route", 404);
}

// ── kind CRUD (admin only) ──────────────────────────────────────
function cg_kinds_list_all(PDO $pdo): void {
    $st = $pdo->query("SELECT k.*, u.display_name AS created_by_name
                         FROM custom_game_kinds k LEFT JOIN users u ON u.id = k.created_by_user_id
                        ORDER BY k.is_active DESC, k.kind");
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['fee'] = (int)$r['fee'];
        $r['is_active'] = (bool)$r['is_active'];
        $r['created_by_user_id'] = $r['created_by_user_id'] !== null ? (int)$r['created_by_user_id'] : null;
    }
    json_response(['items' => $rows]);
}

const CG_MAX_JS_BYTES = 500 * 1024; // 500 KB

function cg_kinds_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $kind = trim((string)require_field($body, 'kind'));
    if (!preg_match('/^[a-z][a-z0-9_-]{1,38}[a-z0-9]$/', $kind)) {
        throw new ApiException('bad_request', 'kind は 3-40 文字、 lowercase + 数字 + _ + -', 400);
    }
    $name = trim((string)require_field($body, 'display_name'));
    if (mb_strlen($name) > 80) throw new ApiException('bad_request', 'display_name は 80 文字以内', 400);
    $desc = trim((string)require_field($body, 'description'));
    if (mb_strlen($desc) > 500) throw new ApiException('bad_request', 'description は 500 文字以内', 400);
    $icon = trim((string)require_field($body, 'icon'));
    if (mb_strlen($icon) > 20) throw new ApiException('bad_request', 'icon は 20 文字以内', 400);
    $fee = (int)($body['fee'] ?? 1);
    if ($fee < 0 || $fee > 100) throw new ApiException('bad_request', 'fee は 0-100', 400);
    $share = (int)($body['provider_share_pct'] ?? 0);
    if ($share < 0 || $share > 50) throw new ApiException('bad_request', 'provider_share_pct は 0-50 (%)', 400);
    $jsUrl = trim((string)($body['js_module_url'] ?? "/api/custom-games/kinds/{$kind}/script.js"));
    if (mb_strlen($jsUrl) > 200) throw new ApiException('bad_request', 'js_module_url は 200 文字以内', 400);
    // v620 JS source は inline 文字列で 受け取る (PATCH でも更新可)
    $jsSource = isset($body['js_source']) ? (string)$body['js_source'] : null;
    if ($jsSource !== null && strlen($jsSource) > CG_MAX_JS_BYTES) {
        throw new ApiException('bad_request', sprintf('js_source は %d KB まで', CG_MAX_JS_BYTES / 1024), 400);
    }
    $jsSize = $jsSource !== null ? strlen($jsSource) : null;
    try {
        $pdo->prepare("INSERT INTO custom_game_kinds (kind, display_name, description, icon, fee, provider_share_pct, js_module_url, js_source, js_size, created_by_user_id, is_active)
                       VALUES (?,?,?,?,?,?,?,?,?,?,1)")
            ->execute([$kind, $name, $desc, $icon, $fee, $share, $jsUrl, $jsSource, $jsSize, $uid]);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) {
            throw new ApiException('conflict', "kind '$kind' は 既に存在", 409);
        }
        throw $e;
    }
    json_response(['ok' => true, 'kind' => $kind]);
}

function cg_kinds_assert_owner_or_admin(PDO $pdo, int $uid, bool $isAdmin, string $kind): void {
    if ($isAdmin) return;
    $st = $pdo->prepare("SELECT created_by_user_id FROM custom_game_kinds WHERE kind=?");
    $st->execute([$kind]);
    $owner = $st->fetchColumn();
    if ($owner === false) throw new ApiException('not_found', 'kind not found', 404);
    if ((int)$owner !== $uid) throw new ApiException('forbidden', '自分が登録した kind のみ 編集可', 403);
}

function cg_kinds_update(PDO $pdo, int $uid, bool $isAdmin, string $kind): void {
    cg_kinds_assert_owner_or_admin($pdo, $uid, $isAdmin, $kind);
    $body = read_json_body();
    $sets = []; $args = [];
    foreach (['display_name', 'description', 'icon', 'js_module_url'] as $col) {
        if (array_key_exists($col, $body)) {
            $sets[] = "$col = ?";
            $args[] = trim((string)$body[$col]);
        }
    }
    if (array_key_exists('fee', $body)) {
        $fee = (int)$body['fee'];
        if ($fee < 0 || $fee > 100) throw new ApiException('bad_request', 'fee は 0-100', 400);
        $sets[] = 'fee = ?'; $args[] = $fee;
    }
    if (array_key_exists('provider_share_pct', $body)) {
        $share = (int)$body['provider_share_pct'];
        if ($share < 0 || $share > 50) throw new ApiException('bad_request', 'provider_share_pct は 0-50', 400);
        $sets[] = 'provider_share_pct = ?'; $args[] = $share;
    }
    if (array_key_exists('is_active', $body)) {
        $sets[] = 'is_active = ?'; $args[] = $body['is_active'] ? 1 : 0;
    }
    if (array_key_exists('js_source', $body)) {
        $jsSource = $body['js_source'];
        if ($jsSource === null) {
            $sets[] = 'js_source = NULL'; $sets[] = 'js_size = NULL';
        } else {
            $jsSource = (string)$jsSource;
            if (strlen($jsSource) > CG_MAX_JS_BYTES) {
                throw new ApiException('bad_request', sprintf('js_source は %d KB まで', CG_MAX_JS_BYTES / 1024), 400);
            }
            $sets[] = 'js_source = ?'; $args[] = $jsSource;
            $sets[] = 'js_size = ?';   $args[] = strlen($jsSource);
        }
    }
    if (!$sets) throw new ApiException('bad_request', '更新する 内容なし', 400);
    $args[] = $kind;
    $pdo->prepare("UPDATE custom_game_kinds SET " . implode(',', $sets) . " WHERE kind=?")->execute($args);
    json_response(['ok' => true]);
}

function cg_kinds_deactivate(PDO $pdo, int $uid, bool $isAdmin, string $kind): void {
    cg_kinds_assert_owner_or_admin($pdo, $uid, $isAdmin, $kind);
    // 既存卓 (custom_games) は そのまま残す。 新規起案は できなくする。
    $pdo->prepare("UPDATE custom_game_kinds SET is_active=0 WHERE kind=?")->execute([$kind]);
    json_response(['ok' => true]);
}

// v620 アップロードされた JS ソースを ES module として 配信。 認証不要 (game logic は 機密でない)。
function cg_kinds_serve_js(PDO $pdo, string $kind): void {
    $st = $pdo->prepare("SELECT js_source FROM custom_game_kinds WHERE kind=?");
    $st->execute([$kind]);
    $src = $st->fetchColumn();
    if ($src === false || $src === null) {
        http_response_code(404);
        header('Content-Type: application/javascript; charset=utf-8');
        echo "// kind '$kind' は js_source 未登録\n";
        return;
    }
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-cache'); // 更新が 即時反映される (重要)
    echo $src;
}

function cg_list(PDO $pdo, int $uid, string $kind): void {
    $st = $pdo->prepare("SELECT g.id, g.game_kind, g.creator_user_id, uc.display_name AS creator_name,
                                g.opponent_user_id, uo.display_name AS opponent_name,
                                g.status, g.fee, g.pot_total, g.winner_user_id,
                                uw.display_name AS winner_name,
                                g.created_at, g.finished_at,
                                (g.creator_user_id=? OR g.opponent_user_id=?) AS me_in
                           FROM custom_games g
                           JOIN users uc ON uc.id=g.creator_user_id
                           LEFT JOIN users uo ON uo.id=g.opponent_user_id
                           LEFT JOIN users uw ON uw.id=g.winner_user_id
                          WHERE g.game_kind=? AND
                            (g.status IN ('waiting','playing')
                             OR (g.status IN ('finished','cancelled') AND g.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY)))
                          ORDER BY g.id DESC LIMIT 30");
    $st->execute([$uid, $uid, $kind]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id']  = (int)$r['creator_user_id'];
        $r['opponent_user_id'] = $r['opponent_user_id'] !== null ? (int)$r['opponent_user_id'] : null;
        $r['winner_user_id']   = $r['winner_user_id']   !== null ? (int)$r['winner_user_id']   : null;
        $r['fee']       = (int)$r['fee'];
        $r['pot_total'] = (int)$r['pot_total'];
        $r['me_in']     = (bool)$r['me_in'];
    }
    json_response(['items' => $rows]);
}

function cg_create(PDO $pdo, int $uid, string $kind, array $meta): void {
    $fee = (int)$meta['fee'];
    // クライアントから 初期 state を 受け取る (JS が computeする)。 無ければ 空 dict。
    $body = read_json_body();
    $initState = $body['initial_state'] ?? null;
    if (!is_array($initState)) $initState = new \stdClass();
    $gid = 0;
    db_tx($pdo, function () use ($pdo, $uid, $kind, $fee, $initState, &$gid) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $fee) throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %dpt)', $fee), 400);
        $pdo->prepare("INSERT INTO custom_games (game_kind, creator_user_id, status, fee, state_json, turn_user_id)
                       VALUES (?,?,'waiting',?,?,?)")
            ->execute([$kind, $uid, $fee, json_encode($initState, JSON_UNESCAPED_UNICODE), $uid]);
        $gid = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $fee, 'custom_game_buyin', 'custom_game', $gid, "{$kind} #{$gid} buy-in (creator)");
        $pdo->prepare("UPDATE custom_games SET pot_total = pot_total + ? WHERE id=?")->execute([$fee, $gid]);
    });
    json_response(['ok' => true, 'id' => $gid]);
}

function cg_join(PDO $pdo, int $uid, int $gid, array $meta): void {
    $body = read_json_body();
    // クライアントが 「opponent_uid を入れた新 state」 を 計算して 送ってくる (任意)。
    //   そうでなければ サーバが 既存 state を そのまま保持。
    $newState = $body['new_state'] ?? null;
    db_tx($pdo, function () use ($pdo, $uid, $gid, $meta, $newState) {
        $st = $pdo->prepare("SELECT * FROM custom_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', 'already started', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '自分の卓には 参加できません', 400);
        $fee = (int)$g['fee'];
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $fee) throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %dpt)', $fee), 400);
        $stateJson = is_array($newState) ? json_encode($newState, JSON_UNESCAPED_UNICODE) : $g['state_json'];
        $pdo->prepare("UPDATE custom_games SET opponent_user_id=?, status='playing', state_json=? WHERE id=?")
            ->execute([$uid, $stateJson, $gid]);
        Ledger::transfer($pdo, $uid, 1, $fee, 'custom_game_buyin', 'custom_game', $gid, "custom_game #{$gid} buy-in (opp)");
        $pdo->prepare("UPDATE custom_games SET pot_total = pot_total + ? WHERE id=?")->execute([$fee, $gid]);
    });
    json_response(['ok' => true]);
}

function cg_move(PDO $pdo, int $uid, int $gid, array $meta): void {
    $body = read_json_body();
    if (!isset($body['new_state']) || !is_array($body['new_state'])) {
        throw new ApiException('bad_request', 'new_state 必須', 400);
    }
    $newState  = $body['new_state'];
    $finished  = !empty($body['finished']);
    $winnerUid = isset($body['winner_user_id']) && $body['winner_user_id'] !== null ? (int)$body['winner_user_id'] : null;
    $nextTurn  = isset($body['turn_user_id']) && $body['turn_user_id'] !== null ? (int)$body['turn_user_id'] : null;

    db_tx($pdo, function () use ($pdo, $uid, $gid, $meta, $newState, $finished, $winnerUid, $nextTurn) {
        $st = $pdo->prepare("SELECT * FROM custom_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        // 手番チェック (= サーバが 保証する最低限のルール)
        if ((int)$g['turn_user_id'] !== $uid) throw new ApiException('bad_request', 'あなたの手番ではありません', 400);
        // 自分以外の user_id を winner として 申告するのは OK (= 自分が負けた と申告できる)、
        //   勝手に勝者を指定しても 手番チェックを 突破しなければ ここに来れないので 制限は最低限。
        if ($winnerUid !== null) {
            // winner は creator か opponent のどちらか
            $valid = in_array($winnerUid, [(int)$g['creator_user_id'], (int)$g['opponent_user_id']], true);
            if (!$valid) throw new ApiException('bad_request', 'winner_user_id 不正', 400);
        }
        if ($finished) {
            $pot = (int)$g['pot_total'];
            if ($winnerUid === null) {
                // 引分: pot 半額ずつ 返金 (場代 rake なし)
                $each = intdiv($pot, 2);
                Ledger::transfer($pdo, 1, (int)$g['creator_user_id'],  $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
                Ledger::transfer($pdo, 1, (int)$g['opponent_user_id'], $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
            } else {
                // v620 場代 rake: pot から 提供者 (kind の登録者) に share_pct% を 渡し、 残り を 勝者へ。
                //   provider が NULL (= 旧 admin 登録) なら rake せず 全額 勝者へ。
                $providerUid = $meta['created_by_user_id'] ?? null;
                $sharePct = (int)($meta['provider_share_pct'] ?? 0);
                $rake = ($providerUid && $sharePct > 0) ? intdiv($pot * $sharePct, 100) : 0;
                $payout = $pot - $rake;
                if ($rake > 0) {
                    Ledger::transfer($pdo, 1, (int)$providerUid, $rake, 'custom_game_rake', 'custom_game', $gid, "{$meta['kind']} #{$gid} 場代 ({$sharePct}%)");
                }
                if ($payout > 0) {
                    Ledger::transfer($pdo, 1, $winnerUid, $payout, 'custom_game_payout', 'custom_game', $gid, "勝利 payout");
                }
            }
            $pdo->prepare("UPDATE custom_games SET state_json=?, status='finished', winner_user_id=?, turn_user_id=NULL, finished_at=NOW() WHERE id=?")
                ->execute([json_encode($newState, JSON_UNESCAPED_UNICODE), $winnerUid, $gid]);
        } else {
            // 次のターンは creator か opponent のどちらか
            if ($nextTurn === null) throw new ApiException('bad_request', '未終了なら turn_user_id 必須', 400);
            $valid = in_array($nextTurn, [(int)$g['creator_user_id'], (int)$g['opponent_user_id']], true);
            if (!$valid) throw new ApiException('bad_request', 'turn_user_id 不正', 400);
            $pdo->prepare("UPDATE custom_games SET state_json=?, turn_user_id=? WHERE id=?")
                ->execute([json_encode($newState, JSON_UNESCAPED_UNICODE), $nextTurn, $gid]);
        }
    });
    json_response(['ok' => true]);
}

function cg_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM custom_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '開始後は キャンセル不可', 400);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        Ledger::transfer($pdo, 1, $uid, (int)$g['fee'], 'custom_game_refund', 'custom_game', $gid, "キャンセル 返金");
        $pdo->prepare("UPDATE custom_games SET status='cancelled', finished_at=NOW() WHERE id=?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function cg_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uo.display_name AS opponent_name,
                                uw.display_name AS winner_name
                           FROM custom_games g
                           JOIN users uc ON uc.id=g.creator_user_id
                           LEFT JOIN users uo ON uo.id=g.opponent_user_id
                           LEFT JOIN users uw ON uw.id=g.winner_user_id
                          WHERE g.id=?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);
    $state = json_decode($g['state_json'], true);
    json_response([
        'id' => (int)$g['id'],
        'game_kind' => $g['game_kind'],
        'status' => $g['status'],
        'creator_user_id'  => (int)$g['creator_user_id'],
        'creator_name'     => $g['creator_name'],
        'opponent_user_id' => $g['opponent_user_id'] !== null ? (int)$g['opponent_user_id'] : null,
        'opponent_name'    => $g['opponent_name'],
        'winner_user_id'   => $g['winner_user_id']   !== null ? (int)$g['winner_user_id']   : null,
        'winner_name'      => $g['winner_name'],
        'fee' => (int)$g['fee'],
        'pot_total' => (int)$g['pot_total'],
        'turn_user_id'     => $g['turn_user_id'] !== null ? (int)$g['turn_user_id'] : null,
        'my_turn'          => $g['turn_user_id'] !== null && (int)$g['turn_user_id'] === $uid,
        'state' => $state,
        'finished_at' => $g['finished_at'],
        'created_at'  => $g['created_at'],
    ]);
}
