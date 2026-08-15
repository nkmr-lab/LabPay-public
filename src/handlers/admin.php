<?php
// /api/admin/* — admin-only endpoints. The function is long but flat; this
// header lists the sub-domains in the same order they appear so you can jump
// to the right block fast.
//
//   allowlist                   GET / POST / DELETE  — who can sign in
//   issue                       POST                 — mint points (one user or broadcast)
//   ledger                      GET                  — recent rows (for reversal picker)
//   reversal                    POST                 — undo a ledger row
//   config                      GET / PATCH          — runtime knobs (fees, streak shape, ...)
//   dashboard                   GET                  — supply totals, counts
//   broadcast                   POST                 — push a notification to everyone
//   users_without_mac           GET / POST notify    — MAC 未登録 user 一覧 + 督促一斉通知
//   rooms                       GET / POST / PATCH / DELETE / rotate_token  — Wi-Fi scanner rooms
//   holidays                    GET / sync           — national holidays import
//   calendar_overrides          GET / POST / DELETE  — lab_open / lab_closed flags
//   presence_infrastructure     GET / POST / DELETE  — lab equipment MACs (never user)
//   scrapbox_slack              sync POST            — trigger #scrapbox bridge sync
//   users                       GET                  — user roster + balances
//
// Every sub-route enforces role=admin via Auth::requireAdmin at the top.

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
            $ledgerId = db_tx($pdo, function () use ($pdo, $sysAcc, $toUserId, $amount, $admin, $memoText) {
                $toAcc = Ledger::accountIdForUser($pdo, $toUserId);
                return Ledger::transfer($pdo, $sysAcc, $toAcc, $amount, 'initial',
                    'admin_issue', $admin['id'], $memoText);
            });
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

        [$reversalIds, $purchaseToNotify] = db_tx($pdo, function () use ($pdo, $ledgerId, $memo) {
            $reversalIds = [];
            $purchaseToNotify = null;
            $st = $pdo->prepare('SELECT * FROM ledger WHERE id=? FOR UPDATE');
            $st->execute([$ledgerId]);
            $src = $st->fetch();
            if (!$src) throw new ApiException('not_found', "ledger $ledgerId not found", 404);

            $reversalIds[] = Ledger::reverse($pdo, $ledgerId, $memo);

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
            return [$reversalIds, $purchaseToNotify];
        });

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
                        'scrapbox_base_pt','scrapbox_pt_per_extra','scrapbox_bonus_cap',
                        'scrapbox_any_edit_pt','scrapbox_own_note_pt','scrapbox_start_date',
                        'roulette_tags'];
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
              (SELECT COALESCE(SUM(b),0) FROM (
                  SELECT
                    (COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=a.id),0)
                    -COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=a.id),0)) AS b
                  FROM accounts a
                  JOIN users u ON u.id = a.owner_user_id
                  WHERE a.kind='user' AND u.kind='human' AND u.role='admin') t)             AS held_by_admins,
              (SELECT COALESCE(SUM(b),0) FROM (
                  SELECT
                    (COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=a.id),0)
                    -COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=a.id),0)) AS b
                  FROM accounts a
                  JOIN users u ON u.id = a.owner_user_id
                  WHERE a.kind='user' AND u.kind='human' AND u.role='member') t)            AS held_by_members,
              (SELECT COUNT(*) FROM users WHERE kind='human' AND role='admin')              AS admin_count,
              (SELECT COUNT(*) FROM users WHERE kind='human' AND role='member')             AS member_count,
              (SELECT COUNT(*) FROM users WHERE kind='human')                               AS user_count,
              (SELECT COUNT(*) FROM allowlist WHERE active=1)                               AS allowlist_active,
              (SELECT COUNT(*) FROM purchases)                                              AS purchase_count,
              (SELECT COUNT(*) FROM listings WHERE status='on_sale' AND qty>0)              AS listings_active,
              (SELECT COUNT(*) FROM products)                                               AS product_count,
              (SELECT COALESCE(SUM(unit_price * qty),0) FROM purchases)                     AS turnover
        ";
        $row = $pdo->query($sql)->fetch();
        // v802 SYSTEM の収支を「ユーザ直接やり取り」と「ESCROW 経由」に分けて集計。
        //   - ユーザ直接: paper_review / rewriter / fee 等 (= ユーザが SYSTEM に直接支払う)
        //                  と minting / scrapbox_reward 等 (= SYSTEM がユーザに直接配る)
        //   - ESCROW 経由: mahjong_rake (escrow → system) や escrow_deposit 等
        //   「戻り」計算はユーザ直接のものだけで OK という方針 (ESCROW 経由は
        //   循環中の内部移動なので「戻り」ではない)。
        $stSys = $pdo->prepare("
            SELECT
              CASE WHEN l.to_account_id = ? THEN 'in' ELSE 'out' END AS dir,
              CASE
                WHEN l.to_account_id = ?   THEN (CASE WHEN l.from_account_id = ? THEN 'via_escrow' ELSE 'with_user' END)
                ELSE                              (CASE WHEN l.to_account_id   = ? THEN 'via_escrow' ELSE 'with_user' END)
              END AS counterparty,
              l.type,
              SUM(l.amount) AS pt,
              COUNT(*) AS n
            FROM ledger l
            WHERE l.to_account_id = ? OR l.from_account_id = ?
            GROUP BY dir, counterparty, l.type
            ORDER BY pt DESC");
        $stSys->execute([$sysAcc, $sysAcc, $escAcc, $escAcc, $sysAcc, $sysAcc]);
        // bucket → [{type, pt, n}]
        $buckets = [
            'in_user'    => [], 'in_escrow'  => [],
            'out_user'   => [], 'out_escrow' => [],
        ];
        foreach ($stSys->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $key = ($r['dir'] === 'in' ? 'in' : 'out') . '_' . ($r['counterparty'] === 'via_escrow' ? 'escrow' : 'user');
            $buckets[$key][] = ['type' => (string)$r['type'], 'pt' => (int)$r['pt'], 'n' => (int)$r['n']];
        }
        $sumPt = fn($arr) => array_sum(array_column($arr, 'pt'));

        // ESCROW 側は単純な種別別 (in/out 双方)
        $stEsc = $pdo->prepare("
            SELECT
              CASE WHEN to_account_id = ? THEN 'in' ELSE 'out' END AS dir,
              type, SUM(amount) AS pt, COUNT(*) AS n
            FROM ledger
            WHERE to_account_id = ? OR from_account_id = ?
            GROUP BY dir, type ORDER BY pt DESC");
        $stEsc->execute([$escAcc, $escAcc, $escAcc]);
        $escIn = []; $escOut = [];
        foreach ($stEsc->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $e = ['type' => (string)$r['type'], 'pt' => (int)$r['pt'], 'n' => (int)$r['n']];
            if ($r['dir'] === 'in') $escIn[] = $e; else $escOut[] = $e;
        }

        $out = array_map('intval', $row);
        // v802 ユーザ直接 / ESCROW 経由で分けて
        $out['system_income_user']    = $buckets['in_user'];    $out['system_income_user_total']    = $sumPt($buckets['in_user']);
        $out['system_income_escrow']  = $buckets['in_escrow'];  $out['system_income_escrow_total']  = $sumPt($buckets['in_escrow']);
        $out['system_outflow_user']   = $buckets['out_user'];   $out['system_outflow_user_total']   = $sumPt($buckets['out_user']);
        $out['system_outflow_escrow'] = $buckets['out_escrow']; $out['system_outflow_escrow_total'] = $sumPt($buckets['out_escrow']);
        // 「戻り」はユーザ直接だけで計算
        $out['system_net_user'] = $out['system_income_user_total'] - $out['system_outflow_user_total'];
        // ESCROW 側内訳
        $out['escrow_income_by_type']   = $escIn;
        $out['escrow_outflow_by_type']  = $escOut;
        $out['escrow_income_total']     = $sumPt($escIn);
        $out['escrow_outflow_total']    = $sumPt($escOut);
        json_response($out);
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

    // ----- users_without_mac -----
    // GET  /api/admin/users_without_mac          : MAC 未登録 (presence_devices 0 件) の human user 一覧
    // POST /api/admin/users_without_mac/notify   : {body, user_ids?} で一斉通知 (user_ids 省略時は全員)
    //   admin が「Mac 登録してください」と督促するための簡易一斉送信。
    if ($sub === 'users_without_mac') {
        if ($method === 'GET' && !isset($seg[2])) {
            $st = $pdo->query("
                SELECT u.id, u.display_name, u.email, u.grade
                  FROM users u
                  JOIN allowlist a ON a.email = u.email AND a.active = 1
                 WHERE u.kind = 'human'
                   AND NOT EXISTS (SELECT 1 FROM presence_devices pd WHERE pd.user_id = u.id)
                 ORDER BY FIELD(u.grade, 'D','M2','M1','B4','B3',''), u.display_name");
            json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
            return;
        }
        if ($method === 'POST' && ($seg[2] ?? '') === 'notify') {
            $body = read_json_body();
            $msg = trim((string)require_field($body, 'body'));
            if ($msg === '' || mb_strlen($msg) > 1000) {
                throw new ApiException('bad_request', 'body length 1..1000', 400);
            }
            // user_ids が無ければ MAC 未登録全員を解決。ある場合は指定された
            // ID のうち「MAC 未登録かつ在籍中の human」のみに絞る (悪用防止)。
            $candidates = [];
            $stC = $pdo->query("
                SELECT u.id FROM users u
                  JOIN allowlist a ON a.email = u.email AND a.active = 1
                 WHERE u.kind = 'human'
                   AND NOT EXISTS (SELECT 1 FROM presence_devices pd WHERE pd.user_id = u.id)");
            foreach ($stC->fetchAll(PDO::FETCH_ASSOC) as $r) $candidates[(int)$r['id']] = true;
            $targets = [];
            if (isset($body['user_ids']) && is_array($body['user_ids'])) {
                foreach ($body['user_ids'] as $uid) {
                    $uid = (int)$uid;
                    if (isset($candidates[$uid])) $targets[] = $uid;
                }
            } else {
                $targets = array_keys($candidates);
            }
            // v396 ユーザー指示で Slack DM は不要 (App 内通知のみ)。
            $count = 0;
            foreach ($targets as $uid) {
                try {
                    Notifier::notifyInApp($pdo, $uid, 'admin_notice', $msg, 'mac_reminder', null);
                    $count++;
                } catch (Throwable $e) { /* continue */ }
            }
            json_response(['ok' => true, 'recipients' => $count]);
            return;
        }
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
            // 6 random bytes = 12 hex chars = 48 bits of entropy. Low-stakes per-room token
            // for a small lab — easy to copy/dictate, online brute force is impractical at
            // request rates. Hashed at rest so a DB leak isn't an immediate exposure.
            $token = bin2hex(random_bytes(6));
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
        // Match the create endpoint's 12-hex token length (6 random bytes / 48 bits).
        $token = bin2hex(random_bytes(6));
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

    // ----- slack 診断 (v352) -----
    // GET  /api/admin/slack_diag         bot identity + 現在の scope 一覧
    // POST /api/admin/slack_diag/test    自分宛に 1 通テスト DM を送る (chat:write の確認用)
    if ($sub === 'slack_diag') {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET') {
            $out = ['bot_token_present' => !empty($cfg['slack']['bot_token'] ?? '')];
            try {
                $r = slack_api_post($cfg, 'auth.test', new stdClass()); // {} body
                $out['ok'] = true;
                $out['team'] = $r['team'] ?? null;
                $out['user'] = $r['user'] ?? null;
                $out['user_id'] = $r['user_id'] ?? null;
                $out['url'] = $r['url'] ?? null;
            } catch (Throwable $e) {
                $out['ok'] = false;
                $out['error'] = $e->getMessage();
            }
            // scope は auth.test の response header に X-OAuth-Scopes として乗るが、我々の
            // slack_api_post は body しか返さないので別途取得。ここでは body のみ。
            // chat:write の有無は下の test エンドポイントで 1 通送ってみるのが確実。
            json_response($out);
            return;
        }
        if ($next === 'test' && $method === 'POST') {
            $body = read_json_body();
            $u = Auth::requireAdmin($pdo, $cfg);
            // 自分の Slack Member ID は auth.nkmr.io の profile store から (本人セッション経由)。
            $slackId = (string)(AuthProfile::selfSlackMemberId($cfg) ?? '');
            if ($slackId === '') {
                throw new ApiException('bad_request',
                    '自分の slack_member_id が未設定。設定 → プロフィールの Slack member ID を埋めてください。', 400);
            }
            try {
                $r = slack_api_post($cfg, 'chat.postMessage', [
                    'channel' => $slackId,
                    'text'    => '🧪 LabPay 通知テスト (admin slack_diag)',
                ]);
                json_response(['ok' => true, 'channel' => $r['channel'] ?? null]);
            } catch (Throwable $e) {
                $msg = $e->getMessage();
                $hint = '';
                if (str_contains($msg, 'missing_scope')) {
                    $hint = "bot token が chat:write スコープを持っていません。\n"
                          . "1) https://api.slack.com/apps からアプリ設定を開く\n"
                          . "2) OAuth & Permissions → Bot Token Scopes に chat:write を追加\n"
                          . "3) Reinstall to Workspace してから新しい xoxb トークンで config/config.php の slack.bot_token を更新\n"
                          . "4) systemctl reload httpd";
                } elseif (str_contains($msg, 'invalid_auth') || str_contains($msg, 'not_authed')) {
                    $hint = 'bot_token が不正 / 期限切れ。 Slack 側で新しいトークンを発行。';
                } elseif (str_contains($msg, 'channel_not_found')) {
                    $hint = "あなたの slack_member_id が不正、もしくは Bot が DM 開けない状態。\n"
                          . "Slack でアプリの「ホーム」タブを 1 回開いてから再試行してください。";
                }
                json_response(['ok' => false, 'error' => $msg, 'hint' => $hint]);
            }
            return;
        }
    }

    // ----- scrapbox-via-slack sync trigger -----
    // POST /api/admin/scrapbox_slack/sync {day?: "Y-m-d", dry_run?: bool}
    if ($sub === 'scrapbox_slack' && ($seg[2] ?? '') === 'sync' && $method === 'POST') {
        require_once __DIR__ . '/../../bin/scrapbox_slack_sync.php';
        $body = read_json_body();
        $day  = isset($body['day']) ? (string)$body['day'] : null;
        $dry  = !empty($body['dry_run']);
        $sync = new ScrapboxSlackSync($pdo, $cfg, $dry);
        json_response($sync->syncDay($day));
        return;
    }

    // ----- users (lightweight list to support admin UI) -----
    if ($sub === 'users' && !isset($seg[2]) && $method === 'GET') {
        $st = $pdo->query("
            SELECT u.id, u.email, u.display_name, u.role, u.kind, u.grade, u.gender,
                   u.created_at, u.last_login_at,
                   a.id AS account_id
              FROM users u LEFT JOIN accounts a ON a.owner_user_id = u.id
             WHERE u.kind='human' ORDER BY u.id");
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            if ($r['account_id']) {
                $r['balance'] = Ledger::balanceOf($pdo, (int)$r['account_id']);
            }
        }
        json_response(['items' => $rows]);
        return;
    }

    // ----- PATCH a single user's grade / gender (admin-only edits to lookup data) -----
    if ($sub === 'users' && isset($seg[2]) && $method === 'PATCH') {
        $uid = (int)$seg[2];
        if ($uid <= 0) throw new ApiException('bad_request', 'bad user id', 400);
        $body = read_json_body();
        $fields = []; $args = [];
        if (array_key_exists('grade', $body)) {
            $g = $body['grade'];
            if ($g === null || $g === '') { $fields[] = 'grade = NULL'; }
            else {
                if (!in_array($g, ['D','M2','M1','B4','B3'], true)) {
                    throw new ApiException('bad_request', 'bad grade', 400);
                }
                $fields[] = 'grade = ?'; $args[] = $g;
            }
        }
        if (array_key_exists('gender', $body)) {
            $g = $body['gender'];
            if ($g === null || $g === '') { $fields[] = 'gender = NULL'; }
            else {
                if (!in_array($g, ['M','F','X'], true)) {
                    throw new ApiException('bad_request', "gender must be M/F/X", 400);
                }
                $fields[] = 'gender = ?'; $args[] = $g;
            }
        }
        if (!$fields) throw new ApiException('bad_request', 'nothing to update', 400);
        $args[] = $uid;
        $sql = 'UPDATE users SET ' . implode(', ', $fields) . " WHERE id = ? AND kind='human'";
        $pdo->prepare($sql)->execute($args);
        json_response(['ok' => true]);
        return;
    }

    // ----- scrapbox_handles (admin が各 user の handle を管理) -----
    // GET    /api/admin/scrapbox_handles               全 user × handle 一覧
    // PATCH  /api/admin/scrapbox_handles {user_id, scrapbox_name}
    //         指定 user の handle を 1 つに置き換える (空文字なら全削除)。
    //         scrapbox_name が他 user に紐づいてれば剥がす (steal)。
    if ($sub === 'scrapbox_handles' && $method === 'GET') {
        $sql = "SELECT u.id, u.display_name, u.grade,
                       h.scrapbox_name
                  FROM users u
             LEFT JOIN user_scrapbox_handles h ON h.user_id = u.id
                 WHERE u.kind='human'
                 ORDER BY CASE u.grade
                            WHEN 'D' THEN 0 WHEN 'M2' THEN 1 WHEN 'M1' THEN 2
                            WHEN 'B4' THEN 3 WHEN 'B3' THEN 4 ELSE 5 END,
                          u.display_name, h.scrapbox_name";
        $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        // 1 user に複数 handle が残ってるレガシーケースはそのまま返す (UI が
        // 1 つに統合する流れ)。
        json_response(['items' => $rows]);
        return;
    }
    if ($sub === 'scrapbox_handles' && $method === 'PATCH') {
        $body = read_json_body();
        $uid = (int)($body['user_id'] ?? 0);
        $name = trim((string)($body['scrapbox_name'] ?? ''));
        if ($uid <= 0) throw new ApiException('bad_request', 'user_id required', 400);
        if (mb_strlen($name) > 100) throw new ApiException('bad_request', 'name too long', 400);
        db_tx($pdo, function () use ($pdo, $uid, $name) {
            // 既存の handle を user から全部はがす (1 user 1 handle に強制)。
            $pdo->prepare('DELETE FROM user_scrapbox_handles WHERE user_id=?')->execute([$uid]);
            if ($name === '') return; // 空文字は「未設定にする」 = 削除のみ
            // 他 user が同じ handle を持ってたら剥がす (steal)。
            $pdo->prepare('DELETE FROM user_scrapbox_handles WHERE scrapbox_name=?')->execute([$name]);
            $pdo->prepare('INSERT INTO user_scrapbox_handles (scrapbox_name, user_id) VALUES (?,?)')
                ->execute([$name, $uid]);
        });
        json_response(['ok' => true]);
        return;
    }

    // ----- v971 usage: /admin/usage/summary?days=7|30 -----
    //   activity_log + AI 系 テーブル を 集計 して 利用統計 を 返す。
    if ($sub === 'usage' && ($seg[2] ?? '') === 'summary' && $method === 'GET') {
        $days = max(1, min(90, (int)($_GET['days'] ?? 30)));
        $since = "NOW() - INTERVAL $days DAY";

        // ノイズ ポーリング endpoint (「使ってる」 の 判定 に は 含めない)。
        //   presence/scan は POS scanner の 30 秒 tick、 他 は SPA の 定期 refresh。
        $noise = ['/presence/scan','/posts/latest_id','/notifications/unread_count',
                  '/me','/me/pending','/me/settings','/presence','/notices',
                  '/timers','/rollcalls','/meetups','/stopwatches',
                  '/groups','/invitations','/ai/paper_recent','/me/asking',
                  '/me/achievements','/places','/listings','/posts'];
        $noiseIn = "'" . implode("','", array_map(fn($x) => str_replace("'", "''", $x), $noise)) . "'";

        // (1) feature 別 (top-level path segment) の DAU/WAU/MAU 相当 と hit 数
        $features = $pdo->query("
            SELECT
                CASE
                    WHEN path LIKE '/ai/%'         THEN 'ai'
                    WHEN path LIKE '/kanban/%'     THEN 'kanban'
                    WHEN path LIKE '/refs/%'       THEN 'refs'
                    WHEN path LIKE '/polls%'       THEN 'polls'
                    WHEN path LIKE '/public-polls%' THEN 'public-polls'
                    WHEN path LIKE '/joint-events%' THEN 'joint-events'
                    WHEN path LIKE '/quotes%'      THEN 'quotes'
                    WHEN path LIKE '/nkmr-albums%' THEN 'nkmr-albums'
                    WHEN path LIKE '/tabearuki%' OR path LIKE '/places%' THEN 'places'
                    WHEN path LIKE '/tier%'        THEN 'tier'
                    WHEN path LIKE '/purchases%'   THEN 'purchases'
                    WHEN path LIKE '/sell%' OR path LIKE '/listings%' THEN 'sell'
                    WHEN path LIKE '/health%'      THEN 'health'
                    WHEN path LIKE '/walk%'        THEN 'walk'
                    WHEN path LIKE '/workouts%'    THEN 'workouts'
                    WHEN path LIKE '/exercise%'    THEN 'exercise'
                    WHEN path LIKE '/sns%'         THEN 'sns'
                    WHEN path LIKE '/predictions%' THEN 'predictions'
                    WHEN path LIKE '/quizzes%'     THEN 'quizzes'
                    WHEN path LIKE '/games%' OR path LIKE '/tictactoe%' OR path LIKE '/buzzer%' THEN 'games'
                    WHEN path LIKE '/timers%' OR path LIKE '/stopwatches%' THEN 'timers'
                    WHEN path LIKE '/overleaf%'    THEN 'overleaf'
                    WHEN path LIKE '/scrapbox%' OR path LIKE '/cosense%' THEN 'cosense'
                    WHEN path LIKE '/zoom%'        THEN 'zoom'
                    WHEN path LIKE '/notices%'     THEN 'notices'
                    ELSE 'other'
                END AS feature,
                COUNT(*) AS hits,
                COUNT(DISTINCT user_id) AS unique_users
              FROM activity_log
             WHERE created_at >= $since
               AND path NOT IN ($noiseIn)
               AND user_id IS NOT NULL
             GROUP BY feature
             ORDER BY unique_users DESC, hits DESC
        ")->fetchAll(PDO::FETCH_ASSOC);

        // (2) 日別 の DAU (直近 30 日)
        $dau = $pdo->query("
            SELECT DATE(created_at) AS d, COUNT(DISTINCT user_id) AS n
              FROM activity_log
             WHERE created_at >= NOW() - INTERVAL 30 DAY
               AND user_id IS NOT NULL
             GROUP BY d
             ORDER BY d
        ")->fetchAll(PDO::FETCH_ASSOC);

        // (3) top users (直近 $days 日)
        $topUsers = $pdo->query("
            SELECT a.user_id, u.display_name,
                   COUNT(*) AS hits,
                   COUNT(DISTINCT DATE(a.created_at)) AS active_days
              FROM activity_log a
              LEFT JOIN users u ON u.id = a.user_id
             WHERE a.created_at >= $since
               AND a.user_id IS NOT NULL
               AND a.path NOT IN ($noiseIn)
             GROUP BY a.user_id
             ORDER BY hits DESC
             LIMIT 20
        ")->fetchAll(PDO::FETCH_ASSOC);

        // (4) AI 系 の 直接 集計 (専用 テーブル)。 テーブル 名 は 実 DB に 合わせる。
        $ai = [];
        foreach ([
            'paper_summary'  => ['paper_translates',        'user_id'],
            'paper_translate'=> ['paper_full_translations', 'user_id'],
            'deep_research'  => ['deep_researches',         'user_id'],
            'paper_review'   => ['paper_reviews',           'user_id'],
        ] as $key => [$table, $userCol]) {
            try {
                $r = $pdo->query("
                    SELECT COUNT(*) AS runs,
                           COUNT(DISTINCT $userCol) AS users,
                           SUM(status='done') AS done_count,
                           SUM(status='error') AS error_count,
                           SUM(status='processing' OR status='pending') AS pending_count
                      FROM $table
                     WHERE created_at >= $since
                ")->fetch(PDO::FETCH_ASSOC);
                $ai[$key] = $r;
            } catch (Throwable $e) {
                // テーブル が 未 作成 の 場合 (新規 環境) は 0 で 埋める
                $ai[$key] = ['runs' => 0, 'users' => 0, 'done_count' => 0,
                             'error_count' => 0, 'pending_count' => 0];
            }
        }

        // (5) 全体 サマリ
        $summary = $pdo->query("
            SELECT
                COUNT(DISTINCT DATE(created_at)) AS active_days_seen,
                COUNT(DISTINCT user_id)          AS active_users,
                COUNT(*)                          AS total_hits
              FROM activity_log
             WHERE created_at >= $since
               AND user_id IS NOT NULL
               AND path NOT IN ($noiseIn)
        ")->fetch(PDO::FETCH_ASSOC);

        // (6) top 30 raw paths (admin の 参考、 ノイズ 除去 後)
        $topPaths = $pdo->query("
            SELECT path, method, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
              FROM activity_log
             WHERE created_at >= $since
               AND user_id IS NOT NULL
               AND path NOT IN ($noiseIn)
             GROUP BY path, method
             ORDER BY n DESC
             LIMIT 30
        ")->fetchAll(PDO::FETCH_ASSOC);

        json_response([
            'days' => $days,
            'summary' => $summary,
            'features' => $features,
            'dau_30d' => $dau,
            'top_users' => $topUsers,
            'ai' => $ai,
            'top_paths' => $topPaths,
        ]);
        return;
    }

    // v1296 AI サブスク 契約週数 ランキング (中村さん要望)
    if ($sub === 'ai-sub' && ($seg[2] ?? '') === 'ranking' && $method === 'GET') {
        $st = $pdo->query("
            SELECT s.user_id, u.display_name, u.avatar_url,
                   s.cycle_count, s.total_paid, s.covered_count, s.covered_pt,
                   s.auto_renew, s.current_period_start, s.current_period_end,
                   s.canceled_at, s.created_at,
                   CASE
                     WHEN s.current_period_end > NOW() AND s.auto_renew = 1 THEN 'renewing'
                     WHEN s.current_period_end > NOW() AND s.auto_renew = 0 THEN 'ends'
                     ELSE 'expired'
                   END AS state
              FROM ai_subs s
              JOIN users u ON u.id = s.user_id
             ORDER BY s.cycle_count DESC, s.total_paid DESC, s.created_at ASC
             LIMIT 100
        ");
        json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
        return;
    }

    json_error('not_found', "no admin route for $method $sub", 404);
}
