<?php
// /api/scrapbox/feed — read-only viewer over the #scrapbox Slack channel.
// Pulls recent bot messages via slack_api_get(), keeps only edits whose
// title contains 研究ノート, and collapses consecutive entries by the same
// author_name into one row (per the user's request: 'まとめる' + 'latest 上').

declare(strict_types=1);

function route_scrapbox(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'feed' && $method === 'GET') {
        scrapbox_feed($pdo, $cfg);
        return;
    }
    json_error('not_found', "no scrapbox route for $method $sub", 404);
}

function scrapbox_feed(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $channel = (string)($cfg['slack']['scrapbox_channel_id'] ?? '');
    if ($channel === '') {
        json_response(['groups' => [], 'note' => 'slack.scrapbox_channel_id is empty']);
        return;
    }

    // 期間の切り出し。 'range' (today / yesterday / this_week) が来たら
    // それで oldest+latest を決め、 来なければ legacy 'days' (rolling N days) で
    // 後方互換。 today/this_week は latest=now、 yesterday だけ latest=今日 0:00。
    $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
    $now        = new DateTimeImmutable('now', $tz);
    $todayStart = $now->setTime(0, 0, 0);
    $range = (string)($_GET['range'] ?? '');
    $latest = null;
    // v494 #98 $days は legacy 経路でしか定義されていないと response 出力時に
    //   undefined variable で警告が出る。 全経路で既定値を持つように。
    $days = max(1, min(90, (int)($_GET['days'] ?? 7)));
    if ($range === 'today') {
        $oldest = $todayStart->getTimestamp();
    } elseif ($range === 'yesterday') {
        $oldest = $todayStart->modify('-1 day')->getTimestamp();
        $latest = $todayStart->getTimestamp();
    } elseif ($range === 'this_week') {
        $dow = (int)$now->format('N');
        $oldest = $todayStart->modify('-' . ($dow - 1) . ' days')->getTimestamp();
    } else {
        $oldest = (new DateTimeImmutable("-{$days} days", $tz))->getTimestamp();
    }

    // Paginated fetch — same shape as bin/scrapbox_slack_sync.php.
    // v494 #98 Slack の scope 不足 (missing_scope) などで slack_api_get が throw すると
    //   500 になっていた → 200 + note で穏便に返し、 UI に 「Slack 連携が止まっている」
    //   と表示できるように。
    $messages = [];
    $cursor = null;
    // v794 Scrapbox reader 専用 bot token を優先 (= channels:history scope を持つ別アプリ)
    $readerTok = (string)($cfg['slack']['scrapbox_bot_token'] ?? '') ?: null;
    try {
        for ($i = 0; $i < 10; $i++) {
            $params = ['channel' => $channel, 'oldest' => $oldest, 'limit' => 200, 'inclusive' => 'true'];
            if ($latest !== null) $params['latest'] = $latest;
            if ($cursor) $params['cursor'] = $cursor;
            $r = slack_api_get($cfg, 'conversations.history', $params, $readerTok);
            $messages = array_merge($messages, $r['messages'] ?? []);
            $cursor = $r['response_metadata']['next_cursor'] ?? '';
            if (!$cursor) break;
        }
    } catch (Throwable $e) {
        json_response([
            'days'   => $days,
            'count'  => 0,
            'groups' => [],
            'note'   => 'Slack API: ' . $e->getMessage(),
        ]);
        return;
    }

    // Flatten attachments → edits. Each attachment is one notification line.
    // ts is a Slack-style 'unix_int.frac' string; we keep it as a float for sort.
    //
    // author_name は時々「Sora, Satoshi Nakamura」のようにカンマ区切りで
    // 複数人になることがある (共同編集など)。それぞれを独立した編集として
    // 展開して、後段の集計で各人に正しくカウントされるようにする。
    $edits = [];
    foreach ($messages as $m) {
        if (($m['username'] ?? '') !== 'Scrapbox') continue;
        $ts = (float)($m['ts'] ?? 0);
        foreach ($m['attachments'] ?? [] as $a) {
            $rawAuthor = trim((string)($a['author_name'] ?? ''));
            $title     = trim((string)($a['title'] ?? ''));
            $link      = trim((string)($a['title_link'] ?? ''));
            // Filter: research-note pages only (per the user's spec).
            if ($rawAuthor === '' || mb_strpos($title, '研究ノート') === false) continue;
            $authors = array_values(array_filter(array_map('trim', explode(',', $rawAuthor)), fn($s) => $s !== ''));
            foreach ($authors as $author) {
                $edits[] = [
                    'ts'     => $ts,
                    'author' => $author,
                    'title'  => $title,
                    'url'    => $link,
                    'text'   => trim((string)($a['text'] ?? '')),
                ];
            }
        }
    }
    // Latest first.
    usort($edits, fn($x, $y) => $y['ts'] <=> $x['ts']);

    // Aggregate by author across the entire window (not just consecutive runs).
    // 'first_ts' = latest edit by that author, 'last_ts' = earliest. Pages are
    // deduplicated by title and ordered with the most-recently-edited first
    // (which matches how we iterate, since edits are sorted desc by ts).
    $byAuthor = [];
    foreach ($edits as $e) {
        $a = $e['author'];
        if (!isset($byAuthor[$a])) {
            $byAuthor[$a] = [
                'author'      => $a,
                'first_ts'    => $e['ts'],          // newest (we walk newest→oldest)
                'last_ts'     => $e['ts'],
                'edit_count'  => 1,
                'pages'       => [['title' => $e['title'], 'url' => $e['url']]],
                'preview'     => mb_substr($e['text'], 0, 200),
            ];
            continue;
        }
        $g = &$byAuthor[$a];
        $g['edit_count']++;
        $g['last_ts'] = $e['ts']; // current edit is older than what we have
        $haveTitle = false;
        foreach ($g['pages'] as $p) {
            if ($p['title'] === $e['title']) { $haveTitle = true; break; }
        }
        if (!$haveTitle) $g['pages'][] = ['title' => $e['title'], 'url' => $e['url']];
        unset($g);
    }
    // Output: sort by latest activity desc.
    $groups = array_values($byAuthor);
    usort($groups, fn($x, $y) => $y['first_ts'] <=> $x['first_ts']);

    // Resolve author_name → LabPay user (display_name + avatar_url) via the
    // existing user_scrapbox_handles table.
    $authors = array_values(array_unique(array_map(fn($g) => $g['author'], $groups)));
    $resolved = [];
    if ($authors) {
        $place = implode(',', array_fill(0, count($authors), '?'));
        $st = $pdo->prepare("
            SELECT h.scrapbox_name, u.id, u.display_name, u.avatar_url
              FROM user_scrapbox_handles h
              JOIN users u ON u.id = h.user_id
             WHERE h.scrapbox_name IN ($place)");
        $st->execute($authors);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $resolved[$r['scrapbox_name']] = [
                'user_id'      => (int)$r['id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
            ];
        }
    }
    foreach ($groups as &$g) {
        $g['mapped'] = $resolved[$g['author']] ?? null;
        // Convert ts to a Y-m-d H:i:s string in JST for the UI.
        $g['first_at'] = (new DateTimeImmutable('@' . (int)$g['first_ts']))->setTimezone($tz)->format('Y-m-d H:i:s');
        $g['last_at']  = (new DateTimeImmutable('@' . (int)$g['last_ts']))->setTimezone($tz)->format('Y-m-d H:i:s');
        unset($g['first_ts'], $g['last_ts']);
    }
    unset($g);

    json_response([
        'days'   => $days,
        'count'  => count($edits),
        'groups' => $groups,
    ]);
}
