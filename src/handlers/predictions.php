<?php
// v576 優勝予想アプリ。 ワールドカップ等の順位を予想 → 答え合わせで配分。
//   1位のみ予想 (predict_count=1) / 1-2位 / 1-4位 で 答え合わせ。
//   スコア = 順位重み [5, 3, 2, 1] (1位から順) の一致した分の合計 (= 予想ランキング 表示用)。
//   payout: 1位を 的中させた人 で 山分け (場代 5%)。
//     - 的中者複数 → pot × 95% を 均等分配 (端数は 早く参加した人)
//     - 的中者ゼロ → 全員にフィー返金
//   v576c 山分けモデル (旧: スコア比例) に変更、 重みも [5,3,2,1] に。
declare(strict_types=1);

const PREDICTIONS_DEFAULT_FEE = 50;
const PREDICTIONS_MIN_FEE = 10;
const PREDICTIONS_MAX_FEE = 100;
const PREDICTIONS_RAKE_PCT = 5;
// v664 順位の 一致重み (= 位置 ピッタリ 的中 で 加算)。 配列 の i 番目 = (i+1) 位 の 重み。
//   旧: [5,3,2,1] / 新: [4,3,2,1] (1位 を -1)
//   加えて 「順位 無関係 で top-N 集合 に 入って いる 国」 1 件 ごと に +1 点 を 別途 加算。
const PREDICTIONS_SCORE_WEIGHTS = [4, 3, 2, 1];

