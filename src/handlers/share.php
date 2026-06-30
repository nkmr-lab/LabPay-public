<?php
// /api/share — v853 任意のページを別ユーザに「送る」簡易共有エンドポイント。
//   POST /api/share/notify-users  body { user_ids:[..], title, hash_url, message? }
//     → 指定ユーザに admin_notice で URL + 一言メッセージを通知
declare(strict_types=1);

function route_share(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if ($method === 'POST' && ($seg[1] ?? '') === 'notify-users') {
        share_notify_users($pdo, $cfg, $u, $uid);
        return;
    }
    json_error('not_found', "no share route for $method", 404);
}

function share_notify_users(PDO $pdo, array $cfg, array $sender, int $senderUid): void {
    $body = read_json_body();
    $uids = $body['user_ids'] ?? [];
    if (!is_array($uids) || !$uids) {
        throw new ApiException('bad_request', 'user_ids が空', 400);
    }
    if (count($uids) > 50) {
        throw new ApiException('bad_request', '一度に送れるのは 50 人まで', 400);
    }
    $title = trim((string)($body['title'] ?? ''));
    $hashUrl = trim((string)($body['hash_url'] ?? ''));
    $message = trim((string)($body['message'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) {
        throw new ApiException('bad_request', 'title 1〜300 文字', 400);
    }
    if ($hashUrl === '' || mb_strlen($hashUrl) > 500) {
        throw new ApiException('bad_request', 'hash_url 1〜500 文字', 400);
    }
    if (mb_strlen($message) > 500) {
        throw new ApiException('bad_request', 'message 500 文字まで', 400);
    }
    if ($hashUrl[0] !== '#') $hashUrl = '#' . $hashUrl;
    $senderName = (string)($sender['display_name'] ?? '?');
    $msgBody = "📤 {$senderName} さんから共有: 「{$title}」"
        . ($message !== '' ? "\n💬 {$message}" : '')
        . "\n→ {$hashUrl}";
    $sent = 0;
    foreach ($uids as $rawUid) {
        $toUid = (int)$rawUid;
        if ($toUid <= 0 || $toUid === $senderUid) continue;
        try {
            // notify_safely があればそちら、なければ Notifier::notify
            if (function_exists('notify_safely')) {
                notify_safely($pdo, $cfg, $toUid, 'admin_notice', $msgBody, 'share', 0);
            } else {
                Notifier::notify($pdo, $cfg, $toUid, 'admin_notice', $msgBody, 'share', 0);
            }
            $sent++;
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'sent' => $sent]);
}
