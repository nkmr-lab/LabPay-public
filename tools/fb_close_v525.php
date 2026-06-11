<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    167 => [
        'summary' => 'らぼったー (タイムライン) に 下スワイプによる pull-to-refresh を入れました。 ページ上部 (scrollY=0) から 60px 以上下方向にスワイプすると 「↓ 引っ張って 更新」 → 「↻ 離して 更新」 のインジケータが出て、 離すと再読込されます。 PC でも touch event をサポートするブラウザなら動作。',
        'sns'     => '↓ らぼったー に 下スワイプ更新 (pull-to-refresh) を追加。 ページ上部から引っ張ると再読込 #v525',
    ],
    175 => [
        'summary' => '設定ページの各カテゴリを デフォルト折りたたみに変更しました。 ▶ アイコンと見出しをタップで展開、 ▼ で折り畳み。 「設定」 トップカードは そのまま (タイトル h2)、 中身がある各 h3 セクション (プロフィール / 通知 / 自分の端末 / ホーム ウィジェット / タブのカスタマイズ / ホーム上部の クイック ボタン / Google Calendar / 効果音 など) は折りたたんでスッキリ。 設定ページの初見スクロール量が劇的に減ります。',
        'sns'     => '🗂 設定ページの各カテゴリ、 デフォルト折りたたみに #v525',
    ],
    178 => [
        'summary' => '通知 「すべて既読にする」 ボタン、 v525 から 表示先行 + DB 裏更新 に変更しました。 押すと即座にローカル loadedItems の read_at を全部 NOW にして paint() → 表示が瞬時に既読モードに切り替わり、 サーバへの PATCH /api/notifications/read_all は裏で完了。 全件 re-fetch しないので体感がずっと軽くなりました。',
        'sns'     => '⚡ 通知 「すべて既読」 ボタン、 表示先行 + DB は裏更新で 体感を改善 (全件 re-fetch 廃止) #v525',
    ],
    180 => [
        'summary' => 'らぼったーで 投稿者の アバター or 名前 をタップすると、 その人の投稿のみに絞り込む機能を追加しました (/#/sns?user=ID)。 絞り込み中は composer (新規投稿) は隠れて、 ヘッダに 「@name の投稿のみ」 + 「← タイムライン全体」 「解除」 ボタン が出ます。 サーバ側 /api/posts に ?user_id=N パラメータも追加。',
        'sns'     => '🔍 らぼったー: 投稿者のアバター or 名前タップで その人の投稿だけに絞り込み #v525',
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
