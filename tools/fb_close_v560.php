<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) exit(1);

$BATCH = [
    213 => [
        'summary' => '待ち合わせ (#/meetups) の 時刻入力に 「🇯🇵 JST / 🌍 ローカル」 切替トグルを追加しました (デフォルト JST)。 海外滞在中でも 「日本時間 で 10:00」 を 正しくセットできます。 設定は localStorage に永続化されるので 一度選んだ TZ モード が タスク締切とも共通で 維持されます。 待ち合わせの edit 画面 (時刻変更) も同じトグル + helper 経由。',
        'sns'     => '🕘 待ち合わせ時刻入力に JST/ローカル 切替トグル (デフォルト JST、 海外でも正確) #v560',
    ],
    215 => [
        'summary' => 'タスクの締切設定にも 「🇯🇵 JST / 🌍 ローカル」 切替トグルを追加しました (デフォルト JST)。 新規作成 + 編集 両方で。 海外から 日本時間 締切を 直感的にセットできます。 待ち合わせ (#213) と同じ TZ helper を共有しているので 設定は連動 (localStorage.labpay-tz-mode)。',
        'sns'     => '📅 タスク締切も JST/ローカル 切替トグル対応 #v560',
    ],
    218 => [
        'summary' => '日本で締切設定した時刻が 海外で見ると ローカルタイムにずれて表示される件、 format.js の fmtDateTime に TZ mode を反映するように修正しました。 mode=jst (default) なら そのまま JST 表示、 mode=local なら 端末ローカル時刻に変換して表示。 切替は タスク/待ち合わせ 編集画面のトグルから (localStorage.labpay-tz-mode 共通)。 「日本で 17:00 にセット」 → JST モード で 「17:00」 と表示、 ローカルモード (例: イタリア) で 「10:00」 と表示、 が一貫します。',
        'sns'     => '🌍 時刻表示も TZ mode 反映: JST/ローカル 切替で 一貫した時刻が見える #v560',
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
