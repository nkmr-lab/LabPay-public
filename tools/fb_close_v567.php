<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) exit(1);

$BATCH = [
    216 => [
        'summary' => 'ホーム 未対応 / 依頼中 カード で 24 時間以内に締切のあるものを 自動的に一番上 + 🔥 24h バッジ + オレンジの背景強調 で表示するようにしました。 並びは「urgent (24h 以内) → 締切順 → 締切無し」。 ヘッダーの件数表示も 「N 件🔥 / M 件未対応」 のように urgent 件数を強調。 また 「urgent な件数 > デフォルト表示数 (5)」 の時は 自動で表示数を上げて 全件 urgent を見せます。 進行中の カード位置は変更せず、 中の並び順だけ urgent 優先に。',
        'sns'     => '🔥 ホームの 未対応 / 依頼中、 24h 以内の締切は 一番上に強調表示 #v567',
    ],
    221 => [
        'summary' => '画像翻訳 (#/translate) を 複数画像対応 + CSS整形に。 ① ファイル選択を複数可 (multiple) にして 一度に複数枚アップロード、 サムネと × 削除ボタンを並べる、 ② 「N 件まとめて和訳」 ボタンで 順次処理 (1 枚ずつ 進捗 N/M 表示) → 各画像ごとに 独立カードで結果表示、 ③ 出力の MD っぽい形式を CSS 整形に変換 (**太字** は紫の strong、 「└ 補足」 は 紫左罫線付き淡背景ブロック、 # 見出しは下線付き 16px、 - 箇条書きは • で字下げ)。 全画像処理後に履歴も自動更新。',
        'sns'     => '📸 画像翻訳バルク対応 + CSS整形出力 (MD じゃなくて見やすい) #v567',
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
