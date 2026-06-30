<?php
// v634 ⚾ ドラフトハンドラ。 プロ野球風順番指名 + くじ抽選。
//
// state_json の形:
// {
//   "round": 1,                              // 現ラウンド (1 から)
//   "phase": "picking",                      // picking / reveal / lottery / lottery_reveal / finished
//   "pending": [uid, uid, ...],              // この round で指名まだの uid
//   "submitted": { "uid": cand, ... },       // この round で自分の希望を出した分 (= 公開前は自分のしか見えない)
//   "confirmed": {                           // 確定した指名 (累積)
//      "1": { "uid": cand, ... },           //   round 1 の確定
//      "2": { ... },
//      ...
//   },
//   "lottery": null or {
//      "candidate": cand,
//      "contenders": [uid, ...],            // 競合した人
//      "winning_stick": k,                  // 勝ちくじの index (公開前は自分の draw のみ返す)
//      "draws": { "uid": stick_index, ... },
//   }
// }

declare(strict_types=1);

function route_drafts(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    if (!isset($seg[1])) {
        if ($method === 'GET')  { drafts_list($pdo, $uid); return; }
        if ($method === 'POST') { drafts_create($pdo, $cfg, $uid); return; }
    }
    $did = (int)$seg[1];
    $action = $seg[2] ?? '';
    if ($action === '' && $method === 'GET')        { drafts_get($pdo, $uid, $did); return; }
    if ($action === 'pick' && $method === 'POST')   { drafts_pick($pdo, $uid, $did); return; }
    if ($action === 'draw' && $method === 'POST')   { drafts_draw($pdo, $uid, $did); return; }
    if ($action === 'advance' && $method === 'POST'){ drafts_advance($pdo, $cfg, $uid, $did); return; }
    if ($action === 'cancel' && $method === 'POST') { drafts_cancel($pdo, $uid, $did); return; }
    throw new ApiException('not_found', 'no draft route', 404);
}

function drafts_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT d.id, d.creator_user_id, uc.display_name AS creator_name,
                                d.title, d.target_type, d.status, d.created_at, d.finished_at,
                                d.participants_json
                           FROM drafts d JOIN users uc ON uc.id=d.creator_user_id
                          WHERE d.status='active'
                             OR (d.status<>'active' AND d.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY))
                          ORDER BY d.id DESC LIMIT 30");
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $pids = json_decode($r['participants_json'] ?: '[]', true) ?: [];
        $r['me_in'] = in_array($uid, array_map('intval', $pids), true);
        $r['participant_count'] = count($pids);
        unset($r['participants_json']);
    }
    json_response(['items' => $rows]);
}

