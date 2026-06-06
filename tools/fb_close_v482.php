<?php
// v482 cron-hourly: feedback #69-73 を done に。
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
    69 => [
        'summary' => 'らぼったー の ホーム カード を ① 画像 有 / 無 で 同じ 高さ (116px) に 揃え、 ② 上 マージン を 詰めて 投稿者名 を 少し 上 に、 ③ 投稿者名 の 右横 に 「N 分前」 の 相対 時刻 を 追加 しました。 加えて 投稿時 の 位置情報 ON/OFF を localStorage に 永続化 (一度 ON にしたら 以降 ずっと ON、 OFF にしたら ずっと OFF) しました。',
        'sns'     => '🐦 らぼったー ホーム カード を 高さ 統一 + 投稿時刻 表示 + 位置情報 ON/OFF を 端末 に 記憶 #v482',
    ],
    70 => [
        'summary' => '点呼 の タイマー 表示 を 「あと X:XX」 (countdown) から 「X:XX 経過 (締切 HH:MM)」 (countup) に 変更 し、 起算点 が 「点呼 を 押した 瞬間 = 起案 時刻」 で ある こと を 数字 が 増える 形 で 明示 しました。 一覧 / 詳細 / ホーム の 進行中 全部 で 統一。',
        'sns'     => '📣 点呼 タイマー を 「経過 時間」 表示 に。 「点呼 を 押した 瞬間 = 0:00」 から 数字 が 増えて いきます #v482',
    ],
    71 => [
        'summary' => '待ち合わせ / 〆切 に メッセージ シェア 機能 を 追加 しました。 詳細 ページ の 下部 に 入力欄 + 履歴 が 出ます。 投稿 する と 関係者 全員 (起案者 + 参加者) に push 通知 が 飛びます。 「少し 遅れます」 「もう 入って ます」 等。',
        'sns'     => '🤝 待ち合わせ / 〆切 で メッセージ を シェア できる ように! 「少し 遅れます」 等 を 関係者 全員 に 通知 #v482',
    ],
    72 => [
        'summary' => 'TODO に 締切 (due_at) を 追加 しました。 リスト 画面 で ⏰ ボタン から 設定可、 締切 接近 / 過ぎ で 色 が 変わります。 ホーム カード として 出る ように なり (上位 5 件、 締切 近い順)、 設定 → ホーム カード並び で ON/OFF できます。',
        'sns'     => '📝 TODO に 締切 設定 + ホーム カード 追加。 締切 が 近い 順 に 表示、 設定 → ホーム カード並び で ON/OFF #v482',
    ],
    73 => [
        'summary' => '点呼 を 3 点 改良 しました。 ① 起案者 が 対象 に 含まれて いる 場合、 自動 で 「答えてる」 状態 に なる (起案 した 人 = 「いる」 が 自明 なので)。 ② ホーム の 進行中 カード に 自分 起案 / 応答済 の open な 点呼 も 表示 (応答済 は ✅ 緑、 未応答 は 📣 オレンジ)。 ③ 自分 起案 の もの は タイトル に [起案] を 付加。',
        'sns'     => '📣 点呼 改良: 起案者 は 自動 で 「答えてる」 + 答え 終えた 点呼 も ホーム 進行中 に 残る + 自分 起案 は [起案] バッジ #v482',
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
