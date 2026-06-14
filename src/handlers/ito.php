<?php
// v568 #223 ito ゲーム (協力ゲーム: 1-100 の数字を表現で当てる)。
//   1. lobby: 起案者がお題 + メンバー選択 + 1pt 預託 → 参加者も 1pt 預託
//   2. input: 各自に 1-100 の数字 (重複なし) が配布 → お題に沿って表現を入力
//   3. reveal: 全員入力したら 数字を 公開 (小さい順)、 全員で並び順を当てる
//   4. finished: 結果表示 + pot 分配 (全員で割り勘戻し: 1pt × N → 全員 1pt 戻し、 場代 0)

declare(strict_types=1);

const ITO_DEFAULT_BUYIN = 1;
const ITO_MAX_NUMBER = 100;

function route_ito(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no ito route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET')  { ito_games_list($pdo, $uid); return; }
        if ($method === 'POST') { ito_create($pdo, $cfg, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')      { ito_detail($pdo, $uid, $gid); return; }
        if ($action === 'join'    && $method === 'POST') { ito_join($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'leave'   && $method === 'POST') { ito_leave($pdo, $uid, $gid); return; }
        if ($action === 'start'   && $method === 'POST') { ito_start($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'express' && $method === 'POST') { ito_express($pdo, $uid, $gid); return; }
        if ($action === 'reveal'  && $method === 'POST') { ito_reveal($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'cancel'  && $method === 'POST') { ito_cancel($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no ito route for $method", 404);
}

function ito_games_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT g.id, g.creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
               g.theme, g.status, g.buy_in, g.pot_total, g.created_at, g.finished_at,
               (SELECT COUNT(*) FROM ito_players p WHERE p.game_id = g.id) AS player_count,
               EXISTS(SELECT 1 FROM ito_players p WHERE p.game_id = g.id AND p.user_id = ?) AS me_joined
          FROM ito_games g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.status IN ('lobby','input','reveal')
            OR g.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['buy_in'] = (int)$r['buy_in'];
        $r['pot_total'] = (int)$r['pot_total'];
        $r['player_count'] = (int)$r['player_count'];
        $r['me_joined'] = (bool)$r['me_joined'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function ito_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM ito_games g JOIN users uc ON uc.id = g.creator_user_id WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    $stP = $pdo->prepare("SELECT p.user_id, p.number, p.expression, p.joined_at,
                                 u.display_name, u.avatar_url
                            FROM ito_players p JOIN users u ON u.id = p.user_id
                           WHERE p.game_id = ? ORDER BY p.joined_at");
    $stP->execute([$gid]);
    $players = [];
    $myNumber = null;
    foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $isMe = ((int)$r['user_id'] === $uid);
        if ($isMe) $myNumber = $r['number'] !== null ? (int)$r['number'] : null;
        // reveal/finished 以降は 数字を全員に公開、 それ以前は自分のだけ
        $showNum = ($g['status'] === 'reveal' || $g['status'] === 'finished');
        $players[] = [
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'number'       => $showNum ? ($r['number'] !== null ? (int)$r['number'] : null) : ($isMe ? ($r['number'] !== null ? (int)$r['number'] : null) : null),
            'expression'   => $r['expression'],
            'has_expressed'=> $r['expression'] !== null && $r['expression'] !== '',
            'is_me'        => $isMe,
        ];
    }
    json_response([
        'id'              => (int)$g['id'],
        'theme'           => $g['theme'],
        'status'          => $g['status'],
        'buy_in'          => (int)$g['buy_in'],
        'pot_total'       => (int)$g['pot_total'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name'    => $g['creator_name'],
        'creator_avatar'  => $g['creator_avatar'],
        'created_at'      => $g['created_at'],
        'started_at'      => $g['started_at'],
        'finished_at'     => $g['finished_at'],
        'players'         => $players,
        'my_number'       => $myNumber,
        'is_creator'      => (int)$g['creator_user_id'] === $uid,
        'me_joined'       => (bool)count(array_filter($players, fn($p) => $p['user_id'] === $uid)),
        'all_expressed'   => count($players) > 0 && count(array_filter($players, fn($p) => $p['has_expressed'])) === count($players),
    ]);
}

function ito_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $theme = trim((string)require_field($body, 'theme'));
    if ($theme === '' || mb_strlen($theme) > 200) throw new ApiException('bad_request', 'theme 1-200', 400);
    $buyIn = (int)($body['buy_in'] ?? ITO_DEFAULT_BUYIN);
    if ($buyIn < 1 || $buyIn > 100) throw new ApiException('bad_request', 'buy_in 1-100', 400);
    $memberIds = $body['member_ids'] ?? [];
    if (!is_array($memberIds)) $memberIds = [];
    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $theme, $buyIn, &$gameId) {
        mahjong_assert_balance($pdo, $uid, $buyIn);
        $pdo->prepare("INSERT INTO ito_games (creator_user_id, theme, buy_in, status, pot_total) VALUES (?,?,?,?,?)")
            ->execute([$uid, $theme, $buyIn, 'lobby', 0]);
        $gameId = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO ito_players (game_id, user_id) VALUES (?, ?)")->execute([$gameId, $uid]);
        ito_deposit($pdo, $gameId, $uid, $buyIn);
    });
    // 招待通知
    global $CFG;
    foreach ($memberIds as $mid) {
        $mid = (int)$mid;
        if ($mid === $uid || $mid <= 0) continue;
        try {
            notify_safely($pdo, $CFG, $mid, 'admin_notice', "🎲 ito 「{$theme}」 に招待されました ({$buyIn}pt)", 'ito', $gameId);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $gameId]);
}

function ito_join(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = ito_lock($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '参加受付中ではありません', 400);
        $stE = $pdo->prepare("SELECT 1 FROM ito_players WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        if ($stE->fetchColumn()) throw new ApiException('bad_request', '既に参加しています', 400);
        $buyIn = (int)$g['buy_in'];
        mahjong_assert_balance($pdo, $uid, $buyIn);
        $pdo->prepare("INSERT INTO ito_players (game_id, user_id) VALUES (?, ?)")->execute([$gid, $uid]);
        ito_deposit($pdo, $gid, $uid, $buyIn);
    });
    json_response(['ok' => true]);
}

function ito_leave(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = ito_lock($pdo, $gid);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '開始後は脱退できません', 400);
        if ((int)$g['creator_user_id'] === $uid) throw new ApiException('bad_request', '起案者は脱退不可 (キャンセルしてください)', 400);
        $pdo->prepare("DELETE FROM ito_players WHERE game_id = ? AND user_id = ?")->execute([$gid, $uid]);
        $buyIn = (int)$g['buy_in'];
        Ledger::transfer($pdo, 1, $uid, $buyIn, 'mahjong_refund', 'ito', $gid, 'ito 脱退返金');
        $pdo->prepare("UPDATE ito_games SET pot_total = pot_total - ? WHERE id = ?")->execute([$buyIn, $gid]);
    });
    json_response(['ok' => true]);
}

function ito_start(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = ito_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ開始可', 403);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '募集中ではありません', 400);
        $stC = $pdo->prepare("SELECT COUNT(*) FROM ito_players WHERE game_id = ?");
        $stC->execute([$gid]);
        $n = (int)$stC->fetchColumn();
        if ($n < 2) throw new ApiException('bad_request', '2 人以上で開始してください', 400);
        if ($n > ITO_MAX_NUMBER) throw new ApiException('bad_request', '参加者多すぎ', 400);
        // 1-100 から重複なし N 個を ランダム割当て
        $pool = range(1, ITO_MAX_NUMBER);
        shuffle($pool);
        $picks = array_slice($pool, 0, $n);
        $stP = $pdo->prepare("SELECT user_id FROM ito_players WHERE game_id = ? ORDER BY joined_at");
        $stP->execute([$gid]);
        $playerUids = array_map('intval', $stP->fetchAll(PDO::FETCH_COLUMN));
        foreach ($playerUids as $i => $puid) {
            $pdo->prepare("UPDATE ito_players SET number = ? WHERE game_id = ? AND user_id = ?")
                ->execute([$picks[$i], $gid, $puid]);
        }
        $pdo->prepare("UPDATE ito_games SET status='input', started_at=NOW() WHERE id = ?")->execute([$gid]);
    });
    // 全員に開始通知
    $stP = $pdo->prepare("SELECT user_id FROM ito_players WHERE game_id = ?");
    $stP->execute([$gid]);
    foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        try { notify_safely($pdo, $cfg, (int)$pid, 'admin_notice', "🎲 ito 開始! あなたに数字が配布されました", 'ito', $gid); } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function ito_express(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 500) throw new ApiException('bad_request', '表現 1-500 文字', 400);
    db_tx($pdo, function () use ($pdo, $uid, $gid, $text) {
        $g = ito_lock($pdo, $gid);
        if ($g['status'] !== 'input') throw new ApiException('bad_request', '入力フェーズではありません', 400);
        $stE = $pdo->prepare("SELECT 1 FROM ito_players WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        if (!$stE->fetchColumn()) throw new ApiException('forbidden', '参加者ではありません', 403);
        $pdo->prepare("UPDATE ito_players SET expression = ? WHERE game_id = ? AND user_id = ?")
            ->execute([$text, $gid, $uid]);
    });
    json_response(['ok' => true]);
}

