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
    json_error('not_found', "no feedback route for $method $sub", 404);
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
        $pdo->prepare("UPDATE feedback SET claude_status='approved', claude_assigned_at=NOW()
            WHERE id = ?")->execute([$id]);
    } else {
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

    $ins = $pdo->prepare("INSERT INTO feedback (user_id, kind, body, user_agent, url)
        VALUES (?,?,?,?,?)");
    $ins->execute([$u['id'], $kind, $text, $ua ?: null, $url]);
    $fbId = (int)$pdo->lastInsertId();

    // Notify every admin so it's not solo-dependent on one person being awake.
    $kindLabel = Labels::feedbackKind($kind);
    $snippet = mb_substr($text, 0, 80) . (mb_strlen($text) > 80 ? '…' : '');
    $msg = "{$kindLabel} ({$u['display_name']}): {$snippet}";
    notify_admins($pdo, $cfg, 'admin_notice', $msg, 'feedback', $fbId);

    // And blast to Slack so admin sees it on their phone immediately.
    try {
        slack_notify($cfg, "{$kindLabel} from *{$u['display_name']}*\n>>> " . $text);
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true, 'id' => $fbId]);
}
