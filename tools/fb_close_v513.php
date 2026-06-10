<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    134 => [
        'summary' => 'グループ一覧の上に空の領域が残っていた件、 v510 で説明文を撤去した際に空の page-header カードがそのまま残ってしまっていました。 v513 で 空のカード自体を削除しました。 ついでに 募集ページ と 送金ページ の同じ空 page-header も合わせて 一括削除しました。',
        'sns'     => '🧹 グループ一覧の上の空白カード、 v513 で削除しました #v513',
    ],
    135 => [
        'summary' => 'ホームの 「募集」 ウィジェット、 中身が空のときに 「＋ 新しく募集する」 だけ出てたのを撤去しました。 募集が一件もないときは カードごと非表示。 募集を作りたいときは アプリ → 募集 や グループ から行ってください。',
        'sns'     => '🧹 ホームの 「＋ 新しく募集する」 ボタン (募集が無い時) を撤去 #v513',
    ],
    136 => [
        'summary' => '食べある記のサムネが PC で回転してしまう件、 全 134 枚のサムネを 強制再生成 (削除 → orientation 補正付き再生成) しました。 v505 以前に生成されたサムネが混ざっていた可能性があります。 もしまだ特定の店舗で残っていたら ID を教えてください、 個別に再生成します。 ブラウザのキャッシュもクリアして確認お願いします。',
        'sns'     => '🔄 食べある記サムネの PC 回転件、 全 134 枚を orientation 補正付きで強制再生成 #v513',
    ],
    137 => [
        'summary' => '要望フォームの 「Cannot read properties of null (reading value)」 エラー、 ページ遷移中に 送信ボタンが発火するレースで textarea 要素が null になっていたケースを 防御コードに変更しました。 ?. オペレータ + null チェックで 静かに早期 return するようにしています。',
        'sns'     => '🛡 要望フォーム送信時の null エラーを防御 #v513',
    ],
    138 => [
        'summary' => 'ワリカでレシートを削除した後、 リロードしないと反映されない件、 Service Worker の content キャッシュに 古いワリカデータが残っていたのが原因でした。 v513 で 削除直後に invalidateGroupCache (= /api/groups/.* のキャッシュを破棄) してから loadWari するように変更したので、 削除すれば即座に画面から消えます。',
        'sns'     => '🧹 ワリカのレシート削除、 即時反映されるようにキャッシュ破棄を追加 #v513',
    ],
    140 => [
        'summary' => '食べある記の Google Map インポート、 + 新規 ボタンの中にドロップダウンとして移動しました。 タップで 「📝 1 件 ずつ 追加」 と 「📥 Google Map から (KML/GeoJSON)」 の 2 つが出ます。 ヘッダがすっきりして、 普段使いの邪魔にならなくなりました。',
        'sns'     => '🗺 食べある記の Google Map インポート、 +新規 ボタンの中に格納しました #v513',
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
