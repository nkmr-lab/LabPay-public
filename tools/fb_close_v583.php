<?php
// v583 #225 + #226 close
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$items = [
    225 => "原稿チェック (paper-review の 軽量版) を v583 で 実装。 /#/resume-check から アクセス。 5pt、 上限 8000 文字、 テキスト貼付方式。 背景妥当性 / 論理展開 / 専門用語 / 接続詞 / 表記揺れ / 引用 の 6 項目を スコア + コメントで返す。 リライト案 と 著者へのコメント付き。 失敗時は 自動返金。",
    226 => "優勝予想の 詳細ページに 「⏳ 締切まで N 日 H 時間 M 分 S 秒」 のライブ カウントダウン を 追加 (v582)。 締切超過後は 赤色で 「⛔ 締切超過」 表示。",
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
