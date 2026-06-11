<?php
// v530 #188 7F scanner が 2026-06-10 23:28 から停止しており、 user 17 (メンバー09さん) が
//   2026-06-11 在室していたにも関わらず ラボイン できなかった事象を 手動 backfill。
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;

$userId = 17;
$today  = '2026-06-11';

// 既存チェック
$ex = $pdo->prepare("SELECT points_awarded FROM checkins WHERE user_id=? AND checkin_date=?");
$ex->execute([$userId, $today]);
if ($ex->fetchColumn() !== false) { echo "already exists\n"; exit; }

// streak 取得 + 翌日 streak 計算
$st = $pdo->prepare("SELECT current_streak, longest_streak FROM streaks WHERE user_id=?");
$st->execute([$userId]);
$streak = $st->fetch(PDO::FETCH_ASSOC);
$curStreak = (int)($streak['current_streak'] ?? 0);
$newStreak = $curStreak + 1;
$newLongest = max((int)($streak['longest_streak'] ?? 0), $newStreak);

$base    = (int)cfg_get($pdo, 'checkin_base', '10');
$cap     = (int)cfg_get($pdo, 'streak_bonus_cap', '10');
$perDay  = (int)cfg_get($pdo, 'streak_bonus_per_day', '1');
$divisor = max(1, (int)cfg_get($pdo, 'streak_bonus_divisor', '1'));
$bonus   = intdiv(min($cap, max(0, $newStreak - 1)) * $perDay, $divisor);
$points  = $base + $bonus;

echo "user_id=$userId today=$today newStreak=$newStreak points=$points\n";

db_tx($pdo, function () use ($pdo, $userId, $today, $points, $newStreak, $newLongest) {
    $pdo->prepare("INSERT INTO checkins (user_id, checkin_date, points_awarded) VALUES (?,?,?)")
        ->execute([$userId, $today, $points]);
    $pdo->prepare("INSERT INTO streaks (user_id, current_streak, longest_streak, last_checkin_date)
                   VALUES (?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE current_streak=VALUES(current_streak),
                                          longest_streak=VALUES(longest_streak),
                                          last_checkin_date=VALUES(last_checkin_date)")
        ->execute([$userId, $newStreak, $newLongest, $today]);
    // SYSTEM (id=1) から user 17 へ points 移転
    Ledger::transfer($pdo, 1, $userId, $points, 'checkin', null, null,
                     "ラボイン backfill (7F scanner 停止のため手動補填)");
});
try { notify_safely($pdo, $cfg, $userId, 'admin_notice',
    "🤖 Claude 対応: 7F scanner が停止していたため 本日 ($today) のラボインを手動で記録しました (+{$points}pt)。 連続 {$newStreak} 日。",
    'feedback', 188); } catch (Throwable $_) {}
echo "DONE backfilled +{$points}pt streak={$newStreak}\n";
