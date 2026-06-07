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
    80 => [
        'summary' => '食べある記 (places) に ❤️ いいね 機能 を 追加 しました。 1 人 1 いいね、 詳細 画面 の 「🤍 0」 ボタン で 押せ ます。 一覧 タイル と ホーム ヒーロー にも 数 が 出ます。',
        'sns'     => '🍴 食べある記 に ❤️ いいね 機能 を 追加! 詳細 画面 で 押せ ます。 一覧 ・ ホーム にも 数 表示 #v486',
    ],
    81 => [
        'summary' => 'グループ 地図 の 位置共有 で 香港 等 (端末 タイムゾーン ≠ JST) で 「-3500 秒前」 等 の 異常 表示 が 出る 問題 を 修正 しました。 サーバ で 経過秒 を 計算 して 返す ように 変更 し、 クライアント の Date.parse による ローカル TZ 解釈 を 通さない 経路 に しました。',
        'sns'     => '📍 グループ 地図 位置共有: 海外 (TZ 違う) で 「-3500 秒前」 と なる 表示 バグ を 修正 #v486',
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
