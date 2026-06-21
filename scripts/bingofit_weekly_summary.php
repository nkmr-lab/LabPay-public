<?php
// v741 BingoFit 週次集計 (月曜 09:00 JST cron)。
//   前週 (= 先週日曜 〜 先週土曜) の盤を持っていた user に対して
//   admin_notice で 「先週は ◯ マス開け、 ▲ ビンゴ」 を通知。
//   ついでに 全体 サマリ を Slack #/bingofit/board に投げる。
//
//   ※ 新盤生成は client が GET /api/bingofit/board したタイミングで自動生成されるので、
//     ここでは事前生成しない (cron が走らなくても困らない設計)。

declare(strict_types=1);

chdir('/var/www/labpay');
require_once '/var/www/labpay/src/bootstrap.php';

global $PDO, $CFG;

// 先週日曜の日付 (JST)
$d = new DateTime('now', new DateTimeZone('Asia/Tokyo'));
$d->modify('-' . (int)$d->format('w') . ' days'); // 今週の日曜
$d->modify('-7 days');                            // 先週の日曜
$lastWeek = $d->format('Y-m-d');

$st = $PDO->prepare("SELECT b.id, b.user_id, b.cells_json,
                            u.display_name, u.kind,
                            (SELECT COUNT(*) FROM bingofit_cell_opens o WHERE o.board_id=b.id) AS opened
                       FROM bingofit_boards b
                       JOIN users u ON u.id = b.user_id
                      WHERE b.week_start = ?
                        AND u.kind = 'human'");
$st->execute([$lastWeek]);
$rows = $st->fetchAll(PDO::FETCH_ASSOC);

if (empty($rows)) {
    echo "[" . date('c') . "] no boards for last week ($lastWeek)\n";
    exit(0);
}

$grand = ['users' => 0, 'opens' => 0, 'lines' => 0, 'full' => 0, 'top' => null];
foreach ($rows as $r) {
    $bid = (int)$r['id'];
    $uid = (int)$r['user_id'];
    $opens = (int)$r['opened'];
    $stO = $PDO->prepare("SELECT cell_index FROM bingofit_cell_opens WHERE board_id=?");
    $stO->execute([$bid]);
    $opened = array_map('intval', $stO->fetchAll(PDO::FETCH_COLUMN));
    $lines = bingofit_count_lines($opened);
    $isFull = $opens >= 25;

    $msg = "👕 先週 (" . $lastWeek . " 週) の 着回しビンゴ: "
         . $opens . "/25 マス開け、 "
         . ($lines > 0 ? '🎯 ' . $lines . ' ビンゴ達成!' : 'ビンゴなし');
    if ($isFull) $msg .= " 🌟 フルハウス!";
    try {
        notify_safely($PDO, $CFG, $uid, 'admin_notice', $msg, 'bingofit', $bid);
    } catch (Throwable $e) {
        fwrite(STDERR, "notify_safely fail uid=$uid: " . $e->getMessage() . "\n");
    }

    $grand['users']++;
    $grand['opens'] += $opens;
    $grand['lines'] += $lines;
    if ($isFull) $grand['full']++;
    if ($grand['top'] === null || $lines > $grand['top']['lines'] || ($lines === $grand['top']['lines'] && $opens > $grand['top']['opens'])) {
        $grand['top'] = ['name' => $r['display_name'], 'lines' => $lines, 'opens' => $opens, 'full' => $isFull];
    }
    echo "[" . date('c') . "] uid=$uid opens=$opens lines=$lines full=" . ($isFull?'Y':'N') . "\n";
}

// Slack 全体サマリ
try {
    $top = $grand['top'];
    $topMsg = $top ? ('🏆 トップ: ' . $top['name'] . ' (' . $top['lines'] . ' ビンゴ、 ' . $top['opens'] . '/25' . ($top['full'] ? ' 🌟フルハウス' : '') . ')') : '';
    $slack = "👕 先週 (" . $lastWeek . " 週) の 着回しビンゴ サマリ\n"
           . $grand['users'] . " 人参加 / 合計 " . $grand['opens'] . " マス開け / 合計 " . $grand['lines'] . " ビンゴ / フルハウス " . $grand['full'] . " 人\n"
           . $topMsg;
    slack_notify($CFG, $slack, null, '#/bingofit/board');
} catch (Throwable $e) {
    fwrite(STDERR, "slack_notify fail: " . $e->getMessage() . "\n");
}
