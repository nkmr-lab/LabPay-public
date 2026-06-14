<?php
// v600 #228 #229 #230 #231 #232 まとめて close
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$items = [
    228 => "連続ラボイン表示の修正 (v600)。/api/me で last_checkin_date が今日 or 昨日でなければ current_streak を 0 として返すように変更。DB の値は次回 checkin の計算用にそのまま保存 (decay計算に影響しないように)。",
    229 => "ティア表を娯楽 (games) ハブの 「集める/制覇する」 カテゴリへ移動 (v600)。アプリハブでも cat: 'game' に変更。",
    230 => "制覇マップとプレイリストを娯楽ハブへ移動 (v600)。両方とも 「集める/制覇する」 カテゴリ。アプリハブも cat: 'game'。",
    231 => "誕生日登録 + バースデー表示 (v600)。設定 → プロフィールで MM-DD と西暦 (任意) を登録。当日ホームに🎂バナー表示 (西暦あれば年齢付き)。",
    232 => "ホームにビンゴウィジェットを追加・デフォルトON (v600)。今週の進捗 (X/25) + ビンゴ数 + リーチ数 + 5x5 ミニ盤を表示。既存ユーザにも自動でONに。",
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
