<?php
// v635 📝 フリップクイズハンドラ。
//
// state machine:
//   asking     - 出題者が問題文を入力中 (参加者は待機)
//   answering  - 参加者がフリップに回答中 (各自の回答は公開前隠す)
//   reveal     - 全員の回答を一斉開示 (タップで拡大表示)
//   scored     - 出題者がマルバツ採点済、次の問へボタン
//   finished   - 終了 (集計表示)
//
// 累積集計 = history[] に各問の {q, answers, scores} が残る。

declare(strict_types=1);

function route_quizzes(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) {
        if ($method === 'GET')  { quizzes_list($pdo, $uid); return; }
        if ($method === 'POST') { quizzes_create($pdo, $cfg, $uid); return; }
    }
    $qid = (int)$seg[1];
    $action = $seg[2] ?? '';
    if ($action === '' && $method === 'GET')          { quizzes_get($pdo, $uid, $qid); return; }
    if ($action === 'ask' && $method === 'POST')      { quizzes_ask($pdo, $uid, $qid); return; }
    if ($action === 'answer' && $method === 'POST')   { quizzes_answer($pdo, $uid, $qid); return; }
    if ($action === 'reveal' && $method === 'POST')   { quizzes_reveal($pdo, $uid, $qid); return; }
    if ($action === 'score' && $method === 'POST')    { quizzes_score($pdo, $uid, $qid); return; }
    if ($action === 'next' && $method === 'POST')     { quizzes_next($pdo, $uid, $qid); return; }
    if ($action === 'finish' && $method === 'POST')   { quizzes_finish($pdo, $uid, $qid); return; }
    if ($action === 'cancel' && $method === 'POST')   { quizzes_cancel($pdo, $uid, $qid); return; }
    throw new ApiException('not_found', 'no quiz route', 404);
}

function quizzes_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT q.id, q.creator_user_id, uc.display_name AS creator_name,
                                q.title, q.status, q.created_at, q.finished_at, q.participants_json
                           FROM quizzes q JOIN users uc ON uc.id=q.creator_user_id
                          WHERE q.status='active'
                             OR (q.status<>'active' AND q.finished_at > DATE_SUB(NOW(), INTERVAL 7 DAY))
                          ORDER BY q.id DESC LIMIT 30");
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

function quizzes_create(PDO $pdo, array $cfg, int $uid): void {
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $mode = (string)($body['mode'] ?? 'text');
    if (!in_array($mode, ['text', 'verbal'], true)) throw new ApiException('bad_request', 'mode は text/verbal', 400);
    $participants = $body['participants'] ?? [];
    if (!is_array($participants) || count($participants) < 1) throw new ApiException('bad_request', '参加者 1 人以上', 400);
    $participants = array_values(array_unique(array_map('intval', $participants)));
    // creator も自動で参加者に入れる (= 解答者でもある)
    if (!in_array($uid, $participants, true)) array_unshift($participants, $uid);
    $place = implode(',', array_fill(0, count($participants), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($participants);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) !== count($participants)) throw new ApiException('bad_request', '無効な参加者', 400);

    $state = [
        'current_q' => 1,
        'phase' => 'asking',
        'question' => null,
        'answers' => new \stdClass(),
        'scores' => new \stdClass(),
        'history' => [],
    ];
    $pdo->prepare("INSERT INTO quizzes (creator_user_id, title, mode, participants_json, state_json) VALUES (?,?,?,?,?)")
        ->execute([$uid, $title, $mode, json_encode($participants), json_encode($state, JSON_UNESCAPED_UNICODE)]);
    $qid = (int)$pdo->lastInsertId();
    $stN = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
    $stN->execute([$uid]); $byName = (string)$stN->fetchColumn();
    foreach ($participants as $pid) {
        if ($pid === $uid) continue;
        try { notify_safely($pdo, $cfg, $pid, 'admin_notice',
            "📝 {$byName} さんからクイズ「{$title}」に招待されました", 'quizzes', $qid); }
        catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $qid]);
}

