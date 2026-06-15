<?php
// v618 #236 自作ゲーム フレームワーク。 PHP は 「kind → 表示名/手数料」 の manifest 辞書のみ。
//   ゲームロジック は すべて public/js/custom_games/{kind}.js (JS) に書く。
//   サーバは state_json を 不透明 な コンテナとして 保存するだけ で、 中身の判定はしない。
//
//   セキュリティ モデル: 1pt 程度の低額対戦を想定。
//   - 手番ユーザだけが /move を呼べる (turn_user_id 一致チェック)
//   - クライアントが 計算した new_state / finished / winner_user_id を 信頼して 保存
//   - 「対戦相手の クライアントも 同じ JS ロジックで 再計算」 することで 健全性を保つ
//   - 不正検知が必要なら ゲーム固有の dispute UI を作る (今のところ なし)
//
//   API:
//     GET  /api/custom-games/list                       登録ゲーム一覧
//     GET  /api/custom-games/:kind/games                対戦卓 一覧 (recent 30)
//     POST /api/custom-games/:kind/games                起案 (1pt buy-in、 body は {initial_state})
//     GET  /api/custom-games/:kind/games/:id            詳細 (state_json + turn_user_id + status)
//     POST /api/custom-games/:kind/games/:id/join       参加 (1pt)
//     POST /api/custom-games/:kind/games/:id/move       手を打つ (body は {new_state, finished, winner_user_id, turn_user_id})
//     POST /api/custom-games/:kind/games/:id/cancel     ロビーで キャンセル
//
//   新しいゲームを 追加するには:
//     1. CG_REGISTRY に 1 行追加 (kind → fee / display_name / icon / description)
//     2. public/js/custom_games/{kind}.js を 1 ファイル作る
//   PHP を触る必要は 上記 1 行だけ。

declare(strict_types=1);

const CG_REGISTRY = [
    'tictactoe' => [
        'display_name' => '⭕❌ マルバツ',
        'description'  => '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。',
        'icon'         => '⭕',
        'fee'          => 1,
    ],
    // 新しいゲーム を 追加する 場合は ここに 1 行:
    // 'mygame' => ['display_name' => '🎲 マイゲーム', 'description' => '...', 'icon' => '🎲', 'fee' => 1],
];

function cg_kind_meta(string $kind): array {
    if (!isset(CG_REGISTRY[$kind])) throw new ApiException('not_found', "未知のゲーム種別: $kind", 404);
    return CG_REGISTRY[$kind];
}

function route_custom_games(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    if (($seg[1] ?? '') === 'list' && $method === 'GET') {
        $items = [];
        foreach (CG_REGISTRY as $kind => $meta) {
            $items[] = ['kind' => $kind] + $meta;
        }
        json_response(['items' => $items]);
        return;
    }
    if (!isset($seg[1]) || !isset($seg[2])) throw new ApiException('not_found', 'no route', 404);
    $kind = (string)$seg[1];
    if ($seg[2] !== 'games') throw new ApiException('not_found', 'no route', 404);
    $meta = cg_kind_meta($kind);

    if (!isset($seg[3])) {
        if ($method === 'GET')  { cg_list($pdo, $uid, $kind); return; }
        if ($method === 'POST') { cg_create($pdo, $uid, $kind, $meta); return; }
    }
    $gid = (int)$seg[3];
    $action = $seg[4] ?? '';
    if ($action === '' && $method === 'GET')         { cg_detail($pdo, $uid, $gid); return; }
    if ($action === 'join'   && $method === 'POST')  { cg_join($pdo, $uid, $gid, $meta); return; }
    if ($action === 'move'   && $method === 'POST')  { cg_move($pdo, $uid, $gid); return; }
    if ($action === 'cancel' && $method === 'POST')  { cg_cancel($pdo, $uid, $gid); return; }
    json_error('not_found', "no custom-games route", 404);
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

function cg_move(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    if (!isset($body['new_state']) || !is_array($body['new_state'])) {
        throw new ApiException('bad_request', 'new_state 必須', 400);
    }
    $newState  = $body['new_state'];
    $finished  = !empty($body['finished']);
    $winnerUid = isset($body['winner_user_id']) && $body['winner_user_id'] !== null ? (int)$body['winner_user_id'] : null;
    $nextTurn  = isset($body['turn_user_id']) && $body['turn_user_id'] !== null ? (int)$body['turn_user_id'] : null;

    db_tx($pdo, function () use ($pdo, $uid, $gid, $newState, $finished, $winnerUid, $nextTurn) {
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
                $each = intdiv($pot, 2);
                Ledger::transfer($pdo, 1, (int)$g['creator_user_id'],  $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
                Ledger::transfer($pdo, 1, (int)$g['opponent_user_id'], $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
            } else {
                Ledger::transfer($pdo, 1, $winnerUid, $pot, 'custom_game_payout', 'custom_game', $gid, "勝利 payout");
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
