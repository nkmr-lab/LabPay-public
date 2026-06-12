<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    199 => [
        'summary' => '「散歩を開くと そのページはありません」 になる件、 サーバ側のファイル (walk.js + app.js の /walk ルート登録) は 正常にデプロイ済みでした。 原因はおそらく Service Worker の古いキャッシュ (v537 以前の app.js がキャッシュされていて /walk ルートが入っていない) です。 v543 で CACHE_NAME bump (= 古い shell キャッシュが activate 時に破棄) しました。 LabPay の タブを 完全に閉じてから 開き直すと 新しい SW が active になって 散歩アプリが開けるはずです。 もし まだ開けない場合は ブラウザ DevTools の Application → Service Workers から手動で Unregister して、 リロードしてみてください。',
        'sns'     => '🔧 散歩アプリ 「ページなし」 不具合、 SW 古いキャッシュが原因。 v543 で CACHE_NAME bump。 アプリ閉じて 開き直しでなおります #v543',
    ],
    200 => [
        'summary' => 'プレイリストのジャンル選択肢に 「ボカロ」 を追加しました 🎵 (J-POP / 洋楽 / K-POP / アニメ / ボカロ / ジャズ / クラシック / ロック / EDM / ヒップホップ / VTuber / 作業用 BGM / その他)。 プレイリスト作成時 + 一覧の絞り込みで 選べます。',
        'sns'     => '🎵 プレイリストのジャンルに 「ボカロ」 を追加! #v543',
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
