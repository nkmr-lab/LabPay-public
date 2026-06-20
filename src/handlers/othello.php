<?php
// v587 地雷オセロ。 2 人対戦、 各自 2 地雷を 設定 → 踏むと 周囲 3x3 反転。
//   GET    /api/othello/games            一覧 (waiting / playing / 最近 finished)
//   POST   /api/othello/games            新規卓 (1pt 預託)
//   POST   /api/othello/games/:id/join   参加 (1pt 預託)
//   POST   /api/othello/games/:id/mines  地雷 設定 ({cells: ['33','44']})
//   POST   /api/othello/games/:id/move   { row, col } 手を打つ
//   POST   /api/othello/games/:id/pass   パス (置く所がない時)
//   GET    /api/othello/games/:id        state 取得 (poll)
//   POST   /api/othello/games/:id/cancel ロビーキャンセル

declare(strict_types=1);

const OTHELLO_FEE = 2;

function route_othello(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET') { othello_list($pdo, $uid); return; }
        if ($method === 'POST') { othello_create($pdo, $uid); return; }
    }
    // v625 AI 対戦
    if ($seg[1] === 'ai' && ($seg[2] ?? '') === 'new' && $method === 'POST') {
        othello_ai_new($pdo, $uid); return;
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')    { othello_state($pdo, $uid, $gid); return; }
        if ($action === 'join'   && $method === 'POST') { othello_join($pdo, $uid, $gid); return; }
        if ($action === 'mines'  && $method === 'POST') { othello_set_mines($pdo, $uid, $gid); return; }
        if ($action === 'move'   && $method === 'POST') { othello_move($pdo, $uid, $gid); return; }
        if ($action === 'pass'   && $method === 'POST') { othello_pass($pdo, $uid, $gid); return; }
        if ($action === 'cancel' && $method === 'POST') { othello_cancel($pdo, $uid, $gid); return; }
        if ($action === 'resign' && $method === 'POST') { othello_resign($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no othello route", 404);
}

function othello_initial_board(): array {
    $b = array_fill(0, 64, 0);
    // 中央 4 マスに 初期配置 (黒: 3,4 と 4,3; 白: 3,3 と 4,4)
    $idx = fn($r, $c) => $r * 8 + $c;
    $b[$idx(3, 4)] = 1; $b[$idx(4, 3)] = 1;
    $b[$idx(3, 3)] = 2; $b[$idx(4, 4)] = 2;
    return $b;
}

function othello_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT g.id, g.creator_user_id, uc.display_name AS creator_name,
                                g.opponent_user_id, uo.display_name AS opponent_name,
                                g.status, g.turn_side, g.winner, g.created_at, g.finished_at,
                                (g.creator_user_id = ? OR g.opponent_user_id = ?) AS me_in
                           FROM othello_games g
                           JOIN users uc ON uc.id = g.creator_user_id
                           LEFT JOIN users uo ON uo.id = g.opponent_user_id
                          WHERE g.status IN ('waiting','mine_setup','playing')
                             OR (g.status IN ('finished','cancelled') AND g.finished_at > DATE_SUB(NOW(), INTERVAL 1 DAY))
                          ORDER BY g.id DESC LIMIT 30");
    $st->execute([$uid, $uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['opponent_user_id'] = $r['opponent_user_id'] ? (int)$r['opponent_user_id'] : null;
        $r['me_in'] = (bool)$r['me_in'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function othello_create(PDO $pdo, int $uid): void {
    // v632 対象者指定 → 即起動: body.opponent_uid が 渡れば その人を 即着席させて mine_setup に
    $body = read_json_body();
    $oppUid = isset($body['opponent_uid']) ? (int)$body['opponent_uid'] : 0;
    $gid = 0;
    $oppName = '';
    db_tx($pdo, function () use ($pdo, $uid, $oppUid, &$gid, &$oppName) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < OTHELLO_FEE) throw new ApiException('insufficient_balance', "ポイント不足 (要 " . OTHELLO_FEE . " pt)", 400);
        if ($oppUid) {
            if ($oppUid === $uid) throw new ApiException('bad_request', '自分は 指定不可', 400);
            $stU = $pdo->prepare("SELECT display_name FROM users WHERE id=? AND kind='human'");
            $stU->execute([$oppUid]);
            $oppName = (string)($stU->fetchColumn() ?: '');
            if (!$oppName) throw new ApiException('bad_request', '無効な相手', 400);
            if (Ledger::balanceOfUser($pdo, $oppUid) < OTHELLO_FEE) {
                throw new ApiException('insufficient_balance', "{$oppName} さんの ポイント不足で 開始不可", 400);
            }
        }
        $board = othello_initial_board();
        $status = $oppUid ? 'mine_setup' : 'waiting';
        $pdo->prepare("INSERT INTO othello_games (creator_user_id, opponent_user_id, status, fee, board_json) VALUES (?,?,?,?,?)")
            ->execute([$uid, $oppUid ?: null, $status, OTHELLO_FEE, json_encode($board)]);
        $gid = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, OTHELLO_FEE, 'othello_buyin', 'othello', $gid, "地雷オセロ #{$gid} buy-in (creator)");
        $pdo->prepare("UPDATE othello_games SET pot_total = pot_total + ? WHERE id = ?")
            ->execute([OTHELLO_FEE, $gid]);
        if ($oppUid) {
            Ledger::transfer($pdo, $oppUid, 1, OTHELLO_FEE, 'othello_buyin', 'othello', $gid, "地雷オセロ #{$gid} buy-in (招待相手)");
            $pdo->prepare("UPDATE othello_games SET pot_total = pot_total + ? WHERE id = ?")
                ->execute([OTHELLO_FEE, $gid]);
        }
    });
    if ($oppUid && $gid) {
        try {
            global $CFG;
            $stN = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
            $stN->execute([$uid]); $by = (string)$stN->fetchColumn();
            notify_safely($pdo, $CFG, $oppUid, 'admin_notice',
                "💣 {$by} さん から 地雷オセロ #{$gid} に 招待 されました (地雷 配置 へ)",
                'othello', $gid);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $gid]);
}

function othello_join(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', 'already started', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '自分の卓には 参加できません', 400);
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < OTHELLO_FEE) throw new ApiException('insufficient_balance', "ポイント不足 (要 " . OTHELLO_FEE . " pt)", 400);
        $pdo->prepare("UPDATE othello_games SET opponent_user_id = ?, status = 'mine_setup' WHERE id = ?")
            ->execute([$uid, $gid]);
        Ledger::transfer($pdo, $uid, 1, OTHELLO_FEE, 'othello_buyin', 'othello', $gid, "地雷オセロ #{$gid} buy-in (opp)");
        $pdo->prepare("UPDATE othello_games SET pot_total = pot_total + ? WHERE id = ?")
            ->execute([OTHELLO_FEE, $gid]);
    });
    json_response(['ok' => true]);
}

