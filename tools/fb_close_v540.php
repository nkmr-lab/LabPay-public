<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    171 => [
        'summary' => '「🎨 絵しりとり」 Phase 1 を新規追加しました (/#/shiritori または アプリ → 絵しりとり)。 Phase 1 機能: ① 新規作成 (タイトル + メンバーピッカー + 1ターン時間 15-600秒 + 周回数 1-10、 自分は自動含む 2 名以上必須)、 ② ゲームページで現在のターンの人を強調表示、 ③ 自分のターン なら キャンバス (500x500 正方形、 ペン太さ 4 段階 + 色 5 色) + タイマーカウントダウン (残り 10 秒で赤) + 「直近 2 枚」 を上に表示、 ストロークを time-stamped で記録 (Phase 2 でアニメ再生)、 消す機能なし、 ④ 提出時に 自分が何を描いたか (label_self) + 直前の絵を何と予想したか (label_prev_guess) を入力、 ⑤ 時間切れで自動提出、 ⑥ 次の人に admin_notice 通知、 ⑦ 起案者は 🏳 ギブアップで強制終了、 ⑧ 終了したら 全描画一覧 (本人の正解と前を予想の両方表示)。 Phase 2 で実装予定: GPT による AI 予想、 最終一斉当て (全員が「これは何の絵?」を入れる→一斉開示)、 ストロークのアニメ再生。',
        'sns'     => '🎨 「絵しりとり」 Phase 1 を追加! キャンバス + タイマー + 周回ターン + ストローク記録 (アニメ再生は Phase 2)。 AI 予想と最終当ては Phase 2 で実装予定 #v540',
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