function quizzes_get(PDO $pdo, int $uid, int $qid): void {
    $st = $pdo->prepare("SELECT q.*, uc.display_name AS creator_name FROM quizzes q JOIN users uc ON uc.id=q.creator_user_id WHERE q.id=?");
    $st->execute([$qid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);
    $participants = json_decode($g['participants_json'], true) ?: [];
    $state = json_decode($g['state_json'], true) ?: [];

    // 名前解決
    $names = [];
    if ($participants) {
        $place = implode(',', array_fill(0, count($participants), '?'));
        $stN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
        $stN->execute($participants);
        foreach ($stN->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];
    }
    $participantList = array_map(fn($p) => ['uid' => (int)$p, 'name' => ($names[(int)$p] ?? 'user#'.$p)], $participants);

    // per-user フィルタ: answering 中は自分の回答だけ返す
    $phase = $state['phase'] ?? 'asking';
    $answers = $state['answers'] ?? [];
    if ($phase === 'answering') {
        $answers = isset($answers[(string)$uid]) ? [(string)$uid => $answers[(string)$uid]] : [];
    }

    // 累積集計 (history から各 uid の正解数)
    $totalScores = [];
    foreach ($participants as $p) $totalScores[(string)$p] = 0;
    foreach ($state['history'] ?? [] as $h) {
        foreach (($h['scores'] ?? []) as $u => $s) {
            if (isset($totalScores[(string)$u])) $totalScores[(string)$u] += (int)$s;
        }
    }

    json_response([
        'id' => (int)$g['id'],
        'creator_user_id' => (int)$g['creator_user_id'],
        'creator_name' => $g['creator_name'],
        'title' => $g['title'],
        'mode' => $g['mode'] ?? 'text',
        'status' => $g['status'],
        'participants' => $participantList,
        'i_am_creator' => (int)$g['creator_user_id'] === $uid,
        'i_am_participant' => in_array($uid, array_map('intval', $participants), true),
        'current_q' => (int)($state['current_q'] ?? 1),
        'phase' => $phase,
        'question' => $state['question'] ?? null,
        'answers' => $answers,
        'scores' => $state['scores'] ?? new \stdClass(),
        'history' => $state['history'] ?? [],
        'total_scores' => $totalScores,
        'total_questions' => count($state['history'] ?? []),
        'created_at' => $g['created_at'],
        'finished_at' => $g['finished_at'],
    ]);
}

// 出題者が問題文を出題 (asking → answering)
//   verbal モードでは question が空でも OK (= 「口頭で出題、解答開始」)
function quizzes_ask(PDO $pdo, int $uid, int $qid): void {
    $body = read_json_body();
    $question = trim((string)($body['question'] ?? ''));
    if (mb_strlen($question) > 500) throw new ApiException('bad_request', 'question は 500 文字以内', 400);
    db_tx($pdo, function () use ($pdo, $uid, $qid, $question) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'asking') throw new ApiException('bad_request', '今は出題フェーズではない', 400);
        $mode = $g['mode'] ?? 'text';
        if ($mode === 'text' && $question === '') {
            throw new ApiException('bad_request', '問題文を入力してください (口頭モードで作成するとテキスト不要)', 400);
        }
        $state['question'] = $question;   // verbal モードなら空文字列で OK
        $state['answers'] = new \stdClass();
        $state['phase'] = 'answering';
        quizzes_save($pdo, $qid, $state);
    });
    json_response(['ok' => true]);
}

// 参加者が回答提出
function quizzes_answer(PDO $pdo, int $uid, int $qid): void {
    $body = read_json_body();
    $answer = trim((string)($body['answer'] ?? ''));
    if (mb_strlen($answer) > 200) throw new ApiException('bad_request', 'answer は 200 文字以内', 400);
    db_tx($pdo, function () use ($pdo, $uid, $qid, $answer) {
        $g = quizzes_lock($pdo, $qid);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'answering') throw new ApiException('bad_request', '今は回答フェーズではない', 400);
        $participants = array_map('intval', json_decode($g['participants_json'], true) ?: []);
        if (!in_array($uid, $participants, true)) throw new ApiException('forbidden', '参加者ではない', 403);
        $state['answers'][(string)$uid] = $answer;
        quizzes_save($pdo, $qid, $state);
    });
    json_response(['ok' => true]);
}

