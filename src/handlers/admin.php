<?php
// /api/admin/* — allowlist, issue, reversal, config, dashboard, broadcast.
// Every sub-route enforces role=admin.

declare(strict_types=1);

function route_admin(PDO $pdo, array $cfg, string $method, array $seg): void {
    $admin = Auth::requireAdmin($pdo, $cfg);
    $sub = $seg[1] ?? '';

    // ----- allowlist -----
    if ($sub === 'allowlist') {
        if ($method === 'GET') {
            $st = $pdo->query('SELECT email, display_name, role, active, created_at FROM allowlist ORDER BY email');
            json_response(['items' => $st->fetchAll()]);
            return;
        }
        if ($method === 'POST') {
            $body = read_json_body();
            $email = strtolower(trim((string)require_field($body, 'email')));
            $name  = trim((string)require_field($body, 'display_name'));
            $role  = (string)($body['role'] ?? 'member');
            $active= isset($body['active']) ? (int)(bool)$body['active'] : 1;
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiException('bad_request', 'bad email', 400);
            if (!in_array($role, ['member','admin'], true))   throw new ApiException('bad_request', 'bad role', 400);
            if ($name === '' || mb_strlen($name) > 100)        throw new ApiException('bad_request', 'bad name', 400);
            $ins = $pdo->prepare('INSERT INTO allowlist (email, display_name, role, active)
                VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), role=VALUES(role), active=VALUES(active)');
            $ins->execute([$email, $name, $role, $active]);
            // Also update users row if exists so admin can promote on the fly
            $upd = $pdo->prepare('UPDATE users SET display_name=?, role=? WHERE email=?');
            $upd->execute([$name, $role, $email]);
            json_response(['ok' => true]);
            return;
        }
    }

    if ($sub === 'allowlist' && isset($seg[2]) && $method === 'DELETE') {
        $email = strtolower(trim((string)$seg[2]));
        $pdo->prepare('UPDATE allowlist SET active=0 WHERE email=?')->execute([$email]);
        json_response(['ok' => true]);
        return;
    }

    // ----- issue points -----
    // mode='user'  : require to_user_id, issue once to that user (legacy default).
    // mode='all'   : issue the same amount to every active human user.
    //   Each user gets their own ledger row + notification; if a row fails for one user,
    //   the rest still go through (per-user transactions, swallowed individually).
    if ($sub === 'issue' && $method === 'POST') {
        $body = read_json_body();
        $amount   = require_int_positive($body['amount'] ?? null, 'amount');
        $memo     = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 255) : null;
        $mode     = (string)($body['mode'] ?? (isset($body['to_user_id']) ? 'user' : 'all'));
        if (!in_array($mode, ['user','all'], true)) {
            throw new ApiException('bad_request', "mode must be 'user' or 'all'", 400);
        }

        $sysAcc  = Ledger::accountIdByCode($pdo, 'SYSTEM');
        $memoText = $memo ?? 'admin issue';

        // Single-recipient path
        if ($mode === 'user') {
            $toUserId = require_int_positive($body['to_user_id'] ?? null, 'to_user_id');
            $pdo->beginTransaction();
            $ledgerId = null;
            try {
                $toAcc = Ledger::accountIdForUser($pdo, $toUserId);
                $ledgerId = Ledger::transfer($pdo, $sysAcc, $toAcc, $amount, 'initial',
                    'admin_issue', $admin['id'], $memoText);
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            try {
                Notifier::notify($pdo, $cfg, $toUserId, 'admin_notice',
                    "管理者から {$amount}pt が付与されました" . format_memo_suffix($memo),
                    'admin_issue', $ledgerId);
            } catch (Throwable $e) { /* swallow */ }
            json_response(['ok' => true, 'mode' => 'user', 'ledger_id' => $ledgerId, 'recipients' => 1]);
            return;
        }

        // Broadcast path: every human user in allowlist (active) gets one row.
        $st = $pdo->query("
            SELECT u.id FROM users u
              JOIN allowlist a ON a.email = u.email AND a.active = 1
             WHERE u.kind='human'");
        $userIds = array_map('intval', array_column($st->fetchAll(), 'id'));
        $ledgerIds = [];
        $failures  = [];
        foreach ($userIds as $uid) {
            $pdo->beginTransaction();
            try {
                $toAcc = Ledger::accountIdForUser($pdo, $uid);
                $lid   = Ledger::transfer($pdo, $sysAcc, $toAcc, $amount, 'initial',
                    'admin_issue', $admin['id'], $memoText);
                $pdo->commit();
                $ledgerIds[$uid] = $lid;
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                $failures[$uid] = $e->getMessage();
                continue;
            }
            try {
                Notifier::notify($pdo, $cfg, $uid, 'admin_notice',
                    "管理者から {$amount}pt が付与されました" . format_memo_suffix($memo),
                    'admin_issue', $lid);
            } catch (Throwable $e) { /* swallow */ }
        }
        json_response([
            'ok' => true, 'mode' => 'all',
            'recipients' => count($ledgerIds),
            'failures'   => $failures,
        ]);
        return;
    }

    // ----- recent ledger (feeds the reversal picker) -----
    // Returns the N most recent ledger rows that are *candidates* for reversal:
    // skip rows that already have a reversal pointing at them, and skip rows that
    // are themselves reversals.
    if ($sub === 'ledger' && $method === 'GET') {
        $limit = min(100, max(1, (int)($_GET['limit'] ?? 30)));
        $sql = "
            SELECT l.id, l.amount, l.type, l.ref_type, l.ref_id, l.memo, l.created_at,
                   af.code AS from_code, at.code AS to_code,
                   uf.display_name AS from_name, ut.display_name AS to_name,
                   pr.name AS product_name
              FROM ledger l
              JOIN accounts af ON af.id = l.from_account_id
              JOIN accounts at ON at.id = l.to_account_id
              LEFT JOIN users uf ON uf.id = af.owner_user_id
              LEFT JOIN users ut ON ut.id = at.owner_user_id
              LEFT JOIN purchases p ON l.ref_type='purchase' AND p.id = l.ref_id
              LEFT JOIN products  pr ON pr.jan = p.jan
             WHERE l.type != 'reversal'
               AND l.reversed_of IS NULL
               AND NOT EXISTS (SELECT 1 FROM ledger r WHERE r.reversed_of = l.id)
             ORDER BY l.id DESC
             LIMIT ?";
        $st = $pdo->prepare($sql);
        $st->bindValue(1, $limit, PDO::PARAM_INT);
        $st->execute();
        json_response(['items' => $st->fetchAll()]);
        return;
    }

    // ----- reversal -----
    if ($sub === 'reversal' && $method === 'POST') {
        $body = read_json_body();
        $ledgerId = require_int_positive($body['ledger_id'] ?? null, 'ledger_id');
        $memo = isset($body['memo']) ? (string)$body['memo'] : null;

        $reversalIds = [];
        $purchaseToNotify = null;
        $pdo->beginTransaction();
        try {
            // Look up source
            $st = $pdo->prepare('SELECT * FROM ledger WHERE id=? FOR UPDATE');
            $st->execute([$ledgerId]);
            $src = $st->fetch();
            if (!$src) throw new ApiException('not_found', "ledger $ledgerId not found", 404);

            // Always reverse the requested row
            $reversalIds[] = Ledger::reverse($pdo, $ledgerId, $memo);

            // If it is a purchase, also reverse its sibling fee row (if any)
            if ($src['type'] === 'purchase' && $src['ref_type'] === 'purchase' && $src['ref_id']) {
                $st2 = $pdo->prepare("SELECT id FROM ledger
                    WHERE ref_type='purchase' AND ref_id=? AND type='fee'");
                $st2->execute([(int)$src['ref_id']]);
                $feeId = $st2->fetchColumn();
                if ($feeId !== false) {
                    $reversalIds[] = Ledger::reverse($pdo, (int)$feeId, $memo);
                }
                $purchaseToNotify = [
                    'buyer_id'  => null,
                    'seller_id' => null,
                    'purchase_id' => (int)$src['ref_id'],
                ];
                $pq = $pdo->prepare('SELECT buyer_user_id, seller_user_id FROM purchases WHERE id=?');
                $pq->execute([(int)$src['ref_id']]);
                $pr = $pq->fetch();
                if ($pr) {
                    $purchaseToNotify['buyer_id']  = (int)$pr['buyer_user_id'];
                    $purchaseToNotify['seller_id'] = (int)$pr['seller_user_id'];
                }
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        if ($purchaseToNotify) {
            try {
                $msg = "取引 #{$purchaseToNotify['purchase_id']} が管理者により取り消されました";
                if ($purchaseToNotify['buyer_id'])
                    Notifier::notify($pdo, $cfg, $purchaseToNotify['buyer_id'], 'admin_notice', $msg, 'purchase', $purchaseToNotify['purchase_id']);
                if ($purchaseToNotify['seller_id'])
                    Notifier::notify($pdo, $cfg, $purchaseToNotify['seller_id'], 'admin_notice', $msg, 'purchase', $purchaseToNotify['purchase_id']);
            } catch (Throwable $e) { /* swallow */ }
        }

        json_response(['ok' => true, 'reversal_ids' => $reversalIds]);
        return;
    }

    // ----- config -----
    if ($sub === 'config') {
        if ($method === 'GET') {
            $st = $pdo->query('SELECT k, v, updated_at FROM config ORDER BY k');
            json_response(['items' => $st->fetchAll()]);
            return;
        }
        if ($method === 'PATCH') {
            $body = read_json_body();
            $allowed = ['fee_rate','initial_points','checkin_base',
                        'streak_bonus_per_day','streak_bonus_cap','streak_bonus_divisor',
                        'streak_decay_per_missed_workday',
                        'streak_weekday_only','session_ttl_days',
                        'presence_window_minutes','geo_default_radius_m',
                        'scrapbox_project','scrapbox_pt_per_page','scrapbox_pt_daily_cap'];
            $updated = [];
            foreach ($body as $k => $v) {
                if (!in_array($k, $allowed, true)) continue;
                $val = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string)$v;
                cfg_set($pdo, $k, $val);
                $updated[$k] = $val;
            }
            json_response(['ok' => true, 'updated' => $updated]);
            return;
        }
    }

    // ----- dashboard -----
    if ($sub === 'dashboard' && $method === 'GET') {
        // Account IDs are trusted ints (Ledger::accountIdByCode throws if missing),
        // so inlining them is safe — and saves the trouble of reusing PDO placeholders.
        $sysAcc = (int)Ledger::accountIdByCode($pdo, 'SYSTEM');
        $escAcc = (int)Ledger::accountIdByCode($pdo, 'ESCROW');

        // One round-trip: all aggregates in a single SELECT with scalar subqueries.
        $sql = "
            SELECT
              (SELECT COALESCE(SUM(amount),0) FROM ledger
                 WHERE from_account_id=$sysAcc AND type IN ('initial','checkin'))           AS total_minted,
              (SELECT COALESCE(SUM(amount),0) FROM ledger
                 WHERE to_account_id=$sysAcc AND type='fee')                                AS total_fees,
              (SELECT COALESCE(SUM(amount),0) FROM ledger
                 WHERE type='reversal' AND from_account_id=$sysAcc)                         AS reversed_from_system,
              (SELECT COALESCE(SUM(amount),0) FROM ledger
                 WHERE type='reversal' AND to_account_id=$sysAcc)                           AS reversed_to_system,
              (  COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=$sysAcc),0)
               - COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=$sysAcc),0)) AS system_balance,
              (  COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=$escAcc),0)
               - COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=$escAcc),0)) AS escrow_balance,
              (SELECT COALESCE(SUM(b),0) FROM (
                  SELECT
                    (COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=a.id),0)
                    -COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=a.id),0)) AS b
                  FROM accounts a WHERE a.kind='user') t)                                   AS held_by_users,
              (SELECT COUNT(*) FROM users WHERE kind='human')                               AS user_count,
              (SELECT COUNT(*) FROM allowlist WHERE active=1)                               AS allowlist_active,
              (SELECT COUNT(*) FROM purchases)                                              AS purchase_count,
              (SELECT COUNT(*) FROM listings WHERE status='on_sale' AND qty>0)              AS listings_active,
              (SELECT COUNT(*) FROM products)                                               AS product_count,
              (SELECT COALESCE(SUM(unit_price * qty),0) FROM purchases)                     AS turnover
        ";
        $row = $pdo->query($sql)->fetch();
        json_response(array_map('intval', $row));
        return;
    }

    // ----- broadcast -----
    if ($sub === 'broadcast' && $method === 'POST') {
        $body = read_json_body();
        $msg = trim((string)require_field($body, 'body'));
        if ($msg === '' || mb_strlen($msg) > 255)
            throw new ApiException('bad_request', 'body length 1..255', 400);
        $st = $pdo->query("SELECT id FROM users WHERE kind='human'");
        $count = 0;
        while (($row = $st->fetch()) !== false) {
            try {
                Notifier::notify($pdo, $cfg, (int)$row['id'], 'admin_notice', $msg, null, null);
                $count++;
            } catch (Throwable $e) { /* continue */ }
        }
        json_response(['ok' => true, 'recipients' => $count]);
        return;
    }

    // ----- rooms (presence scanner) -----
    if ($sub === 'rooms') {
        if ($method === 'GET') {
            $st = $pdo->query('SELECT id, display_name, last_scan_at, created_at,
                lat, lng, geo_radius_m FROM rooms ORDER BY id');
            json_response(['items' => $st->fetchAll()]);
            return;
        }
        if ($method === 'POST') {
            $body = read_json_body();
            $id    = trim((string)require_field($body, 'id'));
            $name  = trim((string)require_field($body, 'display_name'));
            if (!preg_match('/^[A-Za-z0-9_\-]{1,20}$/', $id))
                throw new ApiException('bad_request', 'id must be [A-Za-z0-9_-]{1,20}', 400);
            if (mb_strlen($name) < 1 || mb_strlen($name) > 100)
                throw new ApiException('bad_request', 'display_name length 1..100', 400);

            // Generate plaintext token; store only its sha256 hash. Plaintext is returned ONCE.
            $token = bin2hex(random_bytes(24));
            $hash  = hash('sha256', $token);
            $ins = $pdo->prepare('INSERT INTO rooms (id, display_name, scanner_token_hash) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), scanner_token_hash=VALUES(scanner_token_hash)');
            $ins->execute([$id, $name, $hash]);
            json_response([
                'ok' => true,
                'id' => $id,
                'display_name' => $name,
                'scanner_token' => $token,
                'note' => 'Save this token now. It is not stored in plaintext and cannot be retrieved again.',
            ]);
            return;
        }
    }
    if ($sub === 'rooms' && isset($seg[2]) && $method === 'DELETE') {
        $rid = (string)$seg[2];
        $pdo->prepare('DELETE FROM rooms WHERE id=?')->execute([$rid]);
        json_response(['ok' => true]);
        return;
    }
    if ($sub === 'rooms' && isset($seg[2]) && $method === 'PATCH') {
        // Update room metadata: name and/or geolocation
        $rid = (string)$seg[2];
        $chk = $pdo->prepare('SELECT id FROM rooms WHERE id=?');
        $chk->execute([$rid]);
        if ($chk->fetchColumn() === false) throw new ApiException('not_found', "room $rid not found", 404);
        $body = read_json_body();
        $sets = []; $params = [];
        if (array_key_exists('display_name', $body)) {
            $sets[] = 'display_name=?'; $params[] = mb_substr((string)$body['display_name'], 0, 100);
        }
        if (array_key_exists('lat', $body)) {
            $lat = $body['lat'];
            if ($lat === null || $lat === '') { $sets[] = 'lat=NULL'; }
            else {
                if (!is_numeric($lat) || $lat < -90 || $lat > 90)
                    throw new ApiException('bad_request', 'lat out of range', 400);
                $sets[] = 'lat=?'; $params[] = (float)$lat;
            }
        }
        if (array_key_exists('lng', $body)) {
            $lng = $body['lng'];
            if ($lng === null || $lng === '') { $sets[] = 'lng=NULL'; }
            else {
                if (!is_numeric($lng) || $lng < -180 || $lng > 180)
                    throw new ApiException('bad_request', 'lng out of range', 400);
                $sets[] = 'lng=?'; $params[] = (float)$lng;
            }
        }
        if (array_key_exists('geo_radius_m', $body)) {
            $rad = $body['geo_radius_m'];
            if ($rad === null || $rad === '') { $sets[] = 'geo_radius_m=NULL'; }
            else {
                $r = require_int_positive($rad, 'geo_radius_m');
                $sets[] = 'geo_radius_m=?'; $params[] = $r;
            }
        }
        if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
        $params[] = $rid;
        $pdo->prepare('UPDATE rooms SET ' . implode(',', $sets) . ' WHERE id=?')
            ->execute($params);
        $get = $pdo->prepare('SELECT id, display_name, last_scan_at, created_at, lat, lng, geo_radius_m FROM rooms WHERE id=?');
        $get->execute([$rid]);
        json_response($get->fetch());
        return;
    }
    if ($sub === 'rooms' && isset($seg[2]) && ($seg[3] ?? '') === 'rotate_token' && $method === 'POST') {
        $rid = (string)$seg[2];
        $chk = $pdo->prepare('SELECT id FROM rooms WHERE id=?');
        $chk->execute([$rid]);
        if ($chk->fetchColumn() === false) throw new ApiException('not_found', "room $rid not found", 404);
        $token = bin2hex(random_bytes(24));
        $hash  = hash('sha256', $token);
        $pdo->prepare('UPDATE rooms SET scanner_token_hash=? WHERE id=?')->execute([$hash, $rid]);
        json_response(['ok' => true, 'id' => $rid, 'scanner_token' => $token,
            'note' => 'Old token is now invalid. Update the scanner config.']);
        return;
    }

    // ----- holidays (national) -----
    if ($sub === 'holidays') {
        if ($method === 'GET') {
            $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
            $st = $pdo->prepare('SELECT holiday_date, name FROM national_holidays
                WHERE YEAR(holiday_date) = ? ORDER BY holiday_date');
            $st->execute([$year]);
            json_response(['items' => $st->fetchAll(),
                'last_sync' => cfg_get($pdo, 'national_holidays_last_sync', '')]);
            return;
        }
        if (isset($seg[2]) && $seg[2] === 'sync' && $method === 'POST') {
            $n = Calendar::syncNationalHolidays($pdo);
            json_response(['ok' => true, 'count' => $n,
                'last_sync' => cfg_get($pdo, 'national_holidays_last_sync', '')]);
            return;
        }
    }

    // ----- calendar overrides (manual lab_closed / lab_open) -----
    if ($sub === 'calendar_overrides') {
        if ($method === 'GET') {
            $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
            $st = $pdo->prepare('SELECT override_date, kind, label, created_at
                FROM calendar_overrides WHERE YEAR(override_date) = ? ORDER BY override_date');
            $st->execute([$year]);
            json_response(['items' => $st->fetchAll()]);
            return;
        }
        if ($method === 'POST') {
            $body = read_json_body();
            $date = (string)require_field($body, 'override_date');
            $kind = (string)require_field($body, 'kind');
            $label = isset($body['label']) ? mb_substr((string)$body['label'], 0, 200) : null;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date))
                throw new ApiException('bad_request', 'override_date must be YYYY-MM-DD', 400);
            if (!in_array($kind, ['lab_closed','lab_open'], true))
                throw new ApiException('bad_request', 'kind must be lab_closed or lab_open', 400);
            $pdo->prepare('INSERT INTO calendar_overrides (override_date, kind, label, created_by_user_id)
                VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE kind=VALUES(kind), label=VALUES(label),
                    created_by_user_id=VALUES(created_by_user_id)')
                ->execute([$date, $kind, $label, $admin['id']]);
            json_response(['ok' => true, 'override_date' => $date, 'kind' => $kind, 'label' => $label]);
            return;
        }
    }
    if ($sub === 'calendar_overrides' && isset($seg[2]) && $method === 'DELETE') {
        $d = (string)$seg[2];
        $pdo->prepare('DELETE FROM calendar_overrides WHERE override_date=?')->execute([$d]);
        json_response(['ok' => true]);
        return;
    }

    // ----- presence_infrastructure (lab equipment that should never claim a user slot) -----
    if ($sub === 'presence_infrastructure') {
        if ($method === 'GET') {
            $st = $pdo->query('SELECT mac, label, kind, created_at FROM presence_infrastructure ORDER BY mac');
            json_response(['items' => $st->fetchAll()]);
            return;
        }
        if ($method === 'POST') {
            $body = read_json_body();
            $mac = presence_normalize_mac((string)require_field($body, 'mac'));
            if (!$mac) throw new ApiException('bad_request', 'invalid MAC', 400);
            $label = trim((string)require_field($body, 'label'));
            if ($label === '' || mb_strlen($label) > 100) {
                throw new ApiException('bad_request', 'label length 1..100', 400);
            }
            $kind = isset($body['kind']) ? mb_substr((string)$body['kind'], 0, 40) : null;
            $pdo->prepare('INSERT INTO presence_infrastructure (mac, label, kind, created_by_user_id)
                VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE label=VALUES(label), kind=VALUES(kind),
                    created_by_user_id=VALUES(created_by_user_id)')
                ->execute([$mac, $label, $kind, $admin['id']]);
            json_response(['ok' => true, 'mac' => $mac, 'label' => $label, 'kind' => $kind]);
            return;
        }
    }
    if ($sub === 'presence_infrastructure' && isset($seg[2]) && $method === 'DELETE') {
        $mac = presence_normalize_mac((string)$seg[2]);
        $pdo->prepare('DELETE FROM presence_infrastructure WHERE mac=?')->execute([$mac]);
        json_response(['ok' => true]);
        return;
    }

    // ----- scrapbox sync trigger -----
    if ($sub === 'scrapbox' && ($seg[2] ?? '') === 'sync' && $method === 'POST') {
        require_once __DIR__ . '/../../bin/scrapbox_sync.php';
        $body = read_json_body();
        $day = isset($body['day']) ? (string)$body['day'] : null;
        $sync = new ScrapboxSync($pdo, $cfg);
        json_response($sync->syncDay($day));
        return;
    }

    // ----- users (lightweight list to support admin UI) -----
    if ($sub === 'users' && $method === 'GET') {
        $st = $pdo->query("
            SELECT u.id, u.email, u.display_name, u.role, u.kind, u.created_at, u.last_login_at,
                   a.id AS account_id
              FROM users u LEFT JOIN accounts a ON a.owner_user_id = u.id
             WHERE u.kind='human' ORDER BY u.id");
        $rows = $st->fetchAll();
        // Add balances
        foreach ($rows as &$r) {
            if ($r['account_id']) {
                $r['balance'] = Ledger::balanceOf($pdo, (int)$r['account_id']);
            }
        }
        json_response(['items' => $rows]);
        return;
    }

    json_error('not_found', "no admin route for $method $sub", 404);
}
