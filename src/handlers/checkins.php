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
    if ($sub === 'streak-ranking' && $method === 'GET') { checkin_streak_ranking($pdo, $cfg); return; }

    json_error('not_found', "no checkins route for $method $sub", 404);
}

// v1288 最長連続ラボイン ランキング。 継続中 判定 (me.php と 同じ missed ロジック) を 付与。
// v1289 各人 の 「最長 window の 開始日〜終了日」 と 「継続中 window の 開始日」 を checkins から
//   再構築 して 追加。 weekday_only 対応 (稼働日 gap を Calendar::isWorkday で 判定)。
function checkin_streak_ranking(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $rows = $pdo->query("
        SELECT s.user_id, s.current_streak, s.longest_streak, s.last_checkin_date,
               u.display_name, u.avatar_url
          FROM streaks s
          JOIN users u ON u.id = s.user_id
         WHERE s.longest_streak > 0
         ORDER BY s.longest_streak DESC, s.current_streak DESC, u.display_name
         LIMIT 50
    ")->fetchAll(PDO::FETCH_ASSOC);
    $weekdayOnly = (string)cfg_get($pdo, 'streak_weekday_only', '1') !== '0';
    $tz = new DateTimeZone(date_default_timezone_get());
    $today = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $yest  = (new DateTimeImmutable('yesterday', $tz))->format('Y-m-d');

    // 上位 50 名 の checkins を 一括取得 (user_id, checkin_date ASC)
    $winByUser = [];
    if ($rows) {
        $ids = array_map(fn($r) => (int)$r['user_id'], $rows);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $stC = $pdo->prepare("SELECT user_id, checkin_date FROM checkins
                               WHERE user_id IN ($place) ORDER BY user_id, checkin_date");
        $stC->execute($ids);
        $datesByUser = [];
        foreach ($stC->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $datesByUser[(int)$c['user_id']][] = (string)$c['checkin_date'];
        }
        foreach ($datesByUser as $uid => $dates) {
            $winByUser[$uid] = compute_streak_windows($pdo, $dates, $weekdayOnly, $tz);
        }
    }

    $out = [];
    foreach ($rows as $r) {
        $uid  = (int)$r['user_id'];
        $cur  = (int)$r['current_streak'];
        $last = $r['last_checkin_date'];
        $ongoing = false;
        if ($cur > 0 && $last) {
            if ($last === $today || $last === $yest) {
                $ongoing = true;
            } else {
                $d = new DateTimeImmutable($last, $tz);
                $limit = new DateTimeImmutable($yest, $tz);
                $missed = 0;
                $safety = 400;
                while ($safety-- > 0) {
                    $d = $d->modify('+1 day');
                    if ($d > $limit) break;
                    if (!$weekdayOnly || Calendar::isWorkday($pdo, $d->format('Y-m-d'))) $missed++;
                }
                $ongoing = ($missed === 0);
            }
        }
        $win = $winByUser[$uid] ?? ['longest' => null, 'latest' => null];
        $out[] = [
            'user_id'          => $uid,
            'display_name'     => (string)$r['display_name'],
            'avatar_url'       => $r['avatar_url'],
            'longest_streak'   => (int)$r['longest_streak'],
            'current_streak'   => $cur,
            'is_ongoing'       => $ongoing,
            'last_checkin_date'=> $last,
            'longest_start'    => $win['longest']['start'] ?? null,
            'longest_end'      => $win['longest']['end']   ?? null,
            'current_start'    => ($ongoing && $win['latest']) ? $win['latest']['start'] : null,
        ];
    }
    json_response(['ranking' => $out]);
}

// checkins.checkin_date の ASC 配列 から window を 走査、 最長 と 最新 の (start, end, len) を返す。
// weekday_only=true なら 「前 checkin の 次 稼働日 == 今回 checkin」 で 連続判定、 false なら 単純 +1 日。
function compute_streak_windows(PDO $pdo, array $dates, bool $weekdayOnly, DateTimeZone $tz): array {
    $winStart = null; $winLen = 0; $prev = null;
    $longest = null; $latest = null;
    $flush = function() use (&$longest, &$latest, &$winStart, &$prev, &$winLen) {
        if ($winLen <= 0) return;
        $w = ['start' => $winStart, 'end' => $prev, 'len' => $winLen];
        if (!$longest || $w['len'] > $longest['len']) $longest = $w;
        $latest = $w;
    };
    foreach ($dates as $d) {
        if ($prev === null) {
            $winStart = $d; $winLen = 1; $prev = $d; continue;
        }
        $connected = false;
        if (!$weekdayOnly) {
            $connected = ((new DateTimeImmutable($prev, $tz))->modify('+1 day')->format('Y-m-d') === $d);
        } else {
            $x = new DateTimeImmutable($prev, $tz);
            for ($i = 0; $i < 10; $i++) {
                $x = $x->modify('+1 day');
                if (Calendar::isWorkday($pdo, $x->format('Y-m-d'))) break;
            }
            $connected = ($x->format('Y-m-d') === $d);
        }
        if ($connected) { $winLen++; $prev = $d; }
        else { $flush(); $winStart = $d; $winLen = 1; $prev = $d; }
    }
    $flush();
    return ['longest' => $longest, 'latest' => $latest];
}

// Shared: do the check-in for a user on today's date. Idempotent (UNIQUE on (user,date)).
// $source is recorded only for telemetry/memo. Returns:
//   ['already' => bool, 'points' => int, 'awarded_today' => int,
//    'current_streak' => int, 'longest_streak' => int, 'new_balance' => int]
//
// Streak rule (2026-06 v499 #117): admin config の streak_weekday_only で 2 つのモード
// を切り替え。デフォルトは true (workday-only) = 土日祝は休んでも streak 維持、
// 平日 (workday) を欠かすと decay でリセット気味に。平日勤務型の人にやさしい挙動。
// false にすると「1 日でも空けば streak=1 にリセット」のシンプルルール。
// (v498 #109 で「workday判定撤廃」に倒したら「平日毎日来てるのに 3 連続止まり」と
//  逆方向の混乱が起きたため、旧挙動を default に戻し設定で切り替え可能にした)
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
            // v499 #117 streak_weekday_only で 2 モード切替。 default=true=旧挙動。
            $weekdayOnly = (string)cfg_get($pdo, 'streak_weekday_only', '1') !== '0';
            $missed = 0;
            $cursor = new DateTimeImmutable($prev);
            $end    = new DateTimeImmutable($today);
            while (true) {
                $cursor = $cursor->modify('+1 day');
                if ($cursor >= $end) break;
                if ($weekdayOnly) {
                    if (Calendar::isWorkday($pdo, $cursor->format('Y-m-d'))) $missed++;
                } else {
                    $missed++;
                }
            }
            // v1286 中村さん指示「完全リセットで良い」→ 平日 (weekday_only なら 稼働日 のみ、
            //   OFF なら 全日) を 1 日でも 休んだら streak=1 に 完全リセット。
            //   従来 (v498〜v1285): weekday_only=1 の 場合 は decay 減点 (missed × 5、 max 1)
            //   だった が、 「1 日 休んだ くらいで たった -5 で 済む の は 緩すぎる」の 指摘。
            //   $decay は 現在 未使用 だが 変数 は 温存 (将来 の 中間案 で 復活可)。
            $newStreak = ($missed === 0) ? ($curStreak + 1) : 1;
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