function route_predictions(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no predictions route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET')  { predictions_list($pdo, $uid); return; }
        if ($method === 'POST') { predictions_create($pdo, $cfg, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'GET')      { predictions_detail($pdo, $uid, $gid); return; }
        if ($action === 'predict'  && $method === 'POST') { predictions_predict($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'close'    && $method === 'POST') { predictions_close($pdo, $uid, $gid); return; }
        if ($action === 'finalize' && $method === 'POST') { predictions_finalize($pdo, $cfg, $uid, $gid); return; }
        if ($action === 'cancel'   && $method === 'POST') { predictions_cancel($pdo, $uid, $gid); return; }
        if ($action === ''         && $method === 'PATCH') { predictions_patch($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no predictions route for $method", 404);
}

// v848 #431 起案者が title / description を編集できる。 〆切や候補は変えない (混乱回避)。
function predictions_patch(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT creator_user_id, status FROM predictions_games WHERE id=?");
    $st->execute([$gid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'game not found', 404);
    if ((int)$row['creator_user_id'] !== $uid) {
        throw new ApiException('forbidden', '起案者のみ編集可', 403);
    }
    if (in_array($row['status'], ['finished', 'cancelled'], true)) {
        throw new ApiException('bad_request', '終了済 / 取消済は編集できません', 400);
    }
    $body = read_json_body();
    $sets = [];
    $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) throw new ApiException('bad_request', 'タイトルは 1〜200 文字', 400);
        $sets[] = 'title=?'; $args[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        if (mb_strlen($d) > 2000) throw new ApiException('bad_request', '説明は 2000 文字まで', 400);
        $sets[] = 'description=?'; $args[] = ($d === '' ? null : $d);
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $gid;
    $pdo->prepare("UPDATE predictions_games SET " . implode(', ', $sets) . " WHERE id=?")->execute($args);
    json_response(['ok' => true]);
}

function predictions_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT g.id, g.creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
               g.title, g.fee, g.predict_count, g.status, g.pot_total, g.deadline_at, g.created_at, g.finished_at,
               (SELECT COUNT(*) FROM predictions_entries e WHERE e.game_id = g.id) AS entry_count,
               EXISTS(SELECT 1 FROM predictions_entries e WHERE e.game_id = g.id AND e.user_id = ?) AS me_entered
          FROM predictions_games g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.status IN ('open','closed')
            OR g.finished_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY g.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['fee']             = (int)$r['fee'];
        $r['predict_count']   = (int)$r['predict_count'];
        $r['pot_total']       = (int)$r['pot_total'];
        $r['entry_count']     = (int)$r['entry_count'];
        $r['me_entered']      = (bool)$r['me_entered'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function predictions_detail(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM predictions_games g JOIN users uc ON uc.id = g.creator_user_id WHERE g.id = ?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'game not found', 404);
    $candidates = json_decode($g['candidates_json'] ?: '[]', true) ?: [];
    $actual = $g['actual_json'] ? json_decode($g['actual_json'], true) : null;

    // 自分の予想
    $stMe = $pdo->prepare("SELECT ranks_json, score, payout FROM predictions_entries WHERE game_id = ? AND user_id = ?");
    $stMe->execute([$gid, $uid]);
    $me = $stMe->fetch(PDO::FETCH_ASSOC);
    $myRanks = $me ? json_decode($me['ranks_json'] ?: '[]', true) : null;

    // 全員の予想 を 公開するか?
    //   締切後 (deadline_at < now) または status != 'open' なら 開示。
    //   = 「受付中で 締切前」 のときだけ 他人の予想を 隠す (自分の予想で 引っ張られないように)。
    //   v577 仕様変更: 結果開示 (finalize) を 待たずに、 締切を過ぎたら すぐ 全員分を開示。
    $deadlinePassed = !empty($g['deadline_at']) && strtotime((string)$g['deadline_at']) < time();
    $revealRanks = ($g['status'] !== 'open') || $deadlinePassed;
    $entries = [];
    if ($revealRanks) {
        $stA = $pdo->prepare("SELECT e.user_id, e.ranks_json, e.score, e.payout, u.display_name, u.avatar_url
                                FROM predictions_entries e JOIN users u ON u.id = e.user_id
                               WHERE e.game_id = ? ORDER BY e.score DESC, e.payout DESC, e.created_at ASC");
        $stA->execute([$gid]);
        foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $entries[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'ranks'        => json_decode($r['ranks_json'] ?: '[]', true) ?: [],
                'score'        => (int)$r['score'],
                'payout'       => (int)$r['payout'],
            ];
        }
    } else {
        // 受付中 (締切前): 参加者一覧は出すが ranks は隠す
        $stA = $pdo->prepare("SELECT e.user_id, u.display_name, u.avatar_url, e.created_at
                                FROM predictions_entries e JOIN users u ON u.id = e.user_id
                               WHERE e.game_id = ? ORDER BY e.created_at ASC");
        $stA->execute([$gid]);
        foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $entries[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'ranks'        => null,
            ];
        }
    }

    json_response([
        'id'              => (int)$g['id'],
        'title'           => $g['title'],
        'description'     => $g['description'],
        'fee'             => (int)$g['fee'],
        'predict_count'   => (int)$g['predict_count'],
        'status'          => $g['status'],
        'pot_total'       => (int)$g['pot_total'],
        'deadline_at'     => $g['deadline_at'],
        'created_at'      => $g['created_at'],
        'finished_at'     => $g['finished_at'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name'    => $g['creator_name'],
        'creator_avatar'  => $g['creator_avatar'],
        'candidates'      => $candidates,
        'actual'          => $actual,
        'my_ranks'        => $myRanks,
        'my_score'        => $me ? (int)$me['score'] : null,
        'my_payout'       => $me ? (int)$me['payout'] : null,
        'me_entered'      => (bool)$me,
        'is_creator'      => (int)$g['creator_user_id'] === $uid,
        'entries'         => $entries,
    ]);
}

function predictions_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $description = isset($body['description']) ? mb_substr(trim((string)$body['description']), 0, 1000) : null;
    if ($description === '') $description = null;
    $fee = (int)($body['fee'] ?? PREDICTIONS_DEFAULT_FEE);
    if ($fee < PREDICTIONS_MIN_FEE || $fee > PREDICTIONS_MAX_FEE) {
        throw new ApiException('bad_request', sprintf('fee %d-%d', PREDICTIONS_MIN_FEE, PREDICTIONS_MAX_FEE), 400);
    }
    $predictCount = (int)($body['predict_count'] ?? 1);
    if (!in_array($predictCount, [1, 2, 4], true)) throw new ApiException('bad_request', 'predict_count は 1, 2, 4', 400);
    $candidates = $body['candidates'] ?? [];
    if (!is_array($candidates) || count($candidates) < $predictCount + 1) {
        throw new ApiException('bad_request', '候補は predict_count + 1 個以上', 400);
    }
    if (count($candidates) > 200) throw new ApiException('bad_request', '候補は 200 個まで', 400);
    $cleanCandidates = [];
    $usedIds = [];
    foreach ($candidates as $idx => $c) {
        $cid = isset($c['id']) ? mb_substr((string)$c['id'], 0, 60) : ('c' . $idx);
        if (in_array($cid, $usedIds, true)) throw new ApiException('bad_request', 'candidate id 重複', 400);
        $usedIds[] = $cid;
        $name = mb_substr(trim((string)($c['name'] ?? '')), 0, 80);
        if ($name === '') continue;
        $cleanCandidates[] = [
            'id'   => $cid,
            'name' => $name,
            'flag' => isset($c['flag']) ? mb_substr((string)$c['flag'], 0, 16) : null,
        ];
    }
    if (count($cleanCandidates) < $predictCount + 1) {
        throw new ApiException('bad_request', '有効な候補が足りない', 400);
    }
    $deadlineAt = null;
    if (!empty($body['deadline_at'])) {
        try {
            $dt = new DateTime((string)$body['deadline_at']);
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $deadlineAt = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $_) {}
    }
    // v610 起案時に 通知を 飛ばす対象 user_id 配列 (任意)。
    $notifyIds = [];
    if (isset($body['notify_user_ids']) && is_array($body['notify_user_ids'])) {
        $notifyIds = array_values(array_unique(array_map('intval',
            array_filter($body['notify_user_ids'], fn($x) => is_numeric($x) && (int)$x > 0))));
        $notifyIds = array_filter($notifyIds, fn($x) => $x !== $uid); // 自分は除外
    }
    $gameId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $description, $fee, $predictCount, $cleanCandidates, $deadlineAt, &$gameId) {
        $pdo->prepare("INSERT INTO predictions_games (creator_user_id, title, description, fee, predict_count, candidates_json, deadline_at)
                       VALUES (?,?,?,?,?,?,?)")
            ->execute([$uid, $title, $description, $fee, $predictCount,
                       json_encode($cleanCandidates, JSON_UNESCAPED_UNICODE), $deadlineAt]);
        $gameId = (int)$pdo->lastInsertId();
    });
    // v610 起案時 通知 (1 通ずつ swallow)
    foreach ($notifyIds as $nuid) {
        $msg = "🏆 「{$title}」 の優勝予想 受付開始! フィー {$fee}pt、 {$predictCount}位まで予想";
        notify_safely($pdo, $cfg, (int)$nuid, 'admin_notice', $msg, 'prediction', $gameId);
    }
    json_response(['ok' => true, 'id' => $gameId, 'notified' => count($notifyIds)]);
}

function predictions_predict(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $ranks = $body['ranks'] ?? null;
    if (!is_array($ranks)) throw new ApiException('bad_request', 'ranks 配列必須', 400);
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid, $ranks) {
        $stG = $pdo->prepare("SELECT * FROM predictions_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'game not found', 404);
        if ($g['status'] !== 'open') throw new ApiException('bad_request', '締切後 / 終了済', 400);
        if ($g['deadline_at'] && strtotime($g['deadline_at']) < time()) {
            throw new ApiException('bad_request', '締切時刻を過ぎています', 400);
        }
        $candidates = json_decode($g['candidates_json'] ?: '[]', true) ?: [];
        $validIds = array_column($candidates, 'id');
        $predictCount = (int)$g['predict_count'];
        if (count($ranks) !== $predictCount) {
            throw new ApiException('bad_request', "ranks は {$predictCount} 個", 400);
        }
        $cleanRanks = [];
        $usedRanks = [];
        foreach ($ranks as $r) {
            $r = (string)$r;
            if (!in_array($r, $validIds, true)) throw new ApiException('bad_request', "候補に無い ID: $r", 400);
            if (in_array($r, $usedRanks, true)) throw new ApiException('bad_request', '同じ候補を 2 回選べません', 400);
            $usedRanks[] = $r;
            $cleanRanks[] = $r;
        }
        // 初回参加 = フィー徴収
        $stE = $pdo->prepare("SELECT 1 FROM predictions_entries WHERE game_id = ? AND user_id = ?");
        $stE->execute([$gid, $uid]);
        $isNew = !$stE->fetchColumn();
        if ($isNew) {
            GameLobby::assertBalance($pdo, $uid, (int)$g['fee']);
            GameLobby::depositToPot($pdo, $gid, $uid, (int)$g['fee'], 'mahjong_buyin', 'predictions', 'predictions_games', "予想 #{$gid} 参加フィー");
        }
        $pdo->prepare("INSERT INTO predictions_entries (game_id, user_id, ranks_json) VALUES (?,?,?)
                        ON DUPLICATE KEY UPDATE ranks_json = VALUES(ranks_json)")
            ->execute([$gid, $uid, json_encode($cleanRanks, JSON_UNESCAPED_UNICODE)]);
    });
    json_response(['ok' => true]);
}

function predictions_close(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $stG = $pdo->prepare("SELECT * FROM predictions_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if ($g['status'] !== 'open') throw new ApiException('bad_request', '受付中ではない', 400);
        $pdo->prepare("UPDATE predictions_games SET status='closed' WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function predictions_finalize(PDO $pdo, array $cfg, int $uid, int $gid): void {
    $body = read_json_body();
    $actual = $body['actual'] ?? null;
    if (!is_array($actual)) throw new ApiException('bad_request', 'actual 配列必須', 400);
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $gid, $actual) {
        $stG = $pdo->prepare("SELECT * FROM predictions_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['open','closed'], true)) throw new ApiException('bad_request', '既に終了', 400);
        $candidates = json_decode($g['candidates_json'] ?: '[]', true) ?: [];
        $validIds = array_column($candidates, 'id');
        $predictCount = (int)$g['predict_count'];
        if (count($actual) !== $predictCount) {
            throw new ApiException('bad_request', "actual は {$predictCount} 個", 400);
        }
        $cleanActual = [];
        $usedActual = [];
        foreach ($actual as $r) {
            $r = (string)$r;
            if (!in_array($r, $validIds, true)) throw new ApiException('bad_request', "候補に無い ID: $r", 400);
            if (in_array($r, $usedActual, true)) throw new ApiException('bad_request', '同じ候補を 2 回 actual に置けない', 400);
            $usedActual[] = $r;
            $cleanActual[] = $r;
        }
        // v664 全参加者 の score 計算:
        //   (1) 順位 無関係 で top-N 集合 (= 4位 以内) に 入って いる 国 1 件 ごと に +1 点
        //   (2) 順位 ピッタリ 的中 は さらに 重み (1位 +4 / 2位 +3 / 3位 +2 / 4位 +1)
        // 配分: 最高点 を 取った 人 全員 で 山分け (5% rake を 控除 した 後)。
        //   全員 が 0 点 だった ら 誰も 何も 当てて ない の で 全員 に フィー 返金。
        $stE = $pdo->prepare("SELECT user_id, ranks_json, created_at FROM predictions_entries WHERE game_id = ? ORDER BY created_at ASC, user_id ASC");
        $stE->execute([$gid]);
        $entries = $stE->fetchAll(PDO::FETCH_ASSOC);
        $scoreByUid = [];
        foreach ($entries as $e) {
            $puid = (int)$e['user_id'];
            $userRanks = json_decode($e['ranks_json'] ?: '[]', true) ?: [];
            // (1) 集合 一致 点 (= ユーザ 予想 と 実際 top-N の 重なり 個数)
            $setMatch = count(array_intersect($userRanks, $cleanActual));
            $score = $setMatch;
            // (2) 順位 ピッタリ 的中 ボーナス
            for ($i = 0; $i < $predictCount; $i++) {
                if (isset($userRanks[$i]) && isset($cleanActual[$i]) && $userRanks[$i] === $cleanActual[$i]) {
                    $w = PREDICTIONS_SCORE_WEIGHTS[$i] ?? 1;
                    $score += $w;
                }
            }
            $scoreByUid[$puid] = $score;
        }
        $pot = (int)$g['pot_total'];
        $payoutByUid = [];
        $maxScore = $scoreByUid ? max($scoreByUid) : 0;
        if ($maxScore <= 0) {
            // v737 #347 全員 0 点: 場代 (= 5%) 分を rake として system に残し、 残り (95%) を 各自に返金。
            //   旧版は full refund で system 取り分ゼロになっていた。
            $fee = (int)$g['fee'];
            $rakePer = (int)floor($fee * PREDICTIONS_RAKE_PCT / 100);
            $refund = max(0, $fee - $rakePer);
            foreach ($scoreByUid as $puid => $_) {
                if ($refund > 0) {
                    Ledger::transfer($pdo, 1, $puid, $refund, 'mahjong_refund', 'predictions', $gid, "予想 #{$gid} 全員 0 点 で 返金 (場代 {$rakePer}pt 差引)");
                }
                $payoutByUid[$puid] = $refund;
            }
        } else {
            // 最高点 を 取った 人 全員 (登録 順 で 端数 上乗せ)
            $topWinners = [];
            foreach ($entries as $e) {
                $puid = (int)$e['user_id'];
                if (($scoreByUid[$puid] ?? 0) === $maxScore) $topWinners[] = $puid;
            }
            $rake = (int)floor($pot * PREDICTIONS_RAKE_PCT / 100);
            $payoutPool = $pot - $rake;
            $nWinners = count($topWinners);
            $share = intdiv($payoutPool, $nWinners);
            $remainder = $payoutPool - ($share * $nWinners);
            foreach ($topWinners as $idx => $puid) {
                $amount = $share + ($idx === 0 ? $remainder : 0);
                if ($amount > 0) {
                    Ledger::transfer($pdo, 1, $puid, $amount, 'mahjong_payout', 'predictions', $gid, "予想 #{$gid} 最高点 山分け");
                }
                $payoutByUid[$puid] = $amount;
            }
        }
        // 全員 score + payout を 記録
        foreach ($scoreByUid as $puid => $sc) {
            $payout = $payoutByUid[$puid] ?? 0;
            $pdo->prepare("UPDATE predictions_entries SET score = ?, payout = ? WHERE game_id = ? AND user_id = ?")
                ->execute([$sc, $payout, $gid, $puid]);
        }
        $pdo->prepare("UPDATE predictions_games SET status='finished', actual_json=?, finished_at=NOW() WHERE id = ?")
            ->execute([json_encode($cleanActual, JSON_UNESCAPED_UNICODE), $gid]);
        // 全参加者に通知
        foreach ($scoreByUid as $puid => $score) {
            try {
                $payout = (int)$pdo->query("SELECT payout FROM predictions_entries WHERE game_id = {$gid} AND user_id = {$puid}")->fetchColumn();
                notify_safely($pdo, $cfg, (int)$puid, 'admin_notice',
                    "🏆 予想 「{$g['title']}」 結果開示! スコア {$score} / payout {$payout}pt",
                    'prediction', $gid);
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

function predictions_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $stG = $pdo->prepare("SELECT * FROM predictions_games WHERE id = ? FOR UPDATE");
        $stG->execute([$gid]);
        $g = $stG->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if (!in_array($g['status'], ['open','closed'], true)) throw new ApiException('bad_request', '既に終了', 400);
        $fee = (int)$g['fee'];
        $stE = $pdo->prepare("SELECT user_id FROM predictions_entries WHERE game_id = ?");
        $stE->execute([$gid]);
        foreach ($stE->fetchAll(PDO::FETCH_COLUMN) as $pid) {
            Ledger::transfer($pdo, 1, (int)$pid, $fee, 'mahjong_refund', 'predictions', $gid, "予想 #{$gid} キャンセル返金");
        }
        $pdo->prepare("UPDATE predictions_games SET status='cancelled', finished_at=NOW(), pot_total=0 WHERE id = ?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}
