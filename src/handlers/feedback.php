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
    json_error('not_found', "no feedback route for $method $sub", 404);
}

function feedback_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $text = trim((string)require_field($body, 'body'));
    $kind = (string)($body['kind'] ?? 'other');
    if (!in_array($kind, ['bug','feature','other'], true)) $kind = 'other';
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
    $kindLabel = ['bug'=>'🐛 バグ報告', 'feature'=>'✨ 機能要望', 'other'=>'💬 フィードバック'][$kind];
    $snippet = mb_substr($text, 0, 80) . (mb_strlen($text) > 80 ? '…' : '');
    $msg = "{$kindLabel} ({$u['display_name']}): {$snippet}";
    foreach ($pdo->query("SELECT id FROM users WHERE kind='human' AND role='admin'") as $r) {
        notify_safely($pdo, $cfg, (int)$r['id'], 'admin_notice', $msg, 'feedback', $fbId);
    }

    // And blast to Slack so admin sees it on their phone immediately.
    try {
        slack_notify($cfg, "{$kindLabel} from *{$u['display_name']}*\n>>> " . $text);
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true, 'id' => $fbId]);
}
