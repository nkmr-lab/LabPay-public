<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$items = [
    237 => "らぼったー シェア機能を ブラウザの prompt() から モーダル UI に改修 (v616)。 textarea + 「📍 現在地添付」 + 投稿/キャンセル ボタン。 #/ で始まる URL は タップで該当ページにジャンプできる旨も明記。",
    238 => "食べある記の 「+ 新規」 dropdown が 縦フレームを超える問題を修正 (v616)。 details/summary の入れ子をやめて 「🗺 地図 / ＋ 新規 / 📥 インポート」 の 3 つの フラットボタン横並びに。",
    239 => "ビンゴの平日 (Mon-Fri) 限定フィルタを撤廃 (v616)。 土日に登録した行動 (食べある記投稿/らぼったー/麻雀 等) も カウントされる。 「中村が食べある記を今日 (日曜) 登録したのに反映されない」 という混乱は これで解消。 ビンゴカードは 開くたびに 再判定されるので 次のアクセスで反映。",
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
