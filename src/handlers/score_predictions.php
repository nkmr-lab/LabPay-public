<?php
// v609 #235 勝敗予測。 試合 (X vs Y) のスコアを 予想 → 完璧に当てた人が pot 総取り。
//   山分け前に 5% 場代。 誰も当たらなければ 全員に フィー返金。
//   Ledger type は predictions と同じ 'mahjong_buyin'/'mahjong_payout'/'mahjong_refund' を流用。
declare(strict_types=1);

const SP_DEFAULT_FEE = 20;
const SP_MIN_FEE = 10;
const SP_MAX_FEE = 100;
const SP_RAKE_PCT = 5;

function route_score_predictions(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET')  { sp_list($pdo, $uid); return; }
        if ($method === 'POST') { sp_create($pdo, $cfg, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')        { sp_detail($pdo, $uid, $gid); return; }
        if ($action === 'predict'  && $method === 'POST') { sp_predict($pdo, $uid, $gid); return; }
        if ($action === 'close'    && $method === 'POST') { sp_close($pdo, $uid, $gid); return; }
        if ($action === 'finalize' && $method === 'POST') { sp_finalize($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'cancel'   && $method === 'POST') { sp_cancel($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no score_predictions route", 404);
}

function sp_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT g.id, g.creator_user_id, uc.display_name AS creator_name,
               g.title, g.team_home, g.team_away, g.match_at, g.deadline_at,
               g.fee, g.status, g.pot_total, g.actual_home, g.actual_away,
               g.created_at, g.finished_at,
               (SELECT COUNT(*) FROM score_pred_entries e WHERE e.game_id = g.id) AS entry_count,
               EXISTS(SELECT 1 FROM score_pred_entries e WHERE e.game_id = g.id AND e.user_id = ?) AS me_entered
          FROM score_pred_games g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.status IN ('open','closed')
            OR g.finished_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['fee']             = (int)$r['fee'];
        $r['pot_total']       = (int)$r['pot_total'];
        $r['entry_count']     = (int)$r['entry_count'];
        $r['me_entered']      = (bool)$r['me_entered'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function sp_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM score_pred_games g JOIN users uc ON uc.id = g.creator_user_id WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);

    // 自分のエントリ
    $stMe = $pdo->prepare("SELECT guess_home, guess_away, payout, is_winner FROM score_pred_entries WHERE game_id = ? AND user_id = ?");
    $stMe->execute([$gid, $uid]);
    $me = $stMe->fetch(PDO::FETCH_ASSOC);

    // 締切後 or finished なら 全エントリ 公開
    $deadlinePassed = !empty($g['deadline_at']) && strtotime((string)$g['deadline_at']) < time();
    $reveal = $g['status'] !== 'open' || $deadlinePassed;

    $entries = [];
    if ($reveal) {
        $stA = $pdo->prepare("SELECT e.user_id, e.guess_home, e.guess_away, e.payout, e.is_winner,
                                     u.display_name, u.avatar_url
                                FROM score_pred_entries e JOIN users u ON u.id = e.user_id
                               WHERE e.game_id = ?
                               ORDER BY e.is_winner DESC, e.payout DESC, e.created_at ASC");
        $stA->execute([$gid]);
        foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $entries[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'guess_home'   => (int)$r['guess_home'],
                'guess_away'   => (int)$r['guess_away'],
                'payout'       => (int)$r['payout'],
                'is_winner'    => (bool)$r['is_winner'],
            ];
        }
    } else {
        // 締切前: 名前と参加だけ (予想は隠す)
        $stA = $pdo->prepare("SELECT e.user_id, u.display_name, u.avatar_url, e.created_at
                                FROM score_pred_entries e JOIN users u ON u.id = e.user_id
                               WHERE e.game_id = ? ORDER BY e.created_at ASC");
        $stA->execute([$gid]);
        foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $entries[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'guess_home'   => null,
                'guess_away'   => null,
            ];
        }
    }
    json_response([
        'id'              => (int)$g['id'],
        'title'           => $g['title'],
        'team_home'       => $g['team_home'],
        'team_away'       => $g['team_away'],
        'match_at'        => $g['match_at'],
        'deadline_at'     => $g['deadline_at'],
        'fee'             => (int)$g['fee'],
        'status'          => $g['status'],
        'pot_total'       => (int)$g['pot_total'],
        'actual_home'     => $g['actual_home'] !== null ? (int)$g['actual_home'] : null,
        'actual_away'     => $g['actual_away'] !== null ? (int)$g['actual_away'] : null,
        'created_at'      => $g['created_at'],
        'finished_at'     => $g['finished_at'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name'    => $g['creator_name'],
        'creator_avatar'  => $g['creator_avatar'],
        'my_guess'        => $me ? ['home' => (int)$me['guess_home'], 'away' => (int)$me['guess_away']] : null,
        'my_payout'       => $me ? (int)$me['payout'] : null,
        'my_winner'       => $me ? (bool)$me['is_winner'] : false,
        'me_entered'      => (bool)$me,
        'is_creator'      => (int)$g['creator_user_id'] === $uid,
        'entries'         => $entries,
    ]);
}

function sp_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $home = trim((string)require_field($body, 'team_home'));
    $away = trim((string)require_field($body, 'team_away'));
    if ($home === '' || mb_strlen($home) > 80) throw new ApiException('bad_request', 'team_home 1-80', 400);
    if ($away === '' || mb_strlen($away) > 80) throw new ApiException('bad_request', 'team_away 1-80', 400);
    $fee = (int)($body['fee'] ?? SP_DEFAULT_FEE);
    if ($fee < SP_MIN_FEE || $fee > SP_MAX_FEE) {
        throw new ApiException('bad_request', sprintf('fee %d-%d', SP_MIN_FEE, SP_MAX_FEE), 400);
    }
    $matchAt = null;
    if (!empty($body['match_at'])) {
        try {
            $dt = new DateTime((string)$body['match_at']);
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $matchAt = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $_) {}
    }
    $deadlineAt = null;
    if (!empty($body['deadline_at'])) {
        try {
            $dt = new DateTime((string)$body['deadline_at']);
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $deadlineAt = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $_) {}
    }
    // v610 起案時 通知対象 user_id 配列 (任意)
    $notifyIds = [];
    if (isset($body['notify_user_ids']) && is_array($body['notify_user_ids'])) {
        $notifyIds = array_values(array_unique(array_map('intval',
            array_filter($body['notify_user_ids'], fn($x) => is_numeric($x) && (int)$x > 0))));
        $notifyIds = array_filter($notifyIds, fn($x) => $x !== $uid);
    }
    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $home, $away, $fee, $matchAt, $deadlineAt, &$gameId) {
        $pdo->prepare("INSERT INTO score_pred_games (creator_user_id, title, team_home, team_away, match_at, deadline_at, fee)
                       VALUES (?,?,?,?,?,?,?)")
            ->execute([$uid, $title, $home, $away, $matchAt, $deadlineAt, $fee]);
        $gameId = (int)$pdo->lastInsertId();
    });
    // 起案時 通知
    foreach ($notifyIds as $nuid) {
        $msg = "🎯 「{$home} vs {$away}」 のスコア予想 受付開始! フィー {$fee}pt";
        notify_safely($pdo, $cfg, (int)$nuid, 'admin_notice', $msg, 'score_pred', $gameId);
    }
    json_response(['ok' => true, 'id' => $gameId, 'notified' => count($notifyIds)]);
}

function sp_predict(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $home = $body['home'] ?? null;
    $away = $body['away'] ?? null;
    if (!is_numeric($home) || !is_numeric($away)) throw new ApiException('bad_request', 'home/away 必須 (整数)', 400);
    $home = (int)$home; $away = (int)$away;
    if ($home < 0 || $home > 99 || $away < 0 || $away > 99) throw new ApiException('bad_request', 'スコアは 0-99', 400);
    db_tx($pdo, function () use ($pdo, $uid, $gid, $home, $away) {
        $stG = $pdo->prepare("SELECT * FROM score_pred_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'open') throw new ApiException('bad_request', '受付中ではない', 400);
        if ($g['deadline_at'] && strtotime($g['deadline_at']) < time()) {
            throw new ApiException('bad_request', '締切時刻を過ぎています', 400);
        }
        // 初回参加 → フィー徴収
        $stE = $pdo->prepare("SELECT 1 FROM score_pred_entries WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        $isNew = !$stE->fetchColumn();
        if ($isNew) {
            $bal = Ledger::balanceOfUser($pdo, $uid);
            if ($bal < (int)$g['fee']) throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %d、現在 %d)', $g['fee'], $bal), 400);
            Ledger::transfer($pdo, $uid, 1, (int)$g['fee'], 'mahjong_buyin', 'score_pred', $gid, "勝敗予測 #{$gid} 参加フィー");
            $pdo->prepare("UPDATE score_pred_games SET pot_total = pot_total + ? WHERE id = ?")
                ->execute([$g['fee'], $gid]);
        }
        $pdo->prepare("INSERT INTO score_pred_entries (game_id, user_id, guess_home, guess_away) VALUES (?,?,?,?)
                        ON DUPLICATE KEY UPDATE guess_home = VALUES(guess_home), guess_away = VALUES(guess_away)")
            ->execute([$gid, $uid, $home, $away]);
    });
    json_response(['ok' => true]);
}

function sp_close(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $stG = $pdo->prepare("SELECT * FROM score_pred_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if ($g['status'] !== 'open') throw new ApiException('bad_request', '受付中ではない', 400);
        $pdo->prepare("UPDATE score_pred_games SET status='closed' WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function sp_finalize(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $home = $body['home'] ?? null;
    $away = $body['away'] ?? null;
    if (!is_numeric($home) || !is_numeric($away)) throw new ApiException('bad_request', 'home/away 必須', 400);
    $home = (int)$home; $away = (int)$away;
    if ($home < 0 || $home > 99 || $away < 0 || $away > 99) throw new ApiException('bad_request', 'スコアは 0-99', 400);
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid, $home, $away) {
        $stG = $pdo->prepare("SELECT * FROM score_pred_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['open','closed'], true)) throw new ApiException('bad_request', '既に終了', 400);
        // 完全一致した エントリ群を 取得
        $stW = $pdo->prepare("SELECT user_id FROM score_pred_entries WHERE game_id = ? AND guess_home = ? AND guess_away = ?");
        $stW->execute([$gid, $home, $away]);
        $winners = array_map('intval', $stW->fetchAll(PDO::FETCH_COLUMN));
        $pot = (int)$g['pot_total'];
        if (empty($winners)) {
            // 全員 フィー返金
            $stAll = $pdo->prepare("SELECT user_id FROM score_pred_entries WHERE game_id = ?");
            $stAll->execute([$gid]);
            $allUids = array_map('intval', $stAll->fetchAll(PDO::FETCH_COLUMN));
            $fee = (int)$g['fee'];
            foreach ($allUids as $puid) {
                Ledger::transfer($pdo, 1, $puid, $fee, 'mahjong_refund', 'score_pred', $gid, "勝敗予測 #{$gid} 誰も当たらず返金");
                $pdo->prepare("UPDATE score_pred_entries SET payout = ?, is_winner = 0 WHERE game_id = ? AND user_id = ?")
                    ->execute([$fee, $gid, $puid]);
            }
        } else {
            $rake = (int)floor($pot * SP_RAKE_PCT / 100);
            $payoutPool = $pot - $rake;
            $n = count($winners);
            $share = intdiv($payoutPool, $n);
            $remainder = $payoutPool - ($share * $n);
            foreach ($winners as $idx => $puid) {
                $amount = $share + ($idx === 0 ? $remainder : 0);
                if ($amount > 0) {
                    Ledger::transfer($pdo, 1, $puid, $amount, 'mahjong_payout', 'score_pred', $gid, "勝敗予測 #{$gid} 完全的中");
                }
                $pdo->prepare("UPDATE score_pred_entries SET payout = ?, is_winner = 1 WHERE game_id = ? AND user_id = ?")
                    ->execute([$amount, $gid, $puid]);
            }
        }
        $pdo->prepare("UPDATE score_pred_games SET status='finished', actual_home=?, actual_away=?, finished_at=NOW() WHERE id = ?")
            ->execute([$home, $away, $gid]);
        // 通知
        $stAll = $pdo->prepare("SELECT user_id FROM score_pred_entries WHERE game_id = ?");
        $stAll->execute([$gid]);
        foreach ($stAll->fetchAll(PDO::FETCH_COLUMN) as $puid) {
            try {
                $msg = "🎯 勝敗予測 「{$g['title']}」 結果: {$g['team_home']} {$home}-{$away} {$g['team_away']}";
                notify_safely($pdo, $cfg, (int)$puid, 'admin_notice', $msg, 'score_pred', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function sp_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $stG = $pdo->prepare("SELECT * FROM score_pred_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['open','closed'], true)) throw new ApiException('bad_request', '既に終了', 400);
        $fee = (int)$g['fee'];
        $stE = $pdo->prepare("SELECT user_id FROM score_pred_entries WHERE game_id = ?");
        $stE->execute([$gid]);
        foreach ($stE->fetchAll(PDO::FETCH_COLUMN) as $pid) {
            Ledger::transfer($pdo, 1, (int)$pid, $fee, 'mahjong_refund', 'score_pred', $gid, "勝敗予測 #{$gid} キャンセル返金");
        }
        $pdo->prepare("UPDATE score_pred_games SET status='cancelled', finished_at=NOW(), pot_total=0 WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}
