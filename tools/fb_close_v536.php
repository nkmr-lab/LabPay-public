<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    192 => [
        'summary' => '制覇マップの 都道府県タブ に 「🗾 スタイライズ日本地図」 を追加しました (進捗バーの直下)。 14 列 × 16 行のグリッドに 各都道府県を 地理位置っぽい配置 (北海道は右上、 沖縄は左下、 関東は右、 九州は左下) で並べました。 visited なら 紫塗りつぶし + 白文字、 未訪は薄背景 + 灰文字。 地図上のタップでも トグル可能 (下のグリッドと同期)。 世界地図の色塗りは SVG が複雑なので別途検討、 現状は国タブはグリッドのままです。',
        'sns'     => '🗾 制覇マップの 都道府県タブに スタイライズ日本地図を追加。 行った場所は色塗りで visible #v536',
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
