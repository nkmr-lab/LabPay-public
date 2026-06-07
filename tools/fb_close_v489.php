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
    85 => [
        'summary' => 'スケジュール / 行きたい 場所 ストック の アイテム を タップ で 即 編集 モーダル を 開いて いた の を、 まず 読み取り 専用 の 「内容 確認」 モーダル を 開く ように 変更 しました。 タイトル / 種類 / 日時 / 場所 (地図 リンク 付き) / URL / 画像 / メモ が 見やすく 並び、 ✏ 編集 / 📋 コピー / × 削除 / 閉じる を 選べ ます。 編集 を 押す と 既存 の 編集 モーダル へ。',
        'sns'     => '📅 スケジュール の アイテム タップ で まず 「内容 確認」 画面 を 出し、 そこ から ✏ 編集 を 押す 動線 に 変更 #v489',
    ],
    86 => [
        'summary' => 'タブ ナビ に 「らぼったー」 を 追加 しました (アプリ の 左)。 設定 → タブ並び で 表示 / 非表示 ・ 順序 を 変更 できます。',
        'sns'     => '🐦 タブ ナビ に 「らぼったー」 を 追加。 設定 → タブ並び で 順序 や 表示 / 非表示 も 変えられます #v489',
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
