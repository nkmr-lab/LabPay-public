<?php
// id=3 (中村聡史) の今日のラボ滞在を集計。presence_sessions と
// presence_seen を併せて見て、何が「おかしい」か判断する。
require_once '/var/www/labpay/src/bootstrap.php';

$tz = new DateTimeZone($CFG['app']['timezone'] ?? 'Asia/Tokyo');
$today = (new DateTimeImmutable('today', $tz))->format('Y-m-d');
echo "Today (JST): $today\n\n";

// presence_sessions for today
echo "=== presence_sessions (id=3, today) ===\n";
$st = $PDO->prepare("SELECT id, room_id, session_start_at, last_seen_at, closed_at,
    TIMESTAMPDIFF(MINUTE, session_start_at, COALESCE(closed_at, last_seen_at, NOW())) AS duration_min
    FROM presence_sessions
    WHERE user_id = 3 AND DATE(session_start_at) = ?
    ORDER BY session_start_at");
$st->execute([$today]);
$rows = $st->fetchAll(PDO::FETCH_ASSOC);
foreach ($rows as $r) {
    printf("  id=%d  room=%s  start=%s  last_seen=%s  closed=%s  dur=%dmin\n",
        $r['id'], $r['room_id'], $r['session_start_at'],
        $r['last_seen_at'] ?? 'NULL', $r['closed_at'] ?? 'NULL', $r['duration_min']);
}
$total = array_sum(array_column($rows, 'duration_min'));
echo "Total today: {$total} min  (= " . round($total/60, 1) . " hr)\n\n";

// presence_seen の最初/最後
echo "=== presence_seen (id=3, today) earliest/latest ===\n";
$st = $PDO->prepare("SELECT MIN(first_seen_at) AS first, MAX(last_seen_at) AS last,
    COUNT(DISTINCT room_id) AS rooms
    FROM presence_seen WHERE user_id = 3
      AND (DATE(first_seen_at) = ? OR DATE(last_seen_at) = ?)");
$st->execute([$today, $today]);
print_r($st->fetch(PDO::FETCH_ASSOC));

// /api/me/presence_summary がどう計算するかも近似で
echo "\n=== last 7 days durations (sessions, id=3) ===\n";
$st = $PDO->prepare("SELECT DATE(session_start_at) AS d,
    SUM(TIMESTAMPDIFF(MINUTE, session_start_at, COALESCE(closed_at, last_seen_at, NOW()))) AS min
    FROM presence_sessions WHERE user_id = 3
      AND session_start_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(session_start_at) ORDER BY d DESC");
$st->execute();
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    printf("  %s  %d min\n", $r['d'], $r['min']);
}
