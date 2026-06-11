<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    164 => [
        'summary' => '食べある記に 「👣 行った (足跡)」 機能を追加しました。 ハート (❤️ いいね) と別軸で、 実際に行った場所を 1 回タップで記録。 詳細ページで ❤️ と 👣 の 2 つのボタンが並ぶ形に、 タイル / マップ一覧でも 👣N のバッジが常時表示されます。 「制覇感」 を後押しする方向で、 後ほど 「行った場所一覧」 マップ表示なども検討します。',
        'sns'     => '👣 食べある記に 「行った (足跡)」 機能を追加 (❤️ と別軸)。 タップで記録、 タイル/マップでバッジ表示 #v529',
    ],
    165 => [
        'summary' => 'ご要望のうち 「ストップウォッチを 締切ありカテゴリに移動」 を v529 で対応しました。 アプリ → 🔴 締切・応答が要るもの の中に並びます。 「アプリリストにあって ウィジェット化されてない物を全部 widget化 + 設定で表示」 の方は規模が大きいので、 v530 以降で 1 ジャンルずつ段階的に進めます (urgent 系 → tool 系 → archive 系 の順)。',
        'sns'     => '⏱ ストップウォッチを 「締切・応答が要るもの」 カテゴリに移動 #v529  / アプリ全部 widget 化は順次対応中',
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
