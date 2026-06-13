<?php
// v553 #209 麻雀 Phase 1: 4人卓の 賭けプール + 結果分配 (実ゲームは外部、 結果だけ申告)。
//   GET    /api/mahjong/games               一覧 (lobby + playing + 直近 finished)
//   POST   /api/mahjong/games               { title?, buy_in? } 新規 (起案者は自動参加 = 50pt 預託)
//   GET    /api/mahjong/games/:id           詳細 (players + pot + status)
//   POST   /api/mahjong/games/:id/join      参加 (50pt 預託)
//   POST   /api/mahjong/games/:id/leave     脱退 (lobby 中のみ、 50pt 返金)
//   POST   /api/mahjong/games/:id/start     開始 (4人 揃って 起案者のみ。 playing 状態へ)
//   POST   /api/mahjong/games/:id/report    結果報告 { ranks: { user_id: rank } } 起案者のみ
//   POST   /api/mahjong/games/:id/cancel    キャンセル (lobby/reporting のみ、 全員返金)

declare(strict_types=1);

const MAHJONG_DEFAULT_BUYIN  = 50;
const MAHJONG_RAKE_PCT       = 5;
const MAHJONG_SEATS          = 4;
// rank → 配分 % (場代抜き後の 残り 95% を、 50/30/15/0 で配る)
const MAHJONG_RANK_PCT       = [1 => 50, 2 => 30, 3 => 15, 4 => 0];