function othello_set_mines(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $cells = $body['cells'] ?? [];
    // v608 地雷は 1 個に (2 個だと盤面が地雷だらけになる)
    if (!is_array($cells) || count($cells) !== 1) throw new ApiException('bad_request', '地雷は 1 か所', 400);
    $clean = [];
    foreach ($cells as $c) {
        if (!is_string($c) || !preg_match('/^[0-7][0-7]$/', $c)) throw new ApiException('bad_request', '位置形式 不正 (rrcc, 0-7)', 400);
        // 初期 4 マス (33,34,43,44) は ダメ
        if (in_array($c, ['33','34','43','44'], true)) throw new ApiException('bad_request', '初期4マスには 設置できません', 400);
        $clean[] = $c;
    }
    db_tx($pdo, function () use ($pdo, $uid, $gid, $clean) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'mine_setup') throw new ApiException('bad_request', 'now is not setup phase', 400);
        $side = (int)$g['creator_user_id'] === $uid ? 'creator' : ((int)$g['opponent_user_id'] === $uid ? 'opponent' : null);
        if ($side === null) throw new ApiException('forbidden', 'not in this game', 403);
        $mines = json_decode($g['mines_json'] ?: '{}', true) ?: [];
        if (isset($mines[$side])) throw new ApiException('bad_request', '既に設定済', 400);
        $mines[$side] = $clean;
        $bothDone = isset($mines['creator']) && isset($mines['opponent']);
        $newStatus = $bothDone ? 'playing' : 'mine_setup';
        if ($bothDone) {
            // v665 先手 を ランダム に (= creator / opponent の どちら か)
            $firstSide = (random_int(0, 1) === 0) ? 'creator' : 'opponent';
            $pdo->prepare("UPDATE othello_games SET mines_json = ?, status = ?, turn_side = ? WHERE id = ?")
                ->execute([json_encode($mines), $newStatus, $firstSide, $gid]);
        } else {
            $pdo->prepare("UPDATE othello_games SET mines_json = ?, status = ? WHERE id = ?")
                ->execute([json_encode($mines), $newStatus, $gid]);
        }
    });
    // v625 AI 戦で 開始直後 AI 番なら 進める (通常は creator 始まりなので no-op)
    othello_ai_drive($pdo, $gid);
    json_response(['ok' => true]);
}

