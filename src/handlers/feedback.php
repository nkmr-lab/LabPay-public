<?php
// /api/feedback — bug reports and feature requests submitted from the app.
// Posts go straight to the admin's notification inbox so they see them on
// next visit. Body capped at 4000 chars so a runaway paste can't fill the
// table.

declare(strict_types=1);

function route_feedback(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'POST') {
        feedback_create($pdo, $cfg);
        return;
    }
    if ($sub === '' && $method === 'GET') {
        feedback_list($pdo, $cfg);
        return;
    }
    $id = (int)$sub;
    if ($id > 0 && ($seg[2] ?? '') === 'reply' && $method === 'POST') {
        feedback_reply($pdo, $cfg, $id);
        return;
    }
    // v407 Claude 自動対応 ワークフロー
    if ($id > 0 && ($seg[2] ?? '') === 'claude_status' && $method === 'PATCH') {
        feedback_claude_set_status($pdo, $cfg, $id);
        return;
    }
    // v438 外部 ポーラ用 queue 状態 endpoint (認証なし / count + 最古 age のみ 露出 / 個人情報なし)
    if ($sub === 'claude_queue' && $method === 'GET') {
        feedback_claude_queue_status($pdo);
        return;
    }
    // v453 管理画面 用 Claude ダッシュボード — 最終巡回時刻 / 直近完了 / approved 一覧 (body 含む)
    if ($sub === 'claude_dashboard' && $method === 'GET') {
        feedback_claude_dashboard($pdo, $cfg);
        return;
    }
    json_error('not_found', "no feedback route for $method $sub", 404);
}

