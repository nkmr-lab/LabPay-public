<?php
// v1251 AI サブスク (1 週間 単位 500pt、 自動更新)。 中村さん要望 「AI の サブスク を 契約
//   しているか どうか で、 それ を 他 の 場所 から 参照 して 利用 可能 に したい。 具体的 に
//   は、 今 実現 して いる FileBrowser や ChatGPT を 模倣 した やつ (chai.nkmr.io)。 AI は
//   サブスク で 1 週間 単位 と する。 500pt 自動 引き落し、 残高 無く なる と 自動 切れ」対応。
//
// 使い方 (外部 サービス から):
//   fetch('https://pay.nkmr.io/api/ai-sub/check', { credentials: 'include' })
//     .then(r => r.json())
//     .then(j => j.active ? enableFullFeatures() : showSubscribePrompt())
//   nkmr-SSO cookie 共有 なので credentials で 通る。 CORS は 既に *.nkmr.io 許可 済。
//
// エンドポイント:
//   GET  /api/ai-sub          — 詳細 状態 (LabPay 内 UI 用)
//   POST /api/ai-sub/subscribe — 新規 契約 (500pt 即時 引き落し、 期限 +7 日、 auto_renew=1)
//   POST /api/ai-sub/cancel   — 自動更新 停止 (期限まで は 利用可)
//   POST /api/ai-sub/resume   — 自動更新 再開 (期限内 の 場合 のみ)
//   GET  /api/ai-sub/check    — 外部 サービス 用 軽量 チェック ({active, expires_at, days_left, user_id})

declare(strict_types=1);

const AI_SUB_COST = 500;
const AI_SUB_DAYS = 7;

function route_ai_sub(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')            { ai_sub_status($pdo, $cfg);   return; }
    if ($sub === 'check' && $method === 'GET')       { ai_sub_check($pdo, $cfg);    return; }
    if ($sub === 'subscribe' && $method === 'POST')  { ai_sub_subscribe($pdo, $cfg); return; }
    if ($sub === 'cancel' && $method === 'POST')     { ai_sub_cancel($pdo, $cfg);    return; }
    if ($sub === 'resume' && $method === 'POST')     { ai_sub_resume($pdo, $cfg);    return; }
    json_error('not_found', "no ai-sub route for $method $sub", 404);
}

