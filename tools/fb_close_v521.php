<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    156 => [
        'summary' => 'タスク詳細ページの起案者アイコン (md サイズ) と、 申請者アイコン (md / sm 両方) も flexbox 内で横長になっていました。 v521 で 3 箇所すべてを `<span style="display:inline-flex; flex:none">` で包んで横伸び抑止しました。 タスク一覧 (v517 で対応済み) と合わせて、 タスク系の起案者・申請者アイコンは全て正しい正方形になります。',
        'sns'     => '🐛 タスク詳細ページの起案者・申請者アイコンが横長だった件、 残り 3 箇所も修正 #v521',
    ],
    157 => [
        'summary' => '徹底再精査の結果、 サムネ漏れが 8 箇所あったので一括修正しました。 サーバ側 (4 ハンドラ): products.php 個別 GET / playlists.php list & detail / ai.php translations list / adhoc_groups.php (receipts / expenses / schedule_items / lodgings / flights) で `image_thumb_url` / `cover_image_thumb` を追加で返すように。 クライアント側 (8 箇所): groups.js のレシート画像 (220px / 54px) と schedule item 関連 (タイル / ヒーロー / 詳細モーダル)、 product.js の商品ヒーロー、 playlists.js のカバー (一覧 / 詳細)、 translate.js の履歴 60px サムネを サムネ URL 優先 + loading=lazy + decoding=async に変更。 これでアプリ全体で 「タイル / ヒーロー / 中型表示」 でオリジナル画像がロードされる場面は無くなりました (avatar 系は元から loading=lazy で軽量)。',
        'sns'     => '🖼 サムネ漏れ 8 箇所 (サーバ 4 ハンドラ + クライアント 8 箇所) を一括修正。 全体的に画像が軽くなりました #v521',
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
