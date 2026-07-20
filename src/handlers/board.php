<?php
// v1100 /api/miro — Miro 的な共同ポストイット空間。
//   * ラボ全員が全部屋を閲覧・編集可 (LabPay 標準の共有カルチャ)
//   * 各ノート = カード 2 面 (front/back text+image は共有、side は user ごと個別)
//   * ドラッグで自由配置、拡大縮小、色変更
//   * デフォルト色は user_settings.board_default_color に持つ
//   * ノート内で OpenAI gpt-image-1 (low) で画像生成 → 表 or 裏に差し込み
//   * 2s poll でリアルタイム更新 (server は since=updated_at で差分返す)

declare(strict_types=1);

const BOARD_MAX_NOTES_PER_ROOM = 500;   // 1 部屋の上限。 miro 実質上限なしだが練習だから
const BOARD_DEFAULT_COLOR = '#FEF9A8';
const BOARD_IMAGE_MODEL = 'gpt-image-1';

function route_board(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    // /api/board/rooms ...
    if ($sub === 'rooms') {
        $id = (int)($seg[2] ?? 0);
        if ($id === 0 && $method === 'GET')  { board_rooms_list  ($pdo, $cfg); return; }
        if ($id === 0 && $method === 'POST') { board_rooms_create($pdo, $cfg); return; }
        if ($id > 0) {
            $next = $seg[3] ?? '';
            if ($next === '' && $method === 'GET')    { board_room_detail($pdo, $cfg, $id);         return; }
            if ($next === '' && $method === 'PATCH')  { board_room_patch ($pdo, $cfg, $id);         return; }
            if ($next === '' && $method === 'DELETE') { board_room_archive($pdo, $cfg, $id);        return; }
            if ($next === 'notes'   && $method === 'GET')  { board_notes_list  ($pdo, $cfg, $id);   return; }
            if ($next === 'notes'   && $method === 'POST') { board_notes_create($pdo, $cfg, $id);   return; }
            if ($next === 'notes-from-refs' && $method === 'POST') { board_notes_from_refs($pdo, $cfg, $id); return; }
            if ($next === 'notes-from-places' && $method === 'POST') { board_notes_from_places($pdo, $cfg, $id); return; }
            if ($next === 'updates' && $method === 'GET')  { board_room_updates($pdo, $cfg, $id);   return; }
            if ($next === 'cursor'  && $method === 'POST') { board_cursor_upsert($pdo, $cfg, $id);  return; }
            // v1173 手書き
            if ($next === 'strokes' && $method === 'GET')  { board_strokes_list($pdo, $cfg, $id);   return; }
            if ($next === 'strokes' && $method === 'POST') { board_stroke_create($pdo, $cfg, $id);  return; }
            // v1189 note-to-note 矢印 (Miro 風)
            if ($next === 'arrows'  && $method === 'GET')  { board_arrows_list ($pdo, $cfg, $id);   return; }
            if ($next === 'arrows'  && $method === 'POST') { board_arrow_create($pdo, $cfg, $id);   return; }
        }
    }
    // /api/board/notes/{id} ...
    if ($sub === 'notes') {
        $id = (int)($seg[2] ?? 0);
        if ($id > 0) {
            $next = $seg[3] ?? '';
            if ($next === '' && $method === 'PATCH')  { board_note_patch ($pdo, $cfg, $id);        return; }
            if ($next === '' && $method === 'DELETE') { board_note_delete($pdo, $cfg, $id);        return; }
            if ($next === 'flip'           && $method === 'POST') { board_note_flip($pdo, $cfg, $id);           return; }
            if ($next === 'generate-image' && $method === 'POST') { board_note_generate_image($pdo, $cfg, $id); return; }
        }
    }
    // v1173 /api/miro/strokes/{id} DELETE
    if ($sub === 'strokes') {
        $id = (int)($seg[2] ?? 0);
        if ($id > 0 && $method === 'DELETE') { board_stroke_delete($pdo, $cfg, $id); return; }
    }
    // v1189 /api/board/arrows/{id} — PATCH (label/color/style) / DELETE (soft)
    if ($sub === 'arrows') {
        $id = (int)($seg[2] ?? 0);
        if ($id > 0 && $method === 'PATCH')  { board_arrow_patch ($pdo, $cfg, $id); return; }
        if ($id > 0 && $method === 'DELETE') { board_arrow_delete($pdo, $cfg, $id); return; }
    }
    // /api/board/default-color — GET/PUT
    if ($sub === 'default-color') {
        if ($method === 'GET') { board_default_color_get($pdo, $cfg); return; }
        if ($method === 'PUT') { board_default_color_put($pdo, $cfg); return; }
    }
    throw new ApiException('not_found', "no board route for $method $sub", 404);
}

// ─── helpers ─────────────────────────────────────────────────────

function _board_norm_color(?string $c, string $fallback = BOARD_DEFAULT_COLOR): string {
    $c = trim((string)$c);
    if ($c === '') return $fallback;
    if (preg_match('/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/', $c)) return strtoupper($c);
    return $fallback;
}

