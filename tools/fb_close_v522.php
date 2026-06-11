<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    158 => [
        'summary' => '行きたい場所ストックの 「＋ 候補を追加」 ボタン、 v522 から 編集モード関係なく常時表示するようにしました。 いつでも候補を足せます。 食べログ / Trip Advisor / Google 口コミ URL からの読み込みについては、 URL fetch + scraping を サーバ側で実装する必要があり (SSRF 対策 + 各サイトの構造化データパーサ)、 別途 v523 以降で順次対応予定です。 現状の取り込み手段は KML/GeoJSON 一括 (📥 Google Map から取り込み) + 手動入力 (＋ 候補を追加) です。',
        'sns'     => '📋 行きたい場所ストックの ＋追加 ボタン、 編集モード関係なく常時表示に。 食べログ / TripAdvisor / Google URL 取込は別途検討中 #v522',
    ],
    159 => [
        'summary' => '「今ラボにいる人」 ウィジェット、 ホームの デフォルト表示を ON に変更しました。 新規ユーザ + ホーム設定をまだ触ってないユーザは 自動的に表示されます。 既に設定を保存した方は、 設定 → ホーム から手動で ON にしてください。',
        'sns'     => '🟢 「今ラボにいる人」 ホームのデフォルト表示を ON に #v522',
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
