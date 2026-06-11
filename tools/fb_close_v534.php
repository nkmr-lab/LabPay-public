<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    189 => [
        'summary' => 'avi2026 スケジュールがロードされない件、 サーバ側 (/api/groups/1/schedule) のレスポンス自体は正常 (size > 30KB / 全 60+ アイテム) でした。 v534 で 2 つ追加防御: ① loadSchedule 全体を try/catch で包んで、 描画コード内の JS エラーで body が 「読み込み中…」 のまま残らないように (エラー時は 「描画エラー: ...」 と表示)、 ② SW の content cache を v2 → v3 に bump して 古い stale な /api/groups* キャッシュを activate 時に破棄。 ブラウザを完全リロードして もう一度開いてみてください。 もし まだ止まる場合は ブラウザの DevTools コンソールの エラーメッセージを教えてください (赤い文字が出てるはず)。',
        'sns'     => '🛡 スケジュールロード防御を強化 (try/catch + content cache v3 bump)。 完全リロードで反映、 残るならコンソールエラー教えてください #v534',
    ],
    190 => [
        'summary' => '自分の投稿マップ (/#/sns/map) で写真がある場合、 ① マーカータップ時のポップアップに サムネ画像 (160px) を 上に表示、 ② 下の一覧で 投稿に写真がある場合 アバターの代わりに 48px サムネ画像 を 左に表示するようにしました。 サムネ URL を優先 (image_thumb_url) なので軽量、 loading=lazy + decoding=async でスクロール最適化済み。',
        'sns'     => '📸 自分の投稿マップで写真サムネ表示。 マーカー ポップアップは 160px、 一覧は 48px サムネ #v534',
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
