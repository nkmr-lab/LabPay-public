<?php
// /api/polls — 投票 (polls)。
// 個人の票はデフォルト非公開。起案者 / 締切後 / open visibility のときだけ
// 全体集計が見える。「誰が何に入れたか」はどの設定でも他者には見せない
// (起案者にも個別の票は見せず、集計のみ)。

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
        if ($next === '' && $method === 'PATCH')  { polls_update($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { polls_delete($pdo, $cfg, $id); return; }
        if ($next === 'vote'   && $method === 'POST')  { polls_vote($pdo, $cfg, $id); return; }
        if ($next === 'close'  && $method === 'PATCH') { polls_close($pdo, $cfg, $id); return; }
        if ($next === 'remind' && $method === 'POST')  { polls_remind($pdo, $cfg, $id); return; }
        // v912 選択肢に投票した人でグループを作る (起案者専用、締切後のみ)
        if ($next === 'create-group' && $method === 'POST') { polls_create_group($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no polls route for $method $sub", 404);
}

// 締切過ぎたら自動 close。詳細 / 一覧の前に呼んで一貫した状態にする。
function polls_autoclose(PDO $pdo): void {
    $pdo->exec("UPDATE polls SET status='closed', closed_at=NOW()
                 WHERE status='open' AND deadline_at <= NOW()");
}

function polls_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    polls_autoclose($pdo);
    // 自分が対象 (poll_voters) または自分が起案者の投票を新しい順に。
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
         WHERE p.deleted_at IS NULL
           AND (p.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM poll_voters pv WHERE pv.poll_id=p.id AND pv.user_id=?))
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
    // 自由記述は「複数選択可」と組み合わせる前提。単一選択で許可しても意味が
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
    // 通知: 自分以外の対象者に「投票してください」を送る。
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
                          WHERE p.id = ? AND p.deleted_at IS NULL");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isCreator = (int)$poll['creator_user_id'] === (int)$u['id'];
    // 対象者リスト + 自分が対象か。
    $stV = $pdo->prepare("SELECT pv.user_id, pv.voted_at, u.display_name, u.avatar_url, u.grade
                           FROM poll_voters pv
                           JOIN users u ON u.id = pv.user_id
                          WHERE pv.poll_id = ?
                          ORDER BY CASE u.grade
                                     WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                     WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                     WHEN 'D'  THEN 5 ELSE 99 END,
                                   u.display_name");
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
    $optionVoters = null;
    if ($tallyVisible) {
        $stT = $pdo->prepare("SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_id");
        $stT->execute([$id]);
        $tallies = [];
        foreach ($stT->fetchAll(PDO::FETCH_ASSOC) as $r) $tallies[(int)$r['option_id']] = (int)$r['n'];
        // v710 #302 各 option ごとに誰が投票したかを公開 (tally と同じ可視性)。
        $stOV = $pdo->prepare("SELECT pv.option_id, pv.user_id, u.display_name, u.avatar_url
                                 FROM poll_votes pv
                                 JOIN users u ON u.id = pv.user_id
                                WHERE pv.poll_id = ?
                                ORDER BY pv.option_id, u.display_name");
        $stOV->execute([$id]);
        $optionVoters = [];
        foreach ($stOV->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $oid = (int)$r['option_id'];
            $optionVoters[$oid] ??= [];
            $optionVoters[$oid][] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
            ];
        }
        // 自由記述本文は起案者だけに渡す (誰が書いたかも含めて参照したいのは起案者のみ)。
        // 一般の対象者には「他人の自由記述」を出さない方針。自分自身の自由記述は
        // my_free_text 経由で別途返している。
        if (!empty($poll['allow_free_text']) && $isCreator) {
            $stF = $pdo->prepare("SELECT pv.free_text, pv.user_id, pv.voted_at,
                                         u.display_name, u.avatar_url
                                    FROM poll_voters pv
                                    JOIN users u ON u.id = pv.user_id
                                   WHERE pv.poll_id=? AND pv.free_text IS NOT NULL AND pv.free_text <> ''
                                   ORDER BY pv.voted_at, pv.user_id");
            $stF->execute([$id]);
            $freeTexts = array_map(fn($r) => [
                'body'         => (string)$r['free_text'],
                'user_id'      => (int)$r['user_id'],
                'display_name' => (string)$r['display_name'],
                'avatar_url'   => $r['avatar_url'],
            ], $stF->fetchAll(PDO::FETCH_ASSOC));
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
            'grade' => $v['grade'] ?? '',
            'has_voted' => $v['voted_at'] !== null,
        ], $voters),
        'my_votes' => $myVotes,
        'my_free_text' => $myFreeText,
        'tally_visible' => $tallyVisible,
        'tallies' => $tallies,
        'option_voters' => $optionVoters,
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
    // 投票内容のバリデーション。自由記述 OK の時のみ「候補 0 + 自由記述あり」
    // を許す (= 既存の選択肢に該当無し時の脱出口)。
    if (count($optionIds) === 0 && !(empty($poll['multi_select']) === false && !empty($poll['allow_free_text']) && $freeText !== '')) {
        throw new ApiException('bad_request',
            empty($poll['allow_free_text']) ? '1 つ以上選んでください' : '選択肢を選ぶか、自由記述を書いてください',
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

// 未投票の対象者に「まだ投票してないよ」 push を一斉送信 (起案者のみ)。
// 過剰連打を避けるため、 polls.last_reminded_at は無いが、 1 回の API 呼び出しで
// 全員に 1 通だけ届くシンプル実装。通知のレート制限は Notifier 側に任せる。
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

// PATCH /api/polls/{id} — 起案者 / admin による編集。渡したフィールドだけ更新。
//   options : 配列が来たら「同じラベルは残し、無くなったものは削除 (=その option への票も cascade で消える)、
//             新規ラベルは追加」の差分更新。
//   voter_ids: 同様に差分更新。外された voter の票は削除。追加された voter は voted_at=NULL。
function polls_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM polls WHERE id=?");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$poll['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];

    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) throw new ApiException('bad_request', 'title 1..200', 400);
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('body', $body)) {
        $b = isset($body['body']) ? mb_substr((string)$body['body'], 0, 2000) : null;
        if ($b === '') $b = null;
        $sets[] = 'body = ?'; $args[] = $b;
    }
    if (array_key_exists('deadline_at', $body)) {
        $raw = (string)$body['deadline_at'];
        $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
           ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
           ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'deadline_at は ISO 日時', 400);
        $sets[] = 'deadline_at = ?'; $args[] = $dt->format('Y-m-d H:i:s');
    }
    $multiNow = (int)$poll['multi_select'];
    if (array_key_exists('multi_select', $body)) {
        $multiNow = !empty($body['multi_select']) ? 1 : 0;
        $sets[] = 'multi_select = ?'; $args[] = $multiNow;
    }
    if (array_key_exists('allow_revote', $body)) {
        $sets[] = 'allow_revote = ?'; $args[] = !empty($body['allow_revote']) ? 1 : 0;
    }
    if (array_key_exists('allow_free_text', $body)) {
        // 単一選択時は意味が無いので 0 に強制。
        $aft = (!empty($body['allow_free_text']) && $multiNow) ? 1 : 0;
        $sets[] = 'allow_free_text = ?'; $args[] = $aft;
    }
    if (array_key_exists('visibility', $body)) {
        $v = (string)$body['visibility'];
        if (!in_array($v, POLL_VISIBILITIES, true)) throw new ApiException('bad_request', 'visibility 不正', 400);
        $sets[] = 'visibility = ?'; $args[] = $v;
    }
    $newOptions = null;
    if (array_key_exists('options', $body)) {
        if (!is_array($body['options'])) throw new ApiException('bad_request', 'options 配列', 400);
        $newOptions = [];
        foreach ($body['options'] as $o) {
            $s = trim((string)$o);
            if ($s === '' || mb_strlen($s) > 200) continue;
            $newOptions[] = $s;
        }
        if (count($newOptions) < 2 || count($newOptions) > 30) {
            throw new ApiException('bad_request', '有効な選択肢が 2〜30 個必要', 400);
        }
    }
    $newVoters = null;
    if (array_key_exists('voter_ids', $body)) {
        $arr = is_array($body['voter_ids'])
            ? array_values(array_unique(array_filter(array_map('intval', $body['voter_ids']))))
            : [];
        if (!count($arr) || count($arr) > 200) throw new ApiException('bad_request', '対象者 1〜200', 400);
        $in = implode(',', array_fill(0, count($arr), '?'));
        $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
        $stU->execute($arr);
        if ((int)$stU->fetchColumn() !== count($arr)) {
            throw new ApiException('bad_request', '存在しない user_id', 400);
        }
        $newVoters = $arr;
    }
    db_tx($pdo, function () use ($pdo, $id, $sets, $args, $newOptions, $newVoters) {
        if ($sets) {
            $pdo->prepare("UPDATE polls SET " . implode(', ', $sets) . " WHERE id = ?")
                ->execute(array_merge($args, [$id]));
        }
        if ($newOptions !== null) {
            $stE = $pdo->prepare("SELECT id, label FROM poll_options WHERE poll_id = ?");
            $stE->execute([$id]);
            $byLabel = [];
            foreach ($stE->fetchAll(PDO::FETCH_ASSOC) as $r) $byLabel[(string)$r['label']] = (int)$r['id'];
            foreach ($newOptions as $i => $label) {
                if (isset($byLabel[$label])) {
                    $pdo->prepare("UPDATE poll_options SET sort_order=? WHERE id=?")
                        ->execute([$i, $byLabel[$label]]);
                    unset($byLabel[$label]);
                } else {
                    $pdo->prepare("INSERT INTO poll_options (poll_id, label, sort_order) VALUES (?,?,?)")
                        ->execute([$id, $label, $i]);
                }
            }
            if ($byLabel) {
                $ids = array_values($byLabel);
                $in = implode(',', array_fill(0, count($ids), '?'));
                $pdo->prepare("DELETE FROM poll_options WHERE id IN ($in)")->execute($ids);
            }
        }
        if ($newVoters !== null) {
            $stE = $pdo->prepare("SELECT user_id FROM poll_voters WHERE poll_id=?");
            $stE->execute([$id]);
            $cur = array_map('intval', array_column($stE->fetchAll(PDO::FETCH_ASSOC), 'user_id'));
            $curSet = array_flip($cur);
            $newSet = array_flip($newVoters);
            foreach ($newVoters as $uid) {
                if (!isset($curSet[$uid])) {
                    $pdo->prepare("INSERT INTO poll_voters (poll_id, user_id) VALUES (?,?)")
                        ->execute([$id, $uid]);
                }
            }
            foreach ($cur as $uid) {
                if (!isset($newSet[$uid])) {
                    $pdo->prepare("DELETE FROM poll_votes  WHERE poll_id=? AND user_id=?")->execute([$id, $uid]);
                    $pdo->prepare("DELETE FROM poll_voters WHERE poll_id=? AND user_id=?")->execute([$id, $uid]);
                }
            }
        }
    });
    json_response(['ok' => true]);
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

// v912 選択肢に投票した人を集めて ad-hoc グループを作成する。
//   起案者専用 + 締切後 のみ。 選択肢複数指定可 (複数選ぶと union、 「行きたい人 + 検討中の人」 で1グループ)。
//   voter プライバシー: この操作でグループが作られる = メンバー名がグループ内で相互に見えるようになる
//   ので、 起案者は暗黙的に voter を知る。 締切後 かつ 起案者専用 でリスクを抑える。
function polls_create_group(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, creator_user_id, title, status FROM polls WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', '投票が見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$poll['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみグループ化できます', 403);
    }
    polls_autoclose($pdo);  // 締切過ぎてれば close 済にする
    // 再度 status を取得
    $st2 = $pdo->prepare("SELECT status FROM polls WHERE id=?");
    $st2->execute([$id]);
    $status = (string)$st2->fetchColumn();
    if ($status !== 'closed') {
        throw new ApiException('conflict', '締切後のみグループ化できます (open 中は不可)', 409);
    }
    $body = read_json_body();
    $optIds = array_values(array_unique(array_filter(array_map('intval', (array)($body['option_ids'] ?? [])))));
    if (!$optIds) throw new ApiException('bad_request', 'option_ids が空', 400);
    // option が このpoll のものか検証
    $place = implode(',', array_fill(0, count($optIds), '?'));
    $stO = $pdo->prepare("SELECT id, label FROM poll_options WHERE poll_id=? AND id IN ($place)");
    $stO->execute(array_merge([$id], $optIds));
    $optRows = $stO->fetchAll(PDO::FETCH_ASSOC);
    if (count($optRows) !== count($optIds)) {
        throw new ApiException('bad_request', 'この投票に属さない option_id が含まれています', 400);
    }
    // voter 収集
    $stV = $pdo->prepare("SELECT DISTINCT user_id FROM poll_votes WHERE poll_id=? AND option_id IN ($place)");
    $stV->execute(array_merge([$id], $optIds));
    $voterIds = array_map('intval', array_column($stV->fetchAll(PDO::FETCH_ASSOC), 'user_id'));
    if (!$voterIds) {
        throw new ApiException('conflict', '選ばれた選択肢に投票した人がいません', 409);
    }
    // タイトル
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') {
        // 「投票タイトル - 選択肢名の union」 を自動生成
        $optLabels = array_map(fn($r) => (string)$r['label'], $optRows);
        $title = (string)$poll['title'] . ' / ' . implode(' + ', $optLabels);
    }
    if (mb_strlen($title) > 200) $title = mb_substr($title, 0, 200);
    // description / slug / image
    $description = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    $slug = null;
    if (!empty($body['slug'])) {
        $s = trim((string)$body['slug']);
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $s) || ctype_digit($s)) {
            throw new ApiException('bad_request', 'slug 形式不正', 400);
        }
        $check = $pdo->prepare("SELECT 1 FROM adhoc_groups WHERE slug = ?");
        $check->execute([$s]);
        if ($check->fetchColumn()) throw new ApiException('conflict', "slug 重複: $s", 409);
        $slug = $s;
    }
    // 起案者も入れる
    $memberIds = array_values(array_unique(array_merge($voterIds, [(int)$u['id']])));

    // adhoc_groups + members に INSERT (groups_create と同じ形。 外部関数呼び出しでは
    // Auth::requireUser を二度実行になり冪等性が微妙なので、 直接 INSERT で 一元処理)。
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare("INSERT INTO adhoc_groups (slug, creator_user_id, title, description)
            VALUES (?, ?, ?, ?)");
        $ins->execute([$slug, (int)$u['id'], $title, $description]);
        $gid = (int)$pdo->lastInsertId();
        $insM = $pdo->prepare("INSERT INTO adhoc_group_members (group_id, user_id) VALUES (?, ?)");
        foreach ($memberIds as $uid) {
            $insM->execute([$gid, $uid]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack(); throw $e;
    }
    // 新メンバーに通知 (起案者は除外)
    foreach ($voterIds as $uid) {
        if ($uid === (int)$u['id']) continue;
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "🏘 投票「{$poll['title']}」の結果からグループ「{$title}」に追加されました",
                'group', $gid);
        } catch (Throwable $_) {}
    }
    json_response([
        'ok' => true,
        'group_id' => $gid,
        'slug' => $slug,
        'member_count' => count($memberIds),
        'voter_count' => count($voterIds),
    ]);
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
    // v458 soft-delete
    $pdo->prepare("UPDATE polls SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
