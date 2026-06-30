<?php
// v540 #171 絵しりとり Phase 1。
//   GET    /api/shiritori/games           自分が参加 or 起案したゲーム
//   POST   /api/shiritori/games           { title, member_ids[], time_limit_sec?, round_count? }
//   GET    /api/shiritori/games/:id       詳細 (players + drawings + 現在のターン)
//   POST   /api/shiritori/games/:id/turn  { strokes_json, image_url, label_self, label_prev_guess? }
//   POST   /api/shiritori/games/:id/giveup  起案者が終了
// 未実装 (Phase 2): AI guess / final guess / replay animation

declare(strict_types=1);

// v623 プレイフィー (1 人 2pt、初回ターン時に SYSTEM へ)
const SHIRITORI_FEE = 2;

function route_shiritori(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === 'games' && $method === 'GET' && !isset($seg[2])) {
        shiritori_games_list($pdo, $uid);
        return;
    }
    if ($sub === 'games' && $method === 'POST' && !isset($seg[2])) {
        shiritori_game_create($pdo, $cfg, $uid);
        return;
    }
    if ($sub === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET') { shiritori_game_detail($pdo, $uid, $gid); return; }
        if ($action === 'turn' && $method === 'POST') { shiritori_turn_submit($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'giveup' && $method === 'POST') { shiritori_giveup($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no shiritori route for $method $sub", 404);
}

function shiritori_games_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT DISTINCT g.id, g.title, g.status, g.current_turn_idx, g.round_count,
               g.time_limit_sec, g.created_at, g.ended_at,
               g.creator_user_id, uc.display_name AS creator_name,
               (SELECT COUNT(*) FROM shiritori_players p WHERE p.game_id = g.id) AS player_count,
               (SELECT COUNT(*) FROM shiritori_drawings d WHERE d.game_id = g.id) AS drawing_count
          FROM shiritori_games g
          JOIN users uc ON uc.id = g.creator_user_id
     LEFT JOIN shiritori_players pm ON pm.game_id = g.id AND pm.user_id = ?
         WHERE g.creator_user_id = ? OR pm.user_id IS NOT NULL
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid, $uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['current_turn_idx']= (int)$r['current_turn_idx'];
        $r['round_count']     = (int)$r['round_count'];
        $r['time_limit_sec']  = (int)$r['time_limit_sec'];
        $r['player_count']    = (int)$r['player_count'];
        $r['drawing_count']   = (int)$r['drawing_count'];
    }
    unset($r);
    json_response(['items' => $items]);
}

function shiritori_game_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    // v580 1 ターン 30 秒固定。 body の time_limit_sec は互換のため受けるが無視。
    $timeLimit = 30;
    $rounds = (int)($body['round_count'] ?? 2);
    if ($rounds < 1 || $rounds > 10) throw new ApiException('bad_request', 'round_count 1-10', 400);
    $memberIds = $body['member_ids'] ?? [];
    if (!is_array($memberIds)) throw new ApiException('bad_request', 'member_ids array', 400);
    $memberIds = array_values(array_unique(array_map('intval', $memberIds)));
    // 起案者を自動的に含める
    if (!in_array($uid, $memberIds, true)) array_unshift($memberIds, $uid);
    if (count($memberIds) < 2) throw new ApiException('bad_request', 'メンバー 2 名以上 (起案者含む)', 400);
    if (count($memberIds) > 30) throw new ApiException('bad_request', 'メンバー 30 名まで', 400);
    // human チェック
    $place = implode(',', array_fill(0, count($memberIds), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($memberIds);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) !== count($memberIds)) throw new ApiException('bad_request', '無効なメンバー', 400);

    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $timeLimit, $rounds, $memberIds, &$gameId) {
        $pdo->prepare("INSERT INTO shiritori_games (creator_user_id, title, time_limit_sec, round_count) VALUES (?,?,?,?)")
            ->execute([$uid, $title, $timeLimit, $rounds]);
        $gameId = (int)$pdo->lastInsertId();
        // v665 turn_order をランダムに
        $shuffled = $memberIds;
        shuffle($shuffled);
        $insP = $pdo->prepare("INSERT INTO shiritori_players (game_id, user_id, turn_order) VALUES (?,?,?)");
        foreach ($shuffled as $idx => $userId) {
            $insP->execute([$gameId, $userId, $idx]);
        }
    });
    // メンバーに通知
    $stN = $pdo->prepare("SELECT display_name FROM users WHERE id = ?");
    $stN->execute([$uid]);
    $creatorName = (string)$stN->fetchColumn();
    foreach ($memberIds as $userId) {
        if ($userId === $uid) continue;
        try {
            global $CFG;
            notify_safely($pdo, $CFG, $userId, 'admin_notice',
                "🎨 「{$title}」 (絵しりとり) に呼ばれました。 {$creatorName} 発起、 {$rounds} 周 / 1 ターン {$timeLimit} 秒。",
                'shiritori', $gameId);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $gameId]);
}

