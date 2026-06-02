<?php
// /api/roulettes — group lottery. Pick a winner from a member list, record it,
// and notify every participant. Uniform random; server-side picks so the
// client can't bias the outcome.

declare(strict_types=1);

function route_roulettes(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { roulettes_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { roulettes_spin($pdo, $cfg);   return; }
    json_error('not_found', "no roulettes route for $method $sub", 404);
}

function roulettes_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("
        SELECT r.id, r.title, r.winner_user_id, r.member_ids, r.created_at,
               uc.display_name AS creator_name,
               uw.display_name AS winner_name, uw.avatar_url AS winner_avatar_url
          FROM roulettes r
          JOIN users uc ON uc.id = r.creator_user_id
          JOIN users uw ON uw.id = r.winner_user_id
         ORDER BY r.id DESC LIMIT 30");
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$it) {
        $it['member_ids'] = json_decode($it['member_ids'], true) ?: [];
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
    // Build id→name map (for the notification body).
    $idToName = [];
    foreach ($found as $r) $idToName[(int)$r['id']] = $r['display_name'];

    // Uniform random pick — random_int is the right primitive here (CSPRNG).
    $winnerIdx = random_int(0, count($ids) - 1);
    $winnerId  = $ids[$winnerIdx];

    $ins = $pdo->prepare("INSERT INTO roulettes (creator_user_id, title, winner_user_id, member_ids)
        VALUES (?,?,?,?)");
    $ins->execute([$u['id'], $title, $winnerId, json_encode($ids, JSON_UNESCAPED_UNICODE)]);
    $rouletteId = (int)$pdo->lastInsertId();

    // Notify every participant (winner included). The winner gets a punchy
    // 'YOU were picked' phrasing; everyone else hears who won.
    $winnerName = $idToName[$winnerId] ?? 'someone';
    foreach ($ids as $uid) {
        $body = ($uid === $winnerId)
            ? "🎯 ルーレット「{$title}」で あなた が選ばれました!"
            : "🎰 ルーレット「{$title}」の結果: {$winnerName} さんが選ばれました";
        notify_safely($pdo, $cfg, $uid, 'admin_notice', $body, 'roulette', $rouletteId);
    }

    json_response([
        'ok' => true,
        'id' => $rouletteId,
        'title' => $title,
        'member_ids' => $ids,
        'winner_user_id' => $winnerId,
        'winner_index' => $winnerIdx,
        'winner_name'  => $winnerName,
    ]);
}
