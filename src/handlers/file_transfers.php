<?php
// v733 #342 相手指定のファイル送受信機能。
//   - 送信時にファイル + メッセージ + 受信者を指定
//   - 受信者がダウンロードすると download_count + first_downloaded_at が記録される
//   - 既存の原稿チェック / 査読などは file_transfers.id を参照することで連携可能 (今後)

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
const FT_MAX_BYTES = 100 * 1024 * 1024; // v744 #355 100 MB

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
                   f.batch_id,
                   us.display_name AS sender_name,    us.avatar_url AS sender_avatar,
                   ur.display_name AS recipient_name, ur.avatar_url AS recipient_avatar
              FROM file_transfers f
              JOIN users us ON us.id = f.sender_user_id
              JOIN users ur ON ur.id = f.recipient_user_id
             WHERE f.deleted_at IS NULL
               AND (f.sender_user_id = ? OR f.recipient_user_id = ?)
          ORDER BY f.sent_at DESC LIMIT 400";
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
        'batch_id'            => $r['batch_id'] !== null ? (int)$r['batch_id'] : null,
        'is_mine_sent'        => (int)$r['sender_user_id']    === $uid,
        'is_mine_recv'        => (int)$r['recipient_user_id'] === $uid,
    ], $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function ft_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // v742 #353 複数受信者対応。 recipient_user_ids[] が来たら配列、 旧互換で
    //   recipient_user_id 単数も受ける。 1 ファイルアップロード = 同じ batch_id で
    //   N 行 INSERT (= 受信者ごとに download 状況を個別に持つ)。
    $recipientIds = [];
    if (isset($_POST['recipient_user_ids']) && is_array($_POST['recipient_user_ids'])) {
        foreach ($_POST['recipient_user_ids'] as $rid) {
            $r = (int)$rid;
            if ($r > 0) $recipientIds[] = $r;
        }
    } elseif (isset($_POST['recipient_user_id'])) {
        $r = (int)$_POST['recipient_user_id'];
        if ($r > 0) $recipientIds[] = $r;
    }
    $recipientIds = array_values(array_unique($recipientIds));
    if (empty($recipientIds)) throw new ApiException('bad_request', 'recipient_user_id(s) 必須', 400);
    $meId = (int)$u['id'];
    foreach ($recipientIds as $r) {
        if ($r === $meId) throw new ApiException('bad_request', '自分には送れません', 400);
    }
    // 全員 humans であることを確認
    $place = implode(',', array_fill(0, count($recipientIds), '?'));
    $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE kind='human' AND id IN ($place)");
    $chk->execute($recipientIds);
    if ((int)$chk->fetchColumn() !== count($recipientIds)) {
        throw new ApiException('bad_request', '宛先ユーザーが見つかりません', 400);
    }
    $body = isset($_POST['body']) ? mb_substr(trim((string)$_POST['body']), 0, 2000) : null;
    if ($body === '') $body = null;

    // v735 #345 フォルダ送信対応: files[] が来たら zip にまとめる。
    //   単一 file (旧互換) は従来通り save_uploaded_file。
    if (!empty($_FILES['files']) && is_array($_FILES['files']['tmp_name'] ?? null)) {
        if (!class_exists('ZipArchive')) {
            throw new ApiException('not_supported', 'サーバに ZipArchive がありません (PHP zip 拡張未導入)', 500);
        }
        $tmpNames = $_FILES['files']['tmp_name'];
        $origNames = $_FILES['files']['name'];
        $sizes     = $_FILES['files']['size'];
        $errors    = $_FILES['files']['error'];
        $n = count($tmpNames);
        if ($n === 0) throw new ApiException('no_file', 'ファイル必須', 400);
        $paths = [];
        if (!empty($_POST['paths'])) {
            $j = json_decode((string)$_POST['paths'], true);
            if (is_array($j)) $paths = $j;
        }
        $totalSize = 0;
        for ($i = 0; $i < $n; $i++) {
            if ((int)$errors[$i] !== UPLOAD_ERR_OK) throw new ApiException('upload_error', "ファイル {$i} アップロード失敗", 400);
            $totalSize += (int)$sizes[$i];
        }
        if ($totalSize > FT_MAX_BYTES) {
            $mb = (int)round(FT_MAX_BYTES / 1024 / 1024);
            throw new ApiException('too_large', "合計サイズが {$mb}MB を超えています", 413);
        }
        // root folder の名前を decide。 v743 #354 フォルダなし (= 単純複数ファイル) なら
        //   'files.zip' に。 フォルダドロップなら最初のパス先頭を採用。
        $hasFolderStruct = false;
        foreach ($paths as $p) {
            if (is_string($p) && str_contains($p, '/')) { $hasFolderStruct = true; break; }
        }
        $folderName = 'files';
        if ($hasFolderStruct && !empty($paths[0])) {
            $first = (string)$paths[0];
            $folderName = explode('/', $first, 2)[0];
        }
        $folderName = preg_replace('/[^\w.-]+/u', '_', $folderName) ?: 'files';
        // tmp zip を作る
        $tmpZip = tempnam(sys_get_temp_dir(), 'ft_') . '.zip';
        $zip = new ZipArchive();
        if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new ApiException('zip_error', 'zip 作成失敗', 500);
        }
        for ($i = 0; $i < $n; $i++) {
            $rel = $paths[$i] ?? $origNames[$i];
            $rel = ltrim((string)$rel, '/');
            // 危険な .. を除去
            $rel = str_replace(['../', '..\\'], '', $rel);
            if ($rel === '') $rel = $origNames[$i];
            $zip->addFile($tmpNames[$i], $rel);
        }
        $zip->close();
        // public/uploads/transfers/ に移動
        $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
        $dir = $publicDir . '/uploads/transfers';
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            @unlink($tmpZip);
            throw new ApiException('mkdir_failed', 'upload dir 作成失敗', 500);
        }
        $stored = bin2hex(random_bytes(12)) . '.zip';
        $dest = $dir . '/' . $stored;
        if (!rename($tmpZip, $dest)) {
            @unlink($tmpZip);
            throw new ApiException('save_failed', 'zip 保存失敗', 500);
        }
        @chmod($dest, 0644);
        $size = filesize($dest);
        $originalName = $folderName . '.zip';
        $relPath = '/uploads/transfers/' . $stored;
        $mime    = 'application/zip';
    } else {
        if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
            throw new ApiException('no_file', 'multipart field "file" もしくは "files[]" が必要です', 400);
        }
        $originalName = mb_substr((string)($_FILES['file']['name'] ?? 'file'), 0, 255);
        $saved = save_uploaded_file($_FILES['file'], 'uploads/transfers', FT_MAX_BYTES, FT_MIME_ALLOW);
        $relPath = (string)$saved['path'];
        $mime    = (string)$saved['mime'];
        $size    = (int)$saved['size'];
    }

    // batch_id = 「同じ送信アクション」 を識別する値。 一括 INSERT 後に一番古い id
    //   を batch_id として全行に書き戻す (= UI 側で同一 batch をまとめて表示)。
    $ins = $pdo->prepare("INSERT INTO file_transfers
        (sender_user_id, recipient_user_id, file_path, original_name, file_size, mime_type, body, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
    $insertedIds = [];
    foreach ($recipientIds as $rid) {
        $ins->execute([$meId, $rid, $relPath, $originalName, $size, $mime, $body]);
        $insertedIds[] = (int)$pdo->lastInsertId();
    }
    $batchId = $insertedIds[0];
    if (count($insertedIds) > 1) {
        $upPlace = implode(',', array_fill(0, count($insertedIds), '?'));
        $up = $pdo->prepare("UPDATE file_transfers SET batch_id=? WHERE id IN ($upPlace)");
        $up->execute(array_merge([$batchId], $insertedIds));
    } else {
        $pdo->prepare("UPDATE file_transfers SET batch_id=? WHERE id=?")->execute([$batchId, $batchId]);
    }
    foreach ($insertedIds as $i => $rowId) {
        $rid = $recipientIds[$i];
        try {
            notify_safely($pdo, $cfg, $rid, 'admin_notice',
                "📦 {$u['display_name']} さんからファイル 「{$originalName}」 が届きました",
                'file_transfer', $rowId);
        } catch (Throwable $_) {}
    }
    json_response(['ids' => $insertedIds, 'batch_id' => $batchId, 'recipient_count' => count($insertedIds)]);
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
    if (!$row) throw new ApiException('not_found', 'ファイルが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['sender_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '送信者または admin のみ削除可', 403);
    }
    $pdo->prepare("UPDATE file_transfers SET deleted_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
