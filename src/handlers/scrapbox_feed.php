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

    // How many days of history. 'feed view, latest on top' → 7-day default is
    // plenty for a glance, 30 for catch-up. Cap at 90 so a misbehaving caller
    // can't drag the whole channel history.
    $days = max(1, min(90, (int)($_GET['days'] ?? 7)));
    $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
    $oldest = (new DateTimeImmutable("-{$days} days", $tz))->getTimestamp();

    // Paginated fetch — same shape as bin/scrapbox_slack_sync.php.
    $messages = [];
    $cursor = null;
    for ($i = 0; $i < 10; $i++) {
        $params = ['channel' => $channel, 'oldest' => $oldest, 'limit' => 200, 'inclusive' => 'true'];
        if ($cursor) $params['cursor'] = $cursor;
        $r = slack_api_get($cfg, 'conversations.history', $params);
        $messages = array_merge($messages, $r['messages'] ?? []);
        $cursor = $r['response_metadata']['next_cursor'] ?? '';
        if (!$cursor) break;
    }

    // Flatten attachments → edits. Each attachment is one notification line.
    // ts is a Slack-style 'unix_int.frac' string; we keep it as a float for sort.
    $edits = [];
    foreach ($messages as $m) {
        if (($m['username'] ?? '') !== 'Scrapbox') continue;
        $ts = (float)($m['ts'] ?? 0);
        foreach ($m['attachments'] ?? [] as $a) {
            $author = trim((string)($a['author_name'] ?? ''));
            $title  = trim((string)($a['title'] ?? ''));
            $link   = trim((string)($a['title_link'] ?? ''));
            // Filter: research-note pages only (per the user's spec).
            if ($author === '' || mb_strpos($title, '研究ノート') === false) continue;
            $edits[] = [
                'ts'     => $ts,
                'author' => $author,
                'title'  => $title,
                'url'    => $link,
                'text'   => trim((string)($a['text'] ?? '')),
            ];
        }
    }
    // Latest first.
    usort($edits, fn($x, $y) => $y['ts'] <=> $x['ts']);

    // Collapse consecutive runs by the same author_name into one 'group'.
    // Each group preserves the order pages were edited (latest within the
    // group also at the top, matching the outer order).
    $groups = [];
    $cur = null;
    foreach ($edits as $e) {
        if ($cur && $cur['author'] === $e['author']) {
            // Same author as previous → append page if not already present
            // (people often re-edit the same page; show it once).
            $cur['edit_count']++;
            $alreadyHavePage = false;
            foreach ($cur['pages'] as $p) {
                if ($p['title'] === $e['title']) { $alreadyHavePage = true; break; }
            }
            if (!$alreadyHavePage) {
                $cur['pages'][] = ['title' => $e['title'], 'url' => $e['url']];
            }
            // Update window — first_ts is later of the two (since latest first),
            // last_ts is the earlier.
            $cur['last_ts'] = $e['ts'];
        } else {
            if ($cur) $groups[] = $cur;
            $cur = [
                'author'      => $e['author'],
                'first_ts'    => $e['ts'],
                'last_ts'     => $e['ts'],
                'edit_count'  => 1,
                'pages'       => [['title' => $e['title'], 'url' => $e['url']]],
                'preview'     => mb_substr($e['text'], 0, 200),
            ];
        }
    }
    if ($cur) $groups[] = $cur;

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