// 方向ベクトル (8 方向)
function othello_dirs(): array {
    return [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
}

// 指定位置 に 指定色を 置いて 反転可能 か & 反転する セル群 を 返す
function othello_flips(array $board, int $row, int $col, int $color): array {
    if ($board[$row * 8 + $col] !== 0) return [];
    $opp = $color === 1 ? 2 : 1;
    $allFlips = [];
    foreach (othello_dirs() as [$dr, $dc]) {
        $r = $row + $dr; $c = $col + $dc;
        $line = [];
        while ($r >= 0 && $r < 8 && $c >= 0 && $c < 8 && $board[$r * 8 + $c] === $opp) {
            $line[] = [$r, $c];
            $r += $dr; $c += $dc;
        }
        if ($line && $r >= 0 && $r < 8 && $c >= 0 && $c < 8 && $board[$r * 8 + $c] === $color) {
            $allFlips = array_merge($allFlips, $line);
        }
    }
    return $allFlips;
}

function othello_has_move(array $board, int $color): bool {
    for ($r = 0; $r < 8; $r++) {
        for ($c = 0; $c < 8; $c++) {
            if (othello_flips($board, $r, $c, $color)) return true;
        }
    }
    return false;
}

// 周囲 3x3 (中心 +8 マス) を 反転
function othello_explode_mine(array &$board, int $row, int $col): array {
    $flipped = [];
    for ($dr = -1; $dr <= 1; $dr++) {
        for ($dc = -1; $dc <= 1; $dc++) {
            $r = $row + $dr; $c = $col + $dc;
            if ($r < 0 || $r >= 8 || $c < 0 || $c >= 8) continue;
            $idx = $r * 8 + $c;
            if ($board[$idx] === 1) { $board[$idx] = 2; $flipped[] = "{$r}{$c}"; }
            else if ($board[$idx] === 2) { $board[$idx] = 1; $flipped[] = "{$r}{$c}"; }
        }
    }
    return $flipped;
}

function othello_move(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $row = (int)($body['row'] ?? -1);
    $col = (int)($body['col'] ?? -1);
    if ($row < 0 || $row > 7 || $col < 0 || $col > 7) throw new ApiException('bad_request', '位置不正', 400);
    db_tx($pdo, function () use ($pdo, $uid, $gid, $row, $col) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        $side = (int)$g['creator_user_id'] === $uid ? 'creator' : ((int)$g['opponent_user_id'] === $uid ? 'opponent' : null);
        if ($side === null) throw new ApiException('forbidden', 'not in game', 403);
        if ($g['turn_side'] !== $side) throw new ApiException('bad_request', 'not your turn', 400);
        $color = $side === 'creator' ? 1 : 2;
        $board = json_decode($g['board_json'], true);
        $flips = othello_flips($board, $row, $col, $color);
        if (!$flips) throw new ApiException('bad_request', 'ここには 置けません (相手の石を 挟めない)', 400);

        // 通常着手
        $board[$row * 8 + $col] = $color;
        foreach ($flips as [$fr, $fc]) {
            $board[$fr * 8 + $fc] = $color;
        }
        // 地雷判定 (相手の地雷を 自分が踏むパターンを 確認)
        $mines = json_decode($g['mines_json'] ?: '{}', true) ?: [];
        $triggered = json_decode($g['triggered_mines_json'] ?: '[]', true) ?: [];
        $cellKey = "{$row}{$col}";
        $oppSide = $side === 'creator' ? 'opponent' : 'creator';
        // 自分の地雷を 自分で 踏むのも 起動 (= 自爆)
        foreach (['creator','opponent'] as $owner) {
            $list = $mines[$owner] ?? [];
            if (in_array($cellKey, $list, true) && !in_array($cellKey, array_column($triggered, 'cell'), true)) {
                $explodedFlips = othello_explode_mine($board, $row, $col);
                $triggered[] = ['cell' => $cellKey, 'owner' => $owner, 'flipped' => $explodedFlips];
            }
        }

        // ターン 進行 + 終局判定
        $nextSide = $oppSide;
        $nextColor = $nextSide === 'creator' ? 1 : 2;
        $myColor = $color;
        $finished = false;
        $winner = null;
        if (!othello_has_move($board, $nextColor)) {
            // 相手 パス → 自分の番 を継続
            if (othello_has_move($board, $myColor)) {
                $nextSide = $side; // 自分の番 維持 (パス した側は 後で UI から pass)
            } else {
                $finished = true;
            }
        }
        if ($finished) {
            $cBlack = 0; $cWhite = 0;
            foreach ($board as $v) { if ($v === 1) $cBlack++; else if ($v === 2) $cWhite++; }
            if ($cBlack > $cWhite) $winner = 'creator';
            else if ($cWhite > $cBlack) $winner = 'opponent';
            else $winner = 'draw';
            // v612 プレイフィーのみ (= 勝者はポイントもらわない、 pot は システム取り)。
            //   ※ 引分のみ 双方に 半額返金する のもなくす予定だが、 ユーザの 心情考慮で 引分は 全額返金 にしておく。
            //   v625: AI 戦は 払戻なし (= bot に 1pt 入っても 意味ない)。
            if ($winner === 'draw' && !(int)$g['is_ai']) {
                $pot = (int)$g['pot_total'];
                $each = intdiv($pot, 2);
                Ledger::transfer($pdo, 1, (int)$g['creator_user_id'], $each, 'othello_refund', 'othello', $gid, "オセロ 引分 返金");
                Ledger::transfer($pdo, 1, (int)$g['opponent_user_id'], $each, 'othello_refund', 'othello', $gid, "オセロ 引分 返金");
            }
            $pdo->prepare("UPDATE othello_games SET board_json=?, mines_json=?, triggered_mines_json=?, status='finished', winner=?, finished_at=NOW() WHERE id=?")
                ->execute([json_encode($board), json_encode($mines), json_encode($triggered), $winner, $gid]);
        } else {
            $pdo->prepare("UPDATE othello_games SET board_json=?, mines_json=?, triggered_mines_json=?, turn_side=? WHERE id=?")
                ->execute([json_encode($board), json_encode($mines), json_encode($triggered), $nextSide, $gid]);
        }
    });
    othello_ai_drive($pdo, $gid);
    json_response(['ok' => true]);
}

