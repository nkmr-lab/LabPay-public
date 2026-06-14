<?php
// v590 #227 close: bingo + 散歩改良 + シェアボタン + 地雷オセロ (まとめ)
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$fbId = 227;
$summary = "全 4 要望を 実装済 (v587-v590):\n"
        . "・地雷オセロ → v587 (/#/othello 1pt buy-in、 各自2地雷、 3x3反転)\n"
        . "・ビンゴ → v588 (/#/bingo 週次 5x5、 平日 行動 自動カウント、 リーチ/BINGO 演出、 LB トップ3)\n"
        . "・散歩改良 → v589 (/#/walk-mode Wake Lock + GPS 5s 軌跡、 履歴閲覧)\n"
        . "・シェアボタン → v585 (汎用 shareToSns ヘルパ + 予想 詳細から ワンタップ。 他ページへの展開は v594 で順次拡張予定)\n"
        . "なお、 散歩の 特殊スワイプ ロック / 軌跡 画像化、 ビンゴの 過去週閲覧、 シェアの 全展開 は MVP で省略 → 後続 v591-v594 で追加します。";

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
    "🤖 Claude 自動対応 feedback#{$fbId}\n" . mb_substr($summary, 0, 600),
    null, '#/feedback-admin');
echo "closed feedback#{$fbId}\n";