function drafts_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $targetType = (string)($body['target_type'] ?? 'user');
    if (!in_array($targetType, ['user', 'text'], true)) throw new ApiException('bad_request', 'target_type は user/text', 400);
    $candidates = $body['candidates'] ?? [];
    if (!is_array($candidates) || count($candidates) < 1) throw new ApiException('bad_request', '候補 1 件以上', 400);
    $participants = $body['participants'] ?? [];
    if (!is_array($participants) || count($participants) < 2) throw new ApiException('bad_request', '参加者 2 人以上', 400);

    // 参加者 (creator を必ず含める)
    $participants = array_values(array_unique(array_map('intval', $participants)));
    if (!in_array($uid, $participants, true)) array_unshift($participants, $uid);
    $place = implode(',', array_fill(0, count($participants), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($participants);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) !== count($participants)) throw new ApiException('bad_request', '無効な参加者', 400);

    // 候補 (user mode は uid 配列、 text mode は文字列配列)
    if ($targetType === 'user') {
        $candidates = array_values(array_unique(array_map('intval', $candidates)));
        $place2 = implode(',', array_fill(0, count($candidates), '?'));
        $stC = $pdo->prepare("SELECT id FROM users WHERE id IN ($place2) AND kind='human'");
        $stC->execute($candidates);
        $vc = array_map(fn($r) => (int)$r['id'], $stC->fetchAll(PDO::FETCH_ASSOC));
        if (count($vc) !== count($candidates)) throw new ApiException('bad_request', '無効な候補ユーザ', 400);
    } else {
        $candidates = array_values(array_filter(array_map(fn($c) => trim((string)$c), $candidates), fn($s) => $s !== ''));
        $candidates = array_values(array_unique($candidates));
        if (!count($candidates)) throw new ApiException('bad_request', '候補テキスト 1 件以上', 400);
        foreach ($candidates as $c) if (mb_strlen($c) > 80) throw new ApiException('bad_request', '候補は 80 文字以内', 400);
    }

    $state = [
        'round'     => 1,
        'phase'     => 'picking',
        'pending'   => $participants,
        'submitted' => new \stdClass(),
        'confirmed' => new \stdClass(),
        'lottery'   => null,
    ];
    $pdo->prepare("INSERT INTO drafts (creator_user_id, title, target_type, candidates_json, participants_json, state_json) VALUES (?,?,?,?,?,?)")
        ->execute([$uid, $title, $targetType, json_encode($candidates, JSON_UNESCAPED_UNICODE),
                   json_encode($participants), json_encode($state, JSON_UNESCAPED_UNICODE)]);
    $did = (int)$pdo->lastInsertId();
    // 参加者 (自分以外) に通知
    $stN = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
    $stN->execute([$uid]); $byName = (string)$stN->fetchColumn();
    foreach ($participants as $pid) {
        if ($pid === $uid) continue;
        try { notify_safely($pdo, $cfg, $pid, 'admin_notice',
            "⚾ {$byName} さんから 「{$title}」 ドラフトに参加を招待されました", 'drafts', $did); }
        catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $did]);
}

