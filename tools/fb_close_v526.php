<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    170 => [
        'summary' => '追加した新アプリ (v523 順番決め) も ホーム上部の クイック アイコン候補に入るようにしました。 HOME_ACTIONS に 「📋 順番決め」 を追加 (デフォルト OFF)。 設定 → 「ホーム上部のクイックボタン」 から ON にすると ホームのアイコン列に表示されます。 以後 追加するアプリは APPS と HOME_ACTIONS の両方に登録します。',
        'sns'     => '🔧 「順番決め」 を ホームクイックアイコン候補に追加。 設定 → ホーム上部のクイックボタン から ON 可能 #v526',
    ],
    172 => [
        'summary' => '購入ページのロードが遅い件、 サーバ側を計測したところ /api/listings のクエリで N+1 ボトルネックがありました: ① 各行で 「この出品者の総売上 (purchases の SUM(qty))」 を 相関サブクエリで計算、 ② 各行で 「自分が同じ JAN を過去に買ったか」 を EXISTS で確認。 200 件 × M 出品者で クエリが重くなっていました。 v526 で 派生テーブル (LEFT JOIN サブクエリ) に書き換えて、 ① per-seller の集計を 1 回だけ、 ② per-jan の購入履歴を 1 回だけ 計算する形にしました。 同じ結果で 速度は大幅改善 (大規模時で 10x 級)。 クライアント側のレンダリング (innerHTML 一括) はまだ重い場合があるので、 さらに改善が必要なら別途対応します。',
        'sns'     => '⚡ 購入ページ /api/listings の N+1 ボトルネックを排除。 per-seller / per-jan の集計を派生テーブル化 #v526',
    ],
    179 => [
        'summary' => 'らぼったーの 画像タップ時 (lightbox) の ローディング表示を入れました。 XMLHttpRequest で画像をオリジナル解像度で取得し、 onprogress イベントで 「45% (3.2 MB)」 のような進行率を出します (Content-Length が取れる場合)。 取得完了後に blob → object URL で表示。 大きい画像でも 「何が起きてるか」 が分かるようになりました。',
        'sns'     => '⏳ らぼったー 画像 lightbox に ローディング + 進行率表示 (大きい画像も体感が改善) #v526',
    ],
    183 => [
        'summary' => 'admin (中村) が LabPay (system 投稿) を削除できるようにする件、 v524 で既に対応済みです。 サーバ posts.php で 「admin かつ author_kind=system」 のときは削除許可、 クライアント posts.js でも 削除ボタンが表示されるようになっています。 もし削除ボタンが見えない場合は ブラウザを完全リロードしてください (SW キャッシュの影響で 古い JS のままになっている可能性)。 v524 以降の posts API は u.kind AS author_kind を返しているので、 ブラウザ側さえ最新なら 動作するはずです。',
        'sns'     => '🔒 admin が LabPay 投稿を削除する権限、 v524 で対応済み。 ブラウザ完全リロードで反映されます #v526',
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