function _board_room_row(PDO $pdo, int $id): ?array {
    $st = $pdo->prepare("SELECT r.id, r.title, r.description, r.bg_color, r.visibility, r.owner_group_id, r.creator_user_id,
                                r.created_at, r.updated_at, r.archived_at,
                                u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                g.title AS group_title,
                                (SELECT COUNT(*) FROM board_notes n WHERE n.room_id = r.id AND n.deleted_at IS NULL) AS note_count
                           FROM board_rooms r
                      LEFT JOIN users u ON u.id = r.creator_user_id
                      LEFT JOIN adhoc_groups g ON g.id = r.owner_group_id
                          WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    $r['id']              = (int)$r['id'];
    $r['creator_user_id'] = (int)$r['creator_user_id'];
    $r['owner_group_id']  = $r['owner_group_id'] !== null ? (int)$r['owner_group_id'] : null;
    $r['note_count']      = (int)$r['note_count'];
    return $r;
}

// v1110 visibility 判定: この user はこの room を見られるか?
function _board_room_visible_to_user(PDO $pdo, array $room, int $uid): bool {
    $vis = (string)($room['visibility'] ?? 'lab');
    if ($vis === 'lab')     return true;
    if ($vis === 'private') return (int)$room['creator_user_id'] === $uid;
    if ($vis === 'group') {
        $gid = $room['owner_group_id'] !== null ? (int)$room['owner_group_id'] : 0;
        if ($gid <= 0) return false;
        // 作成者は自分の部屋を常に見られる (グループ抜けても)
        if ((int)$room['creator_user_id'] === $uid) return true;
        $st = $pdo->prepare("SELECT 1 FROM adhoc_group_members WHERE group_id = ? AND user_id = ?");
        $st->execute([$gid, $uid]);
        return (bool)$st->fetchColumn();
    }
    return false;
}

// v1108 中村さん指示「隠すと見せる、自分には見えるけど、相手には見えないようにして
//   欲しい」→ 第 2 引数は「見る側 (requester) の user_id」に。作成者本人には常に見え、
//   is_hidden の note は他人 (作成者以外) からは隠し (裏) 状態として返す。
function _board_note_shape(array $r, int $requesterId): array {
    $creatorId = (int)$r['created_by_user_id'];
    $isMine    = ($creatorId === $requesterId);
    $isHidden  = (int)($r['is_hidden'] ?? 0) === 1;
    $hiddenForMe = $isHidden && !$isMine;
    return [
        'id'                => (int)$r['id'],
        'room_id'           => (int)$r['room_id'],
        'x'                 => (float)$r['x'],
        'y'                 => (float)$r['y'],
        'width'             => (float)$r['width'],
        'height'            => (float)$r['height'],
        'rotation'          => (float)$r['rotation'],
        'color'             => (string)$r['color'],
        // 他人に見えない (hidden) 時は text / image を配信しない (漏洩防止)
        'front_text'        => $hiddenForMe ? '' : (string)($r['front_text'] ?? ''),
        'front_image_url'   => $hiddenForMe ? null : ($r['front_image_url'] ?: null),
        // back_* は互換のため残すが UI では未使用
        'back_text'         => (string)($r['back_text']  ?? ''),
        'back_image_url'    => $r['back_image_url']  ?: null,
        // v1171 refs/places から貼ったノートは link_url に元ページへのリンクを持つ
        'link_url'          => $hiddenForMe ? null : ($r['link_url'] ?? null),
        'z_index'           => (int)$r['z_index'],
        'is_hidden'         => $isHidden,
        'hidden_for_me'     => $hiddenForMe,
        'is_mine'           => $isMine,
        'created_by_user_id'=> $creatorId,
        'creator_name'      => (string)($r['creator_name'] ?? ''),
        'created_at'        => (string)$r['created_at'],
        'updated_at'        => (string)$r['updated_at'],
    ];
}

function _board_load_my_flips(PDO $pdo, int $userId, int $roomId): array {
    $st = $pdo->prepare("SELECT f.note_id, f.side
                           FROM board_note_flips f
                           JOIN board_notes n ON n.id = f.note_id
                          WHERE n.room_id = ? AND f.user_id = ?");
    $st->execute([$roomId, $userId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['note_id']] = (int)$r['side'];
    }
    return $out;
}

// ─── rooms ───────────────────────────────────────────────────────

// GET /api/board/rooms → 自分に見える部屋のみ (visibility フィルタ)
function board_rooms_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // visibility フィルタを SQL レベルで:
    //   lab: 全員
    //   private: creator = 自分
    //   group: 自分が group メンバー OR 自分が creator
    $st = $pdo->prepare("SELECT r.id, r.title, r.description, r.bg_color, r.visibility, r.owner_group_id, r.creator_user_id,
                                r.created_at, r.updated_at,
                                u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                g.title AS group_title,
                                (SELECT COUNT(*) FROM board_notes n WHERE n.room_id = r.id AND n.deleted_at IS NULL) AS note_count
                           FROM board_rooms r
                      LEFT JOIN users u ON u.id = r.creator_user_id
                      LEFT JOIN adhoc_groups g ON g.id = r.owner_group_id
                          WHERE r.archived_at IS NULL
                            AND (
                              r.visibility = 'lab'
                              OR (r.visibility = 'private' AND r.creator_user_id = ?)
                              OR (r.visibility = 'group' AND (r.creator_user_id = ? OR EXISTS (
                                    SELECT 1 FROM adhoc_group_members m WHERE m.group_id = r.owner_group_id AND m.user_id = ?
                                  )))
                            )
                       ORDER BY r.updated_at DESC");
    $st->execute([$uid, $uid, $uid]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['owner_group_id']  = $r['owner_group_id'] !== null ? (int)$r['owner_group_id'] : null;
        $r['note_count']      = (int)$r['note_count'];
        $items[] = $r;
    }
    json_response(['items' => $items]);
}

// POST /api/board/rooms  body: { title, description?, bg_color?, visibility?, owner_group_id? }
function board_rooms_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 200) $title = mb_substr($title, 0, 200);
    $desc = trim((string)($body['description'] ?? ''));
    if (mb_strlen($desc) > 2000) $desc = mb_substr($desc, 0, 2000);
    $bg = _board_norm_color($body['bg_color'] ?? null, '#FAFAFA');
    // v1110 visibility: lab / group / private
    $vis = (string)($body['visibility'] ?? 'lab');
    if (!in_array($vis, ['lab','group','private'], true)) $vis = 'lab';
    $gid = null;
    if ($vis === 'group') {
        $gid = isset($body['owner_group_id']) ? (int)$body['owner_group_id'] : 0;
        if ($gid <= 0) throw new ApiException('bad_request', 'group スコープには owner_group_id 必須', 400);
        // 自分が member の group か確認
        $mck = $pdo->prepare("SELECT 1 FROM adhoc_group_members WHERE group_id = ? AND user_id = ?");
        $mck->execute([$gid, (int)$u['id']]);
        if (!$mck->fetchColumn()) throw new ApiException('forbidden', 'その group のメンバーではありません', 403);
    }
    $st = $pdo->prepare("INSERT INTO board_rooms (title, description, bg_color, visibility, owner_group_id, creator_user_id)
                         VALUES (?, ?, ?, ?, ?, ?)");
    $st->execute([$title, $desc ?: null, $bg, $vis, $gid, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    json_response(['id' => $id, 'room' => _board_room_row($pdo, $id)]);
}

function board_room_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $id);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    // notes 一括 (作成者名を LEFT JOIN で拾って shape に渡す)
    $st = $pdo->prepare("SELECT n.*, u.display_name AS creator_name
                           FROM board_notes n
                      LEFT JOIN users u ON u.id = n.created_by_user_id
                          WHERE n.room_id = ? AND n.deleted_at IS NULL ORDER BY n.id ASC");
    $st->execute([$id]);
    $notes = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $notes[] = _board_note_shape($r, (int)$u['id']);
    }
    // 自分のデフォルト色
    $defColor = _board_default_color_of_user($pdo, (int)$u['id']);
    // v1104 他人カーソル (最終 15 秒)
    $cur = $pdo->prepare("SELECT c.user_id, c.x, c.y,
                                 UNIX_TIMESTAMP(c.updated_at) AS ts,
                                 u.display_name AS name, u.avatar_url AS avatar
                            FROM board_cursors c JOIN users u ON u.id = c.user_id
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
    // v1173 手書きストローク一括
    $strokes = _board_load_strokes($pdo, $id);
    // v1189 note-to-note 矢印
    $arrows  = _board_load_arrows($pdo, $id);
    json_response([
        'room'          => $room,
        'notes'         => $notes,
        'strokes'       => $strokes,
        'arrows'        => $arrows,
        'cursors'       => $cursors,
        'my_default_color' => $defColor,
        'server_time'   => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
    ]);
}

function _board_load_strokes(PDO $pdo, int $roomId): array {
    $st = $pdo->prepare("SELECT id, points_json, color, width, created_by_user_id, created_at
                           FROM board_strokes
                          WHERE room_id = ? AND deleted_at IS NULL
                          ORDER BY id ASC");
    $st->execute([$roomId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $pts = json_decode((string)$r['points_json'], true);
        if (!is_array($pts)) $pts = [];
        $out[] = [
            'id'                 => (int)$r['id'],
            'points'             => $pts,
            'color'              => (string)$r['color'],
            'width'              => (float)$r['width'],
            'created_by_user_id' => (int)$r['created_by_user_id'],
            'created_at'         => (string)$r['created_at'],
        ];
    }
    return $out;
}

function board_strokes_list(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    json_response(['strokes' => _board_load_strokes($pdo, $roomId)]);
}

function board_stroke_create(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    $body = read_json_body();
    $pts = $body['points'] ?? null;
    if (!is_array($pts) || count($pts) < 2) {
        throw new ApiException('bad_request', 'points が 2 点以上必要', 400);
    }
    if (count($pts) > 5000) throw new ApiException('bad_request', '1 ストロークの点数上限は 5000', 400);
    // clean: {x,y} だけを number として保存
    $clean = [];
    foreach ($pts as $p) {
        if (!is_array($p)) continue;
        $x = isset($p['x']) ? (float)$p['x'] : null;
        $y = isset($p['y']) ? (float)$p['y'] : null;
        if ($x === null || $y === null) continue;
        // 世界座標の暴走を防ぐ (絶対値 1e6 まで)
        if (abs($x) > 1e6 || abs($y) > 1e6) continue;
        $clean[] = ['x' => $x, 'y' => $y];
    }
    if (count($clean) < 2) throw new ApiException('bad_request', 'valid points が 2 点未満', 400);
    $color = _board_norm_color((string)($body['color'] ?? '#111827'), '#111827');
    $width = isset($body['width']) ? max(0.5, min(20.0, (float)$body['width'])) : 2.0;
    $ins = $pdo->prepare("INSERT INTO board_strokes (room_id, points_json, color, width, created_by_user_id)
                          VALUES (?, ?, ?, ?, ?)");
    $ins->execute([$roomId, json_encode($clean), $color, $width, (int)$u['id']]);
    $sid = (int)$pdo->lastInsertId();
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    json_response([
        'ok'                 => true,
        'stroke' => [
            'id'                 => $sid,
            'points'             => $clean,
            'color'              => $color,
            'width'              => $width,
            'created_by_user_id' => (int)$u['id'],
            'created_at'         => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
        ],
    ]);
}

function board_stroke_delete(PDO $pdo, array $cfg, int $strokeId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT s.id, s.room_id, s.created_by_user_id
                           FROM board_strokes s
                          WHERE s.id = ? AND s.deleted_at IS NULL");
    $st->execute([$strokeId]);
    $s = $st->fetch(PDO::FETCH_ASSOC);
    if (!$s) throw new ApiException('not_found', 'stroke なし', 404);
    $room = _board_room_row($pdo, (int)$s['room_id']);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    // 削除は 作成者 or admin or room 参加者 (共同編集 モデル)
    $pdo->prepare("UPDATE board_strokes SET deleted_at = NOW() WHERE id = ?")->execute([$strokeId]);
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$s['room_id']]);
    json_response(['ok' => true]);
}

// ─── v1189 note-to-note arrows (Miro 風) ─────────────────────────

function _board_arrow_shape(array $r): array {
    return [
        'id'                 => (int)$r['id'],
        'from_note_id'       => (int)$r['from_note_id'],
        'to_note_id'         => (int)$r['to_note_id'],
        'color'              => (string)$r['color'],
        'style'              => (string)$r['style'],
        'label'              => $r['label'] !== null ? (string)$r['label'] : null,
        'created_by_user_id' => (int)$r['created_by_user_id'],
        'created_at'         => (string)$r['created_at'],
        'updated_at'         => (string)$r['updated_at'],
    ];
}

function _board_load_arrows(PDO $pdo, int $roomId): array {
    $st = $pdo->prepare("SELECT * FROM board_arrows WHERE room_id = ? AND deleted_at IS NULL ORDER BY id ASC");
    $st->execute([$roomId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $out[] = _board_arrow_shape($r);
    return $out;
}

function board_arrows_list(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    json_response(['arrows' => _board_load_arrows($pdo, $roomId)]);
}

function board_arrow_create(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    $body = read_json_body();
    $from = (int)($body['from_note_id'] ?? 0);
    $to   = (int)($body['to_note_id']   ?? 0);
    if ($from <= 0 || $to <= 0 || $from === $to) {
        throw new ApiException('bad_request', 'from_note_id / to_note_id が不正', 400);
    }
    // 両ノートが同じ room に属し, deleted でないこと
    $chk = $pdo->prepare("SELECT COUNT(*) FROM board_notes WHERE id IN (?, ?) AND room_id = ? AND deleted_at IS NULL");
    $chk->execute([$from, $to, $roomId]);
    if ((int)$chk->fetchColumn() !== 2) {
        throw new ApiException('bad_request', 'ノートがこの部屋に見つかりません', 400);
    }
    $color = _board_norm_color((string)($body['color'] ?? '#111827'), '#111827');
    $style = (string)($body['style'] ?? 'solid');
    if (!in_array($style, ['solid','dashed'], true)) $style = 'solid';
    $label = isset($body['label']) ? trim((string)$body['label']) : '';
    if ($label === '') $label = null;
    if ($label !== null && mb_strlen($label) > 120) $label = mb_substr($label, 0, 120);
    // 同じ (from,to) の 生きた矢印 が 既に あれば それを 返す (重複防止)
    $exist = $pdo->prepare("SELECT * FROM board_arrows WHERE room_id = ? AND from_note_id = ? AND to_note_id = ? AND deleted_at IS NULL LIMIT 1");
    $exist->execute([$roomId, $from, $to]);
    if ($row = $exist->fetch(PDO::FETCH_ASSOC)) {
        json_response(['ok' => true, 'arrow' => _board_arrow_shape($row), 'existed' => true]);
        return;
    }
    $ins = $pdo->prepare("INSERT INTO board_arrows (room_id, from_note_id, to_note_id, color, style, label, created_by_user_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$roomId, $from, $to, $color, $style, $label, (int)$u['id']]);
    $aid = (int)$pdo->lastInsertId();
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    $sel = $pdo->prepare("SELECT * FROM board_arrows WHERE id = ?");
    $sel->execute([$aid]);
    json_response(['ok' => true, 'arrow' => _board_arrow_shape($sel->fetch(PDO::FETCH_ASSOC))]);
}

function board_arrow_patch(PDO $pdo, array $cfg, int $arrowId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM board_arrows WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$arrowId]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'arrow なし', 404);
    $room = _board_room_row($pdo, (int)$a['room_id']);
    if (!$room || !_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    $body = read_json_body();
    $sets = []; $params = [];
    if (array_key_exists('color', $body)) {
        $sets[] = 'color = ?'; $params[] = _board_norm_color((string)$body['color'], '#111827');
    }
    if (array_key_exists('style', $body)) {
        $s = (string)$body['style'];
        if (!in_array($s, ['solid','dashed'], true)) $s = 'solid';
        $sets[] = 'style = ?'; $params[] = $s;
    }
    if (array_key_exists('label', $body)) {
        $l = trim((string)$body['label']);
        if ($l === '') $l = null;
        if ($l !== null && mb_strlen($l) > 120) $l = mb_substr($l, 0, 120);
        $sets[] = 'label = ?'; $params[] = $l;
    }
    if (!$sets) { json_response(['ok' => true, 'arrow' => _board_arrow_shape($a)]); return; }
    $params[] = $arrowId;
    $pdo->prepare("UPDATE board_arrows SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$a['room_id']]);
    $st2 = $pdo->prepare("SELECT * FROM board_arrows WHERE id = ?");
    $st2->execute([$arrowId]);
    json_response(['ok' => true, 'arrow' => _board_arrow_shape($st2->fetch(PDO::FETCH_ASSOC))]);
}

function board_arrow_delete(PDO $pdo, array $cfg, int $arrowId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM board_arrows WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$arrowId]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'arrow なし', 404);
    $room = _board_room_row($pdo, (int)$a['room_id']);
    if (!$room || !_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', '権限なし', 403);
    }
    $pdo->prepare("UPDATE board_arrows SET deleted_at = NOW() WHERE id = ?")->execute([$arrowId]);
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$a['room_id']]);
    json_response(['ok' => true]);
}

function board_room_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $r = _board_room_row($pdo, $id);
    if (!$r) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $r, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
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
        $sets[] = 'bg_color = ?'; $params[] = _board_norm_color((string)$body['bg_color'], '#FAFAFA');
    }
    // v1110 visibility 切替は作成者のみ
    if (array_key_exists('visibility', $body)) {
        if ((int)$r['creator_user_id'] !== (int)$u['id']) {
            throw new ApiException('forbidden', '公開範囲の変更は作成者のみ', 403);
        }
        $vis = (string)$body['visibility'];
        if (!in_array($vis, ['lab','group','private'], true)) throw new ApiException('bad_request', 'visibility 不正', 400);
        $gid = null;
        if ($vis === 'group') {
            $gid = isset($body['owner_group_id']) ? (int)$body['owner_group_id'] : 0;
            if ($gid <= 0) throw new ApiException('bad_request', 'group スコープには owner_group_id 必須', 400);
            $mck = $pdo->prepare("SELECT 1 FROM adhoc_group_members WHERE group_id = ? AND user_id = ?");
            $mck->execute([$gid, (int)$u['id']]);
            if (!$mck->fetchColumn()) throw new ApiException('forbidden', 'その group のメンバーではありません', 403);
        }
        $sets[] = 'visibility = ?'; $params[] = $vis;
        $sets[] = 'owner_group_id = ?'; $params[] = $gid;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE board_rooms SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    json_response(['ok' => true, 'room' => _board_room_row($pdo, $id)]);
}

function board_room_archive(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $r = _board_room_row($pdo, $id);
    if (!$r) throw new ApiException('not_found', 'room なし', 404);
    // 誰でも削除だと事故なので、作成者 or admin
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '作成者 or admin のみアーカイブ可能', 403);
    }
    $pdo->prepare("UPDATE board_rooms SET archived_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// GET /api/board/rooms/{id}/updates?since=YYYY-MM-DD%20HH:MM:SS
//   → 差分 (updated_at > since の notes + 全削除済 id)
function board_room_updates(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $id);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    $since = (string)($_GET['since'] ?? '1970-01-01 00:00:00');
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $since)) {
        $since = '1970-01-01 00:00:00';
    }
    // 更新/新規 (deleted 含む)
    $st = $pdo->prepare("SELECT n.*, u.display_name AS creator_name
                           FROM board_notes n
                      LEFT JOIN users u ON u.id = n.created_by_user_id
                          WHERE n.room_id = ? AND n.updated_at > ? ORDER BY n.id ASC");
    $st->execute([$id, $since]);
    $upserts = []; $deletes = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['deleted_at'] !== null) {
            $deletes[] = (int)$r['id'];
        } else {
            $upserts[] = _board_note_shape($r, (int)$u['id']);
        }
    }
    // v1104 他人のカーソル (最終 15 秒以内、自分は除外)
    $cur = $pdo->prepare("SELECT c.user_id, c.x, c.y,
                                 UNIX_TIMESTAMP(c.updated_at) AS ts,
                                 u.display_name AS name, u.avatar_url AS avatar
                            FROM board_cursors c JOIN users u ON u.id = c.user_id
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
    // v1173 手書きストローク: since より新しい (or 削除) を返す
    $stS = $pdo->prepare("SELECT id, points_json, color, width, created_by_user_id, created_at, deleted_at
                            FROM board_strokes
                           WHERE room_id = ? AND created_at > ?");
    $stS->execute([$id, $since]);
    $strokeUpserts = []; $strokeDeletes = [];
    foreach ($stS->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['deleted_at'] !== null) {
            $strokeDeletes[] = (int)$r['id'];
        } else {
            $pts = json_decode((string)$r['points_json'], true);
            if (!is_array($pts)) $pts = [];
            $strokeUpserts[] = [
                'id'                 => (int)$r['id'],
                'points'             => $pts,
                'color'              => (string)$r['color'],
                'width'              => (float)$r['width'],
                'created_by_user_id' => (int)$r['created_by_user_id'],
                'created_at'         => (string)$r['created_at'],
            ];
        }
    }
    // 削除された古いストローク (deleted_at > since) も検出
    $stD = $pdo->prepare("SELECT id FROM board_strokes WHERE room_id = ? AND deleted_at IS NOT NULL AND deleted_at > ? AND created_at <= ?");
    $stD->execute([$id, $since, $since]);
    foreach ($stD->fetchAll(PDO::FETCH_COLUMN) as $sid) $strokeDeletes[] = (int)$sid;
    // v1189 note-to-note 矢印 の 差分 (updated_at > since = 新規 + patch + delete)
    $stA = $pdo->prepare("SELECT * FROM board_arrows WHERE room_id = ? AND updated_at > ?");
    $stA->execute([$id, $since]);
    $arrowUpserts = []; $arrowDeletes = [];
    foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['deleted_at'] !== null) $arrowDeletes[] = (int)$r['id'];
        else $arrowUpserts[] = _board_arrow_shape($r);
    }
    json_response([
        'upserts'          => $upserts,
        'deletes'          => $deletes,
        'stroke_upserts'   => $strokeUpserts,
        'stroke_deletes'   => $strokeDeletes,
        'arrow_upserts'    => $arrowUpserts,
        'arrow_deletes'    => $arrowDeletes,
        'cursors'          => $cursors,
        'server_time'      => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
        'room_updated_at'  => $room['updated_at'],
    ]);
}

