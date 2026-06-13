<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) exit(1);

$BATCH = [
    220 => [
        'summary' => '実績ページ (#/achievements) の文章から 不要なスペースを除去しました。 ✨ 称号カード周りの 「あなた の 称号」 → 「あなたの称号」、 「実績 を 元 に AI が 称号 を 命名 します」 → 「実績を元に AI が称号を命名します」、 ボタンの 「✨ 称号 を 生成」 → 「✨ 称号を生成」、 等々。 日本語の自然な詰めに統一。',
        'sns'     => '🧹 実績ページの和語スペース除去 #v566',
    ],
    219 => [
        'summary' => '通知一覧の表示崩れを修正しました。 本文の bold 継承で 文字サイズが他より大きくなっていた件、 font-size:14px に明示。 長い URL (例: /#/paper-review/r/xxxxxxxx) が含まれる通知で 横に広がる件、 overflow-wrap:anywhere + word-break:break-word + min-width:0 で 強制折返し。 既読/未読戻し ボタンも 同じ小さめサイズ (11px) で統一。',
        'sns'     => '📐 通知の文字大きすぎ / 長い URL で崩れ問題を修正 #v566',
    ],
    222 => [
        'summary' => 'AI 対戦が一瞬で進む問題、 サーバ側で 1人ずつ遅延を入れるようにしました。 polling (/state) 1 回ごとに AI を 1 step だけ進める実装。 polling は 2 秒間隔なので 1人 1 step ≒ 2 秒で進行 → 3 AI 全員が動くと 6-8 秒で人間の番に。 これで何が起きたか視覚的に追えます。 人間のアクション後も 1 step だけ進めて (= 次の polling から 1人ずつ動く) ので 自然な流れ。',
        'sns'     => '🐢 AI 麻雀対戦、 1人ずつ 2 秒間隔で動くように。 何が起きたか追える #v566',
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
