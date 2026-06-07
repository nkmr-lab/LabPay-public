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
    93 => [
        'summary' => 'LabPay公式SNS投稿の日本語文中に不要な半角スペースを入れていた件、 これまでの投稿5件を一括クリーンアップしました (tools/clean_labpay_post_spaces.php)。 今後の自動投稿も標準的な日本語表記 (スペースなし) で書く方針に変更しました。',
        'sns'     => '✍ LabPay公式投稿の文体を 日本語標準 (スペースなし) に統一。 過去の投稿も一括修正済 #v493',
    ],
    94 => [
        'summary' => 'ホームのらぼったーカードでリアクション (👍 ❤️ ⭐) を直接タップで増減できるようにしました。 詳細画面に飛ばずにその場で反映されます。',
        'sns'     => '🐦 ホームのらぼったーカードからリアクションをその場で押せるように。 数もすぐ反映 #v493',
    ],
    95 => [
        'summary' => '「今ラボにいる人」 をタブから単独で開ける専用ページ (/#/presence) を追加しました。 ナビにも 「ラボにいる人」 を入れています。 設定→タブ並びで非表示や順序変更もできます。',
        'sns'     => '📍 「今ラボにいる人」 を独立タブに。 ナビから直接ジャンプできるようになりました #v493',
    ],
    96 => [
        'summary' => 'ホームのらぼったー画像をサムネ (縮小版) で配信するようにしました。 サーバ側で永続キャッシュされているので、 初回表示も2回目以降もぐっと軽くなります。 サムネが無い古い画像は元画像にフォールバックします。',
        'sns'     => '⚡ ホームのらぼったー画像をサムネ配信に切り替えてロード高速化 #v493',
    ],
    97 => [
        'summary' => 'スケジュール内容確認モーダルに 「📦 ストックに戻す」 ボタンを追加しました。 押すと日付が外れて 「行きたい場所」 ストック行きに戻ります。 日付付きアイテムでのみ表示します。',
        'sns'     => '📦 スケジュールから 「ストックに戻す」 ボタンで日付を外せるように #v493',
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
