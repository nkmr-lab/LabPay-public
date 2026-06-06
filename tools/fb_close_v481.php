<?php
// v481 cron-hourly: feedback #67 #68 を done に。
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
    67 => [
        'summary' => '食べある記 詳細 で カバー画像 が 「← 一覧」 ボタン を 被って 戻り にくく なる 問題 を 修正 しました。 戻り ボタン を 別 カード に 分離 し、 カバー画像 と 重ならない ように しました。',
        'sns'     => '🔙 食べある記 で カバー画像 と 「← 一覧」 が 被って 戻り にくかった の を 修正 #v481',
    ],
    68 => [
        'summary' => '① ホーム の らぼったー カード で リアクション (👍 ❤ ⭐) が 見えない 問題 を 修正 (3 種 表示)。 ② ホーム カード の 縦幅 を 約 1.2 倍 に し、 本文 は 2 行 まで で 「…」、 リアクション 行 が 必ず 見える ように。 ③ SNS の 名前 を 「らぼったー」 に 改名 しました。',
        'sns'     => '🐦 SNS → 「らぼったー」 に 改名! ホーム カード でも 👍 ❤ ⭐ が 見える ように なり、 縦幅 1.2x + 本文 2 行 で リアクション が 見切れない 高さ に #v481',
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
