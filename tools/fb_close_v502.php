<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    118 => [
        'summary' => 'LabPayのアイコンをカッコ良くしたい件、 申し訳ないですが Claude 側からは画像生成ができないので、 デザインそのものは生成できません。 代わりに方針提案だけ: (案A) 「L」 と 「P」 を金額の硬貨/コインの上にあしらった2文字ロゴ、 (案B) 円マーク + ラボ (フラスコ/コイル) を組み合わせたアイコン、 (案C) 紫グラデ (#4a106d → #7b3fa0) + 白抜き 「LP」 のミニマル系、 のいずれかが LabPay の世界観と既存のテーマ色に合いそうです。 デザイナーさんに頼むときの方向性として参考にしてください。 生成 AI (DALL·E / Midjourney 等) に投げる場合のプロンプト例も別途お送りできます。',
        'sns'     => '🎨 アイコンデザインは Claude では画像生成ができないので方針案だけお送りしました (詳細は通知欄)。 デザイナー or 画像生成 AI 用のプロンプト例も別途出せます #v502',
    ],
    119 => [
        'summary' => 'Google Maps の保存リストを食べある記にインポートできるようにしました。 食べある記一覧の上にある 「📥 Google Map」 ボタンから KML または GeoJSON (.geojson / .json) ファイルを選ぶだけで、 既存の場所と重複しないものを一括登録します。 重複判定はタイトル一致 (大小無視) + 緯度経度 50m 以内、 同じ場所なら追加されません。 Google Maps から自分のリストを KML エクスポート → ファイル選択、 で取り込めます。 将来のリスト更新時も差分だけ追加されます。',
        'sns'     => '🗺 食べある記に 「📥 Google Map」 取り込みボタン追加。 KML / GeoJSON をそのまま選べば、 重複しない場所だけ一括登録 #v502',
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
