<?php
// v499 全ユーザの current_streak を do_checkin_for_user と同じルールで再計算。
// streak_weekday_only=1 (default) なら workday-only judging + decay、 そうでなければ
// 「1日でも空けば streak=1 にリセット」 ルール。
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
/** @var PDO $PDO */
$pdo = $PDO;

$weekdayOnly = (string)cfg_get($pdo, 'streak_weekday_only', '1') !== '0';
$decay = (int)cfg_get($pdo, 'streak_decay_per_missed_workday', '5');
fwrite(STDOUT, "mode=" . ($weekdayOnly ? 'weekday_only' : 'any_gap') . " decay=$decay\n");

$users = $pdo->query("SELECT DISTINCT user_id FROM checkins")->fetchAll(PDO::FETCH_COLUMN);
$updated = 0;
foreach ($users as $uid) {
    $uid = (int)$uid;
    $st = $pdo->prepare("SELECT checkin_date FROM checkins WHERE user_id=? ORDER BY checkin_date ASC");
    $st->execute([$uid]);
    $dates = array_map(fn($r) => $r['checkin_date'], $st->fetchAll(PDO::FETCH_ASSOC));
    if (!$dates) continue;
    $curStreak = 0;
    $longest = 0;
    $prev = null;
    foreach ($dates as $d) {
        if ($prev === null) {
            $curStreak = 1;
        } else {
            $cursor = new DateTimeImmutable($prev);
            $end    = new DateTimeImmutable($d);
            $missed = 0;
            while (true) {
                $cursor = $cursor->modify('+1 day');
                if ($cursor >= $end) break;
                if ($weekdayOnly) {
                    if (Calendar::isWorkday($pdo, $cursor->format('Y-m-d'))) $missed++;
                } else {
                    $missed++;
                }
            }
            if ($missed === 0) {
                $curStreak = $curStreak + 1;
            } else if ($weekdayOnly) {
                $curStreak = max(1, $curStreak - $missed * $decay + 1);
            } else {
                $curStreak = 1;
            }
        }
        if ($curStreak > $longest) $longest = $curStreak;
        $prev = $d;
    }
    $lastDate = end($dates);
    $stU = $pdo->prepare("SELECT 1 FROM streaks WHERE user_id=?");
    $stU->execute([$uid]);
    if ($stU->fetchColumn()) {
        $pdo->prepare("UPDATE streaks SET current_streak=?, longest_streak=?, last_checkin_date=? WHERE user_id=?")
            ->execute([$curStreak, $longest, $lastDate, $uid]);
    } else {
        $pdo->prepare("INSERT INTO streaks (user_id, current_streak, longest_streak, last_checkin_date) VALUES (?,?,?,?)")
            ->execute([$uid, $curStreak, $longest, $lastDate]);
    }
    echo "user $uid: cur=$curStreak longest=$longest last=$lastDate\n";
    $updated++;
}
echo "DONE: $updated user(s) updated\n";
