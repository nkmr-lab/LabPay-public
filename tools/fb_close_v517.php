<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    145 => [
        'summary' => 'Google Maps の URL からの取り込み、 残念ながら Google Maps の保存リスト (マイマップ) には 公開された API がないので、 URL を貼っても外部から中身を読むことはできません。 現状の運用としては Google Maps のマイマップ → メニュー → KML をエクスポート で .kml を保存 → LabPay の 「📥 Google Map から取り込み」 でファイル選択、 が一番手早いです。 (もし マイマップではなく 「リスト」 機能 (お気に入りなど) からの 直接取り込み が欲しい場合、 こちらは Google が API 公開してないので難しいです。)',
        'sns'     => '🗺 Google Maps URL からの直接取り込みは API 非公開で難しいので、 KML エクスポート → ファイル選択の流れで対応 #v517',
    ],
    146 => [
        'summary' => '要望と報告を 1 つのページに統合しました。 上部の 「📝 フィードバック」 から ✨ 機能要望 / 🐛 バグ報告 を ラジオボタンで選んで送信。 旧 /#/feature-request / /#/bug-report もそのまま使えるので ブックマークも壊れません。 トップバーも 2 つあった 「要望」 「報告」 リンクを 1 つにまとめました。',
        'sns'     => '📝 「要望」 「報告」 を 1 ページに統合。 ラジオボタンで切替 #v517',
    ],
    147 => [
        'summary' => 'らぼったーページのキャッシュ問題、 SW (Service Worker) の SWR は キャッシュから即返す → 裏で fetch して 次回用にキャッシュ更新、 という設計で、 「すぐに最新を表示」 する仕組みではありませんでした。 v517 で 投稿 / 削除 / リアクション など mutation API (POST/PATCH/DELETE) が成功するたびに、 SW が関連 GET キャッシュを自動破棄するようにしました。 これで 「自分が投稿した直後に開いたら古い」 みたいなことが無くなり、 開いた時点で必ずネットから最新を取りに行く形になります。 #149 #150 も この一発で根治しています。',
        'sns'     => '⚡ SW を mutation 後に関連キャッシュ自動破棄するように。 「投稿しても反映されない」 「リロード必要」 を根治 #v517',
    ],
    148 => [
        'summary' => 'グループのフィード追加が即時反映されない件、 #147 と同じ SW SWR キャッシュ問題です。 v517 で POST /api/groups/:id/feed が成功したら SW が /api/groups* のキャッシュをすべて破棄するようにしたので、 追加直後に loadDetail が走っても 必ずネットから新鮮なフィードが取れます。',
        'sns'     => '⚡ グループフィード追加、 リロード不要で即時反映されるように (SW invalidate) #v517',
    ],
    149 => [
        'summary' => 'ご指摘の 「追加・更新・削除でリロードしないと反映されない問題」、 SW SWR キャッシュの仕組み上、 至る所で発生していました。 v517 で SW 全体に mutation invalidate を仕込んだので、 ① 投稿 (POST) ② 編集 (PATCH) ③ 削除 (DELETE) が成功した瞬間に、 同じトップセグメント (/api/posts*, /api/groups*, /api/places*, /api/notices*, /api/me*, ...) のキャッシュが全削除されます。 次回 GET は必ずネット直行 = 新鮮版が出ます。 ledger 系 (送金 / 残高 / 購入) は元々キャッシュ対象外なので無関係に最新です。',
        'sns'     => '🔄 「リロードしないと反映されない問題」 SW で全体根治。 mutation 成功 → 関連キャッシュ自動破棄 → 次回 GET は新鮮 #v517',
    ],
    150 => [
        'summary' => 'らぼったーの追加 / 削除と etag 監視のアイデア、 #147 #149 と同じ SW invalidate で根治しています。 投稿 / 削除した瞬間に /api/posts* のキャッシュが全部消えて、 次回 GET は必ずネット直行。 ホームの 「らぼったー」 ウィジェットも、 タブ復帰時の polling で 最新版が降りてくる流れになりました。 etag による条件付き GET は将来的な最適化として検討します。',
        'sns'     => '⚡ らぼったー 追加 / 削除も SW invalidate で即時反映 (ホームウィジェット含む) #v517',
    ],
    151 => [
        'summary' => 'タスクページの起案者アイコンが横長になる件、 flexbox 親 (.list-item) で aspect-ratio が引き伸ばされていました。 v517 で アイコンを `<span style="display:inline-flex; flex:none">` で包んで 横伸びを防止 (sn の home の同様パターン #117 と同じ修正)。 タスク一覧で起案者の顔が正しい正方形で出ます。',
        'sns'     => '🐛 タスク一覧の起案者アイコンが横長になる件、 修正済み (flexbox 横伸び抑止) #v517',
    ],
    152 => [
        'summary' => 'らぼったー (ホームウィジェットでの画像ヒーロー表示) の本文部分を、 50% から 45% に詰めて 5% 左寄せしました。 リアクションの ❤️/⭐/👍 が折り返さずに 1 行に収まるはずです。 画像 (左 50% の背景) はそのまま変えていません。',
        'sns'     => '🎨 らぼったー の 画像ヒーローカード、 本文を 5% 左寄せして リアクションを折り返さないように #v517',
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
