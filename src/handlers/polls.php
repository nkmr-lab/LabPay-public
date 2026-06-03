<?php
// /api/polls — 投票 (polls)。
// 個人の票はデフォルト非公開。 起案者 / 締切後 / open visibility のときだけ
// 全体集計が見える。 「誰が何に入れたか」 は どの設定でも他者には見せない
// (起案者にも個別の票は見せず、 集計のみ)。

declare(strict_types=1);

const POLL_VISIBILITIES = ['creator','open','after_deadline'];

function route_polls(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { polls_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { polls_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { polls_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { polls_delete($pdo, $cfg, $id); return; }
        if ($next === 'vote'   && $method === 'POST')  { polls_vote($pdo, $cfg, $id); return; }
        if ($next === 'close'  && $method === 'PATCH') { polls_close($pdo, $cfg, $id); return; }
        if ($next === 'remind' && $method === 'POST')  { polls_remind($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no polls route for $method $sub", 404);
}

// 締切過ぎたら自動 close。 詳細 / 一覧の前に呼んで一貫した状態にする。
function polls_autoclose(PDO $pdo): void {
    $pdo->exec("UPDATE polls SET status='closed', closed_at=NOW()
                 WHERE status='open' AND deadline_at <= NOW()");
}

function polls_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    polls_autoclose($pdo);
    // 自分が対象 (poll_voters) または 自分が起案者の投票を新しい順に。
    $st = $pdo->prepare("
        SELECT p.id, p.title, p.deadline_at, p.multi_select, p.visibility, p.status,
               p.created_at, p.closed_at,
               p.creator_user_id, u.display_name AS creator_name,
               EXISTS(SELECT 1 FROM poll_voters pv2 WHERE pv2.poll_id=p.id AND pv2.user_id=? AND pv2.voted_at IS NOT NULL) AS has_voted,
               EXISTS(SELECT 1 FROM poll_voters pv3 WHERE pv3.poll_id=p.id AND pv3.user_id=?)                              AS is_voter,
               (SELECT COUNT(*) FROM poll_voters pv4 WHERE pv4.poll_id=p.id) AS voter_count,
               (SELECT COUNT(*) FROM poll_voters pv5 WHERE pv5.poll_id=p.id AND pv5.voted_at IS NOT NULL) AS voted_count
          FROM polls p
          JOIN users u ON u.id = p.creator_user_id
         WHERE p.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM poll_voters pv WHERE pv.poll_id=p.id AND pv.user_id=?)
         ORDER BY (p.status='open') DESC, p.deadline_at DESC, p.id DESC
         LIMIT 200");
    $st->execute([(int)$u['id'], (int)$u['id'], (int)$u['id'], (int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function polls_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $bodyText = isset($body['body']) ? mb_substr((string)$body['body'], 0, 2000) : null;
    if ($bodyText === '') $bodyText = null;
    $deadlineRaw = (string)($body['deadline_at'] ?? '');
    // ISO 「YYYY-MM-DDTHH:MM」 or 「YYYY-MM-DD HH:MM」。
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $deadlineRaw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $deadlineRaw);
    if (!$dt) throw new ApiException('bad_request', 'deadline_at は ISO 形式の日時', 400);
    $deadline = $dt->format('Y-m-d H:i:s');
    if (strtotime($deadline) <= time() + 30) {
        throw new ApiException('bad_request', '締切は現在より先に', 400);
    }
    $multi = !empty($body['multi_select']) ? 1 : 0;
    $allowRevote   = array_key_exists('allow_revote', $body)   ? (!empty($body['allow_revote'])   ? 1 : 0) : 1;
    $allowFreeText = !empty($body['allow_free_text']) ? 1 : 0;
    // 自由記述は 「複数選択可」 と組み合わせる前提。 単一選択で許可しても意味が
    // 無いので無効化 (UI 側のチェック漏れを backend でも止める)。
    if (!$multi) $allowFreeText = 0;
    $vis = (string)($body['visibility'] ?? 'after_deadline');
    if (!in_array($vis, POLL_VISIBILITIES, true)) {
        throw new ApiException('bad_request', 'visibility 不正', 400);
    }
    $opts = $body['options'] ?? [];
    if (!is_array($opts) || count($opts) < 2 || count($opts) > 30) {
        throw new ApiException('bad_request', '選択肢は 2〜30 個', 400);
    }
    $cleanOpts = [];
    foreach ($opts as $o) {
        $s = trim((string)$o);
        if ($s === '' || mb_strlen($s) > 200) continue;
        $cleanOpts[] = $s;
    }
    if (count($cleanOpts) < 2) {
        throw new ApiException('bad_request', '有効な選択肢が 2 つ以上必要', 400);
    }
    $voterIds = $body['voter_ids'] ?? [];
    if (!is_array($voterIds) || !count($voterIds)) {
        throw new ApiException('bad_request', '対象者を 1 人以上選んでください', 400);
    }
    $voterIds = array_values(array_unique(array_filter(array_map('intval', $voterIds))));
    if (!count($voterIds) || count($voterIds) > 200) {
        throw new ApiException('bad_request', '対象者数 1〜200', 400);
    }
    // 全員が users に居るか軽くチェック。
    $in = implode(',', array_fill(0, count($voterIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
    $stU->execute($voterIds);
    if ((int)$stU->fetchColumn() !== count($voterIds)) {
        throw new ApiException('bad_request', '存在しない user_id が含まれます', 400);
    }
    $pollId = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $bodyText, $deadline, $multi, $vis, $allowRevote, $allowFreeText, $cleanOpts, $voterIds, &$pollId) {
        $ins = $pdo->prepare("INSERT INTO polls (title, body, creator_user_id, deadline_at, multi_select, visibility, allow_revote, allow_free_text, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW())");
        $ins->execute([$title, $bodyText, (int)$u['id'], $deadline, $multi, $vis, $allowRevote, $allowFreeText]);
        $pollId = (int)$pdo->lastInsertId();
        $stO = $pdo->prepare("INSERT INTO poll_options (poll_id, label, sort_order) VALUES (?, ?, ?)");
        foreach ($cleanOpts as $i => $label) $stO->execute([$pollId, $label, $i]);
        $stV = $pdo->prepare("INSERT INTO poll_voters (poll_id, user_id) VALUES (?, ?)");
        foreach ($voterIds as $uid) $stV->execute([$pollId, $uid]);
    });
    // 通知: 自分以外の対象者に 「投票してください」 を送る。
    foreach ($voterIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'poll',
                "📊 投票: 「{$title}」 (締切 " . substr($deadline, 0, 16) . ")",
                'poll', $pollId);
        } catch (Throwable $_) { /* 通知失敗で create を壊さない */ }
    }
    json_response(['id' => $pollId]);
}

function polls_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    polls_autoclose($pdo);
    $st = $pdo->prepare("SELECT p.*, u.display_name AS creator_name
                           FROM polls p
                           JOIN users u ON u.id = p.creator_user_id
                          WHERE p.id = ?");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isCreator = (int)$poll['creator_user_id'] === (int)$u['id'];
    // 対象者リスト + 自分が対象か。
    $stV = $pdo->prepare("SELECT pv.user_id, pv.voted_at, u.display_name, u.avatar_url
                           FROM poll_voters pv
                           JOIN users u ON u.id = pv.user_id
                          WHERE pv.poll_id = ?
                          ORDER BY u.display_name");
    $stV->execute([$id]);
    $voters = $stV->fetchAll(PDO::FETCH_ASSOC);
    $isVoter = false;
    foreach ($voters as $v) if ((int)$v['user_id'] === (int)$u['id']) $isVoter = true;
    if (!$isCreator && !$isVoter) {
        throw new ApiException('forbidden', 'この投票の対象者または起案者のみ閲覧可', 403);
    }
    // 選択肢
    $stO = $pdo->prepare("SELECT id, label, sort_order FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id");
    $stO->execute([$id]);
    $options = $stO->fetchAll(PDO::FETCH_ASSOC);
    // 自分の票 (option_id の配列)
    $stMy = $pdo->prepare("SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?");
    $stMy->execute([$id, (int)$u['id']]);
    $myVotes = array_map('intval', array_column($stMy->fetchAll(PDO::FETCH_ASSOC), 'option_id'));
    // 自分の自由記述 (allow_free_text 有効時のみ意味あり)
    $stMyFt = $pdo->prepare("SELECT free_text FROM poll_voters WHERE poll_id=? AND user_id=?");
    $stMyFt->execute([$id, (int)$u['id']]);
    $myFreeText = (string)($stMyFt->fetchColumn() ?: '');
    // 集計の可視性
    $vis = (string)$poll['visibility'];
    $isClosed = (string)$poll['status'] === 'closed';
    $tallyVisible = $isCreator
        || ($vis === 'open' && !empty($myVotes))
        || ($vis === 'after_deadline' && $isClosed);
    $tallies = null;
    $freeTexts = null;
    if ($tallyVisible) {
        $stT = $pdo->prepare("SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_id");
        $stT->execute([$id]);
        $tallies = [];
        foreach ($stT->fetchAll(PDO::FETCH_ASSOC) as $r) $tallies[(int)$r['option_id']] = (int)$r['n'];
        // 自由記述は本文のみ。 user_id は晒さない (個人匿名集計の方針に合わせる)。
        if (!empty($poll['allow_free_text'])) {
            $stF = $pdo->prepare("SELECT free_text FROM poll_voters
                                   WHERE poll_id=? AND free_text IS NOT NULL AND free_text <> ''
                                   ORDER BY voted_at, user_id");
            $stF->execute([$id]);
            $freeTexts = array_map('strval', array_column($stF->fetchAll(PDO::FETCH_ASSOC), 'free_text'));
        }
    }
    json_response([
        'poll' => [
            'id' => (int)$poll['id'],
            'title' => $poll['title'],
            'body' => $poll['body'],
            'creator_user_id' => (int)$poll['creator_user_id'],
            'creator_name' => $poll['creator_name'],
            'deadline_at' => $poll['deadline_at'],
            'multi_select' => (bool)$poll['multi_select'],
            'allow_revote' => (bool)$poll['allow_revote'],
            'allow_free_text' => (bool)$poll['allow_free_text'],
            'visibility' => $vis,
            'status' => $poll['status'],
            'created_at' => $poll['created_at'],
            'closed_at' => $poll['closed_at'],
        ],
        'is_creator' => $isCreator,
        'is_voter' => $isVoter,
        'options' => $options,
        'voters' => array_map(fn($v) => [
            'user_id' => (int)$v['user_id'],
            'display_name' => $v['display_name'],
            'avatar_url' => $v['avatar_url'],
            'has_voted' => $v['voted_at'] !== null,
        ], $voters),
        'my_votes' => $myVotes,
        'my_free_text' => $myFreeText,
        'tally_visible' => $tallyVisible,
        'tallies' => $tallies,
        'free_texts' => $freeTexts,
    ]);
}

function polls_vote(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    polls_autoclose($pdo);
    $body = read_json_body();
    $optionIds = $body['option_ids'] ?? [];
    if (!is_array($optionIds)) throw new ApiException('bad_request', 'option_ids 配列', 400);
    $optionIds = array_values(array_unique(array_filter(array_map('intval', $optionIds))));
    $freeText = isset($body['free_text']) ? trim((string)$body['free_text']) : '';
    if ($freeText !== '') $freeText = mb_substr($freeText, 0, 2000);
    $st = $pdo->prepare("SELECT multi_select, allow_revote, allow_free_text, status FROM polls WHERE id = ?");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    if ((string)$poll['status'] !== 'open') throw new ApiException('closed', '締め切られた投票には投票できません', 400);
    if (empty($poll['multi_select']) && count($optionIds) > 1) {
        throw new ApiException('bad_request', '単一選択の投票です', 400);
    }
    // 投票内容のバリデーション。 自由記述 OK の時のみ 「候補 0 + 自由記述あり」
    // を許す (= 既存の選択肢に該当無し時の脱出口)。
    if (count($optionIds) === 0 && !(empty($poll['multi_select']) === false && !empty($poll['allow_free_text']) && $freeText !== '')) {
        throw new ApiException('bad_request',
            empty($poll['allow_free_text']) ? '1 つ以上選んでください' : '選択肢を選ぶか、 自由記述を書いてください',
            400);
    }
    // 対象者チェック + 再投票可否判定。
    $stV = $pdo->prepare("SELECT voted_at FROM poll_voters WHERE poll_id=? AND user_id=?");
    $stV->execute([$id, (int)$u['id']]);
    $voterRow = $stV->fetch(PDO::FETCH_ASSOC);
    if ($voterRow === false) {
        throw new ApiException('forbidden', 'この投票の対象者ではありません', 403);
    }
    if (empty($poll['allow_revote']) && $voterRow['voted_at'] !== null) {
        throw new ApiException('locked', '再投票は禁止されています', 400);
    }
    // 選択肢が同じ poll 内にあるか。
    if (count($optionIds)) {
        $in = implode(',', array_fill(0, count($optionIds), '?'));
        $stO = $pdo->prepare("SELECT COUNT(*) FROM poll_options WHERE poll_id=? AND id IN ($in)");
        $stO->execute(array_merge([$id], $optionIds));
        if ((int)$stO->fetchColumn() !== count($optionIds)) {
            throw new ApiException('bad_request', '選択肢が不正です', 400);
        }
    }
    $storeFreeText = (!empty($poll['allow_free_text']) && count($optionIds) === 0) ? $freeText : null;
    // 上書き: 既存の票を消して新規 insert。 free_text も上書き or NULL。
    db_tx($pdo, function () use ($pdo, $id, $u, $optionIds, $storeFreeText) {
        $pdo->prepare("DELETE FROM poll_votes WHERE poll_id=? AND user_id=?")->execute([$id, (int)$u['id']]);
        $ins = $pdo->prepare("INSERT INTO poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, NOW())");
        foreach ($optionIds as $oid) $ins->execute([$id, (int)$u['id'], $oid]);
        $pdo->prepare("UPDATE poll_voters SET voted_at=NOW(), free_text=? WHERE poll_id=? AND user_id=?")
            ->execute([$storeFreeText, $id, (int)$u['id']]);
    });
    json_response(['ok' => true]);
}

// 未投票の対象者に 「まだ投票してないよ」 push を一斉送信 (起案者のみ)。
// 過剰連打を避けるため、 polls.last_reminded_at は無いが、 1 回の API 呼び出しで
// 全員に 1 通だけ届くシンプル実装。 通知のレート制限は Notifier 側に任せる。
function polls_remind(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    polls_autoclose($pdo);
    $st = $pdo->prepare("SELECT title, creator_user_id, deadline_at, status FROM polls WHERE id=?");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$poll['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ催促可', 403);
    }
    if ((string)$poll['status'] !== 'open') {
        throw new ApiException('closed', '締切後は催促できません', 400);
    }
    $stV = $pdo->prepare("SELECT user_id FROM poll_voters WHERE poll_id=? AND voted_at IS NULL");
    $stV->execute([$id]);
    $ids = array_map('intval', array_column($stV->fetchAll(PDO::FETCH_ASSOC), 'user_id'));
    $sent = 0;
    foreach ($ids as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'poll',
                "📣 まだ未投票です: 「{$poll['title']}」 (締切 " . substr((string)$poll['deadline_at'], 0, 16) . ")",
                'poll', $id);
            $sent++;
        } catch (Throwable $_) { /* 通知失敗は無視して残りを送る */ }
    }
    json_response(['ok' => true, 'sent' => $sent, 'unvoted' => count($ids)]);
}

function polls_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status FROM polls WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ締切可', 403);
    }
    if ((string)$row['status'] !== 'open') {
        json_response(['ok' => true, 'already' => true]);
        return;
    }
    $pdo->prepare("UPDATE polls SET status='closed', closed_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function polls_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM polls WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM polls WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
