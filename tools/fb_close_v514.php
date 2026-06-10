<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    131 => [
        'summary' => 'ホームウィジェットの並びとタブの並びを ご要望の通りに再編しました。 ホームの並びは 上から 「進行中 → 未対応 → ポイント (残高) → あなたのグループ → らぼったー → 依頼中 → 新規入荷 → 募集 → 食べある記 (新着) → 重要連絡」 をデフォルトに、 それ以外は デフォルト 非表示 (設定 → ホーム から個別 ON 可能)。 タブは 「ホーム / グループ (ある時) / らぼったー / 購入 / 販売 / 依頼 / 競売 / アプリ / 実績」 の 9 個に絞り、 食べある記 / ラボにいる人 はタブから外しました (アプリ から行けます)。 全員の設定を新デフォルトにリセットするため、 localStorage のキーを labpay-home-layout-v2 と labpay-tab-layout-v2 に上げています (= 既存設定があった人も初回起動でリセット → 必要に応じて 設定から再カスタマイズ可)。',
        'sns'     => '🏠 ホームとタブの並びを再編。 みんな新デフォルト (進行中 → 未対応 → ポイント → グループ → らぼったー → 依頼中 → 新規入荷 → 募集 → 食べある記 → 重要連絡) からスタート、 設定で再カスタマイズ可 #v514',
    ],
    132 => [
        'summary' => 'ホームウィジェットの 「進行中」 「未対応」 「依頼中」 などは、 中身が空のときは カードごと非表示 (= 領域を取らない) ように。 表示設定で ON になっていても 中身が無ければ出ません。 polling (60 秒間隔 + tab フォーカス復帰) で 1 件でも出てきたら 自動的に出ます。',
        'sns'     => '🪟 中身がない 進行中 / 未対応 ウィジェットは カードごと非表示。 出てきたら自動で出ます #v514',
    ],
    133 => [
        'summary' => '通知のデフォルト表示を 10 件に変更しました (20 → 10)、 古いものは 「▼ さらに読み込み」 で。 設定ページの 「Cannot set properties of null」 エラーと、 タブ切替時のディレイ、 プロフィールタップ表示は v515 で別途対応します。',
        'sns'     => '📬 通知のデフォルト表示を 10 件に削減。 残りは「さらに読み込み」 で #v514',
    ],
    139 => [
        'summary' => 'ホーム画面に 「📢 重要連絡 / 学会情報」 ウィジェットを新規追加しました。 デフォルト ON です。 最新 5 件まで タイトル + カテゴリ (📌 連絡 / 📚 学会) + 投稿者 + 投稿日を表示し、 行タップで /#/notices に飛びます。 URL 付きの連絡は 🔗 アイコンで 直接外部リンクへ。',
        'sns'     => '📢 ホームに 「重要連絡 / 学会情報」 ウィジェット追加 (デフォルト ON) #v514',
    ],
    143 => [
        'summary' => 'すみません、 v513 で 「＋ 新しく募集する」 ボタンを削除した時に、 募集がある場合に addLink を連結する古いコードが残っていて 「addLink is not defined」 になっていました。 即修正してデプロイしました。 募集の一覧が正常に出るはずです。',
        'sns'     => '🐛 募集ウィジェットの addLink エラー、 修正済み (v513 のエンバグでした、 ごめんなさい) #v514',
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
