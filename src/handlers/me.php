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
        $av = $pdo->prepare('SELECT avatar_url, scrapbox_username, grade, phone_number, slack_member_id FROM users WHERE id=?');
        $av->execute([$u['id']]);
        $row = $av->fetch();
        $u['avatar_url']        = $row['avatar_url']        ?? null;
        $u['scrapbox_username'] = $row['scrapbox_username'] ?? null;
        $u['grade']             = $row['grade']             ?? null;
        $u['phone_number']      = $row['phone_number']      ?? null;
        $u['slack_member_id']   = $row['slack_member_id']   ?? null;
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
        if (array_key_exists('slack_member_id', $body)) {
            $sid = $body['slack_member_id'];
            if ($sid === null || trim((string)$sid) === '') {
                $sets[] = 'slack_member_id = NULL';
            } else {
                $sid = trim((string)$sid);
                // Slack member ID は U + 英数字。 W (Enterprise Grid) も許容。
                if (!preg_match('/^[UW][A-Z0-9]{6,30}$/', $sid)) {
                    throw new ApiException('bad_request', 'slack_member_id は U/W で始まる Slack member ID (例: U01ABCD2345)', 400);
                }
                $sets[] = 'slack_member_id = ?'; $params[] = $sid;
            }
        }
        if (array_key_exists('phone_number', $body)) {
            $ph = $body['phone_number'];
            if ($ph === null || trim((string)$ph) === '') {
                $sets[] = 'phone_number = NULL';
            } else {
                $ph = trim((string)$ph);
                // 数字 / + / - / 半角スペース / 丸括弧 のみ許容。 長さ 5..50。
                if (!preg_match('/^[0-9+\-\s()]{5,50}$/', $ph)) {
                    throw new ApiException('bad_request', 'phone_number は数字 / + / - / 空白 / () のみ、 5〜50 文字', 400);
                }
                $sets[] = 'phone_number = ?'; $params[] = $ph;
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

    // POST /api/me/app-open-reward — 1 日 1 回、未読通知 0 の状態で叩かれた時のみ
    // pt を出す。 既に今日もらってる / 未読がある場合は no-op (silent OK)。
    // フロント側は通知バッジが 0 になるたびに ping する想定で、 冪等を確保する
    // ため (user_id, awarded_on) PK で衝突したら 「もう貰った」 扱い。
    if ($sub === 'app-open-reward' && $method === 'POST') {
        $st = $pdo->prepare('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL');
        $st->execute([$u['id']]);
        $unread = (int)$st->fetchColumn();
        if ($unread > 0) {
            json_response(['awarded' => false, 'reason' => 'unread_pending', 'unread' => $unread]);
            return;
        }
        $today  = date('Y-m-d');
        $points = (int)cfg_get($pdo, 'app_open_reward_pt', '5');
        if ($points <= 0) {
            json_response(['awarded' => false, 'reason' => 'disabled']);
            return;
        }
        // 既に今日もらってる?
        $chk = $pdo->prepare('SELECT 1 FROM app_open_rewards WHERE user_id=? AND awarded_on=?');
        $chk->execute([$u['id'], $today]);
        if ($chk->fetchColumn()) {
            json_response(['awarded' => false, 'reason' => 'already_today']);
            return;
        }
        $result = null;
        try {
            $pdo->beginTransaction();
            // ledger 移転 (SYSTEM → user)。
            $sysAcc  = Ledger::accountIdByCode($pdo, 'SYSTEM');
            $userAcc = Ledger::accountIdForUser($pdo, (int)$u['id']);
            $ledgerId = Ledger::transfer($pdo, $sysAcc, $userAcc, $points,
                'app_open_reward', 'app_open_reward', (int)$u['id'],
                "アプリ起動ボーナス {$today}");
            // 同じ日に 2 回 INSERT されないよう PK 衝突を握り潰す。
            $ins = $pdo->prepare('INSERT INTO app_open_rewards (user_id, awarded_on, points, ledger_id)
                VALUES (?,?,?,?)');
            try {
                $ins->execute([$u['id'], $today, $points, $ledgerId]);
                $result = ['awarded' => true, 'points' => $points];
            } catch (PDOException $e) {
                // 並行 POST で衝突した場合は ledger を巻き戻す。
                if ($e->getCode() === '23000') {
                    $pdo->rollBack();
                    json_response(['awarded' => false, 'reason' => 'already_today']);
                    return;
                }
                throw $e;
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        $bal = Ledger::balanceOf($pdo, Ledger::accountIdForUser($pdo, (int)$u['id']));
        $result['new_balance'] = $bal;
        json_response($result);
        return;
    }

    // ─── Zoom 連携状態取得 / 解除 ─────────────────────────────────────
    if ($sub === 'zoom' && ($seg[2] ?? '') === '' && $method === 'GET') {
        // 連携判定は token の有無で。 zoom_user_id / email は scope 不足だと
        // 取れないので、 オプショナル表示のみに使う。
        $st = $pdo->prepare('SELECT zoom_access_token, zoom_email FROM users WHERE id=?');
        $st->execute([$u['id']]);
        $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
        $connected = !empty($row['zoom_access_token']);
        json_response([
            'connected' => $connected,
            'email'     => $connected ? (string)($row['zoom_email'] ?? '') : null,
        ]);
        return;
    }
    if ($sub === 'zoom' && ($seg[2] ?? '') === '' && $method === 'DELETE') {
        Zoom::disconnect($pdo, (int)$u['id']);
        json_response(['ok' => true]);
        return;
    }

    // ─── Google Calendar + Zoom で予定作成 ────────────────────────────
    // POST /api/me/calendar/events
    // body: {topic, start (ISO8601 w/ tz), duration_minutes, calendar_id?, attendees?}
    // 1. Zoom で MTG 作成 → join_url 取得
    // 2. Google Calendar の指定カレンダー (省略時 primary) に予定を作って
    //    location に Zoom URL を、 description にも join_url を埋める
    // 3. 作成された event オブジェクトを返す
    // /me/calendar/events 本体 (seg[3] 無し)。 seg[3] 付きの POST は別 route
     // (events/{id}/zoom) に通すので、 ここで吸い込まないよう segment 制限。
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'events'
        && ($seg[3] ?? '') === '' && $method === 'POST') {
        $body = read_json_body();
        $topic = trim((string)($body['topic'] ?? ''));
        if ($topic === '' || mb_strlen($topic) > 200) {
            throw new ApiException('bad_request', 'topic length 1..200', 400);
        }
        $startRaw = (string)($body['start'] ?? '');
        if ($startRaw === '') throw new ApiException('bad_request', 'start (ISO8601) required', 400);
        // クライアントの実 TZ。 海外滞在中はここを Europe/Rome 等に切り替え、
        // Zoom / Calendar に 「その場所のローカル時刻」 として登録できるように。
        $tzName = (string)($body['timezone'] ?? '');
        if ($tzName !== '') {
            try { $localTz = new DateTimeZone($tzName); }
            catch (Throwable $e) { $localTz = new DateTimeZone('Asia/Tokyo'); $tzName = 'Asia/Tokyo'; }
        } else {
            $localTz = new DateTimeZone('Asia/Tokyo'); $tzName = 'Asia/Tokyo';
        }
        try {
            $startDt = new DateTimeImmutable($startRaw, $localTz);
        } catch (Throwable $e) {
            throw new ApiException('bad_request', 'start must be ISO8601', 400);
        }
        $duration = max(5, min(720, (int)($body['duration_minutes'] ?? 30)));
        $calendarId = trim((string)($body['calendar_id'] ?? 'primary'));
        if ($calendarId === '') $calendarId = 'primary';
        $withZoom = !array_key_exists('with_zoom', $body) || !empty($body['with_zoom']);
        $endDt = $startDt->modify('+' . $duration . ' minutes');

        $joinUrl = ''; $passcode = ''; $meeting = null;
        if ($withZoom) {
            // Zoom の start_time は 「その TZ における ローカル時刻」 (Z なし)。
            $zoomStart  = $startDt->setTimezone($localTz)->format('Y-m-d\TH:i:s');
            $zoomAccess = Zoom::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
            $meeting = Zoom::createMeeting($zoomAccess, [
                'topic'      => $topic,
                'start_time' => $zoomStart,
                'duration'   => $duration,
                'timezone'   => $tzName,
            ]);
            $joinUrl = (string)($meeting['join_url'] ?? '');
            if ($joinUrl === '') {
                throw new ApiException('zoom_api', 'Zoom did not return join_url', 502);
            }
            $passcode = (string)($meeting['password'] ?? '');
        }

        $event = [
            'summary' => $topic,
            'start'   => ['dateTime' => $startDt->format(DateTimeImmutable::RFC3339), 'timeZone' => $tzName],
            'end'     => ['dateTime' => $endDt->format(DateTimeImmutable::RFC3339),   'timeZone' => $tzName],
        ];
        if ($withZoom) {
            $descLines = ['Zoom MTG', $joinUrl];
            if ($passcode !== '')        $descLines[] = 'パスコード: ' . $passcode;
            if (!empty($meeting['id']))  $descLines[] = 'Meeting ID: ' . (string)$meeting['id'];
            $event['location']    = $joinUrl;
            $event['description'] = implode("\n", $descLines);
        }
        $calAccess = GoogleCalendar::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
        try {
            $created = GoogleCalendar::createEvent($calAccess, $calendarId, $event);
        } catch (ApiException $e) {
            if ($e->errCode === 'calendar_scope') {
                throw new ApiException('calendar_scope',
                    'Google Calendar に書き込み権限がありません。 設定 → Google Calendar 連携 から 再連携 してください', 403);
            }
            throw $e;
        }
        json_response([
            'ok'         => true,
            'invalidate_calendar_cache' => true,
            'zoom'       => $withZoom ? [
                'meeting_id' => $meeting['id']    ?? null,
                'join_url'   => $joinUrl,
                'password'   => $passcode,
            ] : null,
            'event'      => [
                'id'        => (string)($created['id']       ?? ''),
                'html_link' => (string)($created['htmlLink'] ?? ''),
                'summary'   => (string)($created['summary']  ?? ''),
                'start'     => (string)($created['start']['dateTime'] ?? ''),
                'end'       => (string)($created['end']['dateTime']   ?? ''),
            ],
        ]);
        return;
    }

    // POST /api/me/calendar/events/{eventId}/zoom  body: {calendar_id?}
    // 既存予定に Zoom MTG を追加する。 event を Google から取って start/end/title
    // を読み、 Zoom MTG を作成 → location/description に join_url を追記して
    // PATCH。 終日予定は対象外 (Zoom 不要)、 既に Zoom URL がある予定も拒否
    // (重複作成を防ぐ — UI 側でも button 出さないが server gate)。
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'events'
        && ($seg[3] ?? '') !== '' && ($seg[4] ?? '') === 'zoom' && $method === 'POST') {
        $eventId = (string)$seg[3];
        $body = read_json_body();
        $calendarId = trim((string)($body['calendar_id'] ?? 'primary'));
        if ($calendarId === '') $calendarId = 'primary';

        $calAccess = GoogleCalendar::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
        $event = GoogleCalendar::getEvent($calAccess, $calendarId, $eventId);
        if (!$event || empty($event['id'])) {
            throw new ApiException('not_found', '予定が見つかりません', 404);
        }
        if (!isset($event['start']['dateTime'])) {
            throw new ApiException('bad_request', '終日予定には追加できません', 400);
        }
        $existingUrl = GoogleCalendar::extractMeetingUrl($event);
        if ($existingUrl) {
            throw new ApiException('bad_request', 'この予定には既に MTG URL が入ってます', 400);
        }
        $title    = trim((string)($event['summary'] ?? 'Meeting'));
        if ($title === '') $title = 'Meeting';
        try {
            $startDt = new DateTimeImmutable((string)$event['start']['dateTime']);
            $endDt   = new DateTimeImmutable((string)$event['end']['dateTime']);
        } catch (Throwable $e) {
            throw new ApiException('bad_request', 'event start/end が不正です', 400);
        }
        $duration = max(5, (int)round(($endDt->getTimestamp() - $startDt->getTimestamp()) / 60));

        // Google Calendar イベントが持つ timeZone をそのまま Zoom 側にも使う
        // (= 既存予定の現地時刻で Zoom MTG を立てる)。 取れなければ Asia/Tokyo。
        $eventTz = (string)($event['start']['timeZone'] ?? '');
        if ($eventTz === '') $eventTz = 'Asia/Tokyo';
        try { $localTz = new DateTimeZone($eventTz); }
        catch (Throwable $e) { $localTz = new DateTimeZone('Asia/Tokyo'); $eventTz = 'Asia/Tokyo'; }
        $zoomAccess = Zoom::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
        $zoomStart = $startDt->setTimezone($localTz)->format('Y-m-d\TH:i:s');
        $meeting = Zoom::createMeeting($zoomAccess, [
            'topic'      => $title,
            'start_time' => $zoomStart,
            'duration'   => $duration,
            'timezone'   => $eventTz,
        ]);
        $joinUrl = (string)($meeting['join_url'] ?? '');
        if ($joinUrl === '') {
            throw new ApiException('zoom_api', 'Zoom did not return join_url', 502);
        }
        $passcode = (string)($meeting['password'] ?? '');

        // 既存値を保持しつつ追記。 location は空なら join_url を、 あるなら
        // 改行で join_url を後ろに追加。 description は空行を挟んで Zoom 情報を追記。
        $oldLocation    = (string)($event['location']    ?? '');
        $oldDescription = (string)($event['description'] ?? '');
        $extraLines = ['', '— Zoom MTG —', $joinUrl];
        if ($passcode !== '')         $extraLines[] = 'パスコード: ' . $passcode;
        if (!empty($meeting['id']))   $extraLines[] = 'Meeting ID: ' . (string)$meeting['id'];
        $newLocation = $oldLocation === '' ? $joinUrl : ($oldLocation . "\n" . $joinUrl);
        $newDescription = $oldDescription === ''
            ? trim(implode("\n", array_slice($extraLines, 1)))
            : ($oldDescription . "\n" . implode("\n", $extraLines));

        try {
            GoogleCalendar::patchEvent($calAccess, $calendarId, $eventId, [
                'location'    => $newLocation,
                'description' => $newDescription,
            ]);
        } catch (ApiException $e) {
            if ($e->errCode === 'calendar_scope') {
                throw new ApiException('calendar_scope',
                    'Google Calendar に書き込み権限がありません。 設定 → Google Calendar 連携 から 再連携 してください', 403);
            }
            throw $e;
        }
        json_response([
            'ok' => true,
            'invalidate_calendar_cache' => true,
            'zoom' => [
                'join_url' => $joinUrl,
                'password' => $passcode,
                'meeting_id' => $meeting['id'] ?? null,
            ],
        ]);
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
        // MIN(session_start_at) を採用、ただし 24 時間以上の連続検知行 (化石化
        // 候補 = 端末を置き忘れ) は除外して MIN を計算する。これで:
        //   * 同じ MAC が複数 room で検知されている (signal leak) ケース: MIN で
        //     一番古い session_start が拾われて正しい滞在時間が出る
        //   * 化石デバイスがあるケース: 24h+ の行は除外されるので、その古い
        //     start_at は拾われない
        $openStart = null; $openEnd = null; $isFresh = false;
        $stOpen = $pdo->prepare("SELECT MIN(session_start_at) AS s, MAX(last_seen_at) AS e
            FROM presence_seen ps
            JOIN presence_devices pd ON pd.mac = ps.mac
            WHERE pd.user_id = ?
              AND ps.session_start_at IS NOT NULL
              AND TIMESTAMPDIFF(MINUTE, ps.session_start_at, ps.last_seen_at) < ?");
        $stOpen->execute([$u['id'], 24 * 60]);
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

    // ─── Google Calendar ──────────────────────────────────────────────
    // 連携状態を返す + 一覧 / 選択保存 / events / 解除 を担当。
    if ($sub === 'calendar' && ($seg[2] ?? '') === '' && $method === 'GET') {
        $st = $pdo->prepare('SELECT calendar_connected_at, calendar_selected_ids
                             FROM users WHERE id=?');
        $st->execute([$u['id']]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $connected = !empty($row['calendar_connected_at']);
        $selected = [];
        if (!empty($row['calendar_selected_ids'])) {
            $j = json_decode((string)$row['calendar_selected_ids'], true);
            if (is_array($j)) $selected = array_values(array_map('strval', $j));
        }
        json_response([
            'connected'    => $connected,
            'connected_at' => $row['calendar_connected_at'] ?? null,
            'selected_ids' => $selected,
        ]);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'calendars' && $method === 'GET') {
        try {
            $token = GoogleCalendar::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
            $cals  = GoogleCalendar::listCalendars($token);
        } catch (ApiException $e) {
            if ($e->errCode === 'calendar_unauthorized') {
                // refresh は ensureValidAccessToken の中でやってるので、ここに来る
                // ならその refresh 自体が失敗 / token 取消 → 再連携を促す。
                GoogleCalendar::disconnect($pdo, (int)$u['id']);
                throw new ApiException('calendar_reauth', '再連携が必要です', 409);
            }
            throw $e;
        }
        json_response(['items' => $cals]);
        return;
    }
    // 「今日の予定」 タイトル個人フィルタ (ホームの calendar カードで適用)。
    // ルール = JSON 配列、各要素は {pattern: string, regex?: bool}。
    // どれか 1 つにタイトルがマッチすれば hide。
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'filter-rules' && $method === 'GET') {
        $st = $pdo->prepare('SELECT calendar_filter_rules FROM users WHERE id=?');
        $st->execute([$u['id']]);
        $raw = $st->fetchColumn();
        $rules = [];
        if ($raw) {
            $j = json_decode((string)$raw, true);
            if (is_array($j)) $rules = calendar_filter_rules_clean($j);
        }
        json_response(['rules' => $rules]);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'filter-rules' && $method === 'PATCH') {
        $body = read_json_body();
        $raw  = $body['rules'] ?? [];
        if (!is_array($raw)) {
            throw new ApiException('bad_request', 'rules must be an array', 400);
        }
        $rules = calendar_filter_rules_clean($raw);
        // regex ルールはサーバ側でも 1 度 preg_match を試して invalid なら弾く。
        foreach ($rules as $r) {
            if (!empty($r['regex'])) {
                $pat = '/' . str_replace('/', '\/', $r['pattern']) . '/iu';
                if (@preg_match($pat, '') === false) {
                    throw new ApiException('bad_request',
                        "正規表現が不正です: {$r['pattern']}", 400);
                }
            }
        }
        $pdo->prepare('UPDATE users SET calendar_filter_rules=? WHERE id=?')
            ->execute([json_encode($rules, JSON_UNESCAPED_UNICODE), $u['id']]);
        json_response(['ok' => true, 'rules' => $rules]);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'selection' && $method === 'PATCH') {
        $body = read_json_body();
        $ids = $body['ids'] ?? [];
        if (!is_array($ids)) {
            throw new ApiException('bad_request', 'ids must be an array', 400);
        }
        $clean = array_values(array_unique(array_filter(
            array_map(fn($x) => mb_substr(trim((string)$x), 0, 255), $ids))));
        $pdo->prepare('UPDATE users SET calendar_selected_ids=? WHERE id=?')
            ->execute([json_encode($clean, JSON_UNESCAPED_UNICODE), $u['id']]);
        json_response(['ok' => true, 'selected_ids' => $clean]);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === 'events' && $method === 'GET') {
        $st = $pdo->prepare('SELECT calendar_selected_ids, calendar_filter_rules FROM users WHERE id=?');
        $st->execute([$u['id']]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $selected = [];
        if (!empty($row['calendar_selected_ids'])) {
            $j = json_decode((string)$row['calendar_selected_ids'], true);
            if (is_array($j)) $selected = array_map('strval', $j);
        }
        if (!$selected) $selected = ['primary']; // default = primary
        $filterRules = [];
        if (!empty($row['calendar_filter_rules'])) {
            $j = json_decode((string)$row['calendar_filter_rules'], true);
            if (is_array($j)) $filterRules = calendar_filter_rules_clean($j);
        }
        // 「今日 00:00 〜 明日 24:00」 を timeMin/timeMax に変換 (RFC3339)。
        // クライアントが ?tz=Europe/Rome みたいに送ってきたらそれで日付境界を
        // 計算する (海外滞在時に 「今日」 がズレないように)。 不正な TZ 名は
        // 設定 default にフォールバック。
        $clientTz = (string)($_GET['tz'] ?? '');
        try {
            $tz = $clientTz !== '' ? new DateTimeZone($clientTz)
                                   : new DateTimeZone($cfg['app']['timezone'] ?? 'Asia/Tokyo');
        } catch (Throwable $e) {
            $tz = new DateTimeZone($cfg['app']['timezone'] ?? 'Asia/Tokyo');
        }
        $now = new DateTimeImmutable('now', $tz);
        $today0 = $now->setTime(0, 0, 0);
        $tomorrow24 = $today0->modify('+2 day');
        $timeMin = $today0->format(DateTime::RFC3339);
        $timeMax = $tomorrow24->format(DateTime::RFC3339);

        // クライアントが送ってきた前回 ETag を per-calendar で受け取る (JSON)。
        // 全 calendar が 304 (= 変更なし) なら not_modified を返してクライアントは
        // cache をそのまま使う。 1 つでも変更があれば全 calendar を fetch し直す
        // (一部 304 / 一部 200 を merge するのは複雑なので、すべて再取得する方を取った)。
        $clientEtags = [];
        if (!empty($_GET['etags'])) {
            $j = json_decode((string)$_GET['etags'], true);
            if (is_array($j)) $clientEtags = array_map('strval', $j);
        }
        $token = GoogleCalendar::ensureValidAccessToken($pdo, $cfg, (int)$u['id']);
        $perCal = [];
        $allNotModified = !empty($clientEtags);
        foreach ($selected as $cid) {
            try {
                $etagIn = $clientEtags[$cid] ?? null;
                $r = GoogleCalendar::listEvents($token, $cid, $timeMin, $timeMax, $etagIn);
                $perCal[$cid] = $r;
                if ($r['status'] !== 304) $allNotModified = false;
            } catch (ApiException $exc) {
                if ($exc->errCode === 'calendar_unauthorized') {
                    GoogleCalendar::disconnect($pdo, (int)$u['id']);
                    throw new ApiException('calendar_reauth', '再連携が必要です', 409);
                }
                // 個別 calendar の失敗は skip して他の calendar は出す。
                $perCal[$cid] = null;
                $allNotModified = false;
            }
        }
        if ($allNotModified) {
            json_response(['not_modified' => true]);
            return;
        }
        // 304 の cal は items が無いので再 fetch (etag なし) してデータを得る。
        foreach ($perCal as $cid => $r) {
            if ($r !== null && $r['status'] === 304) {
                try {
                    $perCal[$cid] = GoogleCalendar::listEvents($token, $cid, $timeMin, $timeMax, null);
                } catch (Throwable $_) { $perCal[$cid] = null; }
            }
        }
        $merged = [];
        $etags  = [];
        foreach ($perCal as $cid => $r) {
            if ($r === null || empty($r['items'])) continue;
            $etags[$cid] = $r['etag'];
            foreach ($r['items'] as $e) {
                $start = $e['start']['dateTime'] ?? $e['start']['date'] ?? null;
                $end   = $e['end']['dateTime']   ?? $e['end']['date']   ?? null;
                if (!$start) continue;
                $title = (string)($e['summary'] ?? '(無題)');
                if (calendar_filter_rules_match($filterRules, $title)) continue;
                $merged[] = [
                    'id'       => (string)($e['id'] ?? ''),
                    'calendar' => $cid,
                    'title'    => $title,
                    'start'    => $start,
                    'end'      => $end,
                    'all_day'  => !isset($e['start']['dateTime']),
                    'location' => (string)($e['location'] ?? ''),
                    'url'      => GoogleCalendar::extractMeetingUrl($e),
                    'html_url' => (string)($e['htmlLink'] ?? ''),
                ];
            }
        }
        usort($merged, fn($a, $b) => strcmp($a['start'], $b['start']));
        // etags は (object) でキャストして JSON で {} を出す (空 [] にならないよう)
        json_response(['items' => $merged, 'etags' => (object)$etags]);
        return;
    }
    if ($sub === 'calendar' && ($seg[2] ?? '') === '' && $method === 'DELETE') {
        GoogleCalendar::disconnect($pdo, (int)$u['id']);
        json_response(['ok' => true]);
        return;
    }

    // 「自分がまだ回答していないもの」 一覧。 通知を既読にしても消えないよう、
    // 状態をソースに見てそのまま並べる。
    //   - polls: 自分が対象 (poll_voters) + status=open + 自分の poll_votes 無し
    //   - rollcalls: 自分が対象 + status=open + 自分が responded_at NULL
    //   - money_requests: 自分が受取人 + status=open + 自分の paid_at NULL
    if ($sub === 'pending' && $method === 'GET') {
        $items = [];
        $uid = (int)$u['id'];
        // polls
        $stP = $pdo->prepare("
            SELECT p.id, p.title, p.deadline_at, u.display_name AS creator_name,
                   p.multi_select, p.allow_free_text
              FROM polls p
              JOIN poll_voters pv ON pv.poll_id=p.id AND pv.user_id=?
              JOIN users u        ON u.id = p.creator_user_id
             WHERE p.status='open'
               AND NOT EXISTS (SELECT 1 FROM poll_votes pvt WHERE pvt.poll_id=p.id AND pvt.user_id=?)
               AND (pv.voted_at IS NULL OR pv.free_text IS NULL OR pv.free_text='')
             ORDER BY p.deadline_at ASC LIMIT 50");
        $stP->execute([$uid, $uid]);
        foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'poll',
                'kind_label' => '投票',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => '起案 ' . $r['creator_name'],
                'deadline_at' => $r['deadline_at'],
                'url' => '#/polls/' . $r['id'],
                'icon' => '📊',
            ];
        }
        // rollcalls
        $stR = $pdo->prepare("
            SELECT r.id, r.title, r.deadline_at, u.display_name AS creator_name
              FROM roll_calls r
              JOIN roll_call_targets t ON t.roll_call_id=r.id AND t.user_id=?
              JOIN users u             ON u.id = r.creator_user_id
             WHERE r.status='open' AND t.responded_at IS NULL
             ORDER BY r.deadline_at ASC LIMIT 50");
        $stR->execute([$uid]);
        foreach ($stR->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'rollcall',
                'kind_label' => '点呼',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => '起案 ' . $r['creator_name'],
                'deadline_at' => $r['deadline_at'],
                'url' => '#/rollcalls/' . $r['id'],
                'icon' => '📣',
            ];
        }
        // money requests (未払い)
        $stM = $pdo->prepare("
            SELECT mr.id, mr.title, rr.amount_yen, u.display_name AS creator_name
              FROM money_request_recipients rr
              JOIN money_requests mr ON mr.id = rr.request_id
              JOIN users u           ON u.id  = mr.creator_user_id
             WHERE rr.user_id=? AND rr.paid_at IS NULL AND mr.closed_at IS NULL
             ORDER BY mr.id DESC LIMIT 50");
        $stM->execute([$uid]);
        foreach ($stM->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'money_request',
                'kind_label' => '請求',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => '¥' . number_format((int)$r['amount_yen']) . ' · ' . $r['creator_name'] . ' へ',
                'deadline_at' => null,
                'url' => '#/requests/' . $r['id'],
                'icon' => '💸',
            ];
        }
        // tasks: 自分が claim 中 (= 完了報告まだ) のもの
        $stT = $pdo->prepare("
            SELECT t.id, t.title, t.deadline AS deadline_at, t.reward, u.display_name AS requester_name
              FROM task_claims tc
              JOIN tasks t  ON t.id = tc.task_id
              JOIN users u  ON u.id = t.requester_user_id
             WHERE tc.user_id=? AND tc.status='claimed' AND t.status='open'
             ORDER BY t.deadline ASC LIMIT 50");
        $stT->execute([$uid]);
        foreach ($stT->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'task',
                'kind_label' => 'タスク',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => '依頼 ' . $r['requester_name'] . ' · 完了報告まち' . ((int)$r['reward'] > 0 ? ' · ' . (int)$r['reward'] . 'pt' : ''),
                'deadline_at' => $r['deadline_at'],
                'url' => '#/tasks/' . $r['id'],
                'icon' => '✅',
            ];
        }
        // 指名タスクで まだ claim していないもの。
        // assigned_user_ids は CSV (例: "5,10,12") なので FIND_IN_SET で判定。
        $stD = $pdo->prepare("
            SELECT t.id, t.title, t.deadline AS deadline_at, t.reward, u.display_name AS requester_name
              FROM tasks t
              JOIN users u ON u.id = t.requester_user_id
             WHERE t.status='open'
               AND t.assigned_user_ids IS NOT NULL AND t.assigned_user_ids <> ''
               AND FIND_IN_SET(?, t.assigned_user_ids)
               AND NOT EXISTS (SELECT 1 FROM task_claims tc WHERE tc.task_id=t.id AND tc.user_id=? AND tc.status IN ('claimed','reported','approved'))
             ORDER BY t.deadline ASC LIMIT 50");
        $stD->execute([$uid, $uid]);
        foreach ($stD->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'task',
                'kind_label' => '指名タスク',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => '依頼 ' . $r['requester_name'] . ' · 未受諾' . ((int)$r['reward'] > 0 ? ' · ' . (int)$r['reward'] . 'pt' : ''),
                'deadline_at' => $r['deadline_at'],
                'url' => '#/tasks/' . $r['id'],
                'icon' => '👉',
            ];
        }
        // 締切順 (締切無しは末尾)
        usort($items, function ($a, $b) {
            if (!$a['deadline_at'] && !$b['deadline_at']) return 0;
            if (!$a['deadline_at']) return 1;
            if (!$b['deadline_at']) return -1;
            return strcmp($a['deadline_at'], $b['deadline_at']);
        });
        json_response(['items' => $items]);
        return;
    }

    // 「自分が依頼している (起案している) もの」 一覧。 起案者として 締切前 + まだ
    // 全員が応答していない polls / rollcalls / money_requests を返す。
    if ($sub === 'asking' && $method === 'GET') {
        $items = [];
        $uid = (int)$u['id'];
        // polls (creator + open + 未応答が残ってる)
        $stP = $pdo->prepare("
            SELECT p.id, p.title, p.deadline_at,
                   (SELECT COUNT(*) FROM poll_voters pv2 WHERE pv2.poll_id=p.id) AS total_n,
                   (SELECT COUNT(*) FROM poll_voters pv3 WHERE pv3.poll_id=p.id AND pv3.voted_at IS NOT NULL) AS done_n
              FROM polls p
             WHERE p.creator_user_id=? AND p.status='open'
            HAVING done_n < total_n
             ORDER BY p.deadline_at ASC LIMIT 50");
        $stP->execute([$uid]);
        foreach ($stP->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'poll',
                'kind_label' => '投票',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => "{$r['done_n']}/{$r['total_n']} 人が応答",
                'deadline_at' => $r['deadline_at'],
                'url' => '#/polls/' . $r['id'],
                'icon' => '📊',
            ];
        }
        // rollcalls
        $stR = $pdo->prepare("
            SELECT r.id, r.title, r.deadline_at,
                   (SELECT COUNT(*) FROM roll_call_targets t2 WHERE t2.roll_call_id=r.id) AS total_n,
                   (SELECT COUNT(*) FROM roll_call_targets t3 WHERE t3.roll_call_id=r.id AND t3.responded_at IS NOT NULL) AS done_n
              FROM roll_calls r
             WHERE r.creator_user_id=? AND r.status='open'
            HAVING done_n < total_n
             ORDER BY r.deadline_at ASC LIMIT 50");
        $stR->execute([$uid]);
        foreach ($stR->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'rollcall',
                'kind_label' => '点呼',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => "{$r['done_n']}/{$r['total_n']} 人が応答",
                'deadline_at' => $r['deadline_at'],
                'url' => '#/rollcalls/' . $r['id'],
                'icon' => '📣',
            ];
        }
        // money requests (creator + open + 未払いが残ってる)
        $stM = $pdo->prepare("
            SELECT mr.id, mr.title,
                   (SELECT COUNT(*) FROM money_request_recipients rr2 WHERE rr2.request_id=mr.id) AS total_n,
                   (SELECT COUNT(*) FROM money_request_recipients rr3 WHERE rr3.request_id=mr.id AND rr3.paid_at IS NOT NULL) AS done_n
              FROM money_requests mr
             WHERE mr.creator_user_id=? AND mr.closed_at IS NULL
            HAVING done_n < total_n
             ORDER BY mr.id DESC LIMIT 50");
        $stM->execute([$uid]);
        foreach ($stM->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'kind' => 'money_request',
                'kind_label' => '請求',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => "{$r['done_n']}/{$r['total_n']} 人が支払い済",
                'deadline_at' => null,
                'url' => '#/requests/' . $r['id'],
                'icon' => '💸',
            ];
        }
        // tasks: 自分が依頼 (requester) で、 まだ approved 件数 < 必要数 のもの。
        // 承認待ち (reported) があれば 「承認まち」 を強調。
        $stT = $pdo->prepare("
            SELECT t.id, t.title, t.deadline AS deadline_at,
                   (SELECT COUNT(*) FROM task_claims tc1 WHERE tc1.task_id=t.id AND tc1.status='approved') AS approved_n,
                   (SELECT COUNT(*) FROM task_claims tc2 WHERE tc2.task_id=t.id AND tc2.status='reported') AS reported_n,
                   (SELECT COUNT(*) FROM task_claims tc3 WHERE tc3.task_id=t.id AND tc3.status='claimed') AS claimed_n
              FROM tasks t
             WHERE t.requester_user_id=? AND t.status='open'
             ORDER BY t.deadline ASC LIMIT 50");
        $stT->execute([$uid]);
        foreach ($stT->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $reported = (int)$r['reported_n'];
            $claimed  = (int)$r['claimed_n'];
            $sub = $reported > 0 ? "{$reported} 件 承認まち" : ($claimed > 0 ? "{$claimed} 件 進行中" : '受諾まち');
            $items[] = [
                'kind' => 'task',
                'kind_label' => 'タスク',
                'id' => (int)$r['id'],
                'title' => $r['title'],
                'subtitle' => $sub,
                'deadline_at' => $r['deadline_at'],
                'url' => '#/tasks/' . $r['id'],
                'icon' => '✅',
            ];
        }
        usort($items, function ($a, $b) {
            if (!$a['deadline_at'] && !$b['deadline_at']) return 0;
            if (!$a['deadline_at']) return 1;
            if (!$b['deadline_at']) return -1;
            return strcmp($a['deadline_at'], $b['deadline_at']);
        });
        json_response(['items' => $items]);
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

// ─── Calendar filter rules helpers ─────────────────────────────────────
// 受領した配列 (DB 又は body) を妥当な形に正規化: pattern が空文字なものは捨て、
// regex フラグは bool に揃え、pattern 長は 200 文字で頭打ち。
function calendar_filter_rules_clean(array $raw): array {
    $out = [];
    foreach ($raw as $r) {
        if (!is_array($r)) continue;
        $p = trim((string)($r['pattern'] ?? ''));
        if ($p === '') continue;
        $rule = ['pattern' => mb_substr($p, 0, 200)];
        if (!empty($r['regex'])) $rule['regex'] = true;
        $out[] = $rule;
    }
    return array_slice($out, 0, 50); // 上限 50 ルール
}

// タイトルがどれか 1 つのルールにマッチするか。マッチ = この予定を hide。
function calendar_filter_rules_match(array $rules, string $title): bool {
    foreach ($rules as $r) {
        $p = (string)($r['pattern'] ?? '');
        if ($p === '') continue;
        if (!empty($r['regex'])) {
            $pat = '/' . str_replace('/', '\/', $p) . '/iu';
            if (@preg_match($pat, $title) === 1) return true;
        } else {
            if (mb_stripos($title, $p) !== false) return true;
        }
    }
    return false;
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
        $st = $pdo->prepare("SELECT id, display_name, avatar_url, grade, gender, phone_number
            FROM users WHERE kind='human'
              AND (display_name LIKE CONCAT('%', ?, '%') OR email LIKE CONCAT('%', ?, '%'))
            ORDER BY display_name LIMIT 50");
        $st->execute([$q, $q]);
    } else {
        $st = $pdo->query("SELECT id, display_name, avatar_url, grade, gender, phone_number
            FROM users WHERE kind='human' ORDER BY display_name");
    }
    json_response(['items' => $st->fetchAll()]);
}
