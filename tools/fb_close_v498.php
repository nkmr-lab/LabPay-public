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
    106 => [
        'summary' => '自分の投稿についたリアクションが誰によるものか分かるようにしました。 (1) 自分以外のユーザが新しくリアクションした瞬間に、 投稿者宛てに通知が飛びます (👍/❤️/⭐ アイコン入り)。 (2) 投稿の詳細画面の上部に reactors リストが kind ごとにチップ表示され、 タップでその人のプロフィールに飛べます。',
        'sns'     => '👀 自分の投稿に押されたリアクションが誰によるものか分かるように。 通知が飛び、 詳細画面でも一覧できます #v498',
    ],
    107 => [
        'summary' => 'らぼったー投稿時の位置情報、 写真の EXIF に GPS が含まれていればそちらを優先するようにしました。 ライブラリ無しで TIFF/IFD/GPS IFD を辿る軽量パーサを posts.js に追加し、 度分秒rational + N/S/E/W ref を解釈します。 位置取得チェックボックスや navigator.geolocation の結果より EXIF を優先します。',
        'sns'     => '📷 らぼったーで投稿する写真の EXIF に GPS があれば、 その位置を優先して紐づけるようにしました #v498',
    ],
    108 => [
        'summary' => '起動時の白画面が長い件を改善しました。 /api/auth/me の前回結果を localStorage にキャッシュしておき、 boot で即座に hydrate → chrome → ルート dispatch を進めるように変更。 サーバ再検証は裏で走らせ (SWR パターン)、 失敗 (401) した場合はキャッシュを捨てて /login に飛ばします。 オンライン時の体感がかなり短縮されます。',
        'sns'     => '⚡ 起動時の白画面を短縮。 前回の認証情報をキャッシュして即座に画面を出し、 サーバ確認は裏で走らせます #v498',
    ],
    109 => [
        'summary' => '連続ラボインの判定を「どんな1日でも空きがあったら streak=1 にリセット」に統一しました。 旧仕様は workday 判定で土日祝を除外して decay=5 で減らす方式でしたが、 「昨日来てないのに3日連続」 と混乱の元になっていました。 加えて、 既存のユーザ全員の current_streak / longest_streak を新ルールで再計算済みです (報告者の方の current_streak は 1 に更新)。',
        'sns'     => '📆 連続ラボインの判定を 「1日でも空きがあったらリセット」 にシンプル化。 全ユーザのストリークも新ルールで再計算済み #v498',
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
