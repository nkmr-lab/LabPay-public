<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    195 => [
        'summary' => 'らぼったー投稿で 写真の EXIF GPS を 「現在地」 (geolocation) より優先する 仕様変更 + 既存投稿の DB バックフィル を実施しました。 ① クライアント posts.js: composer に composerImageExifCoords 変数を新設、 画像選択時の EXIF GPS を そこに保存し、 submit 時に EXIF があれば 必ず採用 (geolocation で composerCoords が入っていても上書きされない)。 ② backfill: tools/backfill_post_exif_gps.php を実行、 既存 posts 全件 (image_url ありで JPEG) のうち EXIF GPS が読めた 29 件の lat/lng を 上書き、 8 件は EXIF 無しでスキップ、 エラー 0。 これで自分の投稿マップ (/#/sns/map) には 香港・イタリア・東京 などの投稿が 正しい撮影地に表示されます。',
        'sns'     => '📷 らぼったー: 写真の EXIF GPS を 現在地より優先 + 既存 29 件を バックフィルで補正済 (香港/イタリア/東京) #v537',
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