// POST /api/board/rooms/{id}/cursor  body: { x, y }
//   自分のカーソル位置 (world 座標) を upsert。 room_updated_at は bump しない。
function board_cursor_upsert(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $x = (float)($body['x'] ?? 0);
    $y = (float)($body['y'] ?? 0);
    // v1110 visibility 確認 (部屋自体が見えない相手には位置報告もさせない)
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    $pdo->prepare("INSERT INTO board_cursors (room_id, user_id, x, y) VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE x = VALUES(x), y = VALUES(y), updated_at = CURRENT_TIMESTAMP(3)")
        ->execute([$roomId, (int)$u['id'], $x, $y]);
    // 空応答 (呼び出し側は捨てる)
    json_response(['ok' => true]);
}

// ─── notes ───────────────────────────────────────────────────────

// GET /api/board/rooms/{id}/notes (詳細と同じ、便宜用)
function board_notes_list(PDO $pdo, array $cfg, int $roomId): void {
    board_room_detail($pdo, $cfg, $roomId);
}

// POST /api/board/rooms/{id}/notes  body: { x?, y?, color?, front_text?, width?, height? }
function board_notes_create(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    // 上限チェック
    $cnt = (int)$pdo->query("SELECT COUNT(*) FROM board_notes WHERE room_id = " . (int)$roomId . " AND deleted_at IS NULL")->fetchColumn();
    if ($cnt >= BOARD_MAX_NOTES_PER_ROOM) {
        throw new ApiException('bad_request', 'この部屋は上限 ' . BOARD_MAX_NOTES_PER_ROOM . ' 枚に達しています', 400);
    }
    $body = read_json_body();
    $x = (float)($body['x'] ?? 0);
    $y = (float)($body['y'] ?? 0);
    $w = max(80.0, min(1200.0, (float)($body['width']  ?? 220)));
    $h = max(80.0, min(1200.0, (float)($body['height'] ?? 220)));
    $color = _board_norm_color($body['color'] ?? null, _board_default_color_of_user($pdo, (int)$u['id']));
    $frontText = trim((string)($body['front_text'] ?? ''));
    if (mb_strlen($frontText) > 4000) $frontText = mb_substr($frontText, 0, 4000);
    // v1177 中村さん要望「インポート で画像ファイル群 を アップロード したい」→ front_image_url を作成時に受け付ける。
    $frontImg = null;
    if (isset($body['front_image_url']) && is_string($body['front_image_url'])) {
        $iu = trim($body['front_image_url']);
        if ($iu !== '' && mb_strlen($iu) <= 500) $frontImg = $iu;
    }
    $z = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM board_notes WHERE room_id = " . (int)$roomId)->fetchColumn() + 1;
    $st = $pdo->prepare("INSERT INTO board_notes
        (room_id, x, y, width, height, color, front_text, front_image_url, z_index, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([$roomId, $x, $y, $w, $h, $color, $frontText ?: null, $frontImg, $z, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    // 部屋の updated_at を bump (poll 側の部屋更新判定用)
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    $rr = $pdo->prepare("SELECT n.*, u.display_name AS creator_name FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.id = ?");
    $rr->execute([$id]);
    $note = $rr->fetch(PDO::FETCH_ASSOC);
    json_response(['id' => $id, 'note' => _board_note_shape($note, (int)$u['id'])]);
}

// PATCH /api/board/notes/{id}  body: { x?, y?, width?, height?, rotation?, color?, front_text?, back_text?, is_hidden?, z_bump? }
function board_note_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM board_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $n = $st->fetch(PDO::FETCH_ASSOC);
    if (!$n) throw new ApiException('not_found', 'note なし', 404);
    $body = read_json_body();
    $sets = []; $params = [];
    // v1108 is_hidden の切り替えは作成者本人のみ (他人には自分の note の見え方を
    //   コントロールする権限がある、非作成者が勝手に隠す/見せるのは不可)
    if (array_key_exists('is_hidden', $body)) {
        if ((int)$n['created_by_user_id'] !== (int)$u['id']) {
            throw new ApiException('forbidden', '隠す / 見せるは作成者本人だけ', 403);
        }
        $sets[] = 'is_hidden = ?'; $params[] = $body['is_hidden'] ? 1 : 0;
    }
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
        $sets[] = 'color = ?'; $params[] = _board_norm_color((string)$body['color']);
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
        $z = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM board_notes WHERE room_id = " . (int)$n['room_id'])->fetchColumn() + 1;
        $sets[] = 'z_index = ?'; $params[] = $z;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE board_notes SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    // 部屋の updated_at を bump
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$n['room_id']]);
    $rr = $pdo->prepare("SELECT n.*, u.display_name AS creator_name FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'note' => _board_note_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'])]);
}

function board_note_delete(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT room_id FROM board_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'note なし', 404);
    $pdo->prepare("UPDATE board_notes SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?")->execute([$id]);
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$r['room_id']]);
    json_response(['ok' => true]);
}

