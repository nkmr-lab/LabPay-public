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
    83 => [
        'summary' => 'グループ の 写真 翻訳 ログ で 翻訳結果 が 120 字 で 切れて 全文 見られない 問題 を 修正 しました。 <details> 要素 で 折り畳み、 タップ で 全文 を 展開 できる ように。 画像 も タップ で 新タブ に 原寸 表示 します。',
        'sns'     => '🌐 グループ の 写真 翻訳 ログ で タップ し て 全文 展開 できる ように なりました #v488',
    ],
    84 => [
        'summary' => '2 点 対応 しました。 ① レシート 取り込み に 「📂 ファイル から」 ボタン を 追加。 フォト ライブラリ や ダウンロード フォルダ から も 選べ ます (今 まで は カメラ 起動 専用 でした)。 ② 支出 入力 に 「🔢 個別 金額」 トグル を 追加。 ON に する と 各 メンバー の チップ に 数値 入力 が 並び、 「この人 は この額、 この人 は この額」 と 個別 指定 できます (入れた 人 は 固定、 残額 は 入って いる 他 メンバー で 等分)。',
        'sns'     => '💴 ワリカ: レシート を 📂 ファイル から も 選べる ように + 「🔢 個別 金額」 で この人 ○○ 円、 と 個別 指定 できる ように #v488',
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
