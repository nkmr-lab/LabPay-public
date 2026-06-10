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
    113 => [
        'summary' => 'バージョン表記は引き続き上げていきます (今は v500 です)。 加えて、 起動時のスプラッシュで大きくバージョン番号 + 最終更新日を見えるようにしたので、 「ちゃんと最新が反映されてるか」 もパッと分かるようになりました。 #114 と一体で対応。',
        'sns'     => '🔢 バージョンは引き続き連番で上げていきます。 起動時にも大きく見える形に #v500',
    ],
    114 => [
        'summary' => '起動時の白画面が長い問題への第二弾として、 <main id="app"> の初期 HTML に splash 画面 (大きく LabPay v500 + 最終更新日 + スピナー) を直書きで入れました。 JS が読み込まれる前から見える状態で、 app.js が hydrate した瞬間に自動で消えます。 「起動してる感」 が出てユーザのストレスを減らします。',
        'sns'     => '✨ 起動時に大きくバージョン番号 + スピナーが出る splash を追加。 白画面のストレスを軽減 #v500',
    ],
    116 => [
        'summary' => 'ホームのオンボーディング文言を 「実際に必要な人だけに出す」 形に絞りました。 (1) 一度でもラボインしたことがある人 (longest_streak >= 1) には 「Wi-Fi に繋ぐと自動でチェックインされます」 を表示しません。 (2) 5日以上連続したことがあるベテラン (longest_streak >= 5) には ラボインボーナスのルール説明も省きます。 もう知ってる人にとっては邪魔にならない設計です。',
        'sns'     => '🏠 ホームのラボイン案内文を 「初心者だけに見せる」 条件表示に。 ベテランからは消えてスッキリ #v500',
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
