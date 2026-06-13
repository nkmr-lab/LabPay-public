<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin\n"); exit(1); }

$BATCH = [
    214 => [
        'summary' => '麻雀卓を作ろうとして internal server error の件、 原因は ledger テーブルの type ENUM に 麻雀用 type (mahjong_buyin/mahjong_payout/mahjong_refund/mahjong_rake/mahjong_ai_payout) が無くて Data truncated エラーになっていました。 v558 で PHP 側の Ledger::TYPES に追加、 v559 で DB の ENUM にも ALTER で追加。 同時に paper_review (査読課金) も追加。 これで麻雀卓作成 + AI 対戦 + 査読課金が全部通るはずです。',
        'sns'     => '🐛 麻雀卓 internal server error fix: ledger ENUM に 麻雀 type を追加 #v559',
    ],
    217 => [
        'summary' => 'ネット未接続時 にログイン画面に飛ばす挙動を改修しました。 app.js の refreshMe() で 401/403 (= 認証エラー) と ネット断 (= TypeError / status 取れない) を 区別、 後者なら キャッシュ (前回の me / balance / 在室情報) を温存して 引き続き使えるようにしました。 完全な未ログイン or キャッシュ無しでは ログイン画面に飛びますが、 一度ログイン済の状態でオフラインになっただけなら シェル + 直近の SWR キャッシュ で 普通にアプリ使えます。',
        'sns'     => '📴 オフライン時のログイン画面回避: 401 と ネット断を区別、 キャッシュ温存 #v559',
    ],
];
foreach ($BATCH as $fid => $data) {
    $st = $pdo->prepare("SELECT id, user_id, claude_status FROM feedback WHERE id = ?");
    $st->execute([$fid]);
    $fb = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fb || $fb['claude_status'] === 'done') { echo "skip #$fid\n"; continue; }
    $ownerUid = (int)$fb['user_id'];
    $summary = $data['summary'];
    $reply = '🤖 Claude 対応: ' . $summary;
    db_tx($pdo, function () use ($pdo, $fid, $summary, $reply, $claudeUid) {
        $pdo->prepare("UPDATE feedback SET claude_status='done', claude_finished_at=NOW(), claude_summary=?, replied_at=NOW(), reply_body=?, replied_by_user_id=? WHERE id=?")
            ->execute([$summary, $reply, $claudeUid, $fid]);
    });
    try { notify_safely($pdo, $cfg, $ownerUid, 'admin_notice', "🤖 要望#$fid 対応: $summary", 'feedback', $fid); } catch (Throwable $e) {}
    try { slack_notify($cfg, "✅ feedback #$fid done — $summary", null, '#/feedback-admin'); } catch (Throwable $e) {}
    try { feedback_post_release_to_sns($pdo, (int)$fid, $data['sns']); } catch (Throwable $e) {}
    echo "done #$fid\n";
}
echo "ALL DONE\n";