function othello_pass(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        $side = (int)$g['creator_user_id'] === $uid ? 'creator' : ((int)$g['opponent_user_id'] === $uid ? 'opponent' : null);
        if ($side === null) throw new ApiException('forbidden', 'not in game', 403);
        if ($g['turn_side'] !== $side) throw new ApiException('bad_request', 'not your turn', 400);
        $color = $side === 'creator' ? 1 : 2;
        $board = json_decode($g['board_json'], true);
        if (othello_has_move($board, $color)) throw new ApiException('bad_request', '置けるマスがある場合は パス できません', 400);
        // 両者パス → 終局
        $oppSide = $side === 'creator' ? 'opponent' : 'creator';
        $oppColor = $color === 1 ? 2 : 1;
        if (!othello_has_move($board, $oppColor)) {
            // 終局 (両者パス)
            $cBlack = 0; $cWhite = 0;
            foreach ($board as $v) { if ($v === 1) $cBlack++; else if ($v === 2) $cWhite++; }
            $winner = $cBlack > $cWhite ? 'creator' : ($cWhite > $cBlack ? 'opponent' : 'draw');
            // v612 プレイフィーのみ (勝者は ポイント もらわず、 引分のみ 双方に 返金)。 v625: AI 戦は 払戻なし。
            if ($winner === 'draw' && !(int)$g['is_ai']) {
                $pot = (int)$g['pot_total'];
                $each = intdiv($pot, 2);
                Ledger::transfer($pdo, 1, (int)$g['creator_user_id'], $each, 'othello_refund', 'othello', $gid, "オセロ 引分 返金");
                Ledger::transfer($pdo, 1, (int)$g['opponent_user_id'], $each, 'othello_refund', 'othello', $gid, "オセロ 引分 返金");
            }
            $pdo->prepare("UPDATE othello_games SET status='finished', winner=?, finished_at=NOW() WHERE id=?")
                ->execute([$winner, $gid]);
        } else {
            $pdo->prepare("UPDATE othello_games SET turn_side=? WHERE id=?")->execute([$oppSide, $gid]);
        }
    });
    othello_ai_drive($pdo, $gid);
    json_response(['ok' => true]);
}