// 詳細取得 (per-user filtering: 自分の submitted のみ公開前は見える)
function drafts_get(PDO $pdo, int $uid, int $did): void {
    $st = $pdo->prepare("SELECT d.*, uc.display_name AS creator_name FROM drafts d JOIN users uc ON uc.id=d.creator_user_id WHERE d.id=?");
    $st->execute([$did]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);
    $candidates = json_decode($g['candidates_json'], true) ?: [];
    $participants = json_decode($g['participants_json'], true) ?: [];
    $state = json_decode($g['state_json'], true) ?: [];

    // 候補 / 参加者の表示名を引いておく (user mode の候補 + 参加者一覧)
    $needIds = array_unique(array_merge(array_map('intval', $participants),
        $g['target_type'] === 'user' ? array_map('intval', $candidates) : []));
    $names = [];
    if ($needIds) {
        $place = implode(',', array_fill(0, count($needIds), '?'));
        $stN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
        $stN->execute($needIds);
        foreach ($stN->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];
    }
    $candidateList = array_map(function ($c) use ($g, $names) {
        return $g['target_type'] === 'user'
            ? ['id' => (int)$c, 'label' => ($names[(int)$c] ?? 'user#'.$c)]
            : ['id' => $c, 'label' => $c];
    }, $candidates);
    $participantList = array_map(fn($p) => ['uid' => (int)$p, 'name' => ($names[(int)$p] ?? 'user#'.$p)], $participants);

    // per-user フィルタ
    $isCreator = (int)$g['creator_user_id'] === $uid;
    $phase = $state['phase'] ?? 'picking';
    // submitted: picking 中は自分のしか返さない。 reveal 以降は全員。
    $submitted = $state['submitted'] ?? [];
    if ($phase === 'picking') {
        $submitted = isset($submitted[(string)$uid]) ? [(string)$uid => $submitted[(string)$uid]] : [];
    }
    // lottery: lottery 中は自分の draw + winning_stick 隠す。 reveal で全部見せる。
    $lottery = $state['lottery'];
    if ($lottery) {
        if ($phase === 'lottery') {
            $myDraw = $lottery['draws'][(string)$uid] ?? null;
            $lottery = [
                'candidate' => $lottery['candidate'],
                'candidate_label' => drafts_label($lottery['candidate'], $candidateList),
                'contenders' => $lottery['contenders'],
                'stick_count' => count($lottery['contenders']),
                'my_draw' => $myDraw,
                'drawn_count' => count(array_keys($lottery['draws'])),
            ];
        } else if ($phase === 'lottery_reveal') {
            $lottery['candidate_label'] = drafts_label($lottery['candidate'], $candidateList);
        }
    }

    json_response([
        'id' => (int)$g['id'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name' => $g['creator_name'],
        'title' => $g['title'],
        'target_type' => $g['target_type'],
        'status' => $g['status'],
        'candidates' => $candidateList,
        'participants' => $participantList,
        'i_am_creator' => $isCreator,
        'i_am_participant' => in_array($uid, array_map('intval', $participants), true),
        'round' => (int)($state['round'] ?? 1),
        'phase' => $phase,
        'pending' => $state['pending'] ?? [],
        'submitted' => $submitted,
        'confirmed' => $state['confirmed'] ?? new \stdClass(),
        'lottery' => $lottery,
        'created_at' => $g['created_at'],
        'finished_at' => $g['finished_at'],
    ]);
}

function drafts_label($candId, array $candidateList): string {
    foreach ($candidateList as $c) if ((string)$c['id'] === (string)$candId) return (string)$c['label'];
    return (string)$candId;
}

// 指名の提出
function drafts_pick(PDO $pdo, int $uid, int $did): void {
    $body = read_json_body();
    $value = $body['value'] ?? null;
    if ($value === null || $value === '') throw new ApiException('bad_request', 'value 必須', 400);
    db_tx($pdo, function () use ($pdo, $uid, $did, $value) {
        $g = drafts_lock($pdo, $did);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'picking') throw new ApiException('bad_request', '今は提出フェーズではない', 400);
        $pending = array_map('intval', $state['pending'] ?? []);
        if (!in_array($uid, $pending, true)) throw new ApiException('forbidden', 'あなたは今指名する番ではない', 403);

        // value の有効性: 候補に含まれて、 自分がまだ確定で取ってないこと
        $candidates = json_decode($g['candidates_json'], true) ?: [];
        $candValues = array_map(fn($c) => $g['target_type'] === 'user' ? (int)$c : (string)$c, $candidates);
        $pickVal = $g['target_type'] === 'user' ? (int)$value : (string)$value;
        if (!in_array($pickVal, $candValues, $g['target_type'] === 'user')) {
            throw new ApiException('bad_request', '候補外', 400);
        }
        // 既に確定したものか?
        $confirmed = $state['confirmed'] ?? [];
        $myConfirmed = [];
        foreach ($confirmed as $rd => $byUser) {
            if (isset($byUser[(string)$uid])) $myConfirmed[] = $byUser[(string)$uid];
        }
        if (in_array($pickVal, $myConfirmed, $g['target_type'] === 'user')) {
            throw new ApiException('bad_request', 'それは既に確定済', 400);
        }
        // 他人が既に確定で取ったものは ?
        foreach ($confirmed as $rd => $byUser) {
            foreach ($byUser as $puid => $picked) {
                if ((int)$puid !== $uid && (string)$picked === (string)$pickVal) {
                    throw new ApiException('bad_request', 'それは他の人が確定済', 400);
                }
            }
        }
        // 提出
        $submitted = $state['submitted'] ?? [];
        $submitted[(string)$uid] = $pickVal;
        $state['submitted'] = $submitted;
        // 全員出した?
        $allSubmitted = true;
        foreach ($pending as $pu) if (!isset($submitted[(string)$pu])) { $allSubmitted = false; break; }
        if ($allSubmitted) $state['phase'] = 'reveal';
        drafts_save($pdo, $did, $state);
    });
    json_response(['ok' => true]);
}

