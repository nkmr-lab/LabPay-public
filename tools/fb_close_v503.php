<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    120 => [
        'summary' => 'バージョンアップ直後の初回起動が遅い問題、 主要因は #121 #129 で指摘いただいた 「hidden なホームウィジェットも全部 fetch していた」 です。 v503 で hidden カードはレンダー (fetch) も polling も skip するようにしたので、 平均的なホームのロード時間がかなり減ります。 また 「何をロードしているか」 は #115 の admin perf pill (右下に出る) で詳細が見られます。 splash も #123 対応でデプロイ時刻が自動で更新されるようにしました。',
        'sns'     => '⚡ 起動が遅い問題の核となっていた hidden ウィジェットの fetch を skip するように修正 #v503',
    ],
    121 => [
        'summary' => '計測ありがとうございます！ ご指摘の通り 「ホームに表示してないカードまで全部 fetch していた」 問題でした。 v503 で readHomeLayout().hidden に入ってるカードはレンダー処理ごと skip するように変更しました。 cardId → render 関数の対応表を作って そこを通る形にしたので、 新しいウィジェットが増えてもこの対応表に並べるだけで自動 skip 対象になります。 mytimers が一番重かった件、 hidden なら呼ばれません。',
        'sns'     => '🚀 ホームのウィジェット、 hidden なものはレンダーも fetch も skip するように。 表示してない物は時間使いません #v503',
    ],
    123 => [
        'summary' => 'splash の最終更新日時、 これまではコードに固定の文字列で書いていたので確かに変わってませんでした。 v503 でデプロイ時の sed 置換で実時刻に書き換える方式にしたので、 これからは「最終更新: YYYY-MM-DD HH:MM JST」 が毎回ちゃんと更新されます。',
        'sns'     => '🕒 splash の最終更新日時、 デプロイ時に自動で書き換わるようになりました #v503',
    ],
    125 => [
        'summary' => 'Home load レポートが 2 回出ていた件、 v498 で boot 時に 「キャッシュから即 hydrate → dispatch + 裏で refreshMe」 という流れに変えたタイミングのレースが原因でした。 v503 で router.dispatch() に 「同一 hash の連続呼び出し 800ms 以内は skip」 のデバウンスを入れたので、 renderHome が 2 回走ることはなくなり、 計測レポートも 1 回だけになります。',
        'sns'     => '🪞 ホーム計測レポートが 2 回出る現象、 dispatch 重複が原因だったので debounce で抑止 #v503',
    ],
    126 => [
        'summary' => '#125 と同じ件、 router dispatch のデバウンスで対応しました。 ご丁寧に複数回報告いただきありがとうございます。',
        'sns'     => '🪞 ホーム計測レポート二重出力、 router dispatch debounce で解消 #v503',
    ],
    127 => [
        'summary' => 'ご指摘の通り、 食べある記のタイル背景はオリジナル画像を読んでいました。 v503 でサーバ側に cover_image_thumb (実在チェック済みのサムネ URL) を返すフィールドを追加し、 タイル/マップ一覧/ホームのヒーロー全部でサムネを優先するように変更しました。 サムネがない古い画像はオリジナルにフォールバックします。',
        'sns'     => '🖼 食べある記のタイル背景をサムネ画像に切替。 ロード重さ問題の一部を解消 #v503',
    ],
    128 => [
        'summary' => 'タブの中身は v490 以降、 既に lazy loading (route 時に動的 import) になっています。 ホームを開いた時点では他のタブの view モジュール (sell.js / places.js 等) はダウンロードもパースもされていません。 ただしホーム自体に並ぶウィジェットの方は全部走らせていたので、 そちらは v503 (#121 #129) で hidden を skip する対応を入れました。 「実際にタブを開くまでロードしない」 動作自体は既に効いています。',
        'sns'     => '🧭 タブの中身は元々遷移時 lazy load 済み。 ホーム上のウィジェットの hidden skip は #v503 で別途対応 #v503',
    ],
    129 => [
        'summary' => '完全に同感で、 v503 で 「hidden なホームウィジェットはレンダーも fetch も polling も全部 skip」 するように直しました。 cardId → render 関数の対応表で hidden を弾く形なので、 新しいウィジェットが増えても自動的に同じルールが効きます。',
        'sns'     => '🏠 ホームの hidden ウィジェット、 fetch/polling も全部 skip するように #v503',
    ],
    130 => [
        'summary' => 'こちらも同感で、 v503 で 1 分ポーリングからも hidden なカードを除外しました。 doHomePoll の Promise.all タスクを hiddenSet で filter してから走らせる形なので、 hidden なものは API も叩きません。',
        'sns'     => '⏱ ホームの定期ポーリングも hidden なウィジェットはスキップするように修正 #v503',
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