function ito_reveal(PDO $pdo, array $cfg, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = ito_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ公開可', 403);
        if ($g['status'] !== 'input' && $g['status'] !== 'reveal') throw new ApiException('bad_request', '公開できる状態ではありません', 400);
        $stC = $pdo->prepare("SELECT COUNT(*) FROM ito_players WHERE game_id = ?");
        $stC->execute([$gid]);
        $n = (int)$stC->fetchColumn();
        $stE = $pdo->prepare("SELECT COUNT(*) FROM ito_players WHERE game_id = ? AND expression IS NOT NULL AND expression <> ''");
        $stE->execute([$gid]);
        $ne = (int)$stE->fetchColumn();
        if ($ne < $n) throw new ApiException('bad_request', '全員の入力が揃っていません (' . $ne . '/' . $n . ')', 400);
        // v569 #223 修正: ito はプレイフィー (戻さない)、 pot は そのままシステムに残る
        $pdo->prepare("UPDATE ito_games SET status='finished', finished_at=NOW() WHERE id = ?")->execute([$gid]);
    });
    // 全員に開示通知
    $stP = $pdo->prepare("SELECT user_id FROM ito_players WHERE game_id = ?");
    $stP->execute([$gid]);
    foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        try { notify_safely($pdo, $cfg, (int)$pid, 'admin_notice', "🎲 ito 結果開示! 全員の数字が見れます", 'ito', $gid); } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function ito_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $g = ito_lock($pdo, $gid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['lobby','input','reveal'], true)) throw new ApiException('bad_request', '既に終了しています', 400);
        $stP = $pdo->prepare("SELECT user_id FROM ito_players WHERE game_id = ?");
        $stP->execute([$gid]);
        $buyIn = (int)$g['buy_in'];
        foreach ($stP->fetchAll(PDO::FETCH_COLUMN) as $pid) {
            Ledger::transfer($pdo, 1, (int)$pid, $buyIn, 'mahjong_refund', 'ito', $gid, 'ito キャンセル返金');
        }
        $pdo->prepare("UPDATE ito_games SET status='cancelled', finished_at=NOW(), pot_total=0 WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function ito_lock(PDO $pdo, int $gid): array {
    $st = $pdo->prepare("SELECT * FROM ito_games WHERE id = ? FOR UPDATE");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    return $g;
}
function ito_deposit(PDO $pdo, int $gid, int $uid, int $amount): void {
    // v569 ito はプレイフィー: 参加時にシステムへ徴収。 cancel 時のみ返金。
    Ledger::transfer($pdo, $uid, 1, $amount, 'mahjong_buyin', 'ito', $gid, 'ito プレイフィー');
    $pdo->prepare("UPDATE ito_games SET pot_total = pot_total + ? WHERE id = ?")->execute([$amount, $gid]);
}
