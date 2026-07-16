<?php
// v1100 /api/miro — Miro 的な共同ポストイット空間。
//   * ラボ全員が全部屋を閲覧・編集可 (LabPay 標準の共有カルチャ)
//   * 各ノート = カード 2 面 (front/back text+image は共有、side は user ごと個別)
//   * ドラッグで自由配置、拡大縮小、色変更
//   * デフォルト色は user_settings.miro_default_color に持つ
//   * ノート内で OpenAI gpt-image-1 (low) で画像生成 → 表 or 裏に差し込み
//   * 2s poll でリアルタイム更新 (server は since=updated_at で差分返す)

declare(strict_types=1);

const MIRO_MAX_NOTES_PER_ROOM = 500;   // 1 部屋の上限。 miro 実質上限なしだが練習だから
const MIRO_DEFAULT_COLOR = '#FEF9A8';
const MIRO_IMAGE_MODEL = 'gpt-image-1';

function route_miro(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    // /api/miro/rooms ...
    if ($sub === 'rooms') {
        $id = (int)($seg[2] ?? 0);
        if ($id === 0 && $method === 'GET')  { miro_rooms_list  ($pdo, $cfg); return; }
        if ($id === 0 && $method === 'POST') { miro_rooms_create($pdo, $cfg); return; }
        if ($id > 0) {
            $next = $seg[3] ?? '';
            if ($next === '' && $method === 'GET')    { miro_room_detail($pdo, $cfg, $id);         return; }
            if ($next === '' && $method === 'PATCH')  { miro_room_patch ($pdo, $cfg, $id);         return; }
            if ($next === '' && $method === 'DELETE') { miro_room_archive($pdo, $cfg, $id);        return; }
            if ($next === 'notes'   && $method === 'GET')  { miro_notes_list  ($pdo, $cfg, $id);   return; }
            if ($next === 'notes'   && $method === 'POST') { miro_notes_create($pdo, $cfg, $id);   return; }
            if ($next === 'updates' && $method === 'GET')  { miro_room_updates($pdo, $cfg, $id);   return; }
            if ($next === 'cursor'  && $method === 'POST') { miro_cursor_upsert($pdo, $cfg, $id);  return; }
        }
    }
    // /api/miro/notes/{id} ...
    if ($sub === 'notes') {
        $id = (int)($seg[2] ?? 0);
        if ($id > 0) {
            $next = $seg[3] ?? '';
            if ($next === '' && $method === 'PATCH')  { miro_note_patch ($pdo, $cfg, $id);        return; }
            if ($next === '' && $method === 'DELETE') { miro_note_delete($pdo, $cfg, $id);        return; }
            if ($next === 'flip'           && $method === 'POST') { miro_note_flip($pdo, $cfg, $id);           return; }
            if ($next === 'generate-image' && $method === 'POST') { miro_note_generate_image($pdo, $cfg, $id); return; }
        }
    }
    // /api/miro/default-color — GET/PUT
    if ($sub === 'default-color') {
        if ($method === 'GET') { miro_default_color_get($pdo, $cfg); return; }
        if ($method === 'PUT') { miro_default_color_put($pdo, $cfg); return; }
    }
    throw new ApiException('not_found', "no miro route for $method $sub", 404);
}

// ─── helpers ─────────────────────────────────────────────────────

function _miro_norm_color(?string $c, string $fallback = MIRO_DEFAULT_COLOR): string {
    $c = trim((string)$c);
    if ($c === '') return $fallback;
    if (preg_match('/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/', $c)) return strtoupper($c);
    return $fallback;
}

