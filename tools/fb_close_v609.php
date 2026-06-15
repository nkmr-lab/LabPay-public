<?php
// v609 #234 #235 close
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$items = [
    234 => "🔬 研究 / 🏢 運営 タブを追加 (v609)。 アプリの左隣に配置 (デフォルト表示)、 タップで該当カテゴリ (research / lab-mgmt) のアプリだけを表示。",
    235 => "🎯 勝敗予測アプリを娯楽カテゴリに追加 (v609)。試合 (X vs Y) のスコアを完璧に当てた人が pot 総取り (山分け、 場代5%)。誰も当たらなければ全員返金。基本20pt、 10-100pt 設定可。締切後に全員の予想を開示、 起案者が結果を登録すると自動配分。",
];

foreach ($items as $fbId => $summary) {
    db_tx($PDO, function () use ($PDO, $fbId, $summary) {
        $stFb = $PDO->prepare("SELECT user_id FROM feedback WHERE id = ?");
        $stFb->execute([$fbId]);
        $row = $stFb->fetch(PDO::FETCH_ASSOC);
        if (!$row) { fwrite(STDERR, "feedback $fbId not found\n"); return; }
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
}
