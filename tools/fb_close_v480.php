<?php
// v480 cron-hourly: feedback #59 #60 #61 #62 #63 #64 #65 #66 を done に。
declare(strict_types=1);
chdir(__DIR__ . '/..');
// CLI で 動かす ため、 bootstrap が 期待 する 軽い 環境 を 立てる。
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
/** @var PDO $PDO */
/** @var array $CFG */
$pdo = $PDO;
$cfg = $CFG;

$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE display_name='Claude' AND kind='system' LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) {
    // 既存 行 無し → 代替 で nakamura (admin) を 使う。 新規 system user 作成 は
    //   email 制約 等 で 失敗 し やすい ので 避ける。
    $claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
}
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    59 => [
        'summary' => '販売 注意 文 を 「研究室 の 商品 の 転売 は やめてね」 に 修正 しました。',
        'sns'     => '🚫 販売 ページ の 注意 文 を 「研究室 の 商品 の 転売 は やめてね」 に 明確化 #v480',
    ],
    60 => [
        'summary' => 'グループ 一覧 や 食べある記 / SNS / 重要連絡 / Scrapbox の GET を Service Worker で stale-while-revalidate キャッシュ。 v479 で 入って いた もの に 加えて v480 で /api/me と /api/users も 追加 し、 オフライン でも グループ 一覧 が 直前 内容 で 表示 されます。',
        'sns'     => '📴 オフライン でも グループ 一覧 が 出る ように。 直前 の 内容 を 即 表示、 裏で 新鮮版 を 取りに 行きます #v480',
    ],
    61 => [
        'summary' => '① 投稿 直後 に SW キャッシュ から /api/posts* を 削除 + ホーム / SNS ヒーロー を 即座 に 描き直し ます。 ② ホーム の SNS ヒーロー を 上 詰め + 本文 2 行 まで で 打ち切り、 投稿者名 / 本文 / リアクション が 必ず 見える 高さ に 調整 しました。',
        'sns'     => '⚡ SNS 投稿 が ホーム / 一覧 に 即 反映 + ホーム ヒーロー を 投稿者 + 2 行 本文 + リアクション が 必ず 見える 配置 に #v480',
    ],
    62 => [
        'summary' => 'HOME_CARDS / APPS が source of truth に なって いて、 ここ に 載って いる 機能 は 自動 で 設定 → 「ホーム カード並び」 / 「アプリ表示」 から ON/OFF できます。 今回 v480 で 追加 した 食べある記 / SNS の ヒーロー も そのまま 制御 可能 です。',
        'sns'     => '⚙ 新機能 は 設定 → 「ホーム カード並び」 / 「アプリ表示」 から いつでも ON/OFF できます #v480',
    ],
    63 => [
        'summary' => '/api/posts/latest_id 軽量 endpoint を 追加。 SNS タイムライン と ホーム の SNS ヒーロー が 10 秒 おき に 最新 id だけ を 確認 し、 値 が 変わった 時 のみ 一覧 を 取り直し ます。 通常 polling は 1 件 数 を 返す だけ なので DB 負荷 は ほぼ ゼロ。',
        'sns'     => '🔄 SNS ホーム / 一覧 が 10 秒 毎 に 自動 更新 (差分 検知 で DB に やさしい) #v480',
    ],
    64 => [
        'summary' => 'SNS リアクション を 👍 (いいね) / ❤ (ハート) / ⭐ (星) の 3 種 に。 post_likes に kind 列 を 追加 し、 旧 行 は 「heart」 として 移行 済み (既存 ❤ は そのまま 残ります)。 投稿 詳細 / 一覧 に 3 ボタン が 並びます。',
        'sns'     => '👍 ❤ ⭐ 3 種類 の リアクション が 押せる ように なりました! #v480',
    ],
    65 => [
        'summary' => '新 実績 を 6 つ 追加: 点呼隊長 / つぶやき魔 / ラボの 人気者 / 落札王 / 時間 管理人 / ラボ DJ。 既存 の カウント から 自動 計算 されます。',
        'sns'     => '🏆 新 実績 6 種: 点呼隊長 / つぶやき魔 / ラボの 人気者 / 落札王 / 時間 管理人 / ラボ DJ #v480',
    ],
    66 => [
        'summary' => 'ホーム の 食べある記 (新着) を 新規入荷 と 同じ 「カバー画像 + ⭐ バッジ」 の カード レイアウト に 統一 しました。',
        'sns'     => '🍴 ホーム の 食べある記 を 新規入荷 風 の カバー画像 付き カード に 統一 #v480',
    ],
];

foreach ($BATCH as $fid => $data) {
    $st = $pdo->prepare("SELECT id, user_id, claude_status, url FROM feedback WHERE id = ?");
    $st->execute([$fid]);
    $fb = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fb) { echo "skip #$fid (not found)\n"; continue; }
    if ($fb['claude_status'] === 'done') { echo "skip #$fid (already done)\n"; continue; }
    $ownerUid = (int)$fb['user_id'];
    $summary = $data['summary'];
    $reply = '🤖 Claude 対応: ' . $summary;
    db_tx($pdo, function () use ($pdo, $fid, $summary, $reply, $claudeUid) {
        $pdo->prepare("UPDATE feedback SET
                        claude_status='done',
                        claude_finished_at=NOW(),
                        claude_summary=?,
                        replied_at=NOW(),
                        reply_body=?,
                        replied_by_user_id=?
                      WHERE id=?")
            ->execute([$summary, $reply, $claudeUid, $fid]);
    });
    try {
        notify_safely($pdo, $cfg, $ownerUid, 'admin_notice',
            "🤖 要望#$fid 対応: $summary", 'feedback', $fid);
    } catch (Throwable $e) { echo "  notify #$fid fail: " . $e->getMessage() . "\n"; }
    try {
        slack_notify($cfg, "✅ feedback #$fid done — $summary", null, '#/feedback-admin');
    } catch (Throwable $e) { echo "  slack #$fid fail: " . $e->getMessage() . "\n"; }
    try {
        feedback_post_release_to_sns($pdo, (int)$fid, $data['sns']);
    } catch (Throwable $e) { echo "  sns #$fid fail: " . $e->getMessage() . "\n"; }
    echo "done #$fid\n";
}
echo "ALL DONE\n";
