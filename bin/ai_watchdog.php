<?php
// v1325 AI job watchdog: 15 分 以上 processing の まま の job を 拾って
//   - retry_count < 3 なら status='pending' に 戻す + retry_count++ + 通知
//     (完全自動再実行 は Phase2 で 別途、 現状 は 依頼者 に 「再依頼して」通知 する 半自動)
//   - retry_count >= 3 なら status='error' + ai_refund_if_charged で 返金 + 通知
//
// cron 想定: */5 * * * * (毎 5 分)。

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

// bootstrap.php が global $CFG / $PDO を セット
global $CFG, $PDO;
$pdo = $PDO;
$cfg = $CFG;

const WD_STUCK_MIN = 15;
const WD_MAX_RETRY = 3;

// v1327 retry_endpoint が ある もの (paper_translate/full_translate) は internal auth で
//   完全自動再実行、 ない もの (paper_review) は 現行 の pending 戻し + 通知 の 半自動 継続。
$tables = [
    ['tbl' => 'paper_translates',        'kind' => 'paper_translation',      'ref_type' => 'paper_translation',      'label' => '要約', 'retry_url' => 'paper_translate'],
    ['tbl' => 'paper_full_translations', 'kind' => 'paper_full_translation', 'ref_type' => 'paper_full_translation', 'label' => '全訳', 'retry_url' => 'paper_full_translate'],
    ['tbl' => 'paper_reviews',           'kind' => 'paper_review',           'ref_type' => 'paper_review',           'label' => '査読', 'retry_url' => null],
];

// v1327 retry endpoint を localhost で 叩く (internal auth 経由)
$internalSecret = (string)($cfg['internal']['secret'] ?? '');
function invoke_retry_endpoint(string $sub, int $id, string $secret): array {
    if ($secret === '') return ['ok' => false, 'http_code' => 0, 'err' => 'internal.secret 未設定'];
    $ch = curl_init("http://localhost/api/ai/{$sub}/{$id}/retry");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => '{}',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Internal-Auth: ' . $secret,
            'Host: pay.nkmr.io',
        ],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return ['ok' => ($code >= 200 && $code < 300), 'http_code' => $code, 'body' => $body, 'err' => $err];
}

$now = date('Y-m-d H:i:s');
$handled = 0;

foreach ($tables as $t) {
    // COALESCE(last_attempt_at, created_at) で 判定 (last_attempt_at 未設定 = 初回)
    $sql = "SELECT id, user_id, retry_count, error_msg
              FROM {$t['tbl']}
             WHERE status='processing'
               AND COALESCE(last_attempt_at, created_at) < NOW() - INTERVAL ? MINUTE";
    $st = $pdo->prepare($sql);
    $st->execute([WD_STUCK_MIN]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        $id  = (int)$r['id'];
        $uid = (int)$r['user_id'];
        $rc  = (int)$r['retry_count'];
        if ($rc >= WD_MAX_RETRY) {
            // 諦め + 返金 + 通知
            $newMsg = trim((string)($r['error_msg'] ?? '') . ' / watchdog: 15分×' . WD_MAX_RETRY . '回で沈黙');
            $pdo->prepare("UPDATE {$t['tbl']} SET status='error', error_msg=? WHERE id=?")
                ->execute([$newMsg, $id]);
            try {
                $refunded = ai_refund_if_charged($pdo, $uid, $t['ref_type'], $id, "AI ({$t['label']}) タイムアウト自動返金 (v1325 watchdog)");
            } catch (Throwable $_) { $refunded = 0; }
            $msg = "🤖⚠ AI ({$t['label']}) が " . WD_MAX_RETRY . " 回リトライしても完了せず、 断念しました" .
                   ($refunded > 0 ? " (返金: {$refunded}pt)" : "") .
                   "。 もう一度お試しください (job#{$id})";
            try { notify_safely($pdo, $cfg, $uid, 'admin_notice', $msg, $t['ref_type'], $id); } catch (Throwable $_) {}
            fwrite(STDERR, "[ai_watchdog] gave-up {$t['tbl']}#{$id} uid={$uid} refunded={$refunded}\n");
            $handled++;
            continue;
        }
        // 再実行 (retry_count++ + last_attempt_at=NOW() は endpoint 呼ぶ 前 に セット)
        $pdo->prepare("UPDATE {$t['tbl']} SET retry_count=retry_count+1, last_attempt_at=NOW() WHERE id=?")
            ->execute([$id]);
        $rcNew = $rc + 1;
        if ($t['retry_url']) {
            // v1327 完全自動: curl で /api/ai/{sub}/{id}/retry を internal auth で 叩く
            $res = invoke_retry_endpoint($t['retry_url'], $id, $internalSecret);
            if ($res['ok']) {
                $msg = "🤖🔁 AI ({$t['label']}) が 15 分 応答なし → 自動再実行 (リトライ {$rcNew}/" . WD_MAX_RETRY . ", 課金なし)";
                fwrite(STDERR, "[ai_watchdog] auto-retry {$t['tbl']}#{$id} uid={$uid} attempt={$rcNew} ok\n");
            } else {
                // curl 失敗 は pending 戻し に 落ちる
                $pdo->prepare("UPDATE {$t['tbl']} SET status='pending' WHERE id=?")->execute([$id]);
                $msg = "🤖⏳ AI ({$t['label']}) が 15 分 応答なし で 停止 (リトライ {$rcNew}/" . WD_MAX_RETRY . ")、 自動再実行 に 失敗 (http={$res['http_code']})。 該当ページ から 「再実行」して ください";
                fwrite(STDERR, "[ai_watchdog] auto-retry FAILED {$t['tbl']}#{$id} http={$res['http_code']} err={$res['err']}\n");
            }
        } else {
            // paper_review 系: 現行 の pending 戻し + 半自動 継続
            $pdo->prepare("UPDATE {$t['tbl']} SET status='pending' WHERE id=?")->execute([$id]);
            $msg = "🤖⏳ AI ({$t['label']}) が 15 分 応答なし で 停止判定 (job#{$id}、 リトライ {$rcNew}/" . WD_MAX_RETRY . ")。 pending に 戻しました、 該当ページ から 「再実行」を 試して ください";
        }
        try { notify_safely($pdo, $cfg, $uid, 'admin_notice', $msg, $t['ref_type'], $id); } catch (Throwable $_) {}
        $handled++;
    }
}

fwrite(STDERR, "[ai_watchdog] done {$now} handled={$handled}\n");