function route_mahjong(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no mahjong route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET')  { mahjong_games_list($pdo, $uid); return; }
        if ($method === 'POST') { mahjong_create($pdo, $cfg, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')      { mahjong_detail($pdo, $uid, $gid); return; }
        if ($action === 'join'   && $method === 'POST') { mahjong_join($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'leave'  && $method === 'POST') { mahjong_leave($pdo, $uid, $gid); return; }
        if ($action === 'start'  && $method === 'POST') { mahjong_start($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'report' && $method === 'POST') { mahjong_report($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'cancel' && $method === 'POST') { mahjong_cancel($pdo, $uid, $gid); return; }
        if ($action === 'state'  && $method === 'GET')  { mahjong_state($pdo, $uid, $gid); return; }
        if ($action === 'action' && $method === 'POST') { mahjong_action($pdo, $cfg, $uid, $gid); return; }
    }
    json_error('not_found', "no mahjong route for $method", 404);
}

function mahjong_games_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT g.id, g.creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
               g.title, g.buy_in, g.status, g.pot_total, g.created_at, g.started_at, g.finished_at,
               (SELECT COUNT(*) FROM mahjong_players p WHERE p.game_id = g.id) AS player_count,
               EXISTS(SELECT 1 FROM mahjong_players p WHERE p.game_id = g.id AND p.user_id = ?) AS me_joined
          FROM mahjong_games g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.status IN ('lobby','playing','reporting')
            OR g.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['buy_in']          = (int)$r['buy_in'];
        $r['pot_total']       = (int)$r['pot_total'];
        $r['player_count']    = (int)$r['player_count'];
        $r['me_joined']       = (bool)$r['me_joined'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function mahjong_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM mahjong_games g JOIN users uc ON uc.id = g.creator_user_id
                         WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    $stP = $pdo->prepare("SELECT p.user_id, p.seat_order, p.joined_at, p.result_rank, p.payout,
                                 u.display_name, u.avatar_url
                            FROM mahjong_players p JOIN users u ON u.id = p.user_id
                           WHERE p.game_id = ? ORDER BY p.seat_order");
    $stP->execute([$gid]);
    $players = array_map(fn($r) => [
        'user_id'      => (int)$r['user_id'],
        'seat_order'   => (int)$r['seat_order'],
        'joined_at'    => $r['joined_at'],
        'result_rank'  => $r['result_rank'] !== null ? (int)$r['result_rank'] : null,
        'payout'       => (int)$r['payout'],
        'display_name' => $r['display_name'],
        'avatar_url'   => $r['avatar_url'],
    ], $stP->fetchAll(PDO::FETCH_ASSOC));
    json_response([
        'id'              => (int)$g['id'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name'    => $g['creator_name'],
        'creator_avatar'  => $g['creator_avatar'],
        'title'           => $g['title'],
        'buy_in'          => (int)$g['buy_in'],
        'status'          => $g['status'],
        'pot_total'       => (int)$g['pot_total'],
        'rake_pct'        => (int)$g['rake_pct'],
        'created_at'      => $g['created_at'],
        'started_at'      => $g['started_at'],
        'finished_at'     => $g['finished_at'],
        'players'         => $players,
        'is_creator'      => (int)$g['creator_user_id'] === $uid,
        'me_joined'       => (bool)count(array_filter($players, fn($p) => $p['user_id'] === $uid)),
        'seats'           => MAHJONG_SEATS,
    ]);
}

function mahjong_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = isset($body['title']) ? mb_substr(trim((string)$body['title']), 0, 200) : null;
    if ($title === '') $title = null;
    $buyIn = (int)($body['buy_in'] ?? MAHJONG_DEFAULT_BUYIN);
    if ($buyIn < 1 || $buyIn > 10000) throw new ApiException('bad_request', 'buy_in は 1〜10000', 400);
    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $buyIn, &$gameId) {
        mahjong_assert_balance($pdo, $uid, $buyIn);
        $pdo->prepare("INSERT INTO mahjong_games (creator_user_id, title, buy_in, status, pot_total) VALUES (?,?,?,?,?)")
            ->execute([$uid, $title, $buyIn, 'lobby', 0]);
        $gameId = (int)$pdo->lastInsertId();
        mahjong_insert_player($pdo, $gameId, $uid, 0);
        mahjong_deposit($pdo, $gameId, $uid, $buyIn);
    });
    json_response(['ok' => true, 'id' => $gameId]);
}

function mahjong_join(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid) {
        $g = mahjong_lock_game($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '募集中ではありません', 400);
        $stC = $pdo->prepare("SELECT COUNT(*) FROM mahjong_players WHERE game_id = ?");
        $stC->execute([$gid]);
        $cnt = (int)$stC->fetchColumn();
        if ($cnt >= MAHJONG_SEATS) throw new ApiException('bad_request', '満卓です', 400);
        $stE = $pdo->prepare("SELECT 1 FROM mahjong_players WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        if ($stE->fetchColumn()) throw new ApiException('bad_request', '既に参加しています', 400);
        $buyIn = (int)$g['buy_in'];
        mahjong_assert_balance($pdo, $uid, $buyIn);
        mahjong_insert_player($pdo, $gid, $uid, $cnt);
        mahjong_deposit($pdo, $gid, $uid, $buyIn);
        // 起案者と他参加者に通知
        $stN = $pdo->prepare("SELECT user_id FROM mahjong_players WHERE game_id = ? AND user_id != ?");
        $stN->execute([$gid, $uid]);
        foreach ($stN->fetchAll(PDO::FETCH_COLUMN) as $other) {
            try {
                global $CFG;
                $stU = $pdo->prepare("SELECT display_name FROM users WHERE id = ?");
                $stU->execute([$uid]);
                $name = (string)$stU->fetchColumn();
                $remaining = MAHJONG_SEATS - ($cnt + 1);
                $msg = $remaining > 0
                    ? "🀄 {$name} が麻雀卓 #{$gid} に参加 (残り {$remaining} 席)"
                    : "🀄 {$name} が参加して 麻雀卓 #{$gid} が満卓に! 起案者は 「開始」 を押してください";
                notify_safely($pdo, $CFG, (int)$other, 'admin_notice', $msg, 'mahjong', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function mahjong_leave(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = mahjong_lock_game($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '開始済 / 報告中は脱退できません', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '起案者は脱退できません (キャンセルしてください)', 400);
        $stE = $pdo->prepare("SELECT 1 FROM mahjong_players WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        if (!$stE->fetchColumn()) throw new ApiException('bad_request', '参加していません', 400);
        $pdo->prepare("DELETE FROM mahjong_players WHERE game_id = ? AND user_id = ?")->execute([$gid, $uid]);
        $buyIn = (int)$g['buy_in'];
        Ledger::transfer($pdo, 1, $uid, $buyIn, 'mahjong_refund', 'mahjong', $gid, '麻雀卓 #' . $gid . ' 脱退返金');
        $pdo->prepare("UPDATE mahjong_games SET pot_total = pot_total - ? WHERE id = ?")->execute([$buyIn, $gid]);
    });
    json_response(['ok' => true]);
}

function mahjong_start(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = mahjong_lock_game($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ開始可', 403);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '募集中ではありません', 400);
        $stP = $pdo->prepare("SELECT user_id FROM mahjong_players WHERE game_id = ? ORDER BY seat_order");
        $stP->execute([$gid]);
        $playerUids = array_map('intval', $stP->fetchAll(PDO::FETCH_COLUMN));
        if (count($playerUids) !== MAHJONG_SEATS) throw new ApiException('bad_request', '4人揃ってから開始してください', 400);
        // v554 Phase 2: 実ゲーム状態を初期化
        $state = MahjongEngine::newGame($playerUids);
        // 親 (turn=0) に最初のツモ
        MahjongEngine::drawForTurn($state);
        $pdo->prepare("UPDATE mahjong_games SET status='playing', started_at=NOW(), state_json=?, state_ver=state_ver+1 WHERE id = ?")
            ->execute([json_encode($state, JSON_UNESCAPED_UNICODE), $gid]);
    });
    $stP = $pdo->prepare("SELECT user_id FROM mahjong_players WHERE game_id = ?");
    $stP->execute([$gid]);
    foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        try { notify_safely($pdo, $cfg, (int)$pid, 'admin_notice', "🀄 麻雀卓 #{$gid} 開始!", 'mahjong', $gid); } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

// v554 GET /api/mahjong/games/:id/state — 現在の状態を返す (相手の hand は隠す)
function mahjong_state(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, (SELECT COUNT(*) FROM mahjong_players p WHERE p.game_id = g.id) AS player_count FROM mahjong_games g WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    // 自分の seat_order を特定
    $stP = $pdo->prepare("SELECT seat_order FROM mahjong_players WHERE game_id = ? AND user_id = ?");
    $stP->execute([$gid, $uid]);
    $mySeat = $stP->fetchColumn();
    $mySeat = $mySeat === false ? null : (int)$mySeat;
    $stPa = $pdo->prepare("SELECT p.user_id, p.seat_order, u.display_name, u.avatar_url
                            FROM mahjong_players p JOIN users u ON u.id = p.user_id
                           WHERE p.game_id = ? ORDER BY p.seat_order");
    $stPa->execute([$gid]);
    $players = $stPa->fetchAll(PDO::FETCH_ASSOC);

    $state = $g['state_json'] ? json_decode($g['state_json'], true) : null;
    // 公開可能な状態を構成 (deck は完全に隠す、 他人の hand は サイズだけ)
    $pub = null;
    if ($state) {
        $pubPlayers = [];
        foreach ($state['players'] as $idx => $p) {
            $isMe = ($idx === $mySeat);
            $pubPlayers[] = [
                'user_id'    => (int)$p['user_id'],
                'hand'       => $isMe ? $p['hand'] : null,
                'hand_size'  => count($p['hand']),
                'discards'   => $p['discards'],
                'riichi'     => $p['riichi'],
                'score'      => $p['score'],
            ];
        }
        $pub = [
            'phase'           => $state['phase'],
            'round_wind'      => $state['round_wind'],
            'round_index'     => $state['round_index'],
            'oya'             => $state['oya'],
            'honba'           => $state['honba'],
            'turn'            => $state['turn'],
            'wall_remaining'  => MahjongEngine::wallRemaining($state),
            'dora_indicators' => $state['dora_indicators'],
            'players'         => $pubPlayers,
            'last_discarded'  => $state['last_discarded'],
            'awaiting'        => $state['awaiting'],
            'log'             => array_slice($state['log'], -30),
            'game_winners'    => $state['game_winners'],
        ];
    }
    json_response([
        'id'         => (int)$g['id'],
        'status'     => $g['status'],
        'state_ver'  => (int)$g['state_ver'],
        'state'      => $pub,
        'my_seat'    => $mySeat,
        'players'    => array_map(fn($r) => [
            'user_id'      => (int)$r['user_id'],
            'seat_order'   => (int)$r['seat_order'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
        ], $players),
    ]);
}

// v554 POST /api/mahjong/games/:id/action { type: discard|tsumo|ron|riichi|pass, tile? }
function mahjong_action(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $type = (string)($body['type'] ?? '');
    $tile = isset($body['tile']) ? (int)$body['tile'] : null;
    $result = null;
    db_tx($pdo, function () use ($pdo, $uid, $gid, $type, $tile, &$result) {
        $stG = $pdo->prepare("SELECT * FROM mahjong_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'game not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', '対局中ではありません', 400);
        $state = json_decode($g['state_json'], true);
        if (!$state) throw new ApiException('bad_request', 'state 未初期化', 400);
        // 自分の seat
        $stP = $pdo->prepare("SELECT seat_order FROM mahjong_players WHERE game_id = ? AND user_id = ?");
        $stP->execute([$gid, $uid]);
        $seat = $stP->fetchColumn();
        if ($seat === false) throw new ApiException('forbidden', 'この卓の参加者ではありません', 403);
        $seat = (int)$seat;

        if ($type === 'discard') {
            if ($tile === null) throw new ApiException('bad_request', 'tile が必要', 400);
            $r = MahjongEngine::discard($state, $seat, $tile);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            if (!$state['naki_chances']) {
                // 鳴き候補無し → 即 turn 進める
                $advanced = MahjongEngine::advanceTurn($state) ?? null;
                // advanceTurn を呼べる helper として 別 PHP 関数化
                mahjong_advance_after_discard($state);
            }
            $result = ['ok' => true];
        } else if ($type === 'pass') {
            $r = MahjongEngine::nakiPass($state, $seat);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            if (!empty($r['advanced']) && empty($r['in_play'])) {
                // 流局
                MahjongEngine::ryukyokuPayout($state);
            }
            $result = ['ok' => true];
        } else if ($type === 'pon') {
            $r = MahjongEngine::declareNaki($state, $seat, 'pon', ['tile' => $tile]);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else if ($type === 'chi') {
            $with = $body['with'] ?? null;
            if (!is_array($with) || count($with) !== 2) throw new ApiException('bad_request', 'with [t1,t2] 必須', 400);
            $r = MahjongEngine::declareNaki($state, $seat, 'chi', ['with' => array_map('intval', $with)]);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else if ($type === 'minkan') {
            $r = MahjongEngine::declareNaki($state, $seat, 'minkan', ['tile' => $tile]);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else if ($type === 'ankan') {
            if ($tile === null) throw new ApiException('bad_request', 'tile が必要', 400);
            $r = MahjongEngine::declareAnkan($state, $seat, $tile);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else if ($type === 'kakan') {
            if ($tile === null) throw new ApiException('bad_request', 'tile が必要', 400);
            $r = MahjongEngine::declareKakan($state, $seat, $tile);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else if ($type === 'tsumo') {
            $r = MahjongEngine::tryTsumo($state, $seat);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $isOya = ($seat === $state['oya']);
            $score = MahjongEngine::calcScore($r['yaku'], $isOya, true, (int)$state['honba']);
            mahjong_apply_win($state, $seat, null, $score, $r['yaku'], true);
            $result = ['ok' => true, 'yaku' => $r['yaku'], 'score' => $score];
        } else if ($type === 'ron') {
            $r = MahjongEngine::tryRon($state, $seat);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $isOya = ($seat === $state['oya']);
            $score = MahjongEngine::calcScore($r['yaku'], $isOya, false, (int)$state['honba']);
            mahjong_apply_win($state, $seat, $r['from'], $score, $r['yaku'], false);
            $result = ['ok' => true, 'yaku' => $r['yaku'], 'score' => $score];
        } else if ($type === 'riichi') {
            $r = MahjongEngine::declareRiichi($state, $seat);
            if (!$r['ok']) throw new ApiException('bad_request', $r['msg'], 400);
            $result = ['ok' => true];
        } else {
            throw new ApiException('bad_request', '不明な type', 400);
        }
        // 終局判定 / 局更新
        mahjong_maybe_advance_round($pdo, $state, $g);
        $pdo->prepare("UPDATE mahjong_games SET state_json = ?, state_ver = state_ver + 1, status = ? WHERE id = ?")
            ->execute([json_encode($state, JSON_UNESCAPED_UNICODE), $state['phase'] === 'finished_all' ? 'finished' : 'playing', $gid]);
        if ($state['phase'] === 'finished_all') {
            mahjong_finalize_payout($pdo, (int)$g['id'], $state, (int)$g['buy_in'], (int)$g['rake_pct']);
        }
    });
    json_response($result ?: ['ok' => true]);
}

// 打牌後、 鳴き候補が無い場合に turn を進める helper
function mahjong_advance_after_discard(array &$state): void {
    if ($state['awaiting'] !== 'ron_chance') return;
    $discarder = $state['last_discarded']['by'] ?? null;
    if ($discarder === null) return;
    $next = ($discarder + 1) % MahjongEngine::SEATS;
    $state['turn'] = $next;
    $state['last_discarded'] = null;
    $ok = MahjongEngine::drawForTurn($state);
    if (!$ok) {
        // 山切れ → 流局
        MahjongEngine::ryukyokuPayout($state);
    }
}

// 和了適用: 点数移動 + 局終了マーク
function mahjong_apply_win(array &$state, int $winnerIdx, ?int $loserIdx, array $score, array $yaku, bool $isTsumo): void {
    $state['log'][] = ['type' => $isTsumo ? 'tsumo' : 'ron', 'by' => $winnerIdx, 'yaku' => $yaku, 'score' => $score];
    $state['game_winners'][] = ['by' => $winnerIdx, 'yaku' => $yaku, 'score' => $score, 'tsumo' => $isTsumo, 'round_index' => $state['round_index']];
    if ($isTsumo) {
        if ($winnerIdx === $state['oya']) {
            $each = (int)$score['from_all'];
            foreach ($state['players'] as $i => &$p) {
                if ($i !== $winnerIdx) { $p['score'] -= $each; $state['players'][$winnerIdx]['score'] += $each; }
            }
            unset($p);
        } else {
            $oneOther = (int)$score['from_others'];
            $fromOya  = (int)$score['from_oya'];
            foreach ($state['players'] as $i => &$p) {
                if ($i === $winnerIdx) continue;
                $pay = ($i === $state['oya']) ? $fromOya : $oneOther;
                $p['score'] -= $pay;
                $state['players'][$winnerIdx]['score'] += $pay;
            }
            unset($p);
        }
    } else {
        $pay = (int)$score['from_loser'];
        $state['players'][$loserIdx]['score'] -= $pay;
        $state['players'][$winnerIdx]['score'] += $pay;
    }
    // リーチ棒を 和了者へ
    $state['players'][$winnerIdx]['score'] += $state['riichi_pot'];
    $state['riichi_pot'] = 0;
    $state['phase'] = 'kyoku_end';
    $state['last_winner'] = $winnerIdx;
}

// 局終了後に次局へ進める or 終了
//   v555: 連荘 + 半荘 (東1-4 + 南1-4 = round_index 0..7) 対応
//   親和了 or 流局時テンパイ親 → 親継続 (honba+1)。 それ以外 → oya 進行 + round_index++
function mahjong_maybe_advance_round(?PDO $pdo, array &$state, array $g): void {
    if ($state['phase'] !== 'kyoku_end') return;
    $oyaContinue = false;
    if (isset($state['last_winner']) && $state['last_winner'] === $state['oya']) $oyaContinue = true;
    if (!isset($state['last_winner']) && !empty($state['ryukyoku_tenpai_oya'])) $oyaContinue = true;
    if ($oyaContinue) {
        $state['honba']++;
    } else {
        $state['round_index']++;
        $state['oya'] = $state['round_index'] % MahjongEngine::SEATS;
        $state['honba'] = 0;
    }
    // 半荘終了判定
    if ($state['round_index'] >= 8) {
        $state['phase'] = 'finished_all';
        return;
    }
    // 場風: 東 0..3 → 南 4..7
    $newRoundWind = $state['round_index'] >= 4 ? MahjongEngine::T_S : MahjongEngine::T_E;
    $playerUids = array_map(fn($p) => $p['user_id'], $state['players']);
    $carry = array_map(fn($p) => $p['score'], $state['players']);
    $newSt = MahjongEngine::newGame($playerUids, $carry, $state['oya'], $newRoundWind, $state['round_index'], $state['honba'], $state['riichi_pot']);
    $newSt['game_winners'] = $state['game_winners'];
    MahjongEngine::drawForTurn($newSt);
    $state = $newSt;
}

// 終局: 最終スコアで rank を決定 → pot 分配 (buy_in × 4 - 場代)
function mahjong_finalize_payout(PDO $pdo, int $gid, array $state, int $buyIn, int $rakePct): void {
    // 最終 score 順位
    $scores = [];
    foreach ($state['players'] as $i => $p) {
        $scores[] = ['user_id' => (int)$p['user_id'], 'score' => (int)$p['score'], 'idx' => $i];
    }
    usort($scores, fn($a, $b) => $b['score'] - $a['score']);
    $pot = $buyIn * MAHJONG_SEATS;
    $rake = (int)floor($pot * $rakePct / 100);
    $payouts = [];
    $alloc = 0;
    foreach ([2,3,4] as $rank) {
        $share = (int)floor($pot * MAHJONG_RANK_PCT[$rank] / 100);
        $payouts[$rank] = $share; $alloc += $share;
    }
    $payouts[1] = $pot - $rake - $alloc;
    foreach ($scores as $rankIdx => $row) {
        $rank = $rankIdx + 1;
        $pay = $payouts[$rank];
        if ($pay > 0) {
            Ledger::transfer($pdo, 1, (int)$row['user_id'], $pay, 'mahjong_payout', 'mahjong', $gid, "麻雀卓 #{$gid} {$rank}位 (P2)");
        }
        $pdo->prepare("UPDATE mahjong_players SET result_rank = ?, payout = ? WHERE game_id = ? AND user_id = ?")
            ->execute([$rank, $pay, $gid, (int)$row['user_id']]);
    }
    $pdo->prepare("UPDATE mahjong_games SET finished_at = NOW() WHERE id = ?")->execute([$gid]);
}

function mahjong_report(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $ranks = $body['ranks'] ?? null;
    if (!is_array($ranks)) throw new ApiException('bad_request', 'ranks 必須', 400);
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid, $ranks) {
        $g = mahjong_lock_game($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ報告可', 403);
        if (!in_array($g['status'], ['playing','reporting'], true)) throw new ApiException('bad_request', '報告できる状態ではありません', 400);
        $stP = $pdo->prepare("SELECT user_id FROM mahjong_players WHERE game_id = ?");
        $stP->execute([$gid]);
        $players = array_map('intval', $stP->fetchAll(PDO::FETCH_COLUMN));
        if (count($players) !== MAHJONG_SEATS) throw new ApiException('bad_request', '4人未満です', 400);

        // ranks の検証: 全プレイヤー 1〜4 の rank に正しく割り当てられているか
        $cleaned = [];
        foreach ($ranks as $k => $v) {
            $cleaned[(int)$k] = (int)$v;
        }
        $seenRanks = [];
        foreach ($players as $pid) {
            if (!isset($cleaned[$pid]) || $cleaned[$pid] < 1 || $cleaned[$pid] > 4) {
                throw new ApiException('bad_request', "user $pid の順位が不正", 400);
            }
            if (isset($seenRanks[$cleaned[$pid]])) {
                throw new ApiException('bad_request', "順位 {$cleaned[$pid]} が重複しています", 400);
            }
            $seenRanks[$cleaned[$pid]] = $pid;
        }
        if (count($seenRanks) !== 4) throw new ApiException('bad_request', '1〜4 位 全部割り当ててください', 400);

        $pot = (int)$g['pot_total'];
        $rakePct = (int)$g['rake_pct'];
        $rake = (int)floor($pot * $rakePct / 100);
        // 場代をシステムへ
        if ($rake > 0) Ledger::transfer($pdo, 1, 1, 0, 'mahjong_rake', 'mahjong', $gid, '麻雀 場代 ' . $rake . 'pt 徴収'); // (1→1 は no-op、 実質 pot だけ残す)
        // 配分計算 (端数は 1位に上乗せ)
        $payouts = [];
        $allocated = 0;
        foreach ([2, 3, 4] as $rank) {
            $share = (int)floor($pot * MAHJONG_RANK_PCT[$rank] / 100);
            $payouts[$rank] = $share;
            $allocated += $share;
        }
        $payouts[1] = $pot - $rake - $allocated; // 端数込みで 1位
        // Ledger: 各位に payout 送金 (system → user)
        foreach ($players as $pid) {
            $rank = $cleaned[$pid];
            $pay = $payouts[$rank];
            if ($pay > 0) {
                Ledger::transfer($pdo, 1, $pid, $pay, 'mahjong_payout', 'mahjong', $gid, "麻雀卓 #{$gid} {$rank}位 payout");
            }
            $pdo->prepare("UPDATE mahjong_players SET result_rank = ?, payout = ? WHERE game_id = ? AND user_id = ?")
                ->execute([$rank, $pay, $gid, $pid]);
        }
        $pdo->prepare("UPDATE mahjong_games SET status='finished', finished_at=NOW() WHERE id = ?")->execute([$gid]);
        // 全参加者に通知
        $stUN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN (" . implode(',', array_fill(0, count($players), '?')) . ")");
        $stUN->execute($players);
        $names = [];
        foreach ($stUN->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];
        foreach ($players as $pid) {
            $rank = $cleaned[$pid];
            $pay = $payouts[$rank];
            $diff = $pay - (int)$g['buy_in'];
            $diffStr = $diff >= 0 ? '+' . $diff : (string)$diff;
            try {
                notify_safely($pdo, $cfg, $pid, 'admin_notice',
                    "🀄 麻雀卓 #{$gid} 終了 — あなたは {$rank} 位 / payout {$pay} pt ({$diffStr} pt)",
                    'mahjong', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function mahjong_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = mahjong_lock_game($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['lobby','playing','reporting'], true)) throw new ApiException('bad_request', '既に終了しています', 400);
        // 全員に buy_in 返金
        $stP = $pdo->prepare("SELECT user_id FROM mahjong_players WHERE game_id = ?");
        $stP->execute([$gid]);
        $buyIn = (int)$g['buy_in'];
        foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
            Ledger::transfer($pdo, 1, (int)$pid, $buyIn, 'mahjong_refund', 'mahjong', $gid, "麻雀卓 #{$gid} キャンセル返金");
        }
        $pdo->prepare("UPDATE mahjong_games SET status='cancelled', finished_at=NOW(), pot_total=0 WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

// --- helpers ---
function mahjong_lock_game(PDO $pdo, int $gid): array {
    $st = $pdo->prepare("SELECT * FROM mahjong_games WHERE id = ? FOR UPDATE");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    return $g;
}
function mahjong_assert_balance(PDO $pdo, int $uid, int $need): void {
    $st = $pdo->prepare("SELECT balance FROM users WHERE id = ?");
    $st->execute([$uid]);
    $bal = (int)$st->fetchColumn();
    if ($bal < $need) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %d、 現在 %d)', $need, $bal), 400);
    }
}
function mahjong_insert_player(PDO $pdo, int $gid, int $uid, int $seat): void {
    $pdo->prepare("INSERT INTO mahjong_players (game_id, user_id, seat_order) VALUES (?,?,?)")->execute([$gid, $uid, $seat]);
}
function mahjong_deposit(PDO $pdo, int $gid, int $uid, int $amount): void {
    Ledger::transfer($pdo, $uid, 1, $amount, 'mahjong_buyin', 'mahjong', $gid, '麻雀卓 #' . $gid . ' buy-in');
    $pdo->prepare("UPDATE mahjong_games SET pot_total = pot_total + ? WHERE id = ?")->execute([$amount, $gid]);
}
