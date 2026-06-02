<?php
// /api/me, /api/me/transactions, /api/me/listings.

declare(strict_types=1);

function route_me(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET') {
        $accId = Ledger::accountIdForUser($pdo, $u['id']);
        $bal = Ledger::balanceOf($pdo, $accId);
        $st = $pdo->prepare('SELECT current_streak, longest_streak, last_checkin_date
            FROM streaks WHERE user_id=?');
        $st->execute([$u['id']]);
        $streak = $st->fetch() ?: ['current_streak' => 0, 'longest_streak' => 0, 'last_checkin_date' => null];
        $av = $pdo->prepare('SELECT avatar_url, scrapbox_username, grade FROM users WHERE id=?');
        $av->execute([$u['id']]);
        $row = $av->fetch();
        $u['avatar_url']        = $row['avatar_url']        ?? null;
        $u['scrapbox_username'] = $row['scrapbox_username'] ?? null;
        $u['grade']             = $row['grade']             ?? null;
        // Lab-Wi-Fi presence flag — used by the buy UI to grey out the purchase
        // button when the user is off the lab network (purchases are server-gated).
        json_response([
            'user' => $u,
            'balance' => $bal,
            'streak' => $streak,
            'in_lab' => user_is_in_lab($pdo, (int)$u['id']),
        ]);
        return;
    }

    // PATCH /api/me — update editable profile fields (display_name, avatar_url, scrapbox_username).
    if ($sub === '' && $method === 'PATCH') {
        $body = read_json_body();
        $sets = []; $params = [];
        if (array_key_exists('display_name', $body)) {
            $name = trim((string)$body['display_name']);
            if ($name === '' || mb_strlen($name) > 100) {
                throw new ApiException('bad_request', 'display_name length 1..100', 400);
            }
            $sets[] = 'display_name = ?'; $params[] = $name;
        }
        if (array_key_exists('avatar_url', $body)) {
            $url = $body['avatar_url'];
            if ($url === null || $url === '') {
                $sets[] = 'avatar_url = NULL';
            } else {
                $url = (string)$url;
                // Local upload path: /uploads/<dir>?/<file>.<ext>, charset restricted, no ".." or extra segments.
                $isLocal = (bool)preg_match('#^/uploads/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?\.[A-Za-z0-9]{1,8}$#', $url);
                // Absolute URL: only http(s), and only pointing at this app's own origin.
                $isHttp = false;
                if (filter_var($url, FILTER_VALIDATE_URL) && (str_starts_with($url, 'http://') || str_starts_with($url, 'https://'))) {
                    $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
                    if ($baseUrl !== '' && str_starts_with($url, $baseUrl . '/uploads/')) {
                        // Re-run the local check against the path portion.
                        $rel = substr($url, strlen($baseUrl));
                        $isHttp = (bool)preg_match('#^/uploads/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)?\.[A-Za-z0-9]{1,8}$#', $rel);
                    }
                }
                if (!$isHttp && !$isLocal) {
                    throw new ApiException('bad_request', 'avatar_url must be /uploads/<file>.<ext> on this origin', 400);
                }
                $sets[] = 'avatar_url = ?'; $params[] = $url;
            }
        }
        if (array_key_exists('scrapbox_username', $body)) {
            $sb = $body['scrapbox_username'];
            if ($sb === null || $sb === '') {
                $sets[] = 'scrapbox_username = NULL';
            } else {
                $sb = trim((string)$sb);
                if (mb_strlen($sb) > 60) throw new ApiException('bad_request', 'scrapbox_username too long', 400);
                $sets[] = 'scrapbox_username = ?'; $params[] = $sb;
            }
        }
        if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
        $params[] = $u['id'];
        $pdo->prepare('UPDATE users SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        $get = $pdo->prepare('SELECT id, email, display_name, avatar_url, role, kind FROM users WHERE id=?');
        $get->execute([$u['id']]);
        json_response($get->fetch());
        return;
    }

    if ($sub === 'transactions' && $method === 'GET') {
        $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $accId = Ledger::accountIdForUser($pdo, $u['id']);

        // Join optional product name via purchases for nicer history.
        $sql = "
            SELECT l.id, l.from_account_id, l.to_account_id, l.amount, l.type, l.ref_type, l.ref_id,
                   l.memo, l.created_at,
                   af.code AS from_code, at.code AS to_code,
                   uf.display_name AS from_user, ut.display_name AS to_user,
                   pr.name AS product_name, pr.jan AS product_jan
              FROM ledger l
              JOIN accounts af ON af.id = l.from_account_id
              JOIN accounts at ON at.id = l.to_account_id
              LEFT JOIN users uf ON uf.id = af.owner_user_id
              LEFT JOIN users ut ON ut.id = at.owner_user_id
              LEFT JOIN purchases p ON l.ref_type='purchase' AND p.id = l.ref_id
              LEFT JOIN products pr ON pr.jan = p.jan
             WHERE l.from_account_id = ? OR l.to_account_id = ?
             ORDER BY l.id DESC
             LIMIT ? OFFSET ?";
        $st = $pdo->prepare($sql);
        $st->bindValue(1, $accId, PDO::PARAM_INT);
        $st->bindValue(2, $accId, PDO::PARAM_INT);
        $st->bindValue(3, $limit, PDO::PARAM_INT);
        $st->bindValue(4, $offset, PDO::PARAM_INT);
        $st->execute();
        $rows = $st->fetchAll();

        $items = [];
        foreach ($rows as $r) {
            $direction = ((int)$r['to_account_id'] === $accId) ? 'in' : 'out';
            $signed = ($direction === 'in' ? 1 : -1) * (int)$r['amount'];
            $items[] = [
                'id'             => (int)$r['id'],
                'type'           => $r['type'],
                'direction'      => $direction,
                'amount'         => (int)$r['amount'],
                'signed_amount'  => $signed,
                'counterparty'   => $direction === 'in' ? ($r['from_user'] ?? $r['from_code']) : ($r['to_user'] ?? $r['to_code']),
                'memo'           => $r['memo'],
                'ref_type'       => $r['ref_type'],
                'ref_id'         => $r['ref_id'] !== null ? (int)$r['ref_id'] : null,
                'product_name'   => $r['product_name'],
                'product_jan'    => $r['product_jan'],
                'created_at'     => $r['created_at'],
            ];
        }
        json_response(['items' => $items, 'limit' => $limit, 'offset' => $offset]);
        return;
    }

    if ($sub === 'achievements' && $method === 'GET') {
        $items = Achievements::reportFor($pdo, (int)$u['id']);
        json_response(['items' => $items]);
        return;
    }

    // ----- scrapbox handles (self-claim list) -----
    // GET    /api/me/scrapbox_handles                → list my handles + recent pt earned
    // POST   /api/me/scrapbox_handles  {handle: "x"} → claim a handle (or steal if already owned)
    // DELETE /api/me/scrapbox_handles/{handle}       → release my handle
    if ($sub === 'scrapbox_handles') {
        if ($method === 'GET') {
            $st = $pdo->prepare('SELECT scrapbox_name, created_at
                FROM user_scrapbox_handles WHERE user_id=? ORDER BY created_at');
            $st->execute([$u['id']]);
            $handles = $st->fetchAll(PDO::FETCH_ASSOC);
            // Aggregate recent (last 30 days) Scrapbox awards for context.
            $ag = $pdo->prepare("SELECT COALESCE(SUM(points),0) AS total_pts,
                                        COALESCE(SUM(attachments),0) AS total_atts,
                                        COUNT(*) AS days
                FROM scrapbox_awards
                WHERE user_id=? AND award_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
            $ag->execute([$u['id']]);
            $sum = $ag->fetch(PDO::FETCH_ASSOC) ?: ['total_pts'=>0,'total_atts'=>0,'days'=>0];
            json_response(['handles' => $handles, 'recent_30d' => $sum]);
            return;
        }
        if ($method === 'POST') {
            $body = read_json_body();
            $name = trim((string)require_field($body, 'handle'));
            if ($name === '' || mb_strlen($name) > 100) {
                throw new ApiException('bad_request', 'handle length 1..100', 400);
            }
            // ON DUPLICATE KEY UPDATE: claiming a name already owned by someone else
            // reassigns it to the current user. This is intentional — if you set a
            // wrong name, fixing it (or transferring after a teammate's mistake)
            // shouldn't require admin intervention. The Scrapbox bridge attributes
            // future edits to whoever currently owns the name.
            $st = $pdo->prepare('INSERT INTO user_scrapbox_handles (scrapbox_name, user_id)
                VALUES (?,?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)');
            $st->execute([$name, $u['id']]);
            json_response(['ok' => true, 'handle' => $name]);
            return;
        }
        if (isset($seg[2]) && $method === 'DELETE') {
            $name = (string)$seg[2];
            $st = $pdo->prepare('DELETE FROM user_scrapbox_handles
                WHERE scrapbox_name=? AND user_id=?');
            $st->execute([$name, $u['id']]);
            json_response(['ok' => true]);
            return;
        }
    }

    // GET /api/me/presence_summary
    // Returns cumulative minutes spent in any lab room (today / this_week / this_month)
    // by summing closed sessions in presence_sessions plus the currently-open one,
    // if any. Personal only — the caller's own user_id.
    if ($sub === 'presence_summary' && $method === 'GET') {
        $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
        $now = new DateTimeImmutable('now', $tz);
        $todayStart     = $now->setTime(0, 0, 0)->format('Y-m-d H:i:s');
        $yesterdayStart = $now->modify('-1 day')->setTime(0, 0, 0)->format('Y-m-d H:i:s');
        $weekStart  = $now->modify('monday this week')->setTime(0, 0, 0)->format('Y-m-d H:i:s');
        $monthStart = $now->modify('first day of this month')->setTime(0, 0, 0)->format('Y-m-d H:i:s');

        // Closed sessions: 月始まり以降の全 session を取り出して MAC ごと
        // 重複を merge してから bucket に振り分ける。SUM(duration_minutes) を
        // そのまま使うと、複数 MAC 持ち (例: iPhone14 + iPhone17 同時) の
        // 場合に同じ時間帯が 2 倍 3 倍にカウントされて滞在時間が膨らむ。
        $st = $pdo->prepare("SELECT UNIX_TIMESTAMP(started_at) AS s,
                                    UNIX_TIMESTAMP(ended_at)   AS e
            FROM presence_sessions
            WHERE user_id = ? AND started_at >= ?
            ORDER BY started_at");
        $st->execute([$u['id'], $monthStart]);
        $intervals = array_map(fn($r) => [(int)$r['s'], (int)$r['e']], $st->fetchAll());
        $merged = presence_merge_intervals($intervals);
        $clip = function (int $from) use ($merged): int {
            $sum = 0;
            foreach ($merged as $iv) {
                $s = max($iv[0], $from);
                if ($iv[1] > $s) $sum += $iv[1] - $s;
            }
            return $sum;
        };
        $todayStartTs     = strtotime($todayStart);
        $yesterdayStartTs = strtotime($yesterdayStart);
        $closed = [
            'today'     => $clip($todayStartTs) / 60,
            'yesterday' => ($clip($yesterdayStartTs) - $clip($todayStartTs)) / 60,
            'week'      => $clip(strtotime($weekStart))  / 60,
            'month'     => $clip(strtotime($monthStart)) / 60,
        ];

        // Open / dangling session: presence_seen が最新の "session 中" を表す。
        // scanner は「再入店 (gap > threshold)」のときしか session を閉じない
        // ので、Wi-Fi が切れて検知が止まっただけだとそのまま開きっぱなしになる。
        // ここでは:
        //   * fresh = last_seen が直近 10 分 → 「いま居る」フラグ true、現在時刻
        //     まで滞在として加算
        //   * stale = それ以前 → 「いま居る」は false、ただし last_seen までの
        //     滞在は今日 (週 / 月) の集計に算入
        //
        // MIN(session_start_at) を採用、ただし 12 時間以上の連続検知行 (化石化
        // 候補 = 端末を置き忘れ) は除外して MIN を計算する。これで:
        //   * 同じ MAC が複数 room で検知されている (signal leak) ケース: MIN で
        //     一番古い session_start が拾われて正しい滞在時間が出る
        //   * 化石デバイスがあるケース: 12h+ の行は除外されるので、その古い
        //     start_at は拾われない
        $openStart = null; $openEnd = null; $isFresh = false;
        $stOpen = $pdo->prepare("SELECT MIN(session_start_at) AS s, MAX(last_seen_at) AS e
            FROM presence_seen ps
            JOIN presence_devices pd ON pd.mac = ps.mac
            WHERE pd.user_id = ?
              AND ps.session_start_at IS NOT NULL
              AND TIMESTAMPDIFF(MINUTE, ps.session_start_at, ps.last_seen_at) < ?");
        $stOpen->execute([$u['id'], 12 * 60]);
        if ($row = $stOpen->fetch()) {
            if (!empty($row['s']) && !empty($row['e'])) {
                $openStart = $row['s'];
                $openEnd   = $row['e'];
                $isFresh   = strtotime($row['e']) >= time() - 10 * 60;
            }
        }
        // バケットへの寄与: max(0, MIN(end, NOW) - max(start, bucketStart))
        // fresh のときは end = NOW、stale のときは end = last_seen。
        $nowTs = time();
        $contribute = function($bucketStart) use ($openStart, $openEnd, $isFresh, $nowTs) {
            if ($openStart === null) return 0;
            $effectiveEnd   = $isFresh ? $nowTs : strtotime($openEnd);
            $effectiveStart = max(strtotime($openStart), strtotime($bucketStart));
            return max(0, ($effectiveEnd - $effectiveStart) / 60);
        };

        // PDO returns SUM() results as strings; cast to float before round() —
        // PHP 8.1+ rejects non-numeric arg types even when the string is itself numeric.
        json_response([
            'today_minutes'     => (int)round((float)$closed['today']     + $contribute($todayStart)),
            'yesterday_minutes' => (int)round((float)$closed['yesterday']),  // closed-day, no open-session adjustment needed
            'week_minutes'      => (int)round((float)$closed['week']      + $contribute($weekStart)),
            'month_minutes'     => (int)round((float)$closed['month']     + $contribute($monthStart)),
            'currently_present' => $isFresh,
            'current_session_started_at' => $isFresh ? $openStart : null,
        ]);
        return;
    }

    // GET /api/me/contribution_calendar?days=84
    // GitHub-style daily activity for the user: one entry per calendar day with
    // minutes_present aggregated from presence_sessions, plus any presence_seen
    // visits that never got "closed" (phone left without returning, so the
    // close-event never fired). For those, we fall back to first_seen_at when
    // session_start_at is NULL — legacy rows from before migration 015.
    if ($sub === 'contribution_calendar' && $method === 'GET') {
        $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
        $days = max(7, min(366, (int)($_GET['days'] ?? 84)));
        $end   = new DateTimeImmutable('tomorrow midnight', $tz);
        $start = $end->modify("-{$days} days");

        // Bucket closed sessions by DATE(started_at).
        $st = $pdo->prepare("
            SELECT DATE(started_at) AS d, SUM(duration_minutes) AS mins
              FROM presence_sessions
             WHERE user_id = ? AND started_at >= ? AND started_at < ?
             GROUP BY DATE(started_at)");
        $st->execute([$u['id'], $start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')]);
        $byDay = [];
        foreach ($st->fetchAll() as $r) $byDay[$r['d']] = (int)$r['mins'];

        // ALSO include any presence_seen rows in the window — covers visits whose
        // phone left without returning (no close-event), plus currently-open sessions.
        // Approximation: bucket the whole [start, last_seen] span on its DATE(start).
        // A multi-day open span would be slightly mis-attributed, but typical lab
        // visits don't cross midnight in a single uninterrupted observation window.
        $stSeen = $pdo->prepare("
            SELECT COALESCE(ps.session_start_at, ps.first_seen_at) AS s,
                   ps.last_seen_at AS e
              FROM presence_seen ps
              JOIN presence_devices pd ON pd.mac = ps.mac
             WHERE pd.user_id = ?
               AND COALESCE(ps.session_start_at, ps.first_seen_at) >= ?
               AND ps.last_seen_at < ?");
        $stSeen->execute([$u['id'],
            $start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')]);
        foreach ($stSeen->fetchAll() as $row) {
            if (empty($row['s']) || empty($row['e'])) continue;
            $mins = (int)round(max(0, (strtotime($row['e']) - strtotime($row['s'])) / 60));
            if ($mins <= 0) continue;
            $day = substr($row['s'], 0, 10);
            $byDay[$day] = ($byDay[$day] ?? 0) + $mins;
        }

        // Fill the whole range so the client gets a dense array.
        $entries = [];
        for ($d = $start; $d < $end; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            $entries[] = ['date' => $key, 'minutes' => $byDay[$key] ?? 0];
        }
        json_response([
            'from' => $start->format('Y-m-d'),
            'to'   => $end->modify('-1 day')->format('Y-m-d'),
            'days' => $entries,
        ]);
        return;
    }

    if ($sub === 'listings' && $method === 'GET') {
        require_exposure($cfg, 'listings_write');
        $status = $_GET['status'] ?? '';
        $sql = "SELECT l.*,
                       p.name AS product_name,
                       COALESCE(l.display_name, p.name) AS name,
                       p.image_url
                  FROM listings l JOIN products p ON p.jan = l.jan
                 WHERE l.seller_user_id = ?";
        $params = [$u['id']];
        if ($status !== '') {
            $sql .= ' AND l.status = ?';
            $params[] = $status;
        }
        $sql .= ' ORDER BY l.updated_at DESC';
        $st = $pdo->prepare($sql);
        $st->execute($params);
        json_response(['items' => $st->fetchAll()]);
        return;
    }

    json_error('not_found', "no me route for $method $sub", 404);
}

// 同じ user の overlapping intervals を merge (複数 MAC の重複カウントを解消)。
// 入力: [[start_ts, end_ts], ...] (unix seconds, 任意順)
// 出力: [[s,e],...] でソート済 + 隣接/重複が全部マージされたもの
function presence_merge_intervals(array $iv): array {
    if (!$iv) return [];
    usort($iv, fn($a, $b) => $a[0] <=> $b[0]);
    $merged = [$iv[0]];
    for ($i = 1; $i < count($iv); $i++) {
        $last = &$merged[count($merged) - 1];
        if ($iv[$i][0] <= $last[1]) {
            // 重複 or 隣接: end を伸ばす
            if ($iv[$i][1] > $last[1]) $last[1] = $iv[$i][1];
        } else {
            $merged[] = $iv[$i];
        }
        unset($last);
    }
    return $merged;
}

// GET /api/users — lightweight list of all human users for recipient pickers.
function route_users(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    if ($method !== 'GET' || isset($seg[1])) {
        json_error('not_found', 'use GET /api/users', 404);
        return;
    }
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q !== '') {
        $st = $pdo->prepare("SELECT id, display_name, avatar_url, grade, gender
            FROM users WHERE kind='human'
              AND (display_name LIKE CONCAT('%', ?, '%') OR email LIKE CONCAT('%', ?, '%'))
            ORDER BY display_name LIMIT 50");
        $st->execute([$q, $q]);
    } else {
        $st = $pdo->query("SELECT id, display_name, avatar_url, grade, gender
            FROM users WHERE kind='human' ORDER BY display_name");
    }
    json_response(['items' => $st->fetchAll()]);
}