function othello_resign(PDO $pdo, int $uid, int $gid): void {
    // v637 投了。 ポイント 返却なし。 相手が 勝者。
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if (!in_array($g['status'], ['mine_setup', 'playing'], true)) throw new ApiException('bad_request', '既に終了', 400);
        $side = (int)$g['creator_user_id'] === $uid ? 'creator'
              : ((int)$g['opponent_user_id'] === $uid ? 'opponent' : null);
        if (!$side) throw new ApiException('forbidden', '参加者ではない', 403);
        $winner = $side === 'creator' ? 'opponent' : 'creator';
        $pdo->prepare("UPDATE othello_games SET status='finished', winner=?, finished_at=NOW() WHERE id=?")
            ->execute([$winner, $gid]);
    });
    json_response(['ok' => true]);
}

function othello_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM othello_games WHERE id = ? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'waiting') throw new ApiException('bad_request', '対戦開始後は キャンセル不可', 400);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        Ledger::transfer($pdo, 1, $uid, OTHELLO_FEE, 'othello_refund', 'othello', $gid, "オセロ キャンセル 返金");
        $pdo->prepare("UPDATE othello_games SET status='cancelled', finished_at=NOW() WHERE id=?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function othello_state(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
                                uo.display_name AS opponent_name, uo.avatar_url AS opponent_avatar
                           FROM othello_games g
                           JOIN users uc ON uc.id = g.creator_user_id
                           LEFT JOIN users uo ON uo.id = g.opponent_user_id
                          WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);
    $board = json_decode($g['board_json'], true);
    $mines = json_decode($g['mines_json'] ?: '{}', true) ?: [];
    $triggered = json_decode($g['triggered_mines_json'] ?: '[]', true) ?: [];
    $side = (int)$g['creator_user_id'] === $uid ? 'creator' : ((int)$g['opponent_user_id'] === $uid ? 'opponent' : null);
    // 自分の 地雷だけ 見える / 終了後は 両方 見える
    $myMines = $side ? ($mines[$side] ?? null) : null;
    $oppMinesVisible = $g['status'] === 'finished' ? ($mines[$side === 'creator' ? 'opponent' : 'creator'] ?? []) : null;
    // 合法手 (= 置けるマス) を 出す (自分の番 のときだけ)
    $legalMoves = [];
    if ($g['status'] === 'playing' && $side && $g['turn_side'] === $side) {
        $color = $side === 'creator' ? 1 : 2;
        for ($r = 0; $r < 8; $r++) {
            for ($c = 0; $c < 8; $c++) {
                if (othello_flips($board, $r, $c, $color)) $legalMoves[] = "{$r}{$c}";
            }
        }
    }
    $cBlack = 0; $cWhite = 0;
    foreach ($board as $v) { if ($v === 1) $cBlack++; else if ($v === 2) $cWhite++; }
    $mySetup = $side && isset($mines[$side]);
    json_response([
        'id' => (int)$g['id'],
        'status' => $g['status'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name' => $g['creator_name'],
        'creator_avatar' => $g['creator_avatar'],
        'opponent_user_id' => $g['opponent_user_id'] ? (int)$g['opponent_user_id'] : null,
        'opponent_name' => $g['opponent_name'],
        'opponent_avatar' => $g['opponent_avatar'],
        'board' => $board,
        'turn_side' => $g['turn_side'],
        'fee' => (int)$g['fee'],
        'pot_total' => (int)$g['pot_total'],
        'is_ai' => (bool)($g['is_ai'] ?? 0),
        'me_side' => $side,
        'my_mines' => $myMines,
        'opp_mines_visible' => $oppMinesVisible,
        'triggered_mines' => $triggered,
        'legal_moves' => $legalMoves,
        'count_black' => $cBlack,
        'count_white' => $cWhite,
        'winner' => $g['winner'],
        'i_setup_mines' => $mySetup,
        'finished_at' => $g['finished_at'],
        'created_at' => $g['created_at'],
    ]);
}

