<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    173 => [
        'summary' => '設定を開いた時の 「dev-list innerHTML null」 エラー、 防御コードを入れました。 ページ遷移中に async fetch が解決すると DOM が消えていることがあり (= 古い render の async が新 view の DOM を触ろうとして null)、 これを root の存在確認で早期 return するように修正。',
        'sns'     => '🛡 設定を開く時の dev-list null エラー、 防御 (null check) で抑止 #v524',
    ],
    174 => [
        'summary' => 'フィードバックを開いた時の 「hol-sync null」 エラー、 admin.js の hol-sync click 登録に optional chaining (?.) を入れました。 admin の DOM が無い時はバインドしないようになります。',
        'sns'     => '🛡 フィードバック ページの hol-sync null エラー、 防御済み #v524',
    ],
    176 => [
        'summary' => 'フィードバック の 「title.textContent null」 エラー、 admin.js の renderCalendarGrid に grid/title の null チェックを入れました。 ページ遷移後 (admin → feedback) に古い async が DOM を触ろうとして null になる場面で早期 return。',
        'sns'     => '🛡 フィードバック の title.textContent null エラー、 防御済み #v524',
    ],
    177 => [
        'summary' => '通知 を開いた時の 「dev-list null」 エラー、 #173 と同じ原因 (= 設定 → 通知 のページ遷移中に settings.js の async fetch が dev-list を触る) で、 同じ修正で解消します。',
        'sns'     => '🛡 通知ページ遷移時の dev-list null エラー、 同じ防御で抑止 #v524',
    ],
    182 => [
        'summary' => 'らぼったー の削除権限を絞りました。 ① 投稿者本人: 常に削除可、 ② admin (中村): LabPay (system 投稿) のみ削除可、 他人の人間投稿は削除不可、 ③ その他: 自分のみ削除可。 サーバ posts.php / クライアント posts.js 両方で同じロジック (UI でも削除ボタンが出なくなり、 サーバでも 403)。',
        'sns'     => '🔒 らぼったー削除権限を厳格化: admin でも他人の人間投稿は削除不可 (LabPay自動投稿のみ削除可) #v524',
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
