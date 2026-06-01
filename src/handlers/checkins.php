<?php
// /api/checkins — once-per-day room check-in with streak bonuses.
// Source codes recorded in ledger memos:
//   'presence' — auto-attributed by the Wi-Fi scanner via presence.php (the
//                normal path in production)
//   'manual'   — POST /api/checkins (kept for testing / future fallback UI)

declare(strict_types=1);

function route_checkins(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'POST') { checkin_manual($pdo, $cfg); return; }
    if ($sub === 'status' && $method === 'GET') { checkin_status($pdo, $cfg); return; }

    json_error('not_found', "no checkins route for $method $sub", 404);
}

// Shared: do the check-in for a user on today's date. Idempotent (UNIQUE on (user,date)).
// $source is recorded only for telemetry/memo. Returns:
//   ['already' => bool, 'points' => int, 'awarded_today' => int,
//    'current_streak' => int, 'longest_streak' => int, 'new_balance' => int]
//
// Streak rule (simplified 2026-06): the streak advances every day the user shows up,
// weekends and holidays included. Missing workdays still breaks the chain (only workdays
// are "owed"); missing weekends/holidays does NOT — "no minus, only plus."
function do_checkin_for_user(PDO $pdo, int $userId, string $source = 'manual'): array {
    $today = (new DateTimeImmutable('now'))->format('Y-m-d');
    $base    = (int)cfg_get($pdo, 'checkin_base', '5');
    $perDay  = (int)cfg_get($pdo, 'streak_bonus_per_day', '1');
    $bonusCap= (int)cfg_get($pdo, 'streak_bonus_cap', '15');
    $divisor = (int)cfg_get($pdo, 'streak_bonus_divisor', '1');
    if ($divisor < 1) $divisor = 1;
    $decay   = (int)cfg_get($pdo, 'streak_decay_per_missed_workday', '5');

    $pdo->beginTransaction();
    try {
        // Reserve today's row first; composite PK enforces once-per-day
        $exists = $pdo->prepare('SELECT points_awarded FROM checkins
            WHERE user_id=? AND checkin_date=? FOR UPDATE');
        $exists->execute([$userId, $today]);
        $existing = $exists->fetch();
        if ($existing) {
            $pdo->rollBack();
            $st = $pdo->prepare('SELECT current_streak, longest_streak, last_checkin_date
                FROM streaks WHERE user_id=?');
            $st->execute([$userId]);
            $streak = $st->fetch() ?: ['current_streak'=>0,'longest_streak'=>0,'last_checkin_date'=>null];
            $bal = Ledger::balanceOf($pdo, Ledger::accountIdForUser($pdo, $userId));
            return [
                'already' => true,
                'points' => 0,
                'awarded_today' => (int)$existing['points_awarded'],
                'current_streak' => (int)$streak['current_streak'],
                'longest_streak' => (int)$streak['longest_streak'],
                'new_balance' => $bal,
            ];
        }

        // Compute streak. Any show-up day advances the chain; only missed *workdays*
        // strictly between prev and today break it.
        $st = $pdo->prepare('SELECT current_streak, longest_streak, last_checkin_date
            FROM streaks WHERE user_id=? FOR UPDATE');
        $st->execute([$userId]);
        $streak = $st->fetch();
        $prev = $streak ? $streak['last_checkin_date'] : null;
        $curStreak = $streak ? (int)$streak['current_streak'] : 0;

        if ($prev === null) {
            $newStreak = 1;
        } else {
            $missed = 0;
            $cursor = new DateTimeImmutable($prev);
            $end    = new DateTimeImmutable($today);
            while (true) {
                $cursor = $cursor->modify('+1 day');
                if ($cursor >= $end) break;
                if (Calendar::isWorkday($pdo, $cursor->format('Y-m-d'))) $missed++;
            }
            if ($missed === 0) {
                $newStreak = $curStreak + 1;
            } else {
                $newStreak = max(1, $curStreak - $missed * $decay + 1);
            }
        }
        $newLongest = max((int)($streak['longest_streak'] ?? 0), $newStreak);

        // points = base + floor(min(cap, max(0, streak-1)) * per_day / divisor)
        // With defaults base=5, cap=15, per_day=1, divisor=1 → 5..20pt; cap reached on day 16.
        $bonus  = intdiv(min($bonusCap, max(0, $newStreak - 1)) * $perDay, $divisor);
        $points = $base + $bonus;

        $pdo->prepare('INSERT INTO checkins (user_id, checkin_date, points_awarded)
            VALUES (?,?,?)')->execute([$userId, $today, $points]);

        // Upsert streaks. Always advance last_checkin_date (even on non-workdays) so that
        // a subsequent workday checkin correctly sees this visit and credits continuity.
        $newLastDate = $today;
        if ($streak) {
            $pdo->prepare('UPDATE streaks SET current_streak=?, longest_streak=?, last_checkin_date=?
                WHERE user_id=?')
                ->execute([$newStreak, $newLongest, $newLastDate, $userId]);
        } else {
            $pdo->prepare('INSERT INTO streaks (user_id, current_streak, longest_streak, last_checkin_date)
                VALUES (?,?,?,?)')
                ->execute([$userId, $newStreak, $newLongest, $newLastDate]);
        }

        // Ledger transfer: SYSTEM -> user
        $sysAcc  = Ledger::accountIdByCode($pdo, 'SYSTEM');
        $userAcc = Ledger::accountIdForUser($pdo, $userId);
        $memo = "ラボイン {$today} (streak {$newStreak}, src={$source})";
        Ledger::transfer($pdo, $sysAcc, $userAcc, $points, 'checkin',
            'checkin', $userId, $memo);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $bal = Ledger::balanceOf($pdo, Ledger::accountIdForUser($pdo, $userId));
    return [
        'already' => false,
        'points' => $points,
        'awarded_today' => $points,
        'current_streak' => $newStreak,
        'longest_streak' => $newLongest,
        'new_balance' => $bal,
    ];
}

// POST /api/checkins  — explicit checkin (the "manual" button)
function checkin_manual(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $r = do_checkin_for_user($pdo, (int)$u['id'], 'manual');
    json_response([
        'already_checked_in' => $r['already'],
        'points'         => $r['points'],
        'awarded_today'  => $r['awarded_today'],
        'current_streak' => $r['current_streak'],
        'longest_streak' => $r['longest_streak'],
        'new_balance'    => $r['new_balance'],
    ]);
}

// GET /api/checkins/status — has the user already checked in today? (for UI)
function checkin_status(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $today = (new DateTimeImmutable('now'))->format('Y-m-d');
    $st = $pdo->prepare('SELECT points_awarded FROM checkins WHERE user_id=? AND checkin_date=?');
    $st->execute([$u['id'], $today]);
    $row = $st->fetch();
    $stkSt = $pdo->prepare('SELECT current_streak, longest_streak FROM streaks WHERE user_id=?');
    $stkSt->execute([$u['id']]);
    $stk = $stkSt->fetch() ?: ['current_streak'=>0,'longest_streak'=>0];

    // Expose the bonus knobs so the UI can render an accurate explainer that survives
    // future tweaks via admin config. Mirrors the formula in do_checkin_for_user().
    $base    = (int)cfg_get($pdo, 'checkin_base', '5');
    $perDay  = (int)cfg_get($pdo, 'streak_bonus_per_day', '1');
    $cap     = (int)cfg_get($pdo, 'streak_bonus_cap', '15');
    $div     = max(1, (int)cfg_get($pdo, 'streak_bonus_divisor', '1'));

    json_response([
        'checked_in_today' => $row !== false,
        'points_today'     => $row ? (int)$row['points_awarded'] : 0,
        'current_streak'   => (int)$stk['current_streak'],
        'longest_streak'   => (int)$stk['longest_streak'],
        'today_is_workday' => Calendar::isWorkday($pdo, $today),
        'bonus_rule' => [
            'base'         => $base,
            'per_day'      => $perDay,
            'cap'          => $cap,
            'divisor'      => $div,
            'max_total'    => $base + intdiv($cap * $perDay, $div),
            'days_to_max'  => $cap + 1,
        ],
    ]);
}
