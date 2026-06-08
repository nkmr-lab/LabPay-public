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
    103 => [
        'summary' => 'タブとホームの初期表示を整理しました。 (1) タブは 「売買 (購入)・依頼・らぼったー・食べある記・アプリ・実績」 を初期表示に、 「販売・競売・ラボにいる人」 はデフォルト非表示 (使いたい人は設定→タブのカスタマイズでON)。 「食べある記」 はタブとして追加しました。 (2) ホームに置く要素を 「ウィジェット」 という名称に統一し、 初期は 「進行中・引き受け中タスク・いる人・自分のTODO」 の4つに絞り、 他はデフォルト非表示にしました (ポイント情報=残高ヒーローは常時表示)。 (3) アプリの個別ON/OFFは撤去し、 全アプリを常時表示する方針にしました。 既に細かく設定を保存している人の設定はそのまま尊重します。',
        'sns'     => '🎛 タブとホーム ウィジェットの初期表示を整理。 食べある記はタブに、 アプリ表示の個別ON/OFFは撤去 (全部表示する方針) #v497',
    ],
    104 => [
        'summary' => 'らぼったーの投稿時刻が時差を考慮できておらず、 結構前のものが 「たった今」 と表示されることがあった件を修正しました。 サーバの posts API が created_at_iso (タイムゾーン付きISO 8601) を返すように変更し、 ホーム/一覧 とも created_at_iso を優先利用する形に。 旅行中で端末タイムゾーン ≠ JST の場合でも 「N 分前」 が正しい値に揃います。',
        'sns'     => '⏰ らぼったーで結構前の投稿が 「たった今」 になっていた時差バグを修正 #v497',
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