function _miro_room_row(PDO $pdo, int $id): ?array {
    $st = $pdo->prepare("SELECT r.id, r.title, r.description, r.bg_color, r.creator_user_id,
                                r.created_at, r.updated_at, r.archived_at,
                                u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                (SELECT COUNT(*) FROM miro_notes n WHERE n.room_id = r.id AND n.deleted_at IS NULL) AS note_count
                           FROM miro_rooms r
                      LEFT JOIN users u ON u.id = r.creator_user_id
                          WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    $r['id']              = (int)$r['id'];
    $r['creator_user_id'] = (int)$r['creator_user_id'];
    $r['note_count']      = (int)$r['note_count'];
    return $r;
}

function _miro_note_shape(array $r, ?int $mySide): array {
    return [
        'id'                => (int)$r['id'],
        'room_id'           => (int)$r['room_id'],
        'x'                 => (float)$r['x'],
        'y'                 => (float)$r['y'],
        'width'             => (float)$r['width'],
        'height'            => (float)$r['height'],
        'rotation'          => (float)$r['rotation'],
        'color'             => (string)$r['color'],
        'front_text'        => (string)($r['front_text'] ?? ''),
        'back_text'         => (string)($r['back_text']  ?? ''),
        'front_image_url'   => $r['front_image_url'] ?: null,
        'back_image_url'    => $r['back_image_url']  ?: null,
        'z_index'           => (int)$r['z_index'],
        'created_by_user_id'=> (int)$r['created_by_user_id'],
        'created_at'        => (string)$r['created_at'],
        'updated_at'        => (string)$r['updated_at'],
        'my_side'           => $mySide ?: 2,   // v1103: デフォは裏 (隠し) — Flip で表を出す
    ];
}

function _miro_load_my_flips(PDO $pdo, int $userId, int $roomId): array {
    $st = $pdo->prepare("SELECT f.note_id, f.side
                           FROM miro_note_flips f
                           JOIN miro_notes n ON n.id = f.note_id
                          WHERE n.room_id = ? AND f.user_id = ?");
    $st->execute([$roomId, $userId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['note_id']] = (int)$r['side'];
    }
    return $out;
}

// ─── rooms ───────────────────────────────────────────────────────

// GET /api/miro/rooms → 全部屋 (archived 除く、 updated_at DESC)
function miro_rooms_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT r.id, r.title, r.description, r.bg_color, r.creator_user_id,
                              r.created_at, r.updated_at,
                              u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                              (SELECT COUNT(*) FROM miro_notes n WHERE n.room_id = r.id AND n.deleted_at IS NULL) AS note_count
                         FROM miro_rooms r
                    LEFT JOIN users u ON u.id = r.creator_user_id
                        WHERE r.archived_at IS NULL
                     ORDER BY r.updated_at DESC");
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['note_count']      = (int)$r['note_count'];
        $items[] = $r;
    }
    json_response(['items' => $items]);
}

