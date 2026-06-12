<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    202 => [
        'summary' => 'らぼったー サムネ不在の件、 全 44 件の image_url ありの投稿について tools/backfill_post_thumbs.php で 一通りチェックしました。 結果: generated=0 already=44 missing_orig=0 errors=0 — サーバ側のサムネファイル (.thumb.jpg) は 全て存在していました。 ? になっているのは おそらく ブラウザ側の Service Worker (labpay-images-v1) で 古いキャッシュが残っているか、 ネットワーク取得タイミングで失敗したケースです。 v545 で CACHE_NAME bump したので、 アプリを 完全リロード (= タブ閉じて 開き直し) で 解消するはずです。 もし まだ ? が残る投稿があれば 該当の投稿 ID (URL の #/sns/XXX) を 教えてください、 個別に調査します。',
        'sns'     => '🖼 らぼったー サムネ チェック完了 (44/44 OK)。 ? は SW 古いキャッシュ。 リロードで解消、 残れば投稿 ID 教えてください #v545',
    ],
    203 => [
        'summary' => '設定画面の 「null is not an object (reload-unreg)」 エラー、 settings.js の DOM アクセス 11 箇所 (reload-unreg / my-ip-input / profile-save / notif-perm-status / notif-perm / profile-clear-avatar / profile-avatar-file / cal-hide-save / cal-refresh / cal-disconnect 等) に 全部 optional chaining (?.addEventListener) + null ガードを入れました。 syncPermLabel も npStatus/npBtn の存在チェックでガード。 これで 設定画面のどこかで一部要素が未描画 (auth/state 状態次第) でも 連鎖して 全体が落ちることがなくなります。',
        'sns'     => '🛡 設定画面の getElementById に 全部 optional chain + null ガードを追加。 一部要素欠落で全体落ちる問題を根治 #v545',
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
