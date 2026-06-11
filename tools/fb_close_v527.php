<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    166 => [
        'summary' => '集合時間 (待ち合わせ / 〆切) を 端末のローカルタイムゾーン基準で設定できるようにしました。 v527 から クライアントは datetime-local 入力値を 端末ローカル時刻として解釈し、 ISO 8601 UTC に変換してから送信。 サーバ側もISO + TZ を受けて Tokyo タイムゾーンに正規化して保存。 イタリアで 「30分後」 を設定したら ちゃんと 「現地時刻 + 30分」 が DB に入ります。 「今より前に設定できません」 エラーも解消。',
        'sns'     => '🌍 集合時間 (待ち合わせ / 〆切) を 端末ローカル TZ ベースで設定できるように。 海外滞在中でも 「今より前」 エラーなし #v527',
    ],
    168 => [
        'summary' => 'ホームの 残高ヒーロー の 上に 端末ローカル時刻 (YYYY-MM-DD (曜) + HH:MM:SS) を 表示するようにしました。 1 秒ごとに更新、 5 秒ごとに 時 / 分 / 秒 のどれか 1 つが 1.6 倍フォントサイズに切り替わる演出付き (CSS transition で 0.3s 滑らかに)。',
        'sns'     => '🕐 ホームの ポイント表示の上に 現地時刻 (年月日 曜日 + 時分秒) を表示。 5 秒ごとに 時/分/秒 が 大きくなる演出付き #v527',
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