// POST /api/miro/rooms  body: { title, description?, bg_color? }
function miro_rooms_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 200) $title = mb_substr($title, 0, 200);
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > 2000) $desc = mb_substr($desc, 0, 2000);
    $bg = _miro_norm_color($body['bg_color'] ?? null, '#FAFAFA');
    $st = $pdo->prepare("INSERT INTO miro_rooms (title, description, bg_color, creator_user_id)
                         VALUES (?, ?, ?, ?)");
    $st->execute([$title, $desc ?: null, $bg, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    json_response(['id' => $id, 'room' => _miro_room_row($pdo, $id)]);
}

function miro_room_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _miro_room_row($pdo, $id);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    // notes 一括
    $st = $pdo->prepare("SELECT * FROM miro_notes WHERE room_id = ? AND deleted_at IS NULL ORDER BY id ASC");
    $st->execute([$id]);
    $flips = _miro_load_my_flips($pdo, (int)$u['id'], $id);
    $notes = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $notes[] = _miro_note_shape($r, $flips[(int)$r['id']] ?? 1);
    }
    // 自分のデフォルト色
    $defColor = _miro_default_color_of_user($pdo, (int)$u['id']);
    // v1104 他人カーソル (最終 15 秒)
    $cur = $pdo->prepare("SELECT c.user_id, c.x, c.y,
                                 UNIX_TIMESTAMP(c.updated_at) AS ts,
                                 u.display_name AS name, u.avatar_url AS avatar
                            FROM miro_cursors c JOIN users u ON u.id = c.user_id
                           WHERE c.room_id = ? AND c.user_id != ?
                             AND c.updated_at > (NOW(3) - INTERVAL 15 SECOND)");
    $cur->execute([$id, (int)$u['id']]);
    $cursors = [];
    foreach ($cur->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cursors[] = [
            'user_id' => (int)$r['user_id'],
            'name'    => (string)$r['name'],
            'avatar'  => $r['avatar'] ?: null,
            'x'       => (float)$r['x'],
            'y'       => (float)$r['y'],
            'ts'      => (float)$r['ts'],
        ];
    }
    json_response([
        'room'          => $room,
        'notes'         => $notes,
        'cursors'       => $cursors,
        'my_default_color' => $defColor,
        'server_time'   => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
    ]);
}

function miro_room_patch(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $r = _miro_room_row($pdo, $id);
    if (!$r) throw new ApiException('not_found', 'room なし', 404);
    $body = read_json_body();
    $sets = []; $params = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空不可', 400);
        if (mb_strlen($t) > 200) $t = mb_substr($t, 0, 200);
        $sets[] = 'title = ?'; $params[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        if (mb_strlen($d) > 2000) $d = mb_substr($d, 0, 2000);
        $sets[] = 'description = ?'; $params[] = $d ?: null;
    }
    if (array_key_exists('bg_color', $body)) {
        $sets[] = 'bg_color = ?'; $params[] = _miro_norm_color((string)$body['bg_color'], '#FAFAFA');
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE miro_rooms SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    json_response(['ok' => true, 'room' => _miro_room_row($pdo, $id)]);
}

function miro_room_archive(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $r = _miro_room_row($pdo, $id);
    if (!$r) throw new ApiException('not_found', 'room なし', 404);
    // 誰でも削除だと事故なので、作成者 or admin
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '作成者 or admin のみアーカイブ可能', 403);
    }
    $pdo->prepare("UPDATE miro_rooms SET archived_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// GET /api/miro/rooms/{id}/updates?since=YYYY-MM-DD%20HH:MM:SS
//   → 差分 (updated_at > since の notes + 全削除済 id)
function miro_room_updates(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _miro_room_row($pdo, $id);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    $since = (string)($_GET['since'] ?? '1970-01-01 00:00:00');
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $since)) {
        $since = '1970-01-01 00:00:00';
    }
    // 更新/新規 (deleted 含む)
    $st = $pdo->prepare("SELECT * FROM miro_notes WHERE room_id = ? AND updated_at > ? ORDER BY id ASC");
    $st->execute([$id, $since]);
    $flips = _miro_load_my_flips($pdo, (int)$u['id'], $id);
    $upserts = []; $deletes = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['deleted_at'] !== null) {
            $deletes[] = (int)$r['id'];
        } else {
            $upserts[] = _miro_note_shape($r, $flips[(int)$r['id']] ?? 2);
        }
    }
    // v1104 他人のカーソル (最終 15 秒以内、自分は除外)
    $cur = $pdo->prepare("SELECT c.user_id, c.x, c.y,
                                 UNIX_TIMESTAMP(c.updated_at) AS ts,
                                 u.display_name AS name, u.avatar_url AS avatar
                            FROM miro_cursors c JOIN users u ON u.id = c.user_id
                           WHERE c.room_id = ? AND c.user_id != ?
                             AND c.updated_at > (NOW(3) - INTERVAL 15 SECOND)");
    $cur->execute([$id, (int)$u['id']]);
    $cursors = [];
    foreach ($cur->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cursors[] = [
            'user_id' => (int)$r['user_id'],
            'name'    => (string)$r['name'],
            'avatar'  => $r['avatar'] ?: null,
            'x'       => (float)$r['x'],
            'y'       => (float)$r['y'],
            'ts'      => (float)$r['ts'],
        ];
    }
    json_response([
        'upserts'     => $upserts,
        'deletes'     => $deletes,
        'cursors'     => $cursors,
        'server_time' => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
        'room_updated_at' => $room['updated_at'],
    ]);
}

