<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    141 => [
        'summary' => '巡回時刻が古いまま表示されていた件、 cron が一度切れて再登録した間に poll ファイル (/var/www/labpay/var/claude_last_poll.txt) が更新されていなかったのが原因です。 v515 で 2 つ対応しました: (a) 巡回ダッシュボードの 「最終 巡回」 を MAX(poll ファイル, MAX(claude_finished_at)) で算出するように変更 (= 完了タイムスタンプを 「Claude 生存の証拠」 として扱う)。 (b) cron 巡回プロンプトに 「毎回 /api/feedback/claude_queue を curl で叩いて poll ファイルを更新」 を組み込み。 これで 30 分毎に確実に時刻が進みます。 直近の poll は 2026-06-11 01:22 で記録済み。',
        'sns'     => '🕒 巡回時刻が古い件、 v515 で完了時刻も最終巡回に含めるように + cron が毎回 poll を更新 #v515',
    ],
    142 => [
        'summary' => 'タブ切替直後に反応が遅い件、 v515 で router.dispatch が ① nav ハイライトを即時更新、 ② #app に skeleton プレースホルダを即時注入、 してから各 view の renderer (dynamic import 含む) を await するように変更しました。 これで タップした瞬間に画面が切り替わって見え、 renderer が走り終わったら実コンテンツに自然と入れ替わります。 dynamic import 初回ロードの数百ms の間も 「何かが動いてる」 感が出ます。',
        'sns'     => '⚡ タブ切替直後に skeleton + nav ハイライトを即時表示。 反応の遅さを解消 #v515',
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
