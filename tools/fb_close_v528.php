<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    184 => [
        'summary' => 'グループのスケジュールが 「読み込み中」 で止まる件、 原因は loadDetail が再走した時に async fetch の前に取った body 参照が orphan (DOM 差し替え後) になり、 古い参照に innerHTML を書いても 画面上の 「読み込み中…」 が残ってしまう レース条件でした。 v528 で fetch 後に body / card を再取得する形に修正、 await 中に DOM が差し替わっても 必ず 現行の body に書き込むようにしました。',
        'sns'     => '🐛 スケジュールが 読み込み中 で止まる件、 fetch 後に DOM 再取得するよう修正 (async + DOM 差替えのレース) #v528',
    ],
    185 => [
        'summary' => 'ホームの時計演出 (時 / 分 / 秒 の文字サイズが大きくなる) を、 普段は静か / 10 分おき (毎時 :00, :10, :20, :30, :40, :50) にだけ ON にするようにしました。 ON 期間中は 5 秒ごとに時 / 分 / 秒 が回転して大きくなります。 普段は時計の主張が控えめになります。',
        'sns'     => '🕐 ホームの時計演出、 10 分おき (毎時 :00, :10, ...) の 1 分間だけ ON に。 普段は静か #v528',
    ],
    186 => [
        'summary' => 'スケジュールがロードされない件、 #184 と同じ原因 (= loadDetail 再走時の DOM 差替えレース) で同じ修正で解消します。',
        'sns'     => '🐛 スケジュールがロードされない件、 #184 と同じ DOM 差替えレース修正で解消 #v528',
    ],
    187 => [
        'summary' => 'admin が LabPay 投稿を削除できない件、 サーバ posts.php の SELECT で u.kind AS author_kind は取得していましたが、 シリアライズ時にレスポンスに含めるのを忘れていました。 v528 で posts_serialize_rows に author_kind フィールドを追加。 中村 (admin) のクライアントで 「LabPay」 の投稿に 「削除」 ボタンが表示されるようになります。 ブラウザを完全リロードして反映してください。',
        'sns'     => '🐛 admin が LabPay 投稿を削除できない件、 サーバ レスポンスに author_kind を含めるよう修正 (SELECT はあったが出力に追加忘れ) #v528',
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
