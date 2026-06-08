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
    98 => [
        'summary' => 'Scrapbox履歴ページがinternal server errorになっていた件を修正しました。 原因はSlack Botのscope不足 (missing_scope) でslack_api_getが例外を投げ、 そのまま500になっていたためです。 try/catchで穏便に200を返し、 UIに 「Slack連携が止まっています」 と案内が出るようにしました。 加えて$daysが一部経路で未定義だった軽微な警告も解消しています。 なお実績のScrapbox更新日数の元になるscrapbox_awards自体は、 Slackの権限が戻ればcronで再び更新されます。 admin側でSlack Botの権限 (channels:history など) を確認してください。',
        'sns'     => '📡 Scrapbox履歴ページがエラーで開けない問題を修正。 Slack連携が止まっているとUIで分かるように案内表示 #v494',
    ],
    99 => [
        'summary' => '/api/users から電話番号 (phone_number) を一律除外しました。 連絡先ページでは新エンドポイント /api/users/contacts を使い、 サーバ側で 「admin / 自分 / 同じグループのメンバー」 にだけ番号が見える仕組みになっています。 #100と同じ対応です。',
        'sns'     => '🔒 ラボメンバーの電話番号が一般リストAPIから漏れていた問題を修正。 連絡先専用の新エンドポイントで権限ある人にだけ表示するようにしました #v494',
    ],
    100 => [
        'summary' => '電話番号は 「本人 / admin / 同じグループに入っているメンバー」 にだけ見えるようにしました。 連絡先ページは新しい /api/users/contacts エンドポイント経由で取得し、 該当しないメンバーの番号はサーバ側でnullに伏せます。',
        'sns'     => '🔒 電話番号は本人・admin・同じグループのメンバーにだけ表示されるようになりました #v494',
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