// POST /api/miro/rooms/{id}/cursor  body: { x, y }
//   自分のカーソル位置 (world 座標) を upsert。 room_updated_at は bump しない。
function miro_cursor_upsert(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $x = (float)($body['x'] ?? 0);
    $y = (float)($body['y'] ?? 0);
    // 部屋の存在確認だけ (毎回 room 全体を読むのは重いので軽く)
    $ex = $pdo->prepare("SELECT 1 FROM miro_rooms WHERE id = ?");
    $ex->execute([$roomId]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', 'room なし', 404);
    $pdo->prepare("INSERT INTO miro_cursors (room_id, user_id, x, y) VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE x = VALUES(x), y = VALUES(y), updated_at = CURRENT_TIMESTAMP(3)")
        ->execute([$roomId, (int)$u['id'], $x, $y]);
    // 空応答 (呼び出し側は捨てる)
    json_response(['ok' => true]);
}

// ─── notes ───────────────────────────────────────────────────────

// GET /api/miro/rooms/{id}/notes (詳細と同じ、便宜用)
function miro_notes_list(PDO $pdo, array $cfg, int $roomId): void {
    miro_room_detail($pdo, $cfg, $roomId);
}

// POST /api/miro/rooms/{id}/notes  body: { x?, y?, color?, front_text?, width?, height? }
function miro_notes_create(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _miro_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    // 上限チェック
    $cnt = (int)$pdo->query("SELECT COUNT(*) FROM miro_notes WHERE room_id = " . (int)$roomId . " AND deleted_at IS NULL")->fetchColumn();
    if ($cnt >= MIRO_MAX_NOTES_PER_ROOM) {
        throw new ApiException('bad_request', 'この部屋は上限 ' . MIRO_MAX_NOTES_PER_ROOM . ' 枚に達しています', 400);
    }
    $body = read_json_body();
    $x = (float)($body['x'] ?? 0);
    $y = (float)($body['y'] ?? 0);
    $w = max(80.0, min(1200.0, (float)($body['width']  ?? 220)));
    $h = max(80.0, min(1200.0, (float)($body['height'] ?? 220)));
    $color = _miro_norm_color($body['color'] ?? null, _miro_default_color_of_user($pdo, (int)$u['id']));
    $frontText = trim((string)($body['front_text'] ?? ''));
    if (mb_strlen($frontText) > 4000) $frontText = mb_substr($frontText, 0, 4000);
    $z = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM miro_notes WHERE room_id = " . (int)$roomId)->fetchColumn() + 1;
    $st = $pdo->prepare("INSERT INTO miro_notes
        (room_id, x, y, width, height, color, front_text, z_index, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([$roomId, $x, $y, $w, $h, $color, $frontText ?: null, $z, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    // 部屋の updated_at を bump (poll 側の部屋更新判定用)
    $pdo->prepare("UPDATE miro_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    $rr = $pdo->prepare("SELECT * FROM miro_notes WHERE id = ?");
    $rr->execute([$id]);
    $note = $rr->fetch(PDO::FETCH_ASSOC);
    json_response(['id' => $id, 'note' => _miro_note_shape($note, 2)]);
}

// PATCH /api/miro/notes/{id}  body: { x?, y?, width?, height?, rotation?, color?, front_text?, back_text?, z_bump? }
function miro_note_patch(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM miro_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $n = $st->fetch(PDO::FETCH_ASSOC);
    if (!$n) throw new ApiException('not_found', 'note なし', 404);
    $body = read_json_body();
    $sets = []; $params = [];
    foreach (['x','y'] as $k) {
        if (array_key_exists($k, $body)) { $sets[] = "$k = ?"; $params[] = (float)$body[$k]; }
    }
    foreach (['width','height'] as $k) {
        if (array_key_exists($k, $body)) {
            $v = max(80.0, min(1200.0, (float)$body[$k]));
            $sets[] = "$k = ?"; $params[] = $v;
        }
    }
    if (array_key_exists('rotation', $body)) {
        $sets[] = 'rotation = ?'; $params[] = fmod((float)$body['rotation'], 360.0);
    }
    if (array_key_exists('color', $body)) {
        $sets[] = 'color = ?'; $params[] = _miro_norm_color((string)$body['color']);
    }
    foreach (['front_text','back_text'] as $k) {
        if (array_key_exists($k, $body)) {
            $t = trim((string)$body[$k]);
            if (mb_strlen($t) > 4000) $t = mb_substr($t, 0, 4000);
            $sets[] = "$k = ?"; $params[] = $t !== '' ? $t : null;
        }
    }
    if (array_key_exists('front_image_url', $body)) {
        $sets[] = 'front_image_url = ?'; $params[] = $body['front_image_url'] ?: null;
    }
    if (array_key_exists('back_image_url', $body)) {
        $sets[] = 'back_image_url = ?'; $params[] = $body['back_image_url'] ?: null;
    }
    if (!empty($body['z_bump'])) {
        $z = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM miro_notes WHERE room_id = " . (int)$n['room_id'])->fetchColumn() + 1;
        $sets[] = 'z_index = ?'; $params[] = $z;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE miro_notes SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    // 部屋の updated_at を bump
    $pdo->prepare("UPDATE miro_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$n['room_id']]);
    $rr = $pdo->prepare("SELECT * FROM miro_notes WHERE id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'note' => _miro_note_shape($rr->fetch(PDO::FETCH_ASSOC), 1)]);
}

function miro_note_delete(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT room_id FROM miro_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'note なし', 404);
    $pdo->prepare("UPDATE miro_notes SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?")->execute([$id]);
    $pdo->prepare("UPDATE miro_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$r['room_id']]);
    json_response(['ok' => true]);
}

// POST /api/miro/notes/{id}/flip  → 自分の side をトグル (1↔2)
function miro_note_flip(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, room_id FROM miro_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $n = $st->fetch(PDO::FETCH_ASSOC);
    if (!$n) throw new ApiException('not_found', 'note なし', 404);
    // 現在 side (無ければ 1)
    $curr = 1;
    $s = $pdo->prepare("SELECT side FROM miro_note_flips WHERE note_id = ? AND user_id = ?");
    $s->execute([$id, (int)$u['id']]);
    $ex = $s->fetch(PDO::FETCH_ASSOC);
    if ($ex) $curr = (int)$ex['side'];
    $next = $curr === 1 ? 2 : 1;
    $pdo->prepare("INSERT INTO miro_note_flips (note_id, user_id, side) VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE side = VALUES(side)")
        ->execute([$id, (int)$u['id'], $next]);
    // 部屋の updated_at は bump しない (自分だけの状態、他人には見えない)
    json_response(['ok' => true, 'my_side' => $next]);
}

// ─── default color (user_settings) ─────────────────────────────

function _miro_default_color_of_user(PDO $pdo, int $userId): string {
    $st = $pdo->prepare("SELECT v FROM user_settings WHERE user_id = ? AND k = 'miro_default_color'");
    $st->execute([$userId]);
    $v = $st->fetchColumn();
    if ($v === false || $v === null) return MIRO_DEFAULT_COLOR;
    $decoded = json_decode((string)$v, true);
    $c = is_string($decoded) ? $decoded : (string)$v;
    return _miro_norm_color($c);
}

function miro_default_color_get(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    json_response(['color' => _miro_default_color_of_user($pdo, (int)$u['id'])]);
}

function miro_default_color_put(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $c = _miro_norm_color((string)($body['color'] ?? ''));
    $pdo->prepare("INSERT INTO user_settings (user_id, k, v) VALUES (?, 'miro_default_color', ?)
                    ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = NOW()")
        ->execute([(int)$u['id'], json_encode($c)]);
    json_response(['ok' => true, 'color' => $c]);
}

// ─── image generation (OpenAI gpt-image-1) ─────────────────────

// POST /api/miro/notes/{id}/generate-image  body: { prompt, side: 'front'|'back' (default 'front') }
function miro_note_generate_image(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    if (empty($cfg['openai']['api_key'])) {
        throw new ApiException('server_error', 'OpenAI API key 未設定', 500);
    }
    $st = $pdo->prepare("SELECT id, room_id FROM miro_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $n = $st->fetch(PDO::FETCH_ASSOC);
    if (!$n) throw new ApiException('not_found', 'note なし', 404);
    $body = read_json_body();
    $prompt = trim((string)($body['prompt'] ?? ''));
    if ($prompt === '') throw new ApiException('bad_request', 'prompt 必要', 400);
    if (mb_strlen($prompt) > 1000) $prompt = mb_substr($prompt, 0, 1000);
    $side = ($body['side'] ?? 'front') === 'back' ? 'back' : 'front';

    // OpenAI Images API (gpt-image-1)
    $payload = json_encode([
        'model'   => MIRO_IMAGE_MODEL,
        'prompt'  => $prompt,
        'n'       => 1,
        'size'    => '1024x1024',
        'quality' => 'low',   // 低品質 = 1 枚 ~$0.01。ノート内サイズで十分
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init('https://api.openai.com/v1/images/generations');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT    => 120,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code >= 400) {
        error_log('[miro] image gen upstream failed http=' . $code . ' body=' . substr((string)$resp, 0, 500));
        throw new ApiException('upstream_error', 'OpenAI 画像生成失敗 (HTTP ' . $code . ')', 502);
    }
    $j = json_decode((string)$resp, true);
    $b64 = $j['data'][0]['b64_json'] ?? null;
    if (!$b64) throw new ApiException('upstream_error', 'OpenAI レスポンス不正', 502);
    $bin = base64_decode($b64);
    if ($bin === false || strlen($bin) === 0) throw new ApiException('upstream_error', '画像 decode 失敗', 502);

    // 保存 (sha256 でハッシュ名)
    $sha = hash('sha256', $bin);
    $dir = '/uploads/miro/' . substr($sha, 0, 2);
    $abs = '/var/www/labpay/public' . $dir;
    @mkdir($abs, 0775, true);
    $rel = $dir . '/' . $sha . '.png';
    file_put_contents('/var/www/labpay/public' . $rel, $bin);
    @chmod('/var/www/labpay/public' . $rel, 0644);

    // ノートに反映
    $col = $side === 'back' ? 'back_image_url' : 'front_image_url';
    $pdo->prepare("UPDATE miro_notes SET {$col} = ?, updated_at = NOW() WHERE id = ?")->execute([$rel, $id]);
    $pdo->prepare("UPDATE miro_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$n['room_id']]);

    // 全体レコード返す
    $rr = $pdo->prepare("SELECT * FROM miro_notes WHERE id = ?");
    $rr->execute([$id]);
    json_response([
        'ok'        => true,
        'side'      => $side,
        'image_url' => $rel,
        'note'      => _miro_note_shape($rr->fetch(PDO::FETCH_ASSOC), 1),
    ]);
}