// 現在 の 行 を 取得 (無ければ null)
function _ai_sub_row(PDO $pdo, int $uid): ?array {
    $st = $pdo->prepare("SELECT * FROM ai_subs WHERE user_id=?");
    $st->execute([$uid]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

// 行 を 「active/graceful/expired/never」に 分類
function _ai_sub_status(array $row): string {
    if (!$row) return 'never';
    $end = strtotime((string)$row['current_period_end']);
    if ($end === false || $end <= time()) return 'expired';
    if (!empty($row['canceled_at'])) return 'graceful';
    return 'active';
}

// レスポンス 用 に 整形 (詳細 版、 UI で 使う)
function _ai_sub_shape(?array $row): array {
    if (!$row) {
        return [
            'active'       => false,
            'status'       => 'never',
            'auto_renew'   => false,
            'weekly_cost'  => AI_SUB_COST,
            'period_days'  => AI_SUB_DAYS,
        ];
    }
    $status = _ai_sub_status($row);
    $end = (string)$row['current_period_end'];
    $endTs = strtotime($end) ?: 0;
    $daysLeft = $endTs > 0 ? max(0, (int)ceil(($endTs - time()) / 86400)) : 0;
    return [
        'active'                => in_array($status, ['active', 'graceful'], true),
        'status'                => $status,           // active / graceful / expired / never
        'auto_renew'            => (int)$row['auto_renew'] === 1,
        'started_at'            => $row['started_at'],
        'current_period_start'  => $row['current_period_start'],
        'current_period_end'    => $end,
        'canceled_at'           => $row['canceled_at'],
        'last_charged_at'       => $row['last_charged_at'],
        'last_charge_failed_at' => $row['last_charge_failed_at'],
        'total_paid'            => (int)$row['total_paid'],
        'cycle_count'           => (int)$row['cycle_count'],
        'days_left'             => $daysLeft,
        'weekly_cost'           => AI_SUB_COST,
        'period_days'           => AI_SUB_DAYS,
    ];
}

// ── 詳細 状態 (LabPay 内 UI 用) ────────────────────────────────
function ai_sub_status(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $row = _ai_sub_row($pdo, (int)$u['id']);
    $bal = Ledger::balanceOfUser($pdo, (int)$u['id']);
    json_response([
        'ok'              => true,
        'subscription'    => _ai_sub_shape($row),
        'balance'         => $bal,
        'can_subscribe'   => $bal >= AI_SUB_COST,
    ]);
}

// ── 外部 サービス 用 軽量 チェック ─────────────────────────────
// CORS は index.php で *.nkmr.io + credentials 許可 済 な の で そのまま 通る。
function ai_sub_check(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $row = _ai_sub_row($pdo, (int)$u['id']);
    $shape = _ai_sub_shape($row);
    // 外部 用 に は 最小限 の フィールド だけ
    json_response([
        'ok'         => true,
        'active'     => (bool)$shape['active'],
        'status'     => $shape['status'],
        'expires_at' => $row ? $row['current_period_end'] : null,
        'days_left'  => $shape['days_left'],
        'user_id'    => (int)$u['id'],
    ]);
}

// ── 新規 契約 (500pt 引き落し + 期限 +7 日) ──────────────────
function ai_sub_subscribe(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $row = _ai_sub_row($pdo, $uid);
    $status = $row ? _ai_sub_status($row) : 'never';
    if ($status === 'active') {
        // 既 に active な の で 変化 なし (二重課金 防止)
        json_response([
            'ok' => true, 'unchanged' => true,
            'subscription' => _ai_sub_shape($row),
            'balance' => Ledger::balanceOfUser($pdo, $uid),
        ]);
        return;
    }
    if ($status === 'graceful') {
        // 解約 予約 中 → resume と 同義 (auto_renew=1 に 戻す だけ、 引き落し なし)
        $pdo->prepare("UPDATE ai_subs SET auto_renew=1, canceled_at=NULL WHERE user_id=?")->execute([$uid]);
        $row2 = _ai_sub_row($pdo, $uid);
        json_response([
            'ok' => true, 'resumed' => true,
            'subscription' => _ai_sub_shape($row2),
            'balance' => Ledger::balanceOfUser($pdo, $uid),
        ]);
        return;
    }
    // never or expired → 実際 に 引き落し + 期限 設定
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < AI_SUB_COST) {
        throw new ApiException('insufficient_balance', "残高 不足 (要 " . AI_SUB_COST . "pt、 現在 {$bal}pt)", 400);
    }
    $pdo->beginTransaction();
    try {
        $userAcc = Ledger::accountIdForUser($pdo, $uid);
        $sysAcc  = Ledger::accountIdByCode($pdo, 'SYSTEM');
        Ledger::transfer($pdo, $userAcc, $sysAcc, AI_SUB_COST, 'ai_sub', 'ai_sub_period', $uid,
                         'AI サブスク (1 週間、 初回 契約)');
        $now = date('Y-m-d H:i:s');
        $end = date('Y-m-d H:i:s', strtotime('+' . AI_SUB_DAYS . ' days'));
        if ($row) {
            // 既存 行 を UPDATE (再購入 の パターン)
            $pdo->prepare(
                "UPDATE ai_subs
                    SET current_period_start=?, current_period_end=?,
                        auto_renew=1, canceled_at=NULL, last_charged_at=?, last_charge_failed_at=NULL,
                        total_paid=total_paid+?, cycle_count=cycle_count+1
                  WHERE user_id=?"
            )->execute([$now, $end, $now, AI_SUB_COST, $uid]);
        } else {
            $pdo->prepare(
                "INSERT INTO ai_subs
                    (user_id, started_at, current_period_start, current_period_end,
                     auto_renew, last_charged_at, total_paid, cycle_count)
                    VALUES (?, ?, ?, ?, 1, ?, ?, 1)"
            )->execute([$uid, $now, $now, $end, $now, AI_SUB_COST]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $row2 = _ai_sub_row($pdo, $uid);
    notify_safely($pdo, $cfg, $uid, 'admin_notice',
        '🤖 AI サブスク を 開始 しました (500pt / 週、 自動更新 ON)。 chai.nkmr.io / file.nkmr.io で 有効。',
        'ai_sub', (int)$row2['id']);
    json_response([
        'ok' => true, 'subscribed' => true,
        'subscription' => _ai_sub_shape($row2),
        'balance' => Ledger::balanceOfUser($pdo, $uid),
    ]);
}

// ── 解約 予約 (auto_renew=0、 期限まで は 使える) ───────────
function ai_sub_cancel(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $row = _ai_sub_row($pdo, $uid);
    if (!$row) throw new ApiException('not_found', 'サブスク が ありません', 404);
    $pdo->prepare("UPDATE ai_subs SET auto_renew=0, canceled_at=IFNULL(canceled_at, NOW()) WHERE user_id=?")
        ->execute([$uid]);
    $row2 = _ai_sub_row($pdo, $uid);
    json_response([
        'ok' => true, 'canceled' => true,
        'subscription' => _ai_sub_shape($row2),
        'balance' => Ledger::balanceOfUser($pdo, $uid),
    ]);
}

// ── 解約 予約 取消 (auto_renew=1 に 戻す、 期限内 の 時 のみ) ─
function ai_sub_resume(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $row = _ai_sub_row($pdo, $uid);
    if (!$row) throw new ApiException('not_found', 'サブスク が ありません', 404);
    $status = _ai_sub_status($row);
    if ($status === 'expired') {
        throw new ApiException('bad_request', '期限 切れ の ため resume できません。 subscribe を どうぞ', 400);
    }
    $pdo->prepare("UPDATE ai_subs SET auto_renew=1, canceled_at=NULL WHERE user_id=?")
        ->execute([$uid]);
    $row2 = _ai_sub_row($pdo, $uid);
    json_response([
        'ok' => true, 'resumed' => true,
        'subscription' => _ai_sub_shape($row2),
        'balance' => Ledger::balanceOfUser($pdo, $uid),
    ]);
}

// ── cron 用 の 自動 更新 処理 (bin/ai_sub_renew_cron.php から 呼ぶ) ──
// 戻り値: ['renewed'=>N, 'failed'=>N, 'skipped'=>N] の 集計
function ai_sub_run_renewals(PDO $pdo, array $cfg): array {
    $st = $pdo->prepare(
        "SELECT * FROM ai_subs
          WHERE auto_renew=1 AND current_period_end < NOW()
       ORDER BY current_period_end ASC
          LIMIT 200"
    );
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $renewed = 0; $failed = 0; $skipped = 0;
    foreach ($rows as $row) {
        $uid = (int)$row['user_id'];
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < AI_SUB_COST) {
            // 残高 不足 → 自動 解約 (auto_renew=0)、 last_charge_failed_at を 記録、 通知
            $pdo->prepare(
                "UPDATE ai_subs SET auto_renew=0, last_charge_failed_at=NOW()
                  WHERE user_id=? AND auto_renew=1"
            )->execute([$uid]);
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                '🤖 AI サブスク の 自動更新 に 失敗 しました (残高 不足: ' . $bal . 'pt / 要 ' . AI_SUB_COST . 'pt)。 手動 で 再契約 して ください。',
                'ai_sub', (int)$row['id']);
            $failed++;
            continue;
        }
        // 引き落し + 期限 延長
        $pdo->beginTransaction();
        try {
            $userAcc = Ledger::accountIdForUser($pdo, $uid);
            $sysAcc  = Ledger::accountIdByCode($pdo, 'SYSTEM');
            Ledger::transfer($pdo, $userAcc, $sysAcc, AI_SUB_COST, 'ai_sub', 'ai_sub_period', $uid,
                             'AI サブスク (1 週間、 自動更新 #' . ((int)$row['cycle_count'] + 1) . ')');
            $now = date('Y-m-d H:i:s');
            // 期限 は 「元 の 期限 + 7 日」 か 「今 + 7 日」の 遅い 方 (遅延 更新 で も 継続 感 を 保つ)
            $baseEnd = max(strtotime((string)$row['current_period_end']) ?: time(), time());
            $newEnd = date('Y-m-d H:i:s', $baseEnd + AI_SUB_DAYS * 86400);
            $pdo->prepare(
                "UPDATE ai_subs
                    SET current_period_start=?, current_period_end=?,
                        last_charged_at=?, total_paid=total_paid+?, cycle_count=cycle_count+1
                  WHERE user_id=?"
            )->execute([$now, $newEnd, $now, AI_SUB_COST, $uid]);
            $pdo->commit();
            $renewed++;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('[ai_sub cron] renew failed uid=' . $uid . ': ' . $e->getMessage());
            $skipped++;
        }
    }
    // 手動 解約 済 の 行 で 期限 が 近い もの は 事前 通知 (期限 24h 前 に 1 回)
    // (本 実装 は 簡素 に、 期限 が 12〜36 時間 後 の 行 で last_charge_failed_at が 直近
    // なく 通知 が まだ の もの に つき 1 回)。 実装 省略、 将来 拡張 可能。
    return ['renewed' => $renewed, 'failed' => $failed, 'skipped' => $skipped];
}
