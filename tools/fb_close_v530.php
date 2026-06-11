<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    181 => [
        'summary' => 'らぼったー の 自分の投稿 (位置情報あり) を 地図にプロットする機能を追加しました。 /#/sns/map から、 もしくは らぼったー タイムライン 上部の 「📍 自分の投稿マップ →」 リンクから到達。 Leaflet + OpenStreetMap でマーカー表示、 マーカータップで投稿本文プレビュー + 詳細リンク。 地図を動かす (= 表示中エリアを変える) と 下の一覧が 自動で絞り込まれる (= 食べある記の マップビュー と 同じ思想)。',
        'sns'     => '🗺 らぼったーに 「自分の投稿マップ」 を追加。 地図 + 連動絞り込み一覧 #v530',
    ],
    188 => [
        'summary' => '院生室 (7F 系) で 在室判定にならない件、 原因は 7階研究室のスキャナが 2026-06-10 23:28 を最後に停止していました。 サーバ側のログでは 7F の MAC 検出が全く来ていません (scanner プロセス停止 or 物理機器の電源/ネットワーク問題)。 物理的に scanner ホストを再起動してもらう必要があります。 ご迷惑をおかけしました。 また、 メンバー09さんの本日 (2026-06-11) のラボイン は scanner 停止が原因なので 手動で backfill しました (+13pt / streak 4)。 7F scanner の復旧を nakamura に連絡しました。',
        'sns'     => '🔧 7F scanner が 2026-06-10 23:28 から停止中。 メンバー09さんのラボイン手動補填済 (+13pt)。 nakamura に再起動連絡 #v530',
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
// 7F scanner 停止について nakamura (admin) にも知らせる
try {
    notify_safely($pdo, $cfg, $claudeUid, 'admin_notice',
        "⚠ 7F scanner が 2026-06-10 23:28 から MAC 検出を受け取れていません。 物理ホストの再起動 (or scanner プロセス restart) をお願いします。 user 17 の今日のラボインは手動補填済。",
        'feedback', 188);
} catch (Throwable $e) {}
echo "ALL DONE\n";
