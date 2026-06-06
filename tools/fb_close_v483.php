<?php
// v483 cron-hourly: feedback #74-76 を done に。
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
    74 => [
        'summary' => 'らぼったー ホーム カード の 縦幅 を 116px → 100px (約 0.86x) に 縮め、 余って いた 1 行 分 の 余白 を 詰めて 密度 を 上げ ました。 padding と gap も 連動 して 軽く 詰めて います。',
        'sns'     => '🐦 らぼったー ホーム カード の 縦幅 を 約 0.86x に 縮めて 余白 を 詰めました #v483',
    ],
    75 => [
        'summary' => 'TODO に 詳細 編集 パネル を 追加 しました。 📋 ボタン から URL / 相手 (ラボ メンバー or 自由 入力) / 締切 / メモ (5000 字) を 編集 できます。 一覧 にも URL / 相手 / メモ の 抜粋 が 表示 されます。',
        'sns'     => '📝 TODO に URL / 相手 / 詳細 メモ を 追加 できる ように。 📋 ボタン で 詳細 編集 パネル が 開きます #v483',
    ],
    76 => [
        'summary' => '実績 解除 の 組み合わせ から AI が 「カッコイイ 称号」 を 命名 する 機能 を 追加 しました。 実績 ページ 上部 に 大表示、 「✨ 生成 / 🔄 再生成」 ボタン。 獲得 tier が 変わった とき に 再生成 を 案内 します。 OpenAI gpt-4o-mini 経由、 結果 は ユーザ 単位 に キャッシュ。',
        'sns'     => '✨ 実績 解除 の 組み合わせ から AI が 二つ名 を 命名 して くれる ように! 実績 ページ 上部 で 確認 を どうぞ #v483',
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
