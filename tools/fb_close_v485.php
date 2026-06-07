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
    78 => [
        'summary' => '2 点 対応 しました。 ① スケジュール の 終了時刻 (start + duration) 表示 計算 を Date.parse 経由 から 純粋 な 分 算術 に 変更 し、 旅行 中 で 端末 タイムゾーン が 変わって も 同じ 結果 を 出す ように。 また 15→21 等 の ズレ は v484 で 修正 した DnD swap の 副作用 だった 可能性 が 高い です (ロック 行 を 跨ぐ 計算 で 別 行 の 時刻 と 入れ替わって いた)。 ② スケジュール 編集 モーダル の 「タイトル」 ラベル 内 に 「🔍 場所を検索」 ボタン が 入って いた せい で カーソル 位置 と 入力欄 が ずれて 見える 問題 を、 ボタン を label 外 に 出して 解消。',
        'sns'     => '📅 スケジュール: 旅行 中 の 終了時刻 計算 を TZ 非依存 に + タイトル 入力欄 の カーソル ずれ を 修正 #v485',
    ],
    79 => [
        'summary' => 'らぼったー で 画像 アップロード 中 は 投稿 ボタン を disabled に しました。 アップ 完了 / 失敗 (どちら でも) で 自動 で 復活 します。 これ で 画像 が 付かない まま 送信 さ れる 事故 が 起きない ように。',
        'sns'     => '🐦 らぼったー: 画像 アップロード 中 は 投稿 ボタン が 押せない ように。 添付 待ち の 取りこぼし を 防止 #v485',
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