function shiritori_game_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name
                           FROM shiritori_games g JOIN users uc ON uc.id = g.creator_user_id
                          WHERE g.id = ?");
    $st->execute([$gid]);
    $game = $st->fetch(PDO::FETCH_ASSOC);
    if (!$game) throw new ApiException('not_found', "game $gid not found", 404);
    $game['id'] = (int)$game['id'];
    $game['creator_user_id'] = (int)$game['creator_user_id'];
    $game['current_turn_idx'] = (int)$game['current_turn_idx'];
    $game['round_count'] = (int)$game['round_count'];
    $game['time_limit_sec'] = (int)$game['time_limit_sec'];

    $stP = $pdo->prepare("SELECT p.user_id, p.turn_order, u.display_name, u.avatar_url
                            FROM shiritori_players p JOIN users u ON u.id = p.user_id
                           WHERE p.game_id = ? ORDER BY p.turn_order");
    $stP->execute([$gid]);
    $players = array_map(fn($r) => [
        'user_id'      => (int)$r['user_id'],
        'turn_order'   => (int)$r['turn_order'],
        'display_name' => $r['display_name'],
        'avatar_url'   => $r['avatar_url'],
    ], $stP->fetchAll(PDO::FETCH_ASSOC));

    $stD = $pdo->prepare("SELECT id, user_id, turn_idx, round_idx, label_self, label_prev_guess,
                                 image_url, ai_guess, created_at
                            FROM shiritori_drawings WHERE game_id = ? ORDER BY turn_idx ASC");
    $stD->execute([$gid]);
    $drawings = array_map(fn($r) => [
        'id'              => (int)$r['id'],
        'user_id'         => (int)$r['user_id'],
        'turn_idx'        => (int)$r['turn_idx'],
        'round_idx'       => (int)$r['round_idx'],
        'label_self'      => $r['label_self'],
        'label_prev_guess'=> $r['label_prev_guess'],
        'image_url'       => $r['image_url'],
        'ai_guess'        => $r['ai_guess'],
        'created_at'      => $r['created_at'],
    ], $stD->fetchAll(PDO::FETCH_ASSOC));

    // 現在の描き手 = current_turn_idx 番目のプレイヤー (mod プレイヤー数)。
    $n = max(1, count($players));
    $curPlayerIdx = $game['current_turn_idx'] % $n;
    $currentPlayer = $players[$curPlayerIdx] ?? null;
    $isMyTurn = $game['status'] === 'active' && $currentPlayer && $currentPlayer['user_id'] === $uid;
    $game['players']        = $players;
    $game['drawings']       = $drawings;
    $game['current_player'] = $currentPlayer;
    $game['is_my_turn']     = (bool)$isMyTurn;
    $game['is_creator']     = $game['creator_user_id'] === $uid;
    $game['total_turns']    = $game['round_count'] * $n;
    json_response($game);
}

function shiritori_turn_submit(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $strokes = (string)($body['strokes_json'] ?? '[]');
    $imageUrl = (string)($body['image_url'] ?? '');
    $labelSelf = mb_substr(trim((string)($body['label_self'] ?? '')), 0, 60);
    $labelPrev = isset($body['label_prev_guess']) ? mb_substr(trim((string)$body['label_prev_guess']), 0, 60) : null;
    if ($labelSelf === '') throw new ApiException('bad_request', '自分が何を描いたかを入力', 400);
    if ($labelPrev === '') $labelPrev = null;
    if (strlen($strokes) > 1024 * 1024) throw new ApiException('bad_request', 'strokes_json 大きすぎ', 400);

    // ゲーム取得 + 自分のターンチェック
    $st = $pdo->prepare("SELECT * FROM shiritori_games WHERE id = ? FOR UPDATE");
    db_tx($pdo, function () use ($pdo, $st, $gid, $uid, $strokes, $imageUrl, $labelSelf, $labelPrev) {
        $st->execute([$gid]);
        $game = $st->fetch(PDO::FETCH_ASSOC);
        if (!$game) throw new ApiException('not_found', 'game not found', 404);
        if ($game['status'] !== 'active') throw new ApiException('bad_request', '既に終了したゲームです', 400);
        $stP = $pdo->prepare("SELECT user_id, turn_order FROM shiritori_players WHERE game_id = ? ORDER BY turn_order");
        $stP->execute([$gid]);
        $players = $stP->fetchAll(PDO::FETCH_ASSOC);
        $n = max(1, count($players));
        $curIdx = (int)$game['current_turn_idx'] % $n;
        $curPlayer = $players[$curIdx];
        if ((int)$curPlayer['user_id'] !== $uid) throw new ApiException('forbidden', 'あなたのターンではありません', 403);

        // v623 初回ターンでプレイフィー 2pt を SYSTEM に支払う (lazy charge)。
        //   paid_at 列が DEFAULT NULL なので既存ゲームは課金されず互換維持。
        $stPay = $pdo->prepare("SELECT paid_at FROM shiritori_players WHERE game_id=? AND user_id=?");
        $stPay->execute([$gid, $uid]);
        $paidAt = $stPay->fetchColumn();
        if ($paidAt === null) {
            if (Ledger::balanceOfUser($pdo, $uid) < SHIRITORI_FEE) {
                throw new ApiException('insufficient_balance', sprintf('プレイフィー %dpt が必要です', SHIRITORI_FEE), 400);
            }
            Ledger::transfer($pdo, $uid, 1, SHIRITORI_FEE, 'shiritori_buyin', 'shiritori', $gid, "絵しりとり #{$gid} プレイフィー");
            $pdo->prepare("UPDATE shiritori_players SET paid_at=NOW() WHERE game_id=? AND user_id=?")
                ->execute([$gid, $uid]);
        }

        $roundIdx = intdiv((int)$game['current_turn_idx'], $n);
        $pdo->prepare("INSERT INTO shiritori_drawings
            (game_id, user_id, turn_idx, round_idx, label_self, label_prev_guess, image_url, strokes_json)
            VALUES (?,?,?,?,?,?,?,?)")
            ->execute([$gid, $uid, (int)$game['current_turn_idx'], $roundIdx, $labelSelf, $labelPrev, $imageUrl ?: null, $strokes]);

        $newTurnIdx = (int)$game['current_turn_idx'] + 1;
        $totalTurns = (int)$game['round_count'] * $n;
        if ($newTurnIdx >= $totalTurns) {
            $pdo->prepare("UPDATE shiritori_games SET current_turn_idx = ?, status='ended', ended_at = NOW() WHERE id = ?")
                ->execute([$newTurnIdx, $gid]);
        } else {
            $pdo->prepare("UPDATE shiritori_games SET current_turn_idx = ? WHERE id = ?")
                ->execute([$newTurnIdx, $gid]);
            // 次のプレイヤーに通知
            $nextIdx = $newTurnIdx % $n;
            $nextUid = (int)$players[$nextIdx]['user_id'];
            try {
                global $CFG;
                notify_safely($pdo, $CFG, $nextUid, 'admin_notice',
                    "🎨 あなたの番です! 「" . $game['title'] . "」 (絵しりとり)",
                    'shiritori', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function shiritori_giveup(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT creator_user_id, status FROM shiritori_games WHERE id = ?");
    $st->execute([$gid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'game not found', 404);
    if ((int)$row['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ giveup 可', 403);
    if ($row['status'] === 'ended') { json_response(['ok' => true, 'already' => true]); return; }
    $pdo->prepare("UPDATE shiritori_games SET status='ended', ended_at = NOW() WHERE id = ?")->execute([$gid]);
    json_response(['ok' => true]);
}
