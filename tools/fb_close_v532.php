<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    161 => [
        'summary' => '「⚖️ 体重 / BMI」 記録機能を新規追加しました (/#/health または アプリ → 体重 / BMI から)。 体重 / 身長 / 体脂肪 / メモ を 1 タップで記録 (3 つ全部入れなくても OK)、 サーバ側で BMI 自動計算 + やせ/標準/肥満1/肥満2+ 分類タグ、 前回比 (±N.Nkg) を 体重表示の横に色付きで。 折れ線グラフ (SVG、 軽量、 d3 非依存) で 30日 / 90日 / 半年 / 1年 の期間切替。 履歴 50 件まで一覧 + 個別削除可。 完全に個人ツール (他のメンバーには見えません)。 ホームクイックアイコン候補にも追加済み。',
        'sns'     => '⚖️ 「体重 / BMI」 記録機能を追加 (BMI 自動計算 + 折れ線グラフ + 期間切替)。 個人ツール (他人には見えません) #v532',
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