// ─── v625 AI 対戦 ──────────────────────────────────────
function othello_ai_new(PDO $pdo, int $uid): void {
    // v626 専用 bot を 優先 (麻雀の 東家 と 名前 が 混ざらない ように)。
    $stB = $pdo->prepare("SELECT id FROM users WHERE email=? AND kind='bot'");
    $stB->execute(['ai-othello@labpay.local']);
    $botUid = (int)($stB->fetchColumn() ?: 0);
    if (!$botUid) {
        $botUid = (int)$pdo->query("SELECT id FROM users WHERE kind='bot' AND email LIKE 'ai-%@labpay.local' ORDER BY id LIMIT 1")
            ->fetchColumn();
    }
    if (!$botUid) throw new ApiException('not_configured', 'AI bot users 未設定', 500);
    $gid = 0;
    db_tx($pdo, function () use ($pdo, $uid, $botUid, &$gid) {
        if (Ledger::balanceOfUser($pdo, $uid) < OTHELLO_FEE) {
            throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %dpt)', OTHELLO_FEE), 400);
        }
        $board = othello_initial_board();
        // AI 側 地雷を 即配置 (内側 4x4 から、 初期駒を 避ける)
        $mines = ['opponent' => [othello_ai_pick_mine()]];
        $pdo->prepare("INSERT INTO othello_games (creator_user_id, opponent_user_id, is_ai, status, fee, board_json, mines_json)
                       VALUES (?,?,1,'mine_setup',?,?,?)")
            ->execute([$uid, $botUid, OTHELLO_FEE, json_encode($board), json_encode($mines)]);
        $gid = (int)$pdo->lastInsertId();
        // user のみ プレイフィー (AI は無料)
        Ledger::transfer($pdo, $uid, 1, OTHELLO_FEE, 'othello_buyin', 'othello', $gid, "地雷オセロ #{$gid} AI プレイフィー");
        $pdo->prepare("UPDATE othello_games SET pot_total = pot_total + ? WHERE id=?")->execute([OTHELLO_FEE, $gid]);
    });
    json_response(['ok' => true, 'id' => $gid]);
}

function othello_ai_pick_mine(): string {
    // 内側 4x4 のうち 中央 4 マス (初期駒) を 除いた 12 マスから ランダム選択。
    $cands = [];
    for ($r = 2; $r <= 5; $r++) {
        for ($c = 2; $c <= 5; $c++) {
            if (($r === 3 || $r === 4) && ($c === 3 || $c === 4)) continue;
            $cands[] = "{$r}{$c}";
        }
    }
    return $cands[array_rand($cands)];
}

// v699 #285 オセロ 標準 の positional weight matrix。 角 (corner) は +100、
//   X-square (角 の 斜め 隣) は -50、 C-square は -20、 中央 は ほぼ 0。
const OTHELLO_WEIGHTS = [
    100, -20,  10,   5,   5,  10, -20, 100,
    -20, -50,  -2,  -2,  -2,  -2, -50, -20,
     10,  -2,  -1,  -1,  -1,  -1,  -2,  10,
      5,  -2,  -1,   0,   0,  -1,  -2,   5,
      5,  -2,  -1,   0,   0,  -1,  -2,   5,
     10,  -2,  -1,  -1,  -1,  -1,  -2,  10,
    -20, -50,  -2,  -2,  -2,  -2, -50, -20,
    100, -20,  10,   5,   5,  10, -20, 100,
];

// 全 候補手 を 列挙
function othello_legal_moves(array $board, int $side): array {
    $moves = [];
    for ($r = 0; $r < 8; $r++) {
        for ($c = 0; $c < 8; $c++) {
            $f = othello_flips($board, $r, $c, $side);
            if ($f) $moves[] = [$r, $c, $f];
        }
    }
    return $moves;
}

