<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) exit(1);

$BATCH = [
    223 => [
        'summary' => '人狼 + ito を アプリ化しました。 ito (/#/ito): 2人以上、 プレイフィー 1pt、 各自に 1-100 ランダム配布、 お題に沿って表現を入力、 起案者が公開ボタンで 全員の数字を 小さい順 + 順位付きで開示。 人狼 (/#/jinrou): 4-16人、 役職 (村人/人狼/占い師/騎士) を 自動配布 (人数別比率)、 夜 (人狼襲撃 + 占い + 護衛) → 昼 (全員投票で追放) → 勝敗判定 (人狼全滅 = 村人勝利 / 人狼≥村人 = 人狼勝利)、 自分の役は自分だけ見える、 人狼同士は仲間が見える、 占い師は占った結果を 自分だけ見れる、 騎士の護衛が当たれば襲撃失敗。 ログで全員の行動が時系列で見える。 両方ともプレイフィー方式 (lobby 中のみ返金)。',
        'sns'     => '🎲 ito + 🐺 人狼 アプリ化! それぞれ /#/ito, /#/jinrou から #v570',
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
