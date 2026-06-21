<?php
// v733 #342 相手指定のファイル送受信機能。
//   - 送信時にファイル + メッセージ + 受信者 を指定
//   - 受信者がダウンロードすると download_count + first_downloaded_at が記録される
//   - 既存の原稿チェック / 査読 などは file_transfers.id を参照することで連携可能 (今後)

const FT_MIME_ALLOW = [
    'application/pdf' => 'pdf',
    'application/msword' => 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
    'application/vnd.ms-excel' => 'xls',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
    'application/vnd.ms-powerpoint' => 'ppt',
    'text/plain' => 'txt',
    'text/csv' => 'csv',
    'text/markdown' => 'md',
    'application/json' => 'json',
    'application/zip' => 'zip',
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const FT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function route_file_transfers(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { ft_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { ft_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === 'download' && $method === 'GET') { ft_download($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE')      { ft_delete($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no file-transfers route for $method $sub", 404);
}

function ft_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sql = "SELECT f.id, f.sender_user_id, f.recipient_user_id, f.file_path, f.original_name,
                   f.file_size, f.mime_type, f.body, f.sent_at, f.first_downloaded_at, f.download_count,
                   us.display_name AS sender_name,    us.avatar_url AS sender_avatar,
                   ur.display_name AS recipient_name, ur.avatar_url AS recipient_avatar
              FROM file_transfers f
              JOIN users us ON us.id = f.sender_user_id
              JOIN users ur ON ur.id = f.recipient_user_id
             WHERE f.deleted_at IS NULL
               AND (f.sender_user_id = ? OR f.recipient_user_id = ?)
          ORDER BY f.sent_at DESC LIMIT 200";
    $st = $pdo->prepare($sql);
    $st->execute([$uid, $uid]);
    $items = array_map(fn($r) => [
        'id'                  => (int)$r['id'],
        'sender_user_id'      => (int)$r['sender_user_id'],
        'sender_name'         => $r['sender_name'],
        'sender_avatar'       => $r['sender_avatar'],
        'recipient_user_id'   => (int)$r['recipient_user_id'],
        'recipient_name'      => $r['recipient_name'],
        'recipient_avatar'    => $r['recipient_avatar'],
        'file_path'           => $r['file_path'],
        'original_name'       => $r['original_name'],
        'file_size'           => (int)$r['file_size'],
        'mime_type'           => $r['mime_type'],
        'body'                => $r['body'],
        'sent_at'             => $r['sent_at'],
        'first_downloaded_at' => $r['first_downloaded_at'],
        'download_count'      => (int)$r['download_count'],
        'is_mine_sent'        => (int)$r['sender_user_id']    === $uid,
        'is_mine_recv'        => (int)$r['recipient_user_id'] === $uid,
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function ft_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        throw new ApiException('no_file', 'multipart field "file" 必須', 400);
    }
    $recipient = (int)($_POST['recipient_user_id'] ?? 0);
    if ($recipient <= 0) throw new ApiException('bad_request', 'recipient_user_id 必須', 400);
    if ($recipient === (int)$u['id']) throw new ApiException('bad_request', '自分には送れません', 400);
    $chk = $pdo->prepare("SELECT 1 FROM users WHERE id=? AND kind='human'");
    $chk->execute([$recipient]);
    if (!$chk->fetchColumn()) throw new ApiException('bad_request', '宛先ユーザーが見つかりません', 400);
    $body = isset($_POST['body']) ? mb_substr(trim((string)$_POST['body']), 0, 2000) : null;
    if ($body === '') $body = null;
    $originalName = mb_substr((string)($_FILES['file']['name'] ?? 'file'), 0, 255);

    $saved = save_uploaded_file($_FILES['file'], 'uploads/transfers', FT_MAX_BYTES, FT_MIME_ALLOW);

    $ins = $pdo->prepare("INSERT INTO file_transfers
        (sender_user_id, recipient_user_id, file_path, original_name, file_size, mime_type, body, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
    $ins->execute([
        (int)$u['id'], $recipient,
        (string)$saved['path'], $originalName,
        (int)$saved['size'], (string)$saved['mime'], $body
    ]);
    $id = (int)$pdo->lastInsertId();
    try {
        notify_safely($pdo, $cfg, $recipient, 'admin_notice',
            "📦 {$u['display_name']} さんから ファイル 「{$originalName}」 が届きました",
            'file_transfer', $id);
    } catch (Throwable $_) {}
    json_response(['id' => $id]);
}

function ft_download(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT * FROM file_transfers WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'ファイルが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['recipient_user_id'] !== $uid && (int)$row['sender_user_id'] !== $uid && !$isAdmin) {
        throw new ApiException('forbidden', '宛先 / 送信者 / admin のみダウンロード可', 403);
    }
    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $abs = $publicDir . $row['file_path'];
    if (!is_file($abs)) throw new ApiException('not_found', 'ファイル本体が見つかりません', 404);
    // 受信者がダウンロードした時だけカウント (送信者の確認ダウンロードはカウントしない)
    if ((int)$row['recipient_user_id'] === $uid) {
        if ($row['first_downloaded_at'] === null) {
            $pdo->prepare("UPDATE file_transfers SET first_downloaded_at=NOW(), download_count=download_count+1 WHERE id=?")->execute([$id]);
        } else {
            $pdo->prepare("UPDATE file_transfers SET download_count=download_count+1 WHERE id=?")->execute([$id]);
        }
    }
    while (ob_get_level() > 0) ob_end_clean();
    $mime = (string)($row['mime_type'] ?: 'application/octet-stream');
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($abs));
    header('Content-Disposition: attachment; filename="' . rawurlencode($row['original_name']) . '"');
    readfile($abs);
    exit;
}

function ft_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT sender_user_id, recipient_user_id FROM file_transfers WHERE id=? AND deleted_at IS NULL");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'ファイル が 見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['sender_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '送信者または admin のみ削除可', 403);
    }
    $pdo->prepare("UPDATE file_transfers SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