// 評価 関数: 位置 重み (own - opp) + mobility * 5。 終盤 (空き 8 以下) は 純粋 に 石 数 差。
function othello_eval_board(array $board, int $aiSide): int {
    $oppSide = $aiSide === 1 ? 2 : 1;
    $posScore = 0; $myCount = 0; $oppCount = 0; $empty = 0;
    foreach ($board as $idx => $cell) {
        if ($cell === $aiSide) { $posScore += OTHELLO_WEIGHTS[$idx]; $myCount++; }
        elseif ($cell === $oppSide) { $posScore -= OTHELLO_WEIGHTS[$idx]; $oppCount++; }
        else { $empty++; }
    }
    if ($empty <= 8) {
        // 終盤: 石 数 差 で 勝負
        return ($myCount - $oppCount) * 100;
    }
    // mobility (合法手 数 差)
    $myMob = count(othello_legal_moves($board, $aiSide));
    $oppMob = count(othello_legal_moves($board, $oppSide));
    return $posScore + ($myMob - $oppMob) * 6;
}

// alpha-beta minimax
function othello_minimax(array $board, int $depth, int $alpha, int $beta, bool $maxTurn, int $aiSide, int $oppSide): int {
    if ($depth === 0) return othello_eval_board($board, $aiSide);
    $side = $maxTurn ? $aiSide : $oppSide;
    $moves = othello_legal_moves($board, $side);
    if (!$moves) {
        // パス → 相手 も 打てない なら 終局
        $otherSide = $side === $aiSide ? $oppSide : $aiSide;
        if (!othello_legal_moves($board, $otherSide)) {
            return othello_eval_board($board, $aiSide);
        }
        return othello_minimax($board, $depth - 1, $alpha, $beta, !$maxTurn, $aiSide, $oppSide);
    }
    if ($maxTurn) {
        $value = PHP_INT_MIN;
        foreach ($moves as [$r, $c, $flips]) {
            $nb = $board;
            $nb[$r * 8 + $c] = $side;
            foreach ($flips as [$fr, $fc]) $nb[$fr * 8 + $fc] = $side;
            $v = othello_minimax($nb, $depth - 1, $alpha, $beta, false, $aiSide, $oppSide);
            if ($v > $value) $value = $v;
            if ($value >= $beta) break;
            if ($value > $alpha) $alpha = $value;
        }
        return $value;
    } else {
        $value = PHP_INT_MAX;
        foreach ($moves as [$r, $c, $flips]) {
            $nb = $board;
            $nb[$r * 8 + $c] = $side;
            foreach ($flips as [$fr, $fc]) $nb[$fr * 8 + $fc] = $side;
            $v = othello_minimax($nb, $depth - 1, $alpha, $beta, true, $aiSide, $oppSide);
            if ($v < $value) $value = $v;
            if ($value <= $alpha) break;
            if ($value < $beta) $beta = $value;
        }
        return $value;
    }
}

// AI の着手選択: minimax (深さ 3、 終盤 は 深さ 5 で 全 探索)
function othello_ai_choose_move(array $board): ?array {
    $aiSide = 2; $oppSide = 1;
    $moves = othello_legal_moves($board, $aiSide);
    if (!$moves) return null;
    $empty = count(array_filter($board, fn($v) => $v === 0));
    $depth = $empty <= 10 ? 6 : ($empty <= 18 ? 4 : 3);
    $bestScore = PHP_INT_MIN;
    $bestMoves = [];
    foreach ($moves as [$r, $c, $flips]) {
        $nb = $board;
        $nb[$r * 8 + $c] = $aiSide;
        foreach ($flips as [$fr, $fc]) $nb[$fr * 8 + $fc] = $aiSide;
        $score = othello_minimax($nb, $depth - 1, PHP_INT_MIN, PHP_INT_MAX, false, $aiSide, $oppSide);
        if ($score > $bestScore) { $bestScore = $score; $bestMoves = [[$r, $c]]; }
        elseif ($score === $bestScore) { $bestMoves[] = [$r, $c]; }
    }
    return $bestMoves[array_rand($bestMoves)];
}

