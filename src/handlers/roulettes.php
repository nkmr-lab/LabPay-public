<?php
// /api/roulettes — group lottery. Pick a winner from a member list, record it,
// notify every participant, and optionally transfer a pt prize from the
// creator's wallet to the winner. Uniform random; server-side picks so the
// client can't bias the outcome.

declare(strict_types=1);

function route_roulettes(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { roulettes_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { roulettes_spin($pdo, $cfg);   return; }
    if ($sub === 'tags' && $method === 'GET') { roulettes_tags($pdo, $cfg); return; }
    if ((int)$sub > 0 && $method === 'GET') {
        roulettes_detail($pdo, $cfg, (int)$sub);
        return;
    }
    if ((int)$sub > 0 && ($seg[2] ?? '') === 'notify' && $method === 'POST') {
        roulettes_notify($pdo, $cfg, (int)$sub);
        return;
    }
    json_error('not_found', "no roulettes route for $method $sub", 404);
}

// GET /api/roulettes/tags — admin が config テーブルにカンマ区切りで持つ
// 共通タグの list を返す。ユーザはこれを localStorage の個人タグとマージして
// 表示する (ハイブリッド方式)。
// POST /api/roulettes/{id}/notify — client がホイール停止後に呼ぶ。
// 起案者 (= creator) のみ送信可。多重防止のため notified_at が既にあれば no-op。
function roulettes_notify(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT title, creator_user_id, winner_user_id, member_ids, reward, notified_at FROM roulettes WHERE id=?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'roulette not found', 404);
    if ((int)$r['creator_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '起案者のみ通知可', 403);
    }
    if ($r['notified_at'] !== null) {
        json_response(['ok' => true, 'already' => true]);
        return;
    }
    $ids = json_decode((string)$r['member_ids'], true) ?: [];
    $winnerId = (int)$r['winner_user_id'];
    $reward = (int)$r['reward'];
    $title  = (string)$r['title'];
    // 当選者名を引く
    $idsIn = implode(',', array_fill(0, count($ids), '?'));
    $idToName = [];
    if ($ids) {
        $stU = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($idsIn)");
        $stU->execute($ids);
        foreach ($stU->fetchAll(PDO::FETCH_ASSOC) as $u2) $idToName[(int)$u2['id']] = $u2['display_name'];
    }
    $winnerName = $idToName[$winnerId] ?? 'someone';
    $rewardWinnerSuffix = $reward > 0 && $winnerId !== (int)$r['creator_user_id'] ? " (+{$reward}pt)" : '';
    $rewardOthersSuffix = $reward > 0 ? " (賞金 {$reward}pt)" : '';
    foreach ($ids as $uid) {
        $body = ((int)$uid === $winnerId)
            ? "🎯 ルーレット「{$title}」で " . count($ids) . "人の中からあなたが選ばれました!{$rewardWinnerSuffix}"
            : "🎰 ルーレット「{$title}」の結果: " . count($ids) . "人の中から {$winnerName} さんが選ばれました{$rewardOthersSuffix}";
        notify_safely($pdo, $cfg, (int)$uid, 'admin_notice', $body, 'roulette', $id);
    }
    $pdo->prepare("UPDATE roulettes SET notified_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true, 'notified' => count($ids)]);
}

function roulettes_tags(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $raw = (string)($pdo->query("SELECT v FROM config WHERE k='roulette_tags'")->fetchColumn() ?: '');
    $tags = array_values(array_filter(array_map('trim', explode(',', $raw)), 'strlen'));
    json_response(['tags' => $tags]);
}

// GET /api/roulettes/{id} — public-to-logged-in result page. Returns the
// roulette plus the member roster (names + avatars) so the result page can
// re-render the wheel exactly as it stopped.
function roulettes_detail(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT r.id, r.title, r.winner_user_id, r.member_ids, r.reward, r.created_at,
               uc.id AS creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url,
               uw.display_name AS winner_name, uw.avatar_url AS winner_avatar_url
          FROM roulettes r
          JOIN users uc ON uc.id = r.creator_user_id
          JOIN users uw ON uw.id = r.winner_user_id
         WHERE r.id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', "roulette $id not found", 404);
    $ids = json_decode($row['member_ids'], true) ?: [];

    // Pull avatars + names so the result page can draw the original member list.
    $members = [];
    if ($ids) {
        $place = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
        $st->execute($ids);
        $byId = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $u) $byId[(int)$u['id']] = $u;
        // Preserve the original order so winner_index still points at the right slice.
        foreach ($ids as $uid) {
            $members[] = $byId[(int)$uid] ?? ['id' => $uid, 'display_name' => '?', 'avatar_url' => null];
        }
    }
    $row['member_ids'] = $ids;
    $row['reward'] = (int)$row['reward'];
    $row['winner_index'] = array_search((int)$row['winner_user_id'], $ids, true);
    $row['members'] = $members;
    json_response($row);
}

function roulettes_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("
        SELECT r.id, r.title, r.winner_user_id, r.member_ids, r.reward, r.created_at,
               uc.display_name AS creator_name,
               uw.display_name AS winner_name, uw.avatar_url AS winner_avatar_url
          FROM roulettes r
          JOIN users uc ON uc.id = r.creator_user_id
          JOIN users uw ON uw.id = r.winner_user_id
         ORDER BY r.id DESC LIMIT 30");
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$it) {
        $it['member_ids'] = json_decode($it['member_ids'], true) ?: [];
        $it['reward']     = (int)$it['reward'];
    }
    json_response(['items' => $items]);
}