// v465 → v470 feedback 完了 を SNS の LabPay 公式 アカウント として 投稿。
// v470: $shortMessage は 「〇〇 を 〇〇 したよ!」 的に 完結 した 1 文。 全文 サマリ
// (feedback テーブル の reply_body) と は 別物。 SNS は 流し読み される ので
//   🐛 タイマー音 直したよ!
//   ✨ 〆切 編集 + 参加者追加 できる ように したよ!
//   🛠 @abe さん、 バグ 直したよ!
//   🎁 @abe さん、 リクエスト やってみた!
// の 1 行 で 出す。 (feedback #N) などの 機械っぽい 余白は 入れない。
function feedback_post_release_to_sns(PDO $pdo, int $fbId, string $shortMessage): void {
    try {
        $st = $pdo->query("SELECT id FROM users WHERE display_name='LabPay' AND kind='system' LIMIT 1");
        $labpayUid = (int)$st->fetchColumn();
        if ($labpayUid <= 0) {
            $pdo->prepare("INSERT INTO users (display_name, email, role, kind, created_at) VALUES ('LabPay','labpay-system@localhost','member','system',NOW())")
                ->execute();
            $labpayUid = (int)$pdo->lastInsertId();
        }
        $stF = $pdo->prepare("SELECT f.user_id, f.kind, u.display_name, u.role
                                FROM feedback f JOIN users u ON u.id = f.user_id
                               WHERE f.id = ?");
        $stF->execute([$fbId]);
        $fb = $stF->fetch(PDO::FETCH_ASSOC) ?: [];
        $authorName = (string)($fb['display_name'] ?? '');
        $isAdminAuthor = ((string)($fb['role'] ?? '')) === 'admin';
        $isBug = ((string)($fb['kind'] ?? '')) === 'bug';
        $stP = $pdo->prepare("SELECT id FROM posts WHERE feedback_id=? AND user_id <> ? ORDER BY id ASC LIMIT 1");
        $stP->execute([$fbId, $labpayUid]);
        $src = $stP->fetch(PDO::FETCH_ASSOC);
        $parentId = $src ? (int)$src['id'] : null;
        // 1 行 文面
        $msg = mb_substr(trim($shortMessage), 0, 280);
        if ($isAdminAuthor) {
            $emoji = $isBug ? '🐛' : '✨';
            $bodyTxt = "{$emoji} {$msg}";
        } else {
            $mention = $authorName !== '' ? "@{$authorName} さん、 " : '';
            $emoji = $isBug ? '🛠' : '🎁';
            $bodyTxt = "{$emoji} {$mention}{$msg}";
        }
        $ins = $pdo->prepare("INSERT INTO posts (user_id, body, parent_id, feedback_id, created_at)
                              VALUES (?, ?, ?, ?, NOW())");
        $ins->execute([$labpayUid, $bodyTxt, $parentId, $fbId]);
    } catch (Throwable $_) { /* swallow */ }
}

// v453 管理画面 用 ダッシュボード。 admin のみ。 内容:
//  - last_polled_at: /api/feedback/claude_queue が 最後に 叩かれた 時刻
//  - last_done:      直近 done の id + summary + finished_at
//  - approved / working 一覧 (id, kind, age, body 抜粋)
function feedback_claude_dashboard(PDO $pdo, array $cfg): void {
    Auth::requireAdmin($pdo, $cfg);
    $pollFile = '/var/www/labpay/var/claude_last_poll.txt';
    $lastPollFile = is_readable($pollFile) ? (string) trim((string)@file_get_contents($pollFile)) : null;
    $stD = $pdo->query("SELECT id, claude_summary, claude_finished_at
                          FROM feedback
                         WHERE claude_status='done' AND claude_finished_at IS NOT NULL
                         ORDER BY claude_finished_at DESC LIMIT 1");
    $lastDone = $stD->fetch(PDO::FETCH_ASSOC) ?: null;
    if ($lastDone) $lastDone['id'] = (int)$lastDone['id'];
    // v515 #141 「最終 巡回」 = MAX(claude_last_poll.txt, MAX(claude_finished_at))
    //   ファイル経由のヘルスチェックを実装してない巡回方法 (= 私が SQL を直接読みに行く形)
    //   でも 完了タイムスタンプが入っていれば 「Claude は生きてる」 とみなす。
    $lastPoll = $lastPollFile;
    if ($lastDone && !empty($lastDone['claude_finished_at'])) {
        $finishedIso = date('c', strtotime((string)$lastDone['claude_finished_at']));
        if ($lastPoll === null || strtotime($finishedIso) > strtotime($lastPoll)) {
            $lastPoll = $finishedIso;
        }
    }

    $stQ = $pdo->prepare("
        SELECT id, kind, user_id, claude_status, claude_assigned_at, claude_started_at,
               LEFT(body, 200) AS body_preview,
               TIMESTAMPDIFF(SECOND,
                 COALESCE(claude_started_at, claude_assigned_at),
                 NOW()) AS age_sec
          FROM feedback
         WHERE claude_status IN ('approved','working')
         ORDER BY COALESCE(claude_started_at, claude_assigned_at) ASC
         LIMIT 50");
    $stQ->execute();
    $items = array_map(fn($r) => [
        'id'              => (int)$r['id'],
        'kind'            => (string)$r['kind'],
        'user_id'         => (int)$r['user_id'],
        'claude_status'   => (string)$r['claude_status'],
        'assigned_at'     => $r['claude_assigned_at'],
        'started_at'      => $r['claude_started_at'],
        'age_seconds'     => (int)$r['age_sec'],
        'body_preview'    => (string)$r['body_preview'],
    ], $stQ->fetchAll(PDO::FETCH_ASSOC));

    json_response([
        'last_polled_at' => $lastPoll,
        'last_done'      => $lastDone,
        'queue_items'    => $items,
        'server_now'     => date('c'),
    ]);
}

// GET /api/feedback/claude_queue
//   無認証。 「Claude に approved 状態の feedback が ある か」 を 外部から polling
//   する 用。 個人情報を 露出しない (個数 + working/approved の 最古 age のみ)。
//   外部 アプリ (GitHub Actions / 自前 lambda / ...) で polling し、 状態変化 を
//   検出して 端末側 オートメーション を キックする 設計。
function feedback_claude_queue_status(PDO $pdo): void {
    // v453 巡回した 瞬間 を 記録 (= 「最後に Claude が 来た 時刻」)。 ファイル書き込み
    // 失敗 は 黙殺 (= ダッシュボード が 古いまま でも 機能 を 止めない)。
    @file_put_contents('/var/www/labpay/var/claude_last_poll.txt', date('c'));
    $st = $pdo->query("
        SELECT
          (SELECT COUNT(*) FROM feedback WHERE claude_status='approved') AS approved_count,
          (SELECT COUNT(*) FROM feedback WHERE claude_status='working')  AS working_count,
          (SELECT TIMESTAMPDIFF(SECOND, MIN(claude_assigned_at), NOW())
             FROM feedback WHERE claude_status='approved')                AS oldest_approved_age_s,
          (SELECT TIMESTAMPDIFF(SECOND, MIN(claude_started_at), NOW())
             FROM feedback WHERE claude_status='working')                 AS oldest_working_age_s");
    $r = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $approved = (int)($r['approved_count'] ?? 0);
    $working  = (int)($r['working_count']  ?? 0);
    json_response([
        'has_work'                  => ($approved > 0 || $working > 0),
        'approved_count'            => $approved,
        'working_count'             => $working,
        'oldest_approved_age_seconds' => $r['oldest_approved_age_s'] !== null ? (int)$r['oldest_approved_age_s'] : null,
        'oldest_working_age_seconds'  => $r['oldest_working_age_s']  !== null ? (int)$r['oldest_working_age_s']  : null,
        'server_now'                => date('c'),
    ]);
}

// admin が 「Claude に 任せる」 / 「取り消す」 を トグル。
// body: { status: 'none' | 'approved' | 'blocked' }
// approved の とき claude_assigned_at を セット。 cron が 'approved' を 拾って
// 'working' → 'done' に 進める。 'blocked' は 巡回除外 (admin が none に戻して 再投入)。
function feedback_claude_set_status(PDO $pdo, array $cfg, int $id): void {
    Auth::requireAdmin($pdo, $cfg);
    $body = read_json_body();
    $status = (string)($body['status'] ?? '');
    $allowed = ['none', 'approved', 'blocked'];
    if (!in_array($status, $allowed, true)) {
        throw new ApiException('bad_request', "status must be one of: " . implode(',', $allowed), 400);
    }
    $st = $pdo->prepare("SELECT claude_status FROM feedback WHERE id = ?");
    $st->execute([$id]);
    $cur = $st->fetchColumn();
    if ($cur === false) throw new ApiException('not_found', 'feedback not found', 404);
    // working / done からの 上書きは 安全のため admin が none で 一旦 戻す 必要あり
    if (in_array($cur, ['working','done'], true) && $status === 'approved') {
        throw new ApiException('bad_request', "working / done からは 直接 approved に 戻せません (一度 none に)", 400);
    }
    if ($status === 'approved') {
        // v431 「Claude に 任せる」 を 押した admin id を 記録 → 完了時に reply の
        // replied_by_user_id に 使う。
        $admin = Auth::requireAdmin($pdo, $cfg);
        $pdo->prepare("UPDATE feedback SET claude_status='approved', claude_assigned_at=NOW(),
            claude_assigned_by_user_id=? WHERE id = ?")->execute([(int)$admin['id'], $id]);
        // v438 出張中でも 「approved 入った」 のを 即知るために Slack 通知。
        try {
            $stF = $pdo->prepare("SELECT f.kind, f.body, u.display_name AS user_name
                                    FROM feedback f JOIN users u ON u.id = f.user_id
                                   WHERE f.id = ?");
            $stF->execute([$id]);
            $f = $stF->fetch(PDO::FETCH_ASSOC);
            if ($f) {
                $kindLbl = Labels::feedbackKind((string)$f['kind']);
                $snip = mb_substr((string)$f['body'], 0, 100) . (mb_strlen((string)$f['body']) > 100 ? '…' : '');
                slack_notify($cfg, "✅ Claude に 任せました: {$kindLbl} #{$id} ({$f['user_name']})\n>>> {$snip}\n\n→ 次の cron tick (最大 10 分) で 着手 します", null, '#/feedback-admin');
            }
        } catch (Throwable $_) { /* swallow */ }
    } else {
        Auth::requireAdmin($pdo, $cfg);
        $pdo->prepare("UPDATE feedback SET claude_status=? WHERE id = ?")
            ->execute([$status, $id]);
    }
    json_response(['ok' => true, 'status' => $status]);
}

// admin 専用: 最近の feedback 一覧 (返信状態付き)
function feedback_list(PDO $pdo, array $cfg): void {
    Auth::requireAdmin($pdo, $cfg);
    $st = $pdo->query("
        SELECT f.id, f.kind, f.body, f.url, f.user_agent, f.created_at,
               f.replied_at, f.reply_body, f.replied_by_user_id,
               f.claude_status, f.claude_assigned_at, f.claude_started_at,
               f.claude_finished_at, f.claude_summary,
               u.display_name AS user_name, u.avatar_url AS user_avatar_url,
               ub.display_name AS replied_by_name
          FROM feedback f
          JOIN users u ON u.id = f.user_id
          LEFT JOIN users ub ON ub.id = f.replied_by_user_id
         ORDER BY f.id DESC LIMIT 100");
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

// admin が feedback に返信。投稿者には「対応したよ」通知が届く。
function feedback_reply(PDO $pdo, array $cfg, int $id): void {
    $admin = Auth::requireAdmin($pdo, $cfg);
    $body = read_json_body();
    $reply = trim((string)require_field($body, 'reply'));
    if ($reply === '' || mb_strlen($reply) > 4000) {
        throw new ApiException('bad_request', 'reply length 1..4000', 400);
    }
    $st = $pdo->prepare("SELECT user_id, body, kind FROM feedback WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'feedback not found', 404);

    $pdo->prepare("UPDATE feedback SET replied_at=NOW(), reply_body=?, replied_by_user_id=? WHERE id=?")
        ->execute([$reply, $admin['id'], $id]);

    $kindLabel = Labels::feedbackKind((string)$row['kind']);
    $origSnip = mb_substr((string)$row['body'], 0, 60) . (mb_strlen((string)$row['body']) > 60 ? '…' : '');
    $msg = "✅ あなたの {$kindLabel}「{$origSnip}」 に {$admin['display_name']} さんから返信:\n{$reply}";
    notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice', $msg, 'feedback', $id);

    json_response(['ok' => true]);
}

function feedback_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = trim((string)require_field($body, 'body'));
    $kind = (string)($body['kind'] ?? 'other');
    if (!isset(Labels::FEEDBACK_KIND[$kind])) $kind = 'other';
    if ($text === '' || mb_strlen($text) > 4000) {
        throw new ApiException('bad_request', 'body length 1..4000', 400);
    }
    $url = isset($body['url']) ? mb_substr((string)$body['url'], 0, 500) : null;
    $ua  = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);

    // v465 admin が 自分 で 機能要望 / バグ報告 を 投稿 した 場合 は 承認手順 を
    // 省いて 即 claude_status='approved' に。 cron 巡回 で すぐ 着手 されるよう に。
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($isAdmin) {
        $ins = $pdo->prepare("INSERT INTO feedback
            (user_id, kind, body, user_agent, url,
             claude_status, claude_assigned_at, claude_assigned_by_user_id)
            VALUES (?, ?, ?, ?, ?, 'approved', NOW(), ?)");
        $ins->execute([$u['id'], $kind, $text, $ua ?: null, $url, (int)$u['id']]);
    } else {
        $ins = $pdo->prepare("INSERT INTO feedback (user_id, kind, body, user_agent, url)
            VALUES (?,?,?,?,?)");
        $ins->execute([$u['id'], $kind, $text, $ua ?: null, $url]);
    }
    $fbId = (int)$pdo->lastInsertId();

    // Notify every admin so it's not solo-dependent on one person being awake.
    $kindLabel = Labels::feedbackKind($kind);
    $snippet = mb_substr($text, 0, 80) . (mb_strlen($text) > 80 ? '…' : '');
    $msg = "{$kindLabel} ({$u['display_name']}): {$snippet}";
    notify_admins($pdo, $cfg, 'admin_notice', $msg, 'feedback', $fbId);

    // v547 #208 投稿者が中村聡史 (= 自分) の場合、 Slack 通知は不要 (自分で投稿 →
    //   自分の Slack に通知されると 二度手間)。 表示名を 部分一致でガード。
    $authorName = (string)$u['display_name'];
    $isSelfAuthor = (strpos($authorName, '中村聡史') !== false);
    if (!$isSelfAuthor) {
        try {
            slack_notify($cfg, "{$kindLabel} from *{$authorName}*\n>>> " . $text, null, '#/feedback-admin');
        } catch (Throwable $e) { /* swallow */ }
    }

    json_response(['ok' => true, 'id' => $fbId]);
}
