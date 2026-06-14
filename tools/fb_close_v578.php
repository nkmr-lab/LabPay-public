<?php
// v578 feedback#224 close — AI 麻雀を 練習モード化 (ポイント授受なし)
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$fbId = 224;
$summary = "AI 麻雀を 練習モード化 (v578)。 エントリーフィー 0pt + 順位払い出し 0pt で ポイントの授受なし、 純粋に 役・打牌の練習用に。 既存の「人 4 人の本格麻雀」 は変更なし。";

db_tx($PDO, function () use ($PDO, $fbId, $summary) {
    $stFb = $PDO->prepare("SELECT user_id FROM feedback WHERE id = ?");
    $stFb->execute([$fbId]);
    $row = $stFb->fetch(PDO::FETCH_ASSOC);
    if (!$row) { fwrite(STDERR, "feedback $fbId not found\n"); exit(1); }
    $reporterUid = (int)$row['user_id'];
    $reply = "🤖 Claude 対応: " . $summary;
    $PDO->prepare("UPDATE feedback SET
        claude_status='done',
        claude_finished_at=NOW(),
        claude_summary=?,
        replied_at=NOW(),
        reply_body=?,
        replied_by_user_id=1
       WHERE id=?")->execute([$summary, $reply, $fbId]);
    notify_safely($PDO, $GLOBALS['CFG'], $reporterUid, 'admin_notice',
        "🤖 フィードバック #{$fbId} 対応完了: " . mb_substr($summary, 0, 200),
        'feedback', $fbId);
});

slack_notify($CFG,
    "🤖 Claude 自動対応 feedback#{$fbId}\n{$summary}",
    null, '#/feedback-admin');
echo "closed feedback#{$fbId}\n";
