<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    169 => [
        'summary' => '「🚶 散歩」 機能を新規追加しました (/#/walk または アプリ → 散歩 から)。 現在地ボタンで geolocation 取得 → 周辺の食べある記 places から おすすめ散歩先を提案。 主な機能: ① 「✨ 今日のおすすめ」 を 距離順上位 5 件から ランダム 1 件 (🎲 別の場所 ボタンで 振り直し)、 ② 距離 m + 徒歩 ◯ 分 (約 80m/分) + 方位矢印 (↑↗→↘↓↙←↖) を表示、 ③ Leaflet 地図に 現在地 + おすすめ (⭐) + 候補 (🍴 / 👣 で 未訪 / 行った) をマーカーで、 ④ 半径切替 (500m / 1km / 2km / 3km / 5km)、 ⑤ Google Maps で経路 ボタン (徒歩経路への 1 タップリンク)、 ⑥ 他の候補 一覧 で 15 件まで表示。 食べある記の足跡 (v529 #164) と連動して 未訪を優先する作りなので 「行ったことない近場」 が出やすいはずです。',
        'sns'     => '🚶 「散歩」 機能を追加! 現在地周辺の 食べある記からランダム提案 (未訪優先) + 地図 + Google Maps 経路 + 距離/徒歩分/方位矢印 #v538',
    ],
];
foreach ($BATCH as $fid => $data) {
    $st = $pdo->prepare("SELECT id, user_id, claude_status FROM feedback WHERE id = ?");
    $st->execute([$fid]);
    $fb = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fb || $fb['claude_status'] === 'done') { echo "skip #$fid\n"; continue; }
    $ownerUid = (int)$fb['user_id'];
    $summary = $data['summary'];
    $reply = '🤖 Claude 対応: ' . $summary;
    db_tx($pdo, function () use ($pdo, $fid, $summary, $reply, $claudeUid) {
        $pdo->prepare("UPDATE feedback SET claude_status='done', claude_finished_at=NOW(), claude_summary=?, replied_at=NOW(), reply_body=?, replied_by_user_id=? WHERE id=?")
            ->execute([$summary, $reply, $claudeUid, $fid]);
    });
    try { notify_safely($pdo, $cfg, $ownerUid, 'admin_notice', "🤖 要望#$fid 対応: $summary", 'feedback', $fid); } catch (Throwable $e) {}
    try { slack_notify($cfg, "✅ feedback #$fid done — $summary", null, '#/feedback-admin'); } catch (Throwable $e) {}
    try { feedback_post_release_to_sns($pdo, (int)$fid, $data['sns']); } catch (Throwable $e) {}
    echo "done #$fid\n";
}
echo "ALL DONE\n";
