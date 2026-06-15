<?php
// v617 #236 自作ゲーム フレームワーク 用 ルーター。
//   /api/custom-games/list                    : 登録されている ゲーム種別一覧 (UI 用)
//   /api/custom-games/:kind/games             : 一覧 / 起案
//   /api/custom-games/:kind/games/:id         : 詳細
//   /api/custom-games/:kind/games/:id/join    : 対戦相手として 参加
//   /api/custom-games/:kind/games/:id/move    : 手を打つ (body は ゲームごとに自由)
//   /api/custom-games/:kind/games/:id/cancel  : ロビーで キャンセル

declare(strict_types=1);

require_once __DIR__ . '/../custom_games/GameInterface.php';
require_once __DIR__ . '/../custom_games/TicTacToe.php';

// 新しい ゲームを 追加するときは ここに 1 行 追加するだけ:
//   1. src/custom_games/MyGame.php に CustomGameInterface 実装クラスを置く
//   2. 上の require_once に 追記
//   3. このマップに 'mykind' => MyGame::class を 追加
function custom_game_registry(): array {
    return [
        'tictactoe' => new TicTacToe(),
    ];
}

function custom_game_lookup(string $kind): CustomGameInterface {
    $reg = custom_game_registry();
    if (!isset($reg[$kind])) throw new ApiException('not_found', "未知のゲーム種別: $kind", 404);
    return $reg[$kind];
}

function route_custom_games(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    // GET /api/custom-games/list : 登録ゲーム一覧
    if (($seg[1] ?? '') === 'list' && $method === 'GET') {
        $items = [];
        foreach (custom_game_registry() as $kind => $g) {
            $items[] = [
                'kind' => $kind,
                'display_name' => $g->displayName(),
                'description'  => $g->description(),
                'icon'         => $g->icon(),
                'fee'          => $g->fee(),
            ];
        }
        json_response(['items' => $items]);
        return;
    }

    // /api/custom-games/:kind/...
    if (!isset($seg[1]) || !isset($seg[2])) throw new ApiException('not_found', 'no route', 404);
    $kind = (string)$seg[1];
    if ($seg[2] !== 'games') throw new ApiException('not_found', 'no route', 404);
    $game = custom_game_lookup($kind);

    if (!isset($seg[3])) {
        if ($method === 'GET')  { cg_list($pdo, $uid, $kind); return; }
        if ($method === 'POST') { cg_create($pdo, $uid, $kind, $game); return; }
    }
    $gid = (int)$seg[3];
    $action = $seg[4] ?? '';
    if ($action === '' && $method === 'GET')        { cg_detail($pdo, $uid, $gid, $game); return; }
    if ($action === 'join'   && $method === 'POST') { cg_join($pdo, $uid, $gid, $game); return; }
    if ($action === 'move'   && $method === 'POST') { cg_move($pdo, $uid, $gid, $game); return; }
    if ($action === 'cancel' && $method === 'POST') { cg_cancel($pdo, $uid, $gid, $game); return; }
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

function cg_create(PDO $pdo, int $uid, string $kind, CustomGameInterface $game): void {
    $fee = $game->fee();
    $gid = 0;
    db_tx($pdo, function () use ($pdo, $uid, $kind, $game, $fee, &$gid) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $fee) throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %dpt)', $fee), 400);
        // 初期 state (opponent_uid は 0 で 仮埋め、 join 時に上書き)
        $state = $game->initialState($uid, 0);
        $pdo->prepare("INSERT INTO custom_games (game_kind, creator_user_id, status, fee, state_json, turn_user_id)
                       VALUES (?,?,'waiting',?,?,?)")
            ->execute([$kind, $uid, $fee, json_encode($state, JSON_UNESCAPED_UNICODE), $uid]);
        $gid = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $fee, 'custom_game_buyin', 'custom_game', $gid, "{$kind} #{$gid} buy-in (creator)");
        $pdo->prepare("UPDATE custom_games SET pot_total = pot_total + ? WHERE id=?")->execute([$fee, $gid]);
    });
    json_response(['ok' => true, 'id' => $gid]);
}

function cg_join(PDO $pdo, int $uid, int $gid, CustomGameInterface $game): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid, $game) {
        $st = $pdo->prepare("SELECT * FROM custom_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', 'already started', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '自分の卓には 参加できません', 400);
        $fee = (int)$g['fee'];
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $fee) throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %dpt)', $fee), 400);
        // state.opponent_uid を 更新
        $state = json_decode($g['state_json'], true);
        $state['opponent_uid'] = $uid;
        $pdo->prepare("UPDATE custom_games SET opponent_user_id=?, status='playing', state_json=? WHERE id=?")
            ->execute([$uid, json_encode($state, JSON_UNESCAPED_UNICODE), $gid]);
        Ledger::transfer($pdo, $uid, 1, $fee, 'custom_game_buyin', 'custom_game', $gid, "custom_game #{$gid} buy-in (opp)");
        $pdo->prepare("UPDATE custom_games SET pot_total = pot_total + ? WHERE id=?")->execute([$fee, $gid]);
    });
    json_response(['ok' => true]);
}

function cg_move(PDO $pdo, int $uid, int $gid, CustomGameInterface $game): void {
    $body = read_json_body();
    db_tx($pdo, function () use ($pdo, $uid, $gid, $game, $body) {
        $st = $pdo->prepare("SELECT * FROM custom_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        $isCreator = (int)$g['creator_user_id']  === $uid;
        $isOpp     = (int)$g['opponent_user_id'] === $uid;
        if (!$isCreator && !$isOpp) throw new ApiException('forbidden', 'not in game', 403);
        $state = json_decode($g['state_json'], true);
        $res = $game->playMove($state, $uid, $body);
        $newState   = $res['state'];
        $finished   = !empty($res['finished']);
        $winnerUid  = $res['winner_user_id'] ?? null;
        $nextTurn   = $res['turn_user_id'] ?? null;
        if ($finished) {
            // 引分 → 双方 半額返金、 勝者あり → pot 総取り
            $pot = (int)$g['pot_total'];
            if ($winnerUid === null) {
                $each = intdiv($pot, 2);
                Ledger::transfer($pdo, 1, (int)$g['creator_user_id'],  $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
                Ledger::transfer($pdo, 1, (int)$g['opponent_user_id'], $each, 'custom_game_refund', 'custom_game', $gid, "引分 返金");
            } else {
                Ledger::transfer($pdo, 1, (int)$winnerUid, $pot, 'custom_game_payout', 'custom_game', $gid, "勝利 payout");
            }
            $pdo->prepare("UPDATE custom_games SET state_json=?, status='finished', winner_user_id=?, turn_user_id=NULL, finished_at=NOW() WHERE id=?")
                ->execute([json_encode($newState, JSON_UNESCAPED_UNICODE), $winnerUid, $gid]);
        } else {
            $pdo->prepare("UPDATE custom_games SET state_json=?, turn_user_id=? WHERE id=?")
                ->execute([json_encode($newState, JSON_UNESCAPED_UNICODE), $nextTurn, $gid]);
        }
    });
    json_response(['ok' => true]);
}

function cg_cancel(PDO $pdo, int $uid, int $gid, CustomGameInterface $game): void {
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

function cg_detail(PDO $pdo, int $uid, int $gid, CustomGameInterface $game): void {
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
    $publicState = $game->viewForUser($state, $uid);
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
        'state' => $publicState,
        'finished_at' => $g['finished_at'],
        'created_at'  => $g['created_at'],
    ]);
}