// くじを引く
function drafts_draw(PDO $pdo, int $uid, int $did): void {
    $body = read_json_body();
    $stick = (int)($body['stick'] ?? -1);
    db_tx($pdo, function () use ($pdo, $uid, $did, $stick) {
        $g = drafts_lock($pdo, $did);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'lottery') throw new ApiException('bad_request', '今はくじ引きフェーズではない', 400);
        $lottery = $state['lottery'];
        $contenders = array_map('intval', $lottery['contenders']);
        if (!in_array($uid, $contenders, true)) throw new ApiException('forbidden', '対象ではない', 403);
        if (isset($lottery['draws'][(string)$uid])) throw new ApiException('bad_request', '既に引いた', 400);
        $n = count($contenders);
        if ($stick < 0 || $stick >= $n) throw new ApiException('bad_request', 'stick は 0..N-1', 400);
        // 同じ stick を他人が引いていたら NG
        foreach ($lottery['draws'] as $u => $s) {
            if ((int)$s === $stick) throw new ApiException('bad_request', 'そのくじは既に取られた', 400);
        }
        $lottery['draws'][(string)$uid] = $stick;
        $state['lottery'] = $lottery;
        // 全員引いた?
        if (count($lottery['draws']) === $n) {
            $state['phase'] = 'lottery_reveal';
        }
        drafts_save($pdo, $did, $state);
    });
    json_response(['ok' => true]);
}

// creator が 「次へ」 押す。 reveal や lottery_reveal から進める。
function drafts_advance(PDO $pdo, array $cfg, int $uid, int $did): void {
    db_tx($pdo, function () use ($pdo, $cfg, $uid, $did) {
        $g = drafts_lock($pdo, $did);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        $state = json_decode($g['state_json'], true);
        $phase = $state['phase'];
        $candidates = json_decode($g['candidates_json'], true) ?: [];
        $participants = array_map('intval', json_decode($g['participants_json'], true) ?: []);
        $isUser = $g['target_type'] === 'user';

        if ($phase === 'reveal') {
            // 集計: 候補ごとに誰が出したか
            $byCandidate = [];
            foreach ($state['submitted'] as $u => $v) {
                $key = (string)$v;
                $byCandidate[$key] = $byCandidate[$key] ?? [];
                $byCandidate[$key][] = (int)$u;
            }
            // 単独 = 確定、 競合 = 後でくじ
            $round = (int)$state['round'];
            $confirmed = $state['confirmed'] ?? [];
            $confirmed[(string)$round] = $confirmed[(string)$round] ?? [];
            $stillContested = [];
            foreach ($byCandidate as $candKey => $uids) {
                if (count($uids) === 1) {
                    $confirmed[(string)$round][(string)$uids[0]] = $isUser ? (int)$candKey : $candKey;
                } else {
                    $stillContested[$candKey] = $uids;
                }
            }
            $state['confirmed'] = $confirmed;
            $state['submitted'] = new \stdClass();
            if (count($stillContested) > 0) {
                $firstKey = array_keys($stillContested)[0];
                $contenders = $stillContested[$firstKey];
                shuffle($contenders);
                $state['lottery'] = [
                    'candidate' => $isUser ? (int)$firstKey : $firstKey,
                    'contenders' => $contenders,
                    'winning_stick' => random_int(0, count($contenders) - 1),
                    'draws' => new \stdClass(),
                    'remaining_contests' => array_slice($stillContested, 1, null, true), // 残りの競合
                ];
                $state['phase'] = 'lottery';
            } else {
                // 競合なし → 次の picking or 次 round
                drafts_advance_after_round_pick($state, $participants, $candidates, $isUser);
            }
        }
        else if ($phase === 'lottery_reveal') {
            $lottery = $state['lottery'];
            $round = (int)$state['round'];
            $winningStick = (int)$lottery['winning_stick'];
            $winnerUid = null;
            foreach ($lottery['draws'] as $u => $s) {
                if ((int)$s === $winningStick) { $winnerUid = (int)$u; break; }
            }
            $confirmed = $state['confirmed'] ?? [];
            $confirmed[(string)$round] = $confirmed[(string)$round] ?? [];
            if ($winnerUid !== null) {
                $confirmed[(string)$round][(string)$winnerUid] = $lottery['candidate'];
            }
            $state['confirmed'] = $confirmed;
            // 残り競合があれば次のくじへ
            $remaining = $lottery['remaining_contests'] ?? [];
            if (count($remaining) > 0) {
                $firstKey = array_keys($remaining)[0];
                $contenders = $remaining[$firstKey];
                shuffle($contenders);
                $state['lottery'] = [
                    'candidate' => $isUser ? (int)$firstKey : $firstKey,
                    'contenders' => $contenders,
                    'winning_stick' => random_int(0, count($contenders) - 1),
                    'draws' => new \stdClass(),
                    'remaining_contests' => array_slice($remaining, 1, null, true),
                ];
                $state['phase'] = 'lottery';
            } else {
                $state['lottery'] = null;
                drafts_advance_after_round_pick($state, $participants, $candidates, $isUser);
            }
        }
        else {
            throw new ApiException('bad_request', '今は進められない phase', 400);
        }
        drafts_save($pdo, $did, $state);
        if ($state['phase'] === 'finished') {
            $pdo->prepare("UPDATE drafts SET status='finished', finished_at=NOW() WHERE id=?")->execute([$did]);
            try {
                foreach ($participants as $p) {
                    notify_safely($pdo, $cfg, $p, 'admin_notice', "⚾ ドラフト 「{$g['title']}」 終了。 結果を確認してください", 'drafts', $did);
                }
            } catch (Throwable $_) {}
        }
    });
    json_response(['ok' => true]);
}

