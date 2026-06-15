<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO, $CFG;

$summary = "自作ゲーム フレームワーク を導入 + サンプル ⭕❌ マルバツ を公開 (v617)。\n"
        . "・ /api/custom-games/:kind/games の 共通 API (list / create / join / move / cancel) を 整備\n"
        . "・ CustomGameInterface (PHP) を 実装して registry に 1 行 追加するだけで 2 人対戦 ゲームを 100 行 + 1 SQL 行 で 追加できる\n"
        . "・ サンプル: マルバツ 3x3 (src/custom_games/TicTacToe.php + public/js/views/tictactoe.js)、 1pt buy-in、 勝者 pot 総取り、 引分 半額返金\n"
        . "・ ゲーム追加ガイド: docs/CUSTOM_GAMES.md を新規作成。 アーキテクチャ図 + PHP/JS の最小実装テンプレ + DB スキーマ + 課金フロー\n"
        . "・ /#/tictactoe で 起動。 アプリ → 娯楽 → ⭕❌ マルバツ から アクセス";

db_tx($PDO, function () use ($PDO, $summary) {
    $stFb = $PDO->prepare("SELECT user_id FROM feedback WHERE id = 236");
    $stFb->execute();
    $row = $stFb->fetch(PDO::FETCH_ASSOC);
    if (!$row) { fwrite(STDERR, "feedback 236 not found\n"); exit(1); }
    $reporterUid = (int)$row['user_id'];
    $reply = "🤖 Claude 対応: " . $summary;
    $PDO->prepare("UPDATE feedback SET
        claude_status='done',
        claude_finished_at=NOW(),
        claude_summary=?,
        replied_at=NOW(),
        reply_body=?,
        replied_by_user_id=1
       WHERE id=236")->execute([$summary, $reply]);
    notify_safely($PDO, $GLOBALS['CFG'], $reporterUid, 'admin_notice',
        "🤖 フィードバック #236 対応完了: " . mb_substr($summary, 0, 200),
        'feedback', 236);
});
slack_notify($CFG,
    "🤖 Claude 自動対応 feedback#236\n" . mb_substr($summary, 0, 600),
    null, '#/feedback-admin');
echo "closed feedback#236\n";
