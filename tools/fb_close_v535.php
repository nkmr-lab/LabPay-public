<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    193 => [
        'summary' => 'スケジュール 「描画エラー: hasImage is not defined」 の原因が判明・修正しました。 v521 #157 (サムネ対応) の時に schedule item の hero 背景画像を hasImage → heroBg に変更したのですが、 同じスコープの 別 4 箇所で hasImage 変数を 引き続き参照していました。 v535 で 4 箇所すべてを heroBg に統一。 また #189 で入れた try/catch ラッパが今回原因の検出に大きく役立ったので そのまま残しています。 完全リロード後 ちゃんと描画されるはずです。',
        'sns'     => '🐛 スケジュール 「hasImage is not defined」 エラー、 変数名統一漏れ 4 箇所修正 (#189 の try/catch で検出できた) #v535',
    ],
    194 => [
        'summary' => 'らぼったー の 自分の投稿マップ (/#/sns/map) と 食べある記の マップ (/#/places/map) で、 写真がある場合 マーカーをサムネ画像のアイコン (42px、 白枠 + 影付き) に置換しました。 グループスケジュール地図と同じ見せ方です。 ポップアップにも 上に 大きめサムネ (120-160px) を表示。 マーカータップで画像 + タイトル + 詳細リンクが出ます。',
        'sns'     => '🗺 らぼったー マップ + 食べある記 マップ、 マーカーを画像アイコン化 (42px、 白枠付き)。 グループ地図と同じ見せ方 #v535',
    ],
    191 => [
        'summary' => 'らぼったー マップ (/#/sns/map) に 2 つの機能追加: ① 前回 (= ページを閉じた時) の中心 + ズームを localStorage に保存して 次回 同じ場所/サイズで開く、 ② 「📍」 ボタン (地図右上) で 現在地に移動 (ズームは変えず 位置だけ)。 マーカー画像化 (#194) と合わせて 食べある記マップと同じ操作感になります。 食べある記マップは 別途追加検討予定 (要望に応じて)。',
        'sns'     => '🗺 らぼったーマップ、 前回の表示位置/サイズを記憶 + 📍 現在地移動ボタン #v535',
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
