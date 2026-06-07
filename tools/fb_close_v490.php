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
    87 => [
        'summary' => 'ワリカ 支出 追加 で chip を タップ しても 反応 しない 問題 を 修正 しました。 v488 で 個別 金額 を 追加 した 際 に data-for-uid を 内側 span に 移動 した せい で、 chip の 余白 (アバター / 名前 の 周り) を タップ して も トグル しない 状態 に なって いました。 chip 全体 を クリック ターゲット に 戻し、 個別 額 input は stopPropagation で chip トグル を 抑止 する 形 に 修正。',
        'sns'     => '💴 ワリカ 支出 追加 で chip タップ が 反応 しない 不具合 を 修正 #v490',
    ],
    88 => [
        'summary' => 'LabPay 起動 を 高速化 しました。 50+ の view モジュール を eager-import して いた の を route アクセス 時 の dynamic import に 変更。 起動 直後 必ず 通る login / home のみ eager で、 残り は 初回 アクセス 時 だけ ロード (2 回目 以降 は ブラウザ キャッシュ で 即時)。 初期 ダウンロード / パース 量 が 大幅 に 減り ます。',
        'sns'     => '⚡ LabPay 起動 を 高速化! 50+ の view モジュール を 必要 な タイミング で だけ ロード する ように 変更 #v490',
    ],
    89 => [
        'summary' => 'らぼったー 画面 上部 の タイトル + 説明文 を 削除 しました。 投稿 コンポーザー が 即 上 に 来ます。',
        'sns'     => '🐦 らぼったー 画面 上部 の 説明 を 削除 して、 投稿 欄 を 即 上 に #v490',
    ],
    90 => [
        'summary' => 'グループ の レシート 取り込み を 1 つ の ボタン に 統合 しました (v488 で 別 ボタン を 出して いた の を 戻す)。 capture 属性 を 外した の で、 「📷 レシート」 を 押すと カメラ / フォト ライブラリ / ファイル の どれ から でも 端末 標準 ピッカー で 選べ ます。',
        'sns'     => '📷 グループ レシート: ボタン 1 つ で カメラ / フォト / ファイル の どれ から でも 選べる ように #v490',
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