// くじの確定 / 競合なしのあとの round 進行を決める
function drafts_advance_after_round_pick(array &$state, array $participants, array $candidates, bool $isUser): void {
    $round = (int)$state['round'];
    $confirmed = $state['confirmed'][(string)$round] ?? [];
    // この round で確定した uid
    $picked = array_keys($confirmed);
    // この round でまだ確定してない参加者 = ハズレた人 → もう一度 picking
    $stillPending = [];
    foreach ($participants as $p) {
        if (!isset($confirmed[(string)$p])) $stillPending[] = $p;
    }
    if (count($stillPending) > 0) {
        // 1 人だけなら残り候補から自動確定? いや、 仕様通り picking させる (1 人なら即確定)
        $state['phase'] = 'picking';
        $state['pending'] = $stillPending;
        return;
    }
    // 全員確定 → 次 round へ
    // 残り候補を計算
    $allConfirmed = [];
    foreach ($state['confirmed'] as $rd => $byUser) {
        foreach ($byUser as $u => $v) $allConfirmed[] = $isUser ? (int)$v : (string)$v;
    }
    $remaining = array_values(array_diff(
        array_map(fn($c) => $isUser ? (int)$c : (string)$c, $candidates),
        $allConfirmed
    ));
    if (count($remaining) < 1 || count($remaining) < count($participants)) {
        // 候補が参加者数を下回ったら終了 (= 全員が次 round で取れない)
        // ただし残り >= 1 なら 「もう 1 round 走らせて取れる人だけ取る」 でも良い。
        // ここでは 「全員取れる」 という公平性優先で終了。
        $state['phase'] = 'finished';
        return;
    }
    $state['round'] = $round + 1;
    $state['phase'] = 'picking';
    $state['pending'] = $participants;
    $state['submitted'] = new \stdClass();
}

function drafts_cancel(PDO $pdo, int $uid, int $did): void {
    db_tx($pdo, function () use ($pdo, $uid, $did) {
        $g = drafts_lock($pdo, $did);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if ($g['status'] !== 'active') throw new ApiException('bad_request', 'already inactive', 400);
        $pdo->prepare("UPDATE drafts SET status='cancelled', finished_at=NOW() WHERE id=?")->execute([$did]);
    });
    json_response(['ok' => true]);
}

function drafts_lock(PDO $pdo, int $did): array {
    $st = $pdo->prepare("SELECT * FROM drafts WHERE id=? FOR UPDATE");
    $st->execute([$did]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'draft not found', 404);
    if ($g['status'] !== 'active') throw new ApiException('bad_request', 'draft is not active', 400);
    return $g;
}

function drafts_save(PDO $pdo, int $did, array $state): void {
    $pdo->prepare("UPDATE drafts SET state_json=? WHERE id=?")
        ->execute([json_encode($state, JSON_UNESCAPED_UNICODE), $did]);
}
