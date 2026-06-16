<?php
// v570 #223 人狼 Phase 1。 役職: 村人 / 人狼 / 占い師 / 騎士。 シンプル夜投票 → 昼投票。
//   lobby → night (人狼襲撃 + 占い + 護衛) → day (襲撃結果開示 + 全員で投票) → 勝敗 or 次 night
//   プレイフィー方式 (戻ってこない、 lobby 中の cancel/leave のみ返金)。

declare(strict_types=1);

const JINROU_DEFAULT_BUYIN = 2;

function route_jinrou(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no jinrou route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET')  { jinrou_list($pdo, $uid); return; }
        if ($method === 'POST') { jinrou_create($pdo, $cfg, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')      { jinrou_detail($pdo, $uid, $gid); return; }
        if ($action === 'join'    && $method === 'POST') { jinrou_join($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'leave'   && $method === 'POST') { jinrou_leave($pdo, $uid, $gid); return; }
        if ($action === 'start'   && $method === 'POST') { jinrou_start($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'action'  && $method === 'POST') { jinrou_action($pdo, $uid, $gid); return; }
        if ($action === 'advance' && $method === 'POST') { jinrou_advance($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'cancel'  && $method === 'POST') { jinrou_cancel($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no jinrou route for $method", 404);
}

function jinrou_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT g.id, g.creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
               g.status, g.buy_in, g.pot_total, g.round_no, g.winner, g.created_at, g.finished_at,
               (SELECT COUNT(*) FROM jinrou_players p WHERE p.game_id = g.id) AS player_count,
               EXISTS(SELECT 1 FROM jinrou_players p WHERE p.game_id = g.id AND p.user_id = ?) AS me_joined
          FROM jinrou_games g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.status IN ('lobby','night','day')
            OR g.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['buy_in'] = (int)$r['buy_in'];
        $r['pot_total'] = (int)$r['pot_total'];
        $r['round_no'] = (int)$r['round_no'];
        $r['player_count'] = (int)$r['player_count'];
        $r['me_joined'] = (bool)$r['me_joined'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function jinrou_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM jinrou_games g JOIN users uc ON uc.id = g.creator_user_id WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);

    // 自分が参加者か取得
    $stMe = $pdo->prepare("SELECT role, alive FROM jinrou_players WHERE game_id = ? AND user_id = ?");
    $stMe->execute([$gid, $uid]);
    $meRow = $stMe->fetch(PDO::FETCH_ASSOC);
    $myRole = $meRow['role'] ?? null;
    $myAlive = $meRow ? (bool)$meRow['alive'] : false;

    // 全員
    $stP = $pdo->prepare("SELECT p.user_id, p.role, p.alive, p.joined_at,
                                 u.display_name, u.avatar_url
                            FROM jinrou_players p JOIN users u ON u.id = p.user_id
                           WHERE p.game_id = ? ORDER BY p.joined_at");
    $stP->execute([$gid]);
    $players = [];
    foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $isMe = ((int)$r['user_id'] === $uid);
        // 役職可視性:
        //   - 自分の役は常に
        //   - 人狼は他の人狼も見える
        //   - 終局時は全員見える
        //   - それ以外は null
        $showRole = false;
        if ($g['status'] === 'finished') $showRole = true;
        elseif ($isMe) $showRole = true;
        elseif ($myRole === 'wolf' && $r['role'] === 'wolf') $showRole = true;
        $players[] = [
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'role'         => $showRole ? $r['role'] : null,
            'alive'        => (bool)$r['alive'],
            'is_me'        => $isMe,
        ];
    }

    $logArr = $g['log_json'] ? (json_decode($g['log_json'], true) ?: []) : [];

    // 自分のアクション状況 (現フェーズで提出済か)
    $myAction = null;
    if ($meRow && in_array($g['status'], ['night','day'], true)) {
        $stA = $pdo->prepare("SELECT action_type, target_user_id FROM jinrou_actions
                               WHERE game_id = ? AND round_no = ? AND phase = ? AND actor_user_id = ?");
        $stA->execute([$gid, (int)$g['round_no'], $g['status'], $uid]);
        $myAction = $stA->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($myAction) {
            $myAction['target_user_id'] = $myAction['target_user_id'] !== null ? (int)$myAction['target_user_id'] : null;
        }
    }

    // 占い結果 (自分が占い師なら、 自分が占ったターゲットの 役を取得)
    $inspectResults = [];
    if ($myRole === 'seer') {
        $stI = $pdo->prepare("SELECT a.target_user_id, a.round_no, p.role AS target_role
                                FROM jinrou_actions a
                                JOIN jinrou_players p ON p.user_id = a.target_user_id AND p.game_id = a.game_id
                               WHERE a.game_id = ? AND a.actor_user_id = ? AND a.action_type = 'inspect'");
        $stI->execute([$gid, $uid]);
        foreach ($stI->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $inspectResults[] = [
                'round'      => (int)$r['round_no'],
                'target_uid' => (int)$r['target_user_id'],
                'target_role'=> $r['target_role'], // 占い師には全公開、 シンプル化のため
            ];
        }
    }

    json_response([
        'id'              => (int)$g['id'],
        'status'          => $g['status'],
        'buy_in'          => (int)$g['buy_in'],
        'pot_total'       => (int)$g['pot_total'],
        'round_no'        => (int)$g['round_no'],
        'winner'          => $g['winner'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name'    => $g['creator_name'],
        'creator_avatar'  => $g['creator_avatar'],
        'config'          => $g['config_json'] ? (json_decode($g['config_json'], true) ?: null) : null,
        'created_at'      => $g['created_at'],
        'started_at'      => $g['started_at'],
        'finished_at'     => $g['finished_at'],
        'players'         => $players,
        'my_role'         => $myRole,
        'my_alive'        => $myAlive,
        'my_action'       => $myAction,
        'inspect_results' => $inspectResults,
        'log'             => $logArr,
        'is_creator'      => (int)$g['creator_user_id'] === $uid,
        'me_joined'       => $meRow !== false && $meRow !== null,
    ]);
}

function jinrou_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $buyIn = (int)($body['buy_in'] ?? JINROU_DEFAULT_BUYIN);
    if ($buyIn < 1 || $buyIn > 100) throw new ApiException('bad_request', 'buy_in 1-100', 400);
    $memberIds = $body['member_ids'] ?? [];
    if (!is_array($memberIds)) $memberIds = [];
    // v632 instant_start = 全員 即着席 + 一括徴収 + 役職配布 + status='night' に。
    //   人狼 は 4 人以上 必要 なので 自分 + 3 人 以上 招待 されてれば 即開始可。
    $instant = !empty($body['instant_start']) && count($memberIds) >= 3;
    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $buyIn, $memberIds, $instant, &$gameId) {
        mahjong_assert_balance($pdo, $uid, $buyIn);
        $pdo->prepare("INSERT INTO jinrou_games (creator_user_id, buy_in, status, pot_total) VALUES (?,?,?,?)")
            ->execute([$uid, $buyIn, 'lobby', 0]);
        $gameId = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO jinrou_players (game_id, user_id) VALUES (?, ?)")->execute([$gameId, $uid]);
        jinrou_deposit($pdo, $gameId, $uid, $buyIn);
        if ($instant) {
            jinrou_create_with_invitees($pdo, $uid, $gameId, $buyIn, $memberIds);
        }
    });
    global $CFG;
    foreach ($memberIds as $mid) {
        $mid = (int)$mid;
        if ($mid === $uid || $mid <= 0) continue;
        try {
            $msg = $instant
                ? "🐺 人狼 開始! 役職が 配布されました ({$buyIn}pt 預託済)"
                : "🐺 人狼ゲームに招待されました ({$buyIn}pt)";
            notify_safely($pdo, $CFG, $mid, 'admin_notice', $msg, 'jinrou', $gameId);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $gameId]);
}

// v632 instant_start: 招待者を 全員 着席 + 一括徴収 + 役職配布 + 'night' へ
function jinrou_create_with_invitees(PDO $pdo, int $creatorUid, int $gid, int $buyIn, array $invitees): void {
    $invitees = array_values(array_unique(array_map('intval', $invitees)));
    $invitees = array_values(array_filter($invitees, fn($u) => $u !== $creatorUid && $u > 0));
    $n = 1 + count($invitees);
    if ($n < 4) throw new ApiException('bad_request', '人狼は 4 人以上 (自分 + 3 人 以上)', 400);
    if ($n > 16) throw new ApiException('bad_request', '16 人まで', 400);
    $place = implode(',', array_fill(0, count($invitees), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($invitees);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) !== count($invitees)) throw new ApiException('bad_request', '無効なメンバー', 400);
    foreach ($invitees as $iv) {
        if (Ledger::balanceOfUser($pdo, $iv) < $buyIn) {
            $stN = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
            $stN->execute([$iv]);
            throw new ApiException('insufficient_balance', sprintf('%s さんの ポイント不足 (要 %dpt)', $stN->fetchColumn(), $buyIn), 400);
        }
    }
    foreach ($invitees as $iv) {
        $pdo->prepare("INSERT INTO jinrou_players (game_id, user_id) VALUES (?, ?)")->execute([$gid, $iv]);
        jinrou_deposit($pdo, $gid, $iv, $buyIn);
    }
    // 役職配布 (= jinrou_start core 部分) + status='night'
    $wolfCount = $n <= 5 ? 1 : ($n <= 8 ? 2 : ($n <= 12 ? 3 : 4));
    $roles = [];
    for ($i = 0; $i < $wolfCount; $i++) $roles[] = 'wolf';
    $roles[] = 'seer';
    $roles[] = 'knight';
    while (count($roles) < $n) $roles[] = 'villager';
    shuffle($roles);
    $stP = $pdo->prepare("SELECT user_id FROM jinrou_players WHERE game_id = ? ORDER BY joined_at");
    $stP->execute([$gid]);
    $playerUids = array_map('intval', $stP->fetchAll(PDO::FETCH_COLUMN));
    foreach ($playerUids as $i => $puid) {
        $pdo->prepare("UPDATE jinrou_players SET role = ?, alive = 1 WHERE game_id = ? AND user_id = ?")
            ->execute([$roles[$i], $gid, $puid]);
    }
    $config = ['wolf_count' => $wolfCount, 'seer' => 1, 'knight' => 1];
    $log = [['event' => 'game_start', 'players' => $n, 'config' => $config]];
    $pdo->prepare("UPDATE jinrou_games SET status='night', started_at=NOW(), round_no=1, config_json=?, log_json=? WHERE id = ?")
        ->execute([json_encode($config, JSON_UNESCAPED_UNICODE), json_encode($log, JSON_UNESCAPED_UNICODE), $gid]);
}

function jinrou_join(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = jinrou_lock($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '参加受付中ではありません', 400);
        $stE = $pdo->prepare("SELECT 1 FROM jinrou_players WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        if ($stE->fetchColumn()) throw new ApiException('bad_request', '既に参加しています', 400);
        $buyIn = (int)$g['buy_in'];
        mahjong_assert_balance($pdo, $uid, $buyIn);
        $pdo->prepare("INSERT INTO jinrou_players (game_id, user_id) VALUES (?, ?)")->execute([$gid, $uid]);
        jinrou_deposit($pdo, $gid, $uid, $buyIn);
    });
    json_response(['ok' => true]);
}

function jinrou_leave(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = jinrou_lock($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '開始後は脱退できません', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '起案者は脱退不可 (キャンセルしてください)', 400);
        $pdo->prepare("DELETE FROM jinrou_players WHERE game_id = ? AND user_id = ?")->execute([$gid, $uid]);
        $buyIn = (int)$g['buy_in'];
        Ledger::transfer($pdo, 1, $uid, $buyIn, 'mahjong_refund', 'jinrou', $gid, '人狼 脱退返金');
        $pdo->prepare("UPDATE jinrou_games SET pot_total = pot_total - ? WHERE id = ?")->execute([$buyIn, $gid]);
    });
    json_response(['ok' => true]);
}

function jinrou_start(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = jinrou_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ開始可', 403);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '募集中ではありません', 400);
        $stP = $pdo->prepare("SELECT user_id FROM jinrou_players WHERE game_id = ? ORDER BY joined_at");
        $stP->execute([$gid]);
        $playerUids = array_map('intval', $stP->fetchAll(PDO::FETCH_COLUMN));
        $n = count($playerUids);
        if ($n < 4) throw new ApiException('bad_request', '4 人以上で開始 (人狼1 + 占い1 + 騎士1 + 村人1 が最低構成)', 400);
        if ($n > 16) throw new ApiException('bad_request', '16 人まで', 400);
        // 役職構成: 人数別 (シンプル)
        //   4-5人 → 人狼1 占い1 騎士1 村人 残り
        //   6-8人 → 人狼2 占い1 騎士1 村人 残り
        //   9-12人 → 人狼3 占い1 騎士1 村人 残り
        //   13-16人 → 人狼4 占い1 騎士1 村人 残り
        $wolfCount = $n <= 5 ? 1 : ($n <= 8 ? 2 : ($n <= 12 ? 3 : 4));
        $roles = [];
        for ($i = 0; $i < $wolfCount; $i++) $roles[] = 'wolf';
        $roles[] = 'seer';
        $roles[] = 'knight';
        while (count($roles) < $n) $roles[] = 'villager';
        shuffle($roles);
        // 配布
        foreach ($playerUids as $i => $puid) {
            $pdo->prepare("UPDATE jinrou_players SET role = ?, alive = 1 WHERE game_id = ? AND user_id = ?")
                ->execute([$roles[$i], $gid, $puid]);
        }
        $config = ['wolf_count' => $wolfCount, 'seer' => 1, 'knight' => 1];
        $log = [['event' => 'game_start', 'players' => $n, 'config' => $config]];
        $pdo->prepare("UPDATE jinrou_games SET status='night', started_at=NOW(), round_no=1, config_json=?, log_json=? WHERE id = ?")
            ->execute([json_encode($config, JSON_UNESCAPED_UNICODE), json_encode($log, JSON_UNESCAPED_UNICODE), $gid]);
    });
    // 全員に通知 (役の中身は通知しない、 詳細ページで確認させる)
    $stP = $pdo->prepare("SELECT user_id FROM jinrou_players WHERE game_id = ?");
    $stP->execute([$gid]);
    foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        try { notify_safely($pdo, $cfg, (int)$pid, 'admin_notice', "🐺 人狼ゲーム開始! 自分の役職を確認してください", 'jinrou', $gid); } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function jinrou_action(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $type = (string)($body['type'] ?? '');
    $target = isset($body['target_user_id']) ? (int)$body['target_user_id'] : null;
    if (!in_array($type, ['attack','inspect','protect','vote'], true)) throw new ApiException('bad_request', 'type 不正', 400);
    db_tx($pdo, function () use ($pdo, $uid, $gid, $type, $target) {
        $g = jinrou_lock($pdo, $gid);
        if (!in_array($g['status'], ['night','day'], true)) throw new ApiException('bad_request', 'アクション受付外', 400);
        $stMe = $pdo->prepare("SELECT role, alive FROM jinrou_players WHERE game_id = ? AND user_id = ?");
        $stMe->execute([$gid, $uid]);
        $me = $stMe->fetch(PDO::FETCH_ASSOC);
        if (!$me) throw new ApiException('forbidden', 'この卓の参加者ではありません', 403);
        if (!$me['alive']) throw new ApiException('forbidden', '死亡者はアクションできません', 403);
        // フェーズと type の組合せをチェック
        if ($g['status'] === 'night') {
            if ($type === 'attack' && $me['role'] !== 'wolf') throw new ApiException('forbidden', '人狼のみ襲撃可', 403);
            if ($type === 'inspect' && $me['role'] !== 'seer') throw new ApiException('forbidden', '占い師のみ', 403);
            if ($type === 'protect' && $me['role'] !== 'knight') throw new ApiException('forbidden', '騎士のみ', 403);
            if ($type === 'vote') throw new ApiException('bad_request', '投票は昼フェーズ', 400);
        } else { // day
            if ($type !== 'vote') throw new ApiException('bad_request', '昼は投票のみ', 400);
        }
        // ターゲット存在 + 生存チェック
        if ($target !== null) {
            $stT = $pdo->prepare("SELECT alive FROM jinrou_players WHERE game_id = ? AND user_id = ?");
            $stT->execute([$gid, $target]);
            $tRow = $stT->fetch(PDO::FETCH_ASSOC);
            if (!$tRow) throw new ApiException('bad_request', 'ターゲットが参加者でない', 400);
            if (!$tRow['alive']) throw new ApiException('bad_request', '死亡者はターゲットにできません', 400);
        }
        // upsert
        $pdo->prepare("INSERT INTO jinrou_actions (game_id, round_no, phase, actor_user_id, action_type, target_user_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE target_user_id = VALUES(target_user_id)")
            ->execute([$gid, (int)$g['round_no'], $g['status'], $uid, $type, $target]);
    });
    json_response(['ok' => true]);
}

function jinrou_advance(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid) {
        $g = jinrou_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ進行可', 403);
        if (!in_array($g['status'], ['night','day'], true)) throw new ApiException('bad_request', '進行できる状態ではありません', 400);
        $log = $g['log_json'] ? (json_decode($g['log_json'], true) ?: []) : [];
        $round = (int)$g['round_no'];
        $phase = $g['status'];

        if ($phase === 'night') {
            // 人狼の襲撃 (多数決、 同点は ランダム)
            $stA = $pdo->prepare("SELECT target_user_id FROM jinrou_actions WHERE game_id = ? AND round_no = ? AND phase = 'night' AND action_type = 'attack'");
            $stA->execute([$gid, $round]);
            $attacks = array_filter(array_map('intval', $stA->fetchAll(PDO::FETCH_COLUMN)), fn($x) => $x > 0);
            $tally = [];
            foreach ($attacks as $t) $tally[$t] = ($tally[$t] ?? 0) + 1;
            $victim = null;
            if ($tally) {
                arsort($tally);
                $top = max($tally);
                $cands = array_keys(array_filter($tally, fn($v) => $v === $top));
                $victim = $cands[array_rand($cands)];
            }
            // 騎士の護衛
            $stPr = $pdo->prepare("SELECT target_user_id FROM jinrou_actions WHERE game_id = ? AND round_no = ? AND phase = 'night' AND action_type = 'protect' LIMIT 1");
            $stPr->execute([$gid, $round]);
            $protect = $stPr->fetchColumn();
            $protect = $protect === false ? null : (int)$protect;
            $killed = null;
            if ($victim !== null && $victim !== $protect) {
                $killed = $victim;
                $pdo->prepare("UPDATE jinrou_players SET alive = 0 WHERE game_id = ? AND user_id = ?")->execute([$gid, $killed]);
            }
            $log[] = ['round' => $round, 'phase' => 'night', 'event' => 'night_result', 'killed' => $killed, 'protected' => $protect];

            // 勝敗判定
            $winner = jinrou_check_winner($pdo, $gid);
            if ($winner) {
                jinrou_finalize($pdo, $gid, $winner, $log);
                return;
            }
            // day へ進む
            $pdo->prepare("UPDATE jinrou_games SET status='day', log_json=? WHERE id = ?")
                ->execute([json_encode($log, JSON_UNESCAPED_UNICODE), $gid]);
        } else { // day
            // 全員投票の多数決で 1 人追放
            $stV = $pdo->prepare("SELECT target_user_id FROM jinrou_actions WHERE game_id = ? AND round_no = ? AND phase = 'day' AND action_type = 'vote'");
            $stV->execute([$gid, $round]);
            $votes = array_filter(array_map('intval', $stV->fetchAll(PDO::FETCH_COLUMN)), fn($x) => $x > 0);
            $tally = [];
            foreach ($votes as $t) $tally[$t] = ($tally[$t] ?? 0) + 1;
            $lynched = null;
            if ($tally) {
                arsort($tally);
                $top = max($tally);
                $cands = array_keys(array_filter($tally, fn($v) => $v === $top));
                $lynched = $cands[array_rand($cands)];
                $pdo->prepare("UPDATE jinrou_players SET alive = 0 WHERE game_id = ? AND user_id = ?")->execute([$gid, $lynched]);
            }
            $log[] = ['round' => $round, 'phase' => 'day', 'event' => 'lynch', 'target' => $lynched];

            // 勝敗判定
            $winner = jinrou_check_winner($pdo, $gid);
            if ($winner) {
                jinrou_finalize($pdo, $gid, $winner, $log);
                return;
            }
            // 次 night へ
            $pdo->prepare("UPDATE jinrou_games SET status='night', round_no = round_no + 1, log_json=? WHERE id = ?")
                ->execute([json_encode($log, JSON_UNESCAPED_UNICODE), $gid]);
        }
    });
    // 全員通知
    $stP = $pdo->prepare("SELECT user_id FROM jinrou_players WHERE game_id = ?");
    $stP->execute([$gid]);
    $stG = $pdo->prepare("SELECT status, round_no, winner FROM jinrou_games WHERE id = ?");
    $stG->execute([$gid]);
    $newG = $stG->fetch(PDO::FETCH_ASSOC);
    foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        try {
            if ($newG['winner']) {
                $msg = "🐺 人狼ゲーム終了 (勝者: " . ($newG['winner'] === 'village' ? '村人' : '人狼') . ")";
            } else {
                $msg = "🐺 人狼: " . ($newG['status'] === 'night' ? "夜 (ラウンド {$newG['round_no']})" : "昼 (ラウンド {$newG['round_no']})") . " に進みました";
            }
            notify_safely($pdo, $cfg, (int)$pid, 'admin_notice', $msg, 'jinrou', $gid);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function jinrou_check_winner(PDO $pdo, int $gid): ?string {
    $stP = $pdo->prepare("SELECT role, alive FROM jinrou_players WHERE game_id = ?");
    $stP->execute([$gid]);
    $rows = $stP->fetchAll(PDO::FETCH_ASSOC);
    $wolfAlive = 0; $villageAlive = 0;
    foreach ($rows as $r) {
        if (!$r['alive']) continue;
        if ($r['role'] === 'wolf') $wolfAlive++;
        else $villageAlive++;
    }
    if ($wolfAlive === 0) return 'village';
    if ($wolfAlive >= $villageAlive) return 'wolves';
    return null;
}

function jinrou_finalize(PDO $pdo, int $gid, string $winner, array $log): void {
    $log[] = ['event' => 'finished', 'winner' => $winner];
    $pdo->prepare("UPDATE jinrou_games SET status='finished', winner=?, finished_at=NOW(), log_json=? WHERE id = ?")
        ->execute([$winner, json_encode($log, JSON_UNESCAPED_UNICODE), $gid]);
}

function jinrou_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = jinrou_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['lobby','night','day'], true)) throw new ApiException('bad_request', '既に終了', 400);
        // lobby のみ参加者に返金 (ゲーム開始後は プレイフィーとして徴収済)
        if ($g['status'] === 'lobby') {
            $stP = $pdo->prepare("SELECT user_id FROM jinrou_players WHERE game_id = ?");
            $stP->execute([$gid]);
            $buyIn = (int)$g['buy_in'];
            foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
                Ledger::transfer($pdo, 1, (int)$pid, $buyIn, 'mahjong_refund', 'jinrou', $gid, '人狼キャンセル返金');
            }
            $pdo->prepare("UPDATE jinrou_games SET pot_total = 0 WHERE id = ?")->execute([$gid]);
        }
        $pdo->prepare("UPDATE jinrou_games SET status='cancelled', finished_at=NOW() WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function jinrou_lock(PDO $pdo, int $gid): array {
    $st = $pdo->prepare("SELECT * FROM jinrou_games WHERE id = ? FOR UPDATE");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    return $g;
}
function jinrou_deposit(PDO $pdo, int $gid, int $uid, int $amount): void {
    // v571 リファクタ: GameLobby 共通ヘルパに委譲
    GameLobby::depositToPot($pdo, $gid, $uid, $amount, 'mahjong_buyin', 'jinrou', 'jinrou_games', '人狼プレイフィー');
}
