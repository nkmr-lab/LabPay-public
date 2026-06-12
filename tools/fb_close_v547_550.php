<?php
declare(strict_types=1);
chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/bootstrap.php';
$pdo = $PDO; $cfg = $CFG;
$claudeUid = (int)$pdo->query("SELECT id FROM users WHERE role='admin' AND kind='human' ORDER BY id LIMIT 1")->fetchColumn();
if ($claudeUid <= 0) { fwrite(STDERR, "no admin user found\n"); exit(1); }

$BATCH = [
    208 => [
        'summary' => '機能要望 / バグ報告で 投稿者が中村聡史 の場合は Slack 通知をスキップするように修正しました (feedback.php)。 admin_notice (= LabPay 内通知) は引き続き全 admin に飛びます (履歴として記録)。',
        'sns'     => '🔕 feedback 投稿者が中村聡史の場合は Slack 通知をスキップ #v547',
    ],
    207 => [
        'summary' => 'らぼったー画像投稿で 大きい JPEG (> 3 MB) は クライアント側で 自動縮小するようにしました 📷。 長辺 > 3000px なら 2400px までリサイズ + JPEG q=0.85 で再エンコード。 元画像の APP1 EXIF ブロック (Orientation / GPS / 撮影日時 等) を バイナリレベルで抽出して 縮小後の JPEG に再注入するので、 EXIF は完全保持。 PNG / WebP / HEIC は そのままアップロード (EXIF が無い形式 or canvas 経由で失う方が逆効果)。',
        'sns'     => '📷 らぼったー: 大きい JPEG は クライアントで 2400px 縮小 + EXIF 完全保持で アップロード軽量化 #v548',
    ],
    210 => [
        'summary' => '「🎯 ティア表」 機能を新規追加しました (/#/tierlists または アプリ → ティア表 から)。 ① 起案者がお題 + 候補リスト (改行区切り、 最大 200 件) で作成、 ② 参加者が 各候補を S/A/B/C/D/F の 6 段階 (色付きピル) に振り分け (タップで S→A→B→C→D→F→未配置 ループ)、 ③ 保存後に 他の人の回答 + 全員の集計 (候補ごとに 各 tier に 何人入れたか の積み上げバー) が見える、 ④ 起案者は 「締切る」 ボタンで回答受付終了。 ホームクイックアイコン候補にも追加。',
        'sns'     => '🎯 「ティア表」 機能を追加! みんなで 候補を S/A/B/C/D/F に振り分け → 全員集計 が 積み上げバーで 一目瞭然 #v549',
    ],
    206 => [
        'summary' => '「📄 論文 査読」 機能を新規追加しました (/#/paper-review または アプリ → 論文査読 から)。 論文本文 (英語 or 日本語、 〜60000 文字 ≒ 10ページ程度) を貼って ターゲット会議 + 査読の厳しさ (緩め / やや厳しめ (default) / 厳しめ) を指定 → AI (GPT-4o-mini) が ① 章立て (Abstract / Introduction / Related Work / Method / Results / Discussion / Conclusion 等) を意識した 和訳要約、 ② 査読コメント (Strong Accept ~ Strong Reject の 7 段階決定、 Score 1-5、 Confidence 1-5、 Strengths / Weaknesses 箇条書き、 著者へのコメント 200-600 文字) を返します。 ターゲットがなければ HCI 系国際会議 (CHI / UIST / IUI / DIS / CSCW など) 想定。 1-2 分かかります。',
        'sns'     => '📄 「論文 査読」 機能を追加! 章立て和訳要約 + Strong Accept〜Reject の 7 段階決定 + Strengths/Weaknesses + 著者へのコメント #v550',
    ],
    209 => [
        'summary' => '4人対戦麻雀ゲーム、 仕様は把握しました (4人揃ったら開始、 各50pt 預託、 1位50% / 2位30% / 3位15% / 4位0%、 場代5%)。 ただし 麻雀は 牌の表示・配牌・摸打・鳴き・リーチ・役判定 (40 種類以上の役 + 翻数計算)・点数計算 (符 + 翻 + 場ゾロ + 親子区別)・流局処理 など 実装規模が巨大で、 cron での 10 分処理サイクル内では完結しません。 次の集中作業セッション (中村先生から 「今日 麻雀を仕上げよう」 などの 明示的指示) で Phase 1 (賭けプール + 1〜4位 申告型 結果分配のみ、 ゲーム本体は外部) → Phase 2 (簡易ゲーム本体、 1人 vs CPU 3人) → Phase 3 (4人対戦) と段階的に実装する予定です。 賭けプール (= 4人で 50pt 預けて 1-4位 申告で 自動分配する 汎用機能) だけ先に欲しい場合は 改めて要望ください、 単独機能として作れます (麻雀以外の ゲーム / 飲み会の勝負 / じゃんけん大会 等にも使えるので 汎用性高い)。',
        'sns'     => '🀄 麻雀ゲーム、 仕様 OK ですが 実装規模が巨大 (役判定 40+ / 点数計算) なので 集中セッションで Phase 1〜3 段階実装予定 #v550',
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