// 出題者が「開示」 → reveal phase へ (= 全員出揃ってなくても強制開示可能)
function quizzes_reveal(PDO $pdo, int $uid, int $qid): void {
    db_tx($pdo, function () use ($pdo, $uid, $qid) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'answering') throw new ApiException('bad_request', '今は回答中ではない', 400);
        $state['phase'] = 'reveal';
        quizzes_save($pdo, $qid, $state);
    });
    json_response(['ok' => true]);
}

// 出題者がマルバツ採点 (= scores オブジェクトをそのまま受付)
function quizzes_score(PDO $pdo, int $uid, int $qid): void {
    $body = read_json_body();
    $scores = $body['scores'] ?? null;
    if (!is_array($scores)) throw new ApiException('bad_request', 'scores 必須', 400);
    db_tx($pdo, function () use ($pdo, $uid, $qid, $scores) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'reveal') throw new ApiException('bad_request', '今は開示後ではない', 400);
        $participants = array_map('intval', json_decode($g['participants_json'], true) ?: []);
        $clean = [];
        foreach ($scores as $u => $s) {
            $uu = (int)$u;
            if (!in_array($uu, $participants, true)) continue;
            $clean[(string)$uu] = $s ? 1 : 0;
        }
        $state['scores'] = $clean;
        $state['phase'] = 'scored';
        quizzes_save($pdo, $qid, $state);
    });
    json_response(['ok' => true]);
}

// 次の問へ (history に push、 phase を asking に戻す)
function quizzes_next(PDO $pdo, int $uid, int $qid): void {
    db_tx($pdo, function () use ($pdo, $uid, $qid) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        $state = json_decode($g['state_json'], true);
        if ($state['phase'] !== 'scored') throw new ApiException('bad_request', '採点後のみ次へ', 400);
        $history = $state['history'] ?? [];
        $history[] = [
            'q'       => $state['question'],
            'answers' => $state['answers'],
            'scores'  => $state['scores'],
        ];
        $state['history'] = $history;
        $state['current_q'] = (int)$state['current_q'] + 1;
        $state['phase']    = 'asking';
        $state['question'] = null;
        $state['answers']  = new \stdClass();
        $state['scores']   = new \stdClass();
        quizzes_save($pdo, $qid, $state);
    });
    json_response(['ok' => true]);
}

// 終了 (= scored のあと、出題者が「ここで終わる」を押した時)
function quizzes_finish(PDO $pdo, int $uid, int $qid): void {
    db_tx($pdo, function () use ($pdo, $uid, $qid) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        $state = json_decode($g['state_json'], true);
        // 採点済なら現問も history に追加
        if ($state['phase'] === 'scored') {
            $history = $state['history'] ?? [];
            $history[] = [
                'q'       => $state['question'],
                'answers' => $state['answers'],
                'scores'  => $state['scores'],
            ];
            $state['history'] = $history;
        }
        $state['phase'] = 'finished';
        quizzes_save($pdo, $qid, $state);
        $pdo->prepare("UPDATE quizzes SET status='finished', finished_at=NOW() WHERE id=?")->execute([$qid]);
    });
    json_response(['ok' => true]);
}

function quizzes_cancel(PDO $pdo, int $uid, int $qid): void {
    db_tx($pdo, function () use ($pdo, $uid, $qid) {
        $g = quizzes_lock($pdo, $qid);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '出題者のみ', 403);
        if ($g['status'] !== 'active') throw new ApiException('bad_request', 'already inactive', 400);
        $pdo->prepare("UPDATE quizzes SET status='cancelled', finished_at=NOW() WHERE id=?")->execute([$qid]);
    });
    json_response(['ok' => true]);
}

function quizzes_lock(PDO $pdo, int $qid): array {
    $st = $pdo->prepare("SELECT * FROM quizzes WHERE id=? FOR UPDATE");
    $st->execute([$qid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'quiz not found', 404);
    if ($g['status'] !== 'active') throw new ApiException('bad_request', 'quiz is not active', 400);
    return $g;
}

function quizzes_save(PDO $pdo, int $qid, array $state): void {
    $pdo->prepare("UPDATE quizzes SET state_json=? WHERE id=?")
        ->execute([json_encode($state, JSON_UNESCAPED_UNICODE), $qid]);
}
