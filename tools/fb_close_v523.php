<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    160 => [
        'summary' => '「📋 順番決め」 機能を新規追加しました。 アプリ → 順番決め (緑 道具カテゴリ) または /#/orderings から。 タイトル (例: 「卒研 発表順」) + メンバー (2 名以上, メンバーピッカーから選択) を指定して 「🎲 並べ替えを実行」 を押すと、 CSPRNG (random_int) で全員を 1 列にシャッフル → 結果が保存 + 各メンバーに通知 (📋 『title』 の順番が決まりました! あなたは N 番目です) されます。 詳細ページでは 1 人ずつ位置が確定するフェードイン演出 (⏭ スキップ ボタン付き)。 起案者 / admin は削除可。 通知タップで詳細に飛びます。 一覧では 自分の順番がタグで表示されます。',
        'sns'     => '📋 「順番決め」 機能を追加 (発表順 / 当番割 など)。 メンバー選択 → シャッフル → 結果通知 + 1 人ずつ確定する演出。 /#/orderings から #v523',
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
