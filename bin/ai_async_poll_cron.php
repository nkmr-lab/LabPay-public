<?php
// v1212 fb#501 中村さん報告「論文全訳の完了通知がタップするまで来ない」→ 従来 は
//   ユーザ が 結果ページ を 開いた 時 だけ OpenAI に 進捗確認 (ai_paper_full_translate_poll)
//   が 走る 設計 だった の で、 未着 = 完了検知 も 通知 も 発火しない 状態。
//   このスクリプト は 数分ごと に cron から 呼ばれ、 全 processing 案件 を 一括 poll する。
//   done に なった 案件 は poll 内 で notify_safely まで 走る の で、 完了 → 即 通知 が 実現。
//
// 対象:
//   - paper_full_translations WHERE status='processing' AND openai_response_id IS NOT NULL
//   - deep_researches         WHERE status='processing' AND openai_response_id IS NOT NULL
//
// 使い方 (as apache):
//   sudo -u apache php bin/ai_async_poll_cron.php
//
// cron 推奨:
//   */2 * * * * apache /usr/bin/php /var/www/labpay/bin/ai_async_poll_cron.php >> /var/log/labpay-ai-async-poll.log 2>&1

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$cfg = require __DIR__ . '/../config/config.php';
$pdo = new PDO(
    $cfg['db']['dsn'],
    $cfg['db']['user'],
    $cfg['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$ts = date('Y-m-d H:i:s');
$totals = ['pft_processing' => 0, 'pft_done' => 0, 'pft_error' => 0,
           'dr_processing'  => 0, 'dr_done' => 0, 'dr_error' => 0];

// ── paper_full_translations ──
try {
    $st = $pdo->query("SELECT * FROM paper_full_translations
                        WHERE status = 'processing' AND openai_response_id IS NOT NULL");
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $totals['pft_processing']++;
        try {
            $after = ai_paper_full_translate_poll($pdo, $cfg, $row);
            $s = (string)($after['status'] ?? '');
            if ($s === 'done')       $totals['pft_done']++;
            elseif ($s === 'error')  $totals['pft_error']++;
        } catch (Throwable $e) {
            fwrite(STDERR, "[$ts] pft#{$row['id']} poll err: " . $e->getMessage() . "\n");
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, "[$ts] pft query err: " . $e->getMessage() . "\n");
}

// ── deep_researches ──
try {
    $st = $pdo->query("SELECT * FROM deep_researches
                        WHERE status = 'processing' AND openai_response_id IS NOT NULL");
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $totals['dr_processing']++;
        try {
            $after = ai_deep_research_poll($pdo, $cfg, $row);
            $s = (string)($after['status'] ?? '');
            if ($s === 'done')       $totals['dr_done']++;
            elseif ($s === 'error')  $totals['dr_error']++;
        } catch (Throwable $e) {
            fwrite(STDERR, "[$ts] dr#{$row['id']} poll err: " . $e->getMessage() . "\n");
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, "[$ts] dr query err: " . $e->getMessage() . "\n");
}

$totalIter = $totals['pft_processing'] + $totals['dr_processing'];
if ($totalIter > 0) {
    fwrite(STDOUT, "[$ts] async-poll: pft={$totals['pft_processing']} (done={$totals['pft_done']}, error={$totals['pft_error']}), "
                 . "dr={$totals['dr_processing']} (done={$totals['dr_done']}, error={$totals['dr_error']})\n");
}
