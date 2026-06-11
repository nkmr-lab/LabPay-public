<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    198 => [
        'summary' => 'らぼったー の マップ (/#/sns/map) で 画像なし投稿のマーカーが真っ白で寂しい件、 38px 丸アイコンに 色付きで描画するようにしました。 ① アバター画像があれば アバター を マーカーに、 ② アバターも無ければ 本文先頭の絵文字 を抜き出して 大きく表示、 ③ 絵文字もなければ display_name の頭文字 を 表示。 背景色は display_name hash で 一意な HSL カラー、 白枠 + 影付きで 写真マーカーと統一感のあるデザイン。 「真っ白で悲しい」 が解消されるはずです。',
        'sns'     => '🎨 らぼったー マップ: 画像なしマーカーをアバター/絵文字/頭文字 + ユーザ色付き丸アイコンに #v542',
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
