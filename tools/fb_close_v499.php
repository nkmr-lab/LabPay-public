<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
/** @var PDO $PDO */
/** @var array $CFG */
$pdo = $PDO; $cfg = $CFG;

$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    110 => [
        'summary' => 'らぼったーの投稿を削除した時、 画面では消えるが戻ってきたら復活していた件を修正しました。 削除直後に Service Worker の content cache (/api/posts*) を invalidate するようにしています。',
        'sns'     => '🗑 らぼったーの削除した投稿が再来訪で復活していたキャッシュ問題を修正 #v499',
    ],
    112 => [
        'summary' => 'ワリカの支出を登録/編集/削除した直後にその場で反映されない件を修正しました。 SW の content cache に古い /api/groups* が残って 「一度グループ外に出ないと反映されない」 状態になっていたので、 操作直後に invalidateGroupCache でキャッシュを消すヘルパを追加し、 登録/編集/削除フローから呼ぶようにしました。',
        'sns'     => '💴 ワリカに支出を登録/編集/削除した直後にその場で反映されない問題を修正 #v499',
    ],
    117 => [
        'summary' => '2点ご報告: (1) 連続ラボインの仕様を v499 で workday_only モードに戻しました。 v498 では 「1日でも空けばリセット」 にしましたが、 平日通勤型のユーザから 「平日毎日来てるのに連続3日止まり」 と逆方向の苦情が出たため、 旧仕様 (土日祝は欠席しても連続維持) を default に戻しています。 admin config (streak_weekday_only) でいつでも切替可能。 全34ユーザのストリークも新ルールで再計算済み (id 5 は cur=8 に)。 (2) リアクションの 「誰が押したか」 が他人の投稿の詳細でも見えていた件、 仕様ではなく v498 で広げすぎた不具合でした。 v499 で投稿者本人 + admin のみに制限しました。',
        'sns'     => '📆 連続ラボイン判定を workday_only に戻しました (admin で切替可能)。 リアクションの 「誰が押したか」 は投稿者本人 + admin のみ閲覧に修正 #v499',
    ],
];

foreach ($BATCH as $fid => $data) {
    $st = $pdo->prepare("SELECT id, user_id, claude_status FROM feedback WHERE id = ?");
    $st->execute([$fid]);
    $fb = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fb) { echo "skip #$fid (not found)\n"; continue; }
    if ($fb['claude_status'] === 'done') { echo "skip #$fid (already done)\n"; continue; }
    $ownerUid = (int)$fb['user_id'];
    $summary = $data['summary'];
    $reply = '🤖 Claude 対応: ' . $summary;
    db_tx($pdo, function () use ($pdo, $fid, $summary, $reply, $claudeUid) {
        $pdo->prepare("UPDATE feedback SET
                        claude_status='done',
                        claude_finished_at=NOW(),
                        claude_summary=?,
                        replied_at=NOW(),
                        reply_body=?,
                        replied_by_user_id=?
                      WHERE id=?")
            ->execute([$summary, $reply, $claudeUid, $fid]);
    });
    try { notify_safely($pdo, $cfg, $ownerUid, 'admin_notice', "🤖 要望#$fid 対応: $summary", 'feedback', $fid); }
    catch (Throwable $e) { echo "  notify #$fid fail: " . $e->getMessage() . "\n"; }
    try { slack_notify($cfg, "✅ feedback #$fid done — $summary", null, '#/feedback-admin'); }
    catch (Throwable $e) { echo "  slack #$fid fail: " . $e->getMessage() . "\n"; }
    try { feedback_post_release_to_sns($pdo, (int)$fid, $data['sns']); }
    catch (Throwable $e) { echo "  sns #$fid fail: " . $e->getMessage() . "\n"; }
    echo "done #$fid\n";
}
echo "ALL DONE\n";