// AI 番が続くかぎり 自動進行。 user の move/pass の 後で 呼ぶ。
// パスの 連続や 終局判定 を ここでまとめて 扱う。
// v627 「考えてる感」 のため 各 着手前に 2 秒スリープ。
function othello_ai_drive(PDO $pdo, int $gid): void {
    for ($i = 0; $i < 8; $i++) {
        // 先に 1 秒スリープ。 まず DB を 軽く見て AI 番でなければ 抜ける (= 無駄な待ちなし)。
        $peek = $pdo->prepare("SELECT is_ai, status, turn_side FROM othello_games WHERE id=?");
        $peek->execute([$gid]);
        $p = $peek->fetch(PDO::FETCH_ASSOC);
        if (!$p || !(int)$p['is_ai'] || $p['status'] !== 'playing' || $p['turn_side'] !== 'opponent') return;
        // v699 #285 「考えてる感」 アップ + 強化 minimax の 実時間 を 隠す ため
        //   3 秒 に 延長 (元 2 秒)
        usleep(3_000_000);
        $advanced = false;
        db_tx($pdo, function () use ($pdo, $gid, &$advanced) {
            $st = $pdo->prepare("SELECT * FROM othello_games WHERE id=? FOR UPDATE");
            $st->execute([$gid]);
            $g = $st->fetch(PDO::FETCH_ASSOC);
            if (!$g || !(int)$g['is_ai'] || $g['status'] !== 'playing' || $g['turn_side'] !== 'opponent') return;
            $board = json_decode($g['board_json'], true);
            $mines = json_decode($g['mines_json'] ?: '{}', true) ?: [];
            $triggered = json_decode($g['triggered_mines_json'] ?: '[]', true) ?: [];

            if (!othello_has_move($board, 2)) {
                // AI は パス → user に 返す or 終局
                if (!othello_has_move($board, 1)) {
                    othello_finalize_ai($pdo, $gid, $board, $mines, $triggered);
                } else {
                    $pdo->prepare("UPDATE othello_games SET turn_side='creator' WHERE id=?")->execute([$gid]);
                }
                $advanced = true; return;
            }
            $mv = othello_ai_choose_move($board);
            if (!$mv) return;
            [$r, $c] = $mv;
            $flips = othello_flips($board, $r, $c, 2);
            $board[$r * 8 + $c] = 2;
            foreach ($flips as [$fr, $fc]) { $board[$fr * 8 + $fc] = 2; }
            // 地雷 (self or user の 地雷を AI が 踏むパターン)
            $cellKey = "{$r}{$c}";
            foreach (['creator','opponent'] as $owner) {
                $list = $mines[$owner] ?? [];
                if (in_array($cellKey, $list, true) && !in_array($cellKey, array_column($triggered, 'cell'), true)) {
                    $exp = othello_explode_mine($board, $r, $c);
                    $triggered[] = ['cell' => $cellKey, 'owner' => $owner, 'flipped' => $exp];
                }
            }
            // ターン進行
            $finished = false;
            $nextSide = 'creator';
            if (!othello_has_move($board, 1)) {
                if (othello_has_move($board, 2)) { $nextSide = 'opponent'; }
                else { $finished = true; }
            }
            if ($finished) {
                othello_finalize_ai($pdo, $gid, $board, $mines, $triggered);
            } else {
                $pdo->prepare("UPDATE othello_games SET board_json=?, mines_json=?, triggered_mines_json=?, turn_side=? WHERE id=?")
                    ->execute([json_encode($board), json_encode($mines), json_encode($triggered), $nextSide, $gid]);
            }
            $advanced = true;
        });
        if (!$advanced) return;
    }
}

function othello_finalize_ai(PDO $pdo, int $gid, array $board, array $mines, array $triggered): void {
    $cBlack = 0; $cWhite = 0;
    foreach ($board as $v) { if ($v === 1) $cBlack++; else if ($v === 2) $cWhite++; }
    $winner = $cBlack > $cWhite ? 'creator' : ($cWhite > $cBlack ? 'opponent' : 'draw');
    // AI モード: 払戻なし (プレイフィーは SYSTEM 取り)
    $pdo->prepare("UPDATE othello_games SET board_json=?, mines_json=?, triggered_mines_json=?, status='finished', winner=?, finished_at=NOW() WHERE id=?")
        ->execute([json_encode($board), json_encode($mines), json_encode($triggered), $winner, $gid]);
}