// POST /api/board/notes/{id}/flip  → 自分の side をトグル (1↔2)
// v1108 /flip は per-user 状態から per-note is_hidden トグルに転換。
//   作成者本人だけが叩ける (403 それ以外)。更新後の note を返す。
function board_note_flip(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, room_id, created_by_user_id, is_hidden FROM board_notes WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $n = $st->fetch(PDO::FETCH_ASSOC);
    if (!$n) throw new ApiException('not_found', 'note なし', 404);
    if ((int)$n['created_by_user_id'] !== (int)$u['id']) {
        throw new ApiException('forbidden', '隠す / 見せるは作成者本人だけ', 403);
    }
    $next = ((int)$n['is_hidden'] === 1) ? 0 : 1;
    $pdo->prepare("UPDATE board_notes SET is_hidden = ?, updated_at = NOW() WHERE id = ?")->execute([$next, $id]);
    // 部屋の updated_at も bump (poll で他人が拾えるように)
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$n['room_id']]);
    $rr = $pdo->prepare("SELECT n.*, u.display_name AS creator_name FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.id = ?");
    $rr->execute([$id]);
    json_response(['ok' => true, 'note' => _board_note_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id'])]);
}

// ─── default color (user_settings) ─────────────────────────────

function _board_default_color_of_user(PDO $pdo, int $userId): string {
    $st = $pdo->prepare("SELECT v FROM user_settings WHERE user_id = ? AND k = 'board_default_color'");
    $st->execute([$userId]);
    $v = $st->fetchColumn();
    if ($v === false || $v === null) return BOARD_DEFAULT_COLOR;
    $decoded = json_decode((string)$v, true);
    $c = is_string($decoded) ? $decoded : (string)$v;
    return _board_norm_color($c);
}

function board_default_color_get(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    json_response(['color' => _board_default_color_of_user($pdo, (int)$u['id'])]);
}

function board_default_color_put(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $c = _board_norm_color((string)($body['color'] ?? ''));
    $pdo->prepare("INSERT INTO user_settings (user_id, k, v) VALUES (?, 'board_default_color', ?)
                    ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = NOW()")
        ->execute([(int)$u['id'], json_encode($c)]);
    json_response(['ok' => true, 'color' => $c]);
}

// ─── v1110 refs → miro note の一括展開 ─────────────────────────
// POST /api/board/rooms/{roomId}/notes-from-refs
//   body: { ref_ids: [int,...], center_x?: number, center_y?: number }
//   → 各 ref から front_text を組み立てて note を生成、center 付近にグリッド配置。
//     配置: 220x220 + 20px gap、cols = ceil(sqrt(N))、self default color、
//     front_text = "Title\n\nAuthor+ (Year) VenueShort"
function board_notes_from_refs(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    $body = read_json_body();
    $ids = [];
    foreach ((array)($body['ref_ids'] ?? []) as $x) if (ctype_digit((string)$x) || is_int($x)) $ids[] = (int)$x;
    $ids = array_values(array_unique($ids));
    if (!$ids) throw new ApiException('bad_request', 'ref_ids 必要', 400);
    if (count($ids) > 50) throw new ApiException('bad_request', '一度に貼れるのは 50 本まで', 400);
    // 上限
    $existing = (int)$pdo->query("SELECT COUNT(*) FROM board_notes WHERE room_id = " . (int)$roomId . " AND deleted_at IS NULL")->fetchColumn();
    if ($existing + count($ids) > BOARD_MAX_NOTES_PER_ROOM) {
        throw new ApiException('bad_request', 'この部屋の note 上限 ' . BOARD_MAX_NOTES_PER_ROOM . ' を超えます', 400);
    }
    $cx = isset($body['center_x']) ? (float)$body['center_x'] : 0.0;
    $cy = isset($body['center_y']) ? (float)$body['center_y'] : 0.0;
    // refs を取得
    $place = implode(',', array_fill(0, count($ids), '?'));
    $rs = $pdo->prepare("SELECT id, title, authors_json, year, venue FROM refs WHERE id IN ($place) AND deleted_at IS NULL");
    $rs->execute($ids);
    $refs = [];
    foreach ($rs->fetchAll(PDO::FETCH_ASSOC) as $r) $refs[(int)$r['id']] = $r;
    if (!$refs) throw new ApiException('not_found', '指定した refs が見つかりません', 404);
    // ユーザ指定順序を保つ
    $ordered = [];
    foreach ($ids as $id) if (isset($refs[$id])) $ordered[] = $refs[$id];

    $defColor = _board_default_color_of_user($pdo, (int)$u['id']);
    $W = 240; $H = 220; $GAP = 20;
    $cols = max(1, (int)ceil(sqrt(count($ordered))));
    $rows = (int)ceil(count($ordered) / $cols);
    $totalW = $cols * $W + ($cols - 1) * $GAP;
    $totalH = $rows * $H + ($rows - 1) * $GAP;
    $x0 = $cx - $totalW / 2;
    $y0 = $cy - $totalH / 2;

    $zBase = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM board_notes WHERE room_id = " . (int)$roomId)->fetchColumn();
    // v1171 link_url に refs 詳細ページへのハッシュリンクを保存 (Miro UI 側で 🔗 コーナー表示)
    $ins = $pdo->prepare("INSERT INTO board_notes
        (room_id, x, y, width, height, color, front_text, link_url, z_index, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $createdIds = [];
    foreach ($ordered as $i => $r) {
        $col = $i % $cols;
        $row = intdiv($i, $cols);
        $x = $x0 + $col * ($W + $GAP);
        $y = $y0 + $row * ($H + $GAP);
        $frontText = _board_ref_to_note_text($r);
        $z = $zBase + $i + 1;
        $linkUrl = '#/refs/' . (int)$r['id'];
        $ins->execute([$roomId, $x, $y, $W, $H, $defColor, $frontText ?: null, $linkUrl, $z, (int)$u['id']]);
        $createdIds[] = (int)$pdo->lastInsertId();
    }
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    // 作成した note を返す
    $out = [];
    if ($createdIds) {
        $place2 = implode(',', array_fill(0, count($createdIds), '?'));
        $q = $pdo->prepare("SELECT n.*, u.display_name AS creator_name
                              FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id
                             WHERE n.id IN ($place2)");
        $q->execute($createdIds);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $out[] = _board_note_shape($r, (int)$u['id']);
    }
    json_response(['ok' => true, 'created' => count($createdIds), 'notes' => $out]);
}

// v1171 中村さん要望「Miro に、たべあるきから張り込む機能もほしい (サムネ画像を積極的に使いたい)」
//   places (食べある記) から 選んだ 場所 を miro ノート として 貼付。 image が 主役 な ので
//   cover_image_thumb を front_image_url に、 name (と 任意で category) を front_text に、
//   link_url は #/places/{id} に。 サイズ は 少し 大きめ (画像 主体)。
function board_notes_from_places(PDO $pdo, array $cfg, int $roomId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $room = _board_room_row($pdo, $roomId);
    if (!$room) throw new ApiException('not_found', 'room なし', 404);
    if (!_board_room_visible_to_user($pdo, $room, (int)$u['id'])) {
        throw new ApiException('forbidden', 'この部屋にはアクセス権がありません', 403);
    }
    $body = read_json_body();
    $ids = [];
    foreach ((array)($body['place_ids'] ?? []) as $x) if (ctype_digit((string)$x) || is_int($x)) $ids[] = (int)$x;
    $ids = array_values(array_unique($ids));
    if (!$ids) throw new ApiException('bad_request', 'place_ids 必要', 400);
    if (count($ids) > 50) throw new ApiException('bad_request', '一度に貼れるのは 50 件まで', 400);
    $existing = (int)$pdo->query("SELECT COUNT(*) FROM board_notes WHERE room_id = " . (int)$roomId . " AND deleted_at IS NULL")->fetchColumn();
    if ($existing + count($ids) > BOARD_MAX_NOTES_PER_ROOM) {
        throw new ApiException('bad_request', 'この部屋の note 上限 ' . BOARD_MAX_NOTES_PER_ROOM . ' を超えます', 400);
    }
    $cx = isset($body['center_x']) ? (float)$body['center_x'] : 0.0;
    $cy = isset($body['center_y']) ? (float)$body['center_y'] : 0.0;
    // places を取得 (image_url + latest_image を使って cover を決定、 places.php と同ロジック)
    $place = implode(',', array_fill(0, count($ids), '?'));
    $rs = $pdo->prepare("
        SELECT p.id, p.title, p.category, p.image_url,
               (SELECT c.image_url FROM place_comments c
                 WHERE c.place_id = p.id AND c.image_url IS NOT NULL
                 ORDER BY c.id DESC LIMIT 1) AS latest_image
          FROM places p
         WHERE p.id IN ($place)");
    $rs->execute($ids);
    $places = [];
    foreach ($rs->fetchAll(PDO::FETCH_ASSOC) as $r) $places[(int)$r['id']] = $r;
    if (!$places) throw new ApiException('not_found', '指定した places が見つかりません', 404);
    $ordered = [];
    foreach ($ids as $id) if (isset($places[$id])) $ordered[] = $places[$id];

    $defColor = _board_default_color_of_user($pdo, (int)$u['id']);
    // 画像 主体 なので 少し 大きめ の 正方形
    $W = 260; $H = 260; $GAP = 20;
    $cols = max(1, (int)ceil(sqrt(count($ordered))));
    $rows = (int)ceil(count($ordered) / $cols);
    $totalW = $cols * $W + ($cols - 1) * $GAP;
    $totalH = $rows * $H + ($rows - 1) * $GAP;
    $x0 = $cx - $totalW / 2;
    $y0 = $cy - $totalH / 2;

    $zBase = (int)$pdo->query("SELECT COALESCE(MAX(z_index), 0) FROM board_notes WHERE room_id = " . (int)$roomId)->fetchColumn();
    $ins = $pdo->prepare("INSERT INTO board_notes
        (room_id, x, y, width, height, color, front_text, front_image_url, link_url, z_index, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $createdIds = [];
    foreach ($ordered as $i => $r) {
        $col = $i % $cols;
        $row = intdiv($i, $cols);
        $x = $x0 + $col * ($W + $GAP);
        $y = $y0 + $row * ($H + $GAP);
        // タイトル + カテゴリ簡易ラベル
        $t = trim((string)$r['title']);
        if ($r['category']) $t .= "\n" . '(' . (string)$r['category'] . ')';
        $img = $r['image_url'] ?: $r['latest_image'];
        $z = $zBase + $i + 1;
        $linkUrl = '#/places/' . (int)$r['id'];
        $ins->execute([$roomId, $x, $y, $W, $H, $defColor, $t ?: null, $img ?: null, $linkUrl, $z, (int)$u['id']]);
        $createdIds[] = (int)$pdo->lastInsertId();
    }
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([$roomId]);
    $out = [];
    if ($createdIds) {
        $place2 = implode(',', array_fill(0, count($createdIds), '?'));
        $q = $pdo->prepare("SELECT n.*, u.display_name AS creator_name
                              FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id
                             WHERE n.id IN ($place2)");
        $q->execute($createdIds);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) $out[] = _board_note_shape($r, (int)$u['id']);
    }
    json_response(['ok' => true, 'created' => count($createdIds), 'notes' => $out]);
}

// venue 省略化: "Proceedings of the CHI Conference..." → "CHI"、
//   "ACM Transactions on Graphics" → "ACM TOG" 相当を簡易ルールで。
function _board_shorten_venue(?string $v): string {
    $v = trim((string)$v);
    if ($v === '') return '';
    $short = $v;
    $lower = mb_strtolower($v);
    $map = [
        'chi conference' => 'CHI', 'uist' => 'UIST', 'siggraph asia' => 'SIGGRAPH Asia', 'siggraph' => 'SIGGRAPH',
        'ubicomp' => 'UbiComp', 'iswc' => 'ISWC', 'cscw' => 'CSCW', 'ismar' => 'ISMAR',
        'ieee vr' => 'IEEE VR', 'ismir' => 'ISMIR', 'nips' => 'NeurIPS', 'neurips' => 'NeurIPS',
        'icml' => 'ICML', 'cvpr' => 'CVPR', 'iccv' => 'ICCV', 'eccv' => 'ECCV',
        'acm transactions on graphics' => 'TOG', 'transactions on visualization' => 'TVCG',
        'human factors in computing systems' => 'CHI', 'nature' => 'Nature', 'science' => 'Science',
    ];
    foreach ($map as $needle => $abbr) {
        if (str_contains($lower, $needle)) { $short = $abbr; break; }
    }
    // Proceedings of the...  → 頭 5 語くらいに短縮
    if ($short === $v && mb_strlen($v) > 30) {
        $short = mb_substr($v, 0, 30) . '…';
    }
    return $short;
}

function _board_ref_to_note_text(array $r): string {
    $title = trim((string)($r['title'] ?? ''));
    if (mb_strlen($title) > 140) $title = mb_substr($title, 0, 137) . '…';
    $authors = json_decode((string)($r['authors_json'] ?? '[]'), true);
    $first = '';
    $n = is_array($authors) ? count($authors) : 0;
    if ($n > 0 && !empty($authors[0]['name'])) {
        // 姓だけ取り出す (英語の場合は最後の単語、日本語はそのまま)
        $name = (string)$authors[0]['name'];
        if (preg_match('/[A-Za-z]/', $name) && strpos($name, ' ') !== false) {
            $parts = explode(' ', trim($name));
            $first = end($parts);
        } else {
            $first = $name;
        }
        if ($n > 1) $first .= '+';
    }
    $year = !empty($r['year']) ? (int)$r['year'] : null;
    $venue = _board_shorten_venue($r['venue'] ?? null);
    $meta = [];
    if ($first !== '') $meta[] = $first;
    if ($year)         $meta[] = '(' . $year . ')';
    if ($venue !== '') $meta[] = $venue;
    $metaLine = implode(' ', $meta);
    return $title . ($metaLine !== '' ? "\n\n" . $metaLine : '');
}

// ─── image generation (OpenAI gpt-image-1) ─────────────────────

// POST /api/board/notes/{id}/generate-image  body: { prompt, side: 'front'|'back' (default 'front') }
function board_note_generate_image(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    if (empty($cfg['openai']['api_key'])) {
        throw new ApiException('server_error', 'OpenAI API key 未設定', 500);
    }
    $st = $pdo->prepare("SELECT id, room_id FROM board_notes WHERE id = ? AND deleted_at IS NULL");
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
        'model'   => BOARD_IMAGE_MODEL,
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
    $pdo->prepare("UPDATE board_notes SET {$col} = ?, updated_at = NOW() WHERE id = ?")->execute([$rel, $id]);
    $pdo->prepare("UPDATE board_rooms SET updated_at = NOW() WHERE id = ?")->execute([(int)$n['room_id']]);

    // 全体レコード返す
    $rr = $pdo->prepare("SELECT n.*, u.display_name AS creator_name FROM board_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.id = ?");
    $rr->execute([$id]);
    json_response([
        'ok'        => true,
        'side'      => $side,
        'image_url' => $rel,
        'note'      => _board_note_shape($rr->fetch(PDO::FETCH_ASSOC), (int)$u['id']),
    ]);
}
