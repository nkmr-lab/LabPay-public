<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    162 => [
        'summary' => '「💪 筋トレ」 記録 + 仲間機能を新規追加しました (/#/workouts または アプリ → 筋トレ から)。 主な機能: ① プリセット 9 種目ピル (腕立て / 腹筋 / 背筋 / スクワット / プランク / 懸垂 / ベンチプレス / デッドリフト / ダンベルカール) を 1 タップで種目欄に入る、 ② 回数 / ウェイト kg / セット数 / メモ で記録、 ③ 自分の直近 7 日間 種目別累計 (回数 + セット数) を表示、 ④ ログ表示は 「自分のみ / 仲間のみ / 自分 + 仲間」 で切替可能、 ⑤ 仲間機能 (/#/workouts/friends): メンバーピッカーで追加 → お互いに追加し合うと 「相互フォロー」 となり 互いの記録が見える (片方だけは 「申請中」)。 仲間追加された相手には 「🤝 筋トレ仲間に追加されました」 通知が飛びます。 ホームクイックアイコン候補にも追加済み。',
        'sns'     => '💪 「筋トレ」 機能を追加! 9 種目プリセット + 仲間 (mutual follow) で互いの様子を見られる。 ホーム / アプリから #v533',
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
