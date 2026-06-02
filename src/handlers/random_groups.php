<?php
// /api/random-groups — ランダムグループ生成 ツールの結果を全員に通知。
// DB には何も書かない (純粋な放送ヘルパ)。クライアントが生成済みの
// {title, groups: [[uid,...], ...]} を投げると、関与した全員に同じ本文の
// 通知を送る。

declare(strict_types=1);

function route_random_groups(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'notify' && $method === 'POST') {
        random_groups_notify($pdo, $cfg);
        return;
    }
    json_error('not_found', "no random-groups route for $method $sub", 404);
}

function random_groups_notify(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? 'グループ分け'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $groups = $body['groups'] ?? null;
    if (!is_array($groups) || !$groups) {
        throw new ApiException('bad_request', 'groups must be a non-empty array', 400);
    }
    // Validate + collect all user_ids.
    $allUids = [];
    $cleanGroups = [];
    foreach ($groups as $g) {
        if (!is_array($g)) throw new ApiException('bad_request', 'each group must be an array of user_ids', 400);
        $ids = array_values(array_unique(array_filter(array_map('intval', $g))));
        if (!$ids) continue;
        $cleanGroups[] = $ids;
        foreach ($ids as $uid) $allUids[$uid] = true;
    }
    if (!$cleanGroups || !$allUids) {
        throw new ApiException('bad_request', 'no valid user_ids', 400);
    }

    // Resolve display names.
    $uids = array_keys($allUids);
    $place = implode(',', array_fill(0, count($uids), '?'));
    $st = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($uids);
    $names = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];

    // Build broadcast body.
    $lines = ["🎲 「{$title}」グループ分け結果"];
    foreach ($cleanGroups as $idx => $ids) {
        $n = $idx + 1;
        $memberNames = array_map(fn($id) => $names[$id] ?? "user#$id", $ids);
        $lines[] = "グループ {$n}: " . implode(', ', $memberNames);
    }
    $msg = implode("\n", $lines);

    $sent = 0;
    foreach (array_keys($allUids) as $uid) {
        notify_safely($pdo, $cfg, (int)$uid, 'admin_notice', $msg, 'random_groups', null);
        $sent++;
    }
    json_response(['ok' => true, 'sent' => $sent]);
}
