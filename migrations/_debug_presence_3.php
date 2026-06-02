<?php
// 中村 (id=3) の presence データを診断するだけ。何も変更しない。
require_once '/var/www/labpay/src/bootstrap.php';

echo "== presence_devices for user 3 ==\n";
$st = $PDO->prepare("SELECT mac, label FROM presence_devices WHERE user_id=3");
$st->execute();
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    printf("  mac=%s  label=%s\n", $r['mac'], $r['label'] ?? '-');
}

echo "\n== presence_seen rows for user 3's MACs (any room, recent or not) ==\n";
$st = $PDO->prepare("
  SELECT ps.room_id, ps.mac, ps.last_seen_at, ps.first_seen_at, ps.session_start_at
    FROM presence_seen ps
    JOIN presence_devices pd ON pd.mac = ps.mac
   WHERE pd.user_id = 3
   ORDER BY ps.room_id, ps.last_seen_at DESC");
$st->execute();
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    printf("  room=%-8s  mac=%s  last=%s  first=%s  start=%s\n",
        $r['room_id'], $r['mac'],
        $r['last_seen_at'] ?? 'NULL',
        $r['first_seen_at'] ?? 'NULL',
        $r['session_start_at'] ?? 'NULL');
}

echo "\n== presence_sessions today for user 3 (closed sessions) ==\n";
$st = $PDO->prepare("
  SELECT id, room_id, started_at, ended_at, duration_minutes
    FROM presence_sessions
   WHERE user_id = 3 AND DATE(started_at) = CURDATE()
   ORDER BY started_at");
$st->execute();
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    printf("  id=%d room=%s start=%s end=%s dur=%d min\n",
        $r['id'], $r['room_id'], $r['started_at'], $r['ended_at'], $r['duration_minutes']);
}
