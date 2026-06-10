<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    155 => [
        'summary' => 'ご報告ありがとうございます。 残高ウィジェットが一番下に行ってしまい、 設定からも戻せなかった件、 原因が分かりました。 v514 で 残高 (balance) ウィジェットをホームに昇格させたのですが、 並び替えの設定 UI には 残高を 並び替え可能項目として 出していなかったため、 ユーザが並び替えると order リストから 残高が抜け落ちて 末尾に移動していました。 v520 で applyHomeLayout を修正: ① 残高は order に含まれない場合は 必ず「未対応」 (あるいは 「進行中」) の直後に強制挿入、 ② 残高は hidden 指定があっても無視 (= 常時表示)。 これで 並び替えや個別非表示にしても残高は必ず上部に残ります。',
        'sns'     => '🐛 ホームの残高ウィジェットが一番下に行ってしまう件、 修正しました。 残高は常に上部に強制配置 + 非表示にできない仕様に #v520',
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
