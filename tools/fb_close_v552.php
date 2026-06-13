<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    211 => [
        'summary' => '論文査読機能を拡張: ① PDF 対象 (v551 で実装済、 textarea から file input に変更、 OpenAI Files API + Chat Completions の file content で 直接 PDF を渡す)、 ② 査読 1 回ごとに 10pt をシステムに支払 (残高不足は 400)、 ③ 査読結果を DB 保存 (paper_reviews テーブル) + share_token (32 文字) を発行 → /#/paper-review/r/:token で URL 共有可能、 ④ 査読 system prompt を 設定画面 (折りたたみメニュー) で 編集可能 (空ならデフォルト = 「HCI 査読者 10 年キャリア」)、 ⑤ 履歴 (過去の自分の査読 30 件まで) を 一覧表示。 結果ページに 「🔗 共有 URL + コピーボタン」 を追加。',
        'sns'     => '📄 論文査読を大幅拡張: 10pt 課金 + 結果 URL 共有 + プロンプト編集可能 + 履歴 #v552',
    ],
    212 => [
        'summary' => '査読機能の 「共有対象」 を 事前設定できるようにしました。 ⚙️ 設定メニュー (折りたたみ) でメンバーピッカー (主著 / 共著 / 任意のメンバー) を 選んで保存 → 査読が完了するたびに、 選んだ全員に admin_notice 通知 (📄 中村聡史 が査読しました: 「タイトル」 (Accept) /#/paper-review/r/xxxxx) が飛びます。 通知をタップで 査読結果ページ (共有 URL) に直接遷移できます。 共有対象は 最大 30 名まで、 いつでも編集可能。',
        'sns'     => '👥 査読機能、 共有対象 (主著 / 共著 等) を事前設定 → 査読完了時に全員に通知 + URL 共有 #v552',
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