function roulettes_spin(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $ids = $body['member_ids'] ?? null;
    if (!is_array($ids) || count($ids) < 2) {
        throw new ApiException('bad_request', 'member_ids must have at least 2 entries', 400);
    }
    $reward = isset($body['reward']) ? max(0, min(1_000_000, (int)$body['reward'])) : 0;
    // テストモード: 抽選結果だけ返す。DB insert・pt 送金・通知すべてスキップ。
    $dryRun = !empty($body['dry_run']);

    // Normalize + dedupe + validate.
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (count($ids) < 2) {
        throw new ApiException('bad_request', 'after dedup, member_ids must have at least 2', 400);
    }

    // Confirm every id is a real human user.
    $place = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT id, display_name FROM users
        WHERE id IN ($place) AND kind='human'");
    $st->execute($ids);
    $found = $st->fetchAll(PDO::FETCH_ASSOC);
    if (count($found) !== count($ids)) {
        throw new ApiException('bad_request', 'one or more member_ids not found', 400);
    }
    $idToName = [];
    foreach ($found as $r) $idToName[(int)$r['id']] = $r['display_name'];

    // If the creator has set a prize, sanity-check the wallet BEFORE spinning
    // so we don't pick a winner and then fail the transfer afterward.
    // Skipped in dry-run mode — testing should always succeed regardless of
    // the creator's balance.
    if ($reward > 0 && !$dryRun) {
        $creatorAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
        $bal = Ledger::balanceOf($pdo, $creatorAcc);
        if ($bal < $reward) {
            throw new ApiException('insufficient_funds',
                "賞金 {$reward}pt に対して残高 {$bal}pt しかありません", 402,
                ['balance' => $bal, 'required' => $reward]);
        }
    }

    // Uniform random pick — random_int is the right primitive here (CSPRNG).
    $winnerIdx = random_int(0, count($ids) - 1);
    $winnerId  = $ids[$winnerIdx];

    // Dry-run path: just return the winner. No DB row, no ledger move, no
    // notifications — the spin is a rehearsal, not a real event. We DO compute
    // the would-be notification text per participant so the UI can preview
    // exactly who would hear what before the user commits.
    if ($dryRun) {
        $winnerName = $idToName[$winnerId] ?? 'someone';
        $rewardWinnerSuffix = $reward > 0 && $winnerId !== (int)$u['id']
            ? " (+{$reward}pt)" : '';
        $rewardOthersSuffix = $reward > 0 ? " (賞金 {$reward}pt)" : '';
        $preview = [];
        foreach ($ids as $uid) {
            $preview[] = [
                'user_id'      => $uid,
                'display_name' => $idToName[$uid] ?? '',
                'is_winner'    => $uid === $winnerId,
                'body'         => $uid === $winnerId
                    ? "🎯 ルーレット「{$title}」で " . count($ids) . "人の中からあなたが選ばれました!{$rewardWinnerSuffix}"
                    : "🎰 ルーレット「{$title}」の結果: " . count($ids) . "人の中から {$winnerName} さんが選ばれました{$rewardOthersSuffix}",
            ];
        }
        json_response([
            'ok' => true,
            'dry_run' => true,
            'title' => $title,
            'member_ids' => $ids,
            'winner_user_id' => $winnerId,
            'winner_index' => $winnerIdx,
            'winner_name'  => $winnerName,
            'reward' => $reward,
            'notifications_preview' => $preview,
        ]);
        return;
    }

    // All persistence + the (optional) pt transfer happen inside one TX so a
    // late failure can't leave a roulette row with no matching ledger entry.
    [$rouletteId, $ledgerId] = db_tx($pdo, function () use ($pdo, $u, $title, $winnerId, $ids, $reward) {
        $ins = $pdo->prepare("INSERT INTO roulettes
            (creator_user_id, title, winner_user_id, member_ids, reward)
            VALUES (?,?,?,?,?)");
        $ins->execute([$u['id'], $title, $winnerId,
            json_encode($ids, JSON_UNESCAPED_UNICODE), $reward]);
        $rouletteId = (int)$pdo->lastInsertId();
        $ledgerId = null;

        // If the creator IS the winner, the transfer would be self → self, which
        // Ledger::transfer rejects. Skip it silently — the pt effectively stays
        // with the creator, matching what they'd expect.
        if ($reward > 0 && $winnerId !== (int)$u['id']) {
            $fromAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
            $toAcc   = Ledger::accountIdForUser($pdo, $winnerId);
            $memo    = "ルーレット「{$title}」当選";
            $ledgerId = Ledger::transfer(
                $pdo, $fromAcc, $toAcc, $reward,
                'transfer', 'roulette', $rouletteId, mb_substr($memo, 0, 255)
            );
            $pdo->prepare("UPDATE roulettes SET ledger_id=? WHERE id=?")
                ->execute([$ledgerId, $rouletteId]);
        }
        return [$rouletteId, $ledgerId];
    });

    // 通知はホイール停止後 (= client が POST /announce する) に遅延。ここでは送らない。
    // (アニメーション中に通知が飛んで「答えバレ」を起こさないため。)
    $winnerName = $idToName[$winnerId] ?? 'someone';
    json_response([
        'ok' => true,
        'dry_run' => false,
        'id' => $rouletteId,
        'title' => $title,
        'member_ids' => $ids,
        'winner_user_id' => $winnerId,
        'winner_index' => $winnerIdx,
        'winner_name'  => $winnerName,
        'reward' => $reward,
        'ledger_id' => $ledgerId,
    ]);
}
