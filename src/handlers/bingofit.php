<?php
// v740 BingoFit (feedback #288) 衣類着回しビンゴ。
//   5x5 盤、 日曜 00:00 (JST) 始まり週次サイクル (既存 bingo に合わせた)。
//   衣類画像は /api/uploads/image で先にアップ → 返ってきた URL を image_url で渡して POST /items。
//   背景透過 PNG (image_url_transparent) は cron worker (scripts/bingofit_worker.php) が
//   非同期で生成。 done になるまで closet UI は「🪄 切り抜き中」 バッジ表示。
//
//   GET    /api/bingofit/items                    自分のクローゼット
//   POST   /api/bingofit/items                    衣類追加 (image_url + label + category)
//   PATCH  /api/bingofit/items/:id                更新 (label / category / archived)
//   DELETE /api/bingofit/items/:id                ソフト削除 (= archive)
//   POST   /api/bingofit/items/:id/retry-bg       rembg 再試行
//   GET    /api/bingofit/board                    今週の盤 (未作成かつ active 25 以上なら自動生成)
//   GET    /api/bingofit/board?week=YYYY-MM-DD    過去週 (未作成 = 404 ではなく空盤)
//   POST   /api/bingofit/board/cells/:idx/open    マスを開ける
//   DELETE /api/bingofit/board/cells/:idx/open    開けを取消
//   GET    /api/bingofit/history                  過去 12 週

declare(strict_types=1);

const BINGOFIT_MAX_ITEMS = 50;
const BINGOFIT_BOARD_CELLS = 25;

function route_bingofit(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';
    if ($sub === 'items' && !isset($seg[2])) {
        if ($method === 'GET')  { bingofit_items_list($pdo, $uid); return; }
        if ($method === 'POST') { bingofit_items_create($pdo, $uid); return; }
    }
    if ($sub === 'items' && isset($seg[2])) {
        $iid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($action === '' && $method === 'PATCH')  { bingofit_items_update($pdo, $uid, $iid); return; }
        if ($action === '' && $method === 'DELETE') { bingofit_items_delete($pdo, $uid, $iid); return; }
        if ($action === 'retry-bg' && $method === 'POST') { bingofit_items_retry_bg($pdo, $uid, $iid); return; }
    }
    if ($sub === 'board') {
        if (!isset($seg[2]) && $method === 'GET') { bingofit_board_get($pdo, $uid); return; }
        if (($seg[2] ?? '') === 'cells' && isset($seg[3]) && ($seg[4] ?? '') === 'open') {
            $idx = (int)$seg[3];
            if ($method === 'POST')   { bingofit_cell_open($pdo, $uid, $idx, true); return; }
            if ($method === 'DELETE') { bingofit_cell_open($pdo, $uid, $idx, false); return; }
        }
    }
    if ($sub === 'history' && $method === 'GET') { bingofit_history($pdo, $uid); return; }
    json_error('not_found', "no bingofit route", 404);
}

// ── 衣類 ──────────────────────────────────────────────────────
function bingofit_items_list(PDO $pdo, int $uid): void {
    // v741 last_worn_at + days_since_worn を付ける (「最近着てない服」 表示用)。
    $st = $pdo->prepare("SELECT id, label, category, image_url, image_url_transparent, bg_status, bg_error,
                                archived_at, created_at, last_worn_at,
                                CASE WHEN last_worn_at IS NULL THEN NULL
                                     ELSE TIMESTAMPDIFF(DAY, last_worn_at, NOW()) END AS days_since_worn
                           FROM bingofit_items
                          WHERE user_id=?
                          ORDER BY archived_at IS NOT NULL, id DESC");
    $st->execute([$uid]);
    $items = array_map(function($r) {
        return [
            'id' => (int)$r['id'],
            'label' => $r['label'],
            'category' => $r['category'],
            'image_url' => $r['image_url'],
            'image_url_transparent' => $r['image_url_transparent'],
            'bg_status' => $r['bg_status'],
            'bg_error' => $r['bg_error'],
            'archived' => $r['archived_at'] !== null,
            'created_at' => $r['created_at'],
            'last_worn_at' => $r['last_worn_at'],
            'days_since_worn' => $r['days_since_worn'] !== null ? (int)$r['days_since_worn'] : null,
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items, 'max_items' => BINGOFIT_MAX_ITEMS]);
}

function bingofit_items_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $imageUrl = trim((string)require_field($body, 'image_url'));
    if ($imageUrl === '' || !str_starts_with($imageUrl, '/uploads/')) {
        throw new ApiException('bad_request', 'image_url は /uploads/ で始まる必要があります', 400);
    }
    $label = trim((string)($body['label'] ?? ''));
    if (mb_strlen($label) > 80) throw new ApiException('bad_request', 'label は 80 文字以下', 400);
    $category = (string)($body['category'] ?? 'other');
    if (!in_array($category, ['top','bottom','outer','shoes','other'], true)) $category = 'other';

    $stc = $pdo->prepare("SELECT COUNT(*) FROM bingofit_items WHERE user_id=? AND archived_at IS NULL");
    $stc->execute([$uid]);
    if ((int)$stc->fetchColumn() >= BINGOFIT_MAX_ITEMS) {
        throw new ApiException('too_many', '登録上限 (' . BINGOFIT_MAX_ITEMS . '着) に達しています', 400);
    }

    $pdo->prepare("INSERT INTO bingofit_items (user_id, label, category, image_url, bg_status)
                   VALUES (?,?,?,?,'pending')")
        ->execute([$uid, $label, $category, $imageUrl]);
    $id = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $id]);
}

function bingofit_items_update(PDO $pdo, int $uid, int $iid): void {
    $body = read_json_body();
    $st = $pdo->prepare("SELECT user_id FROM bingofit_items WHERE id=?");
    $st->execute([$iid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '他人の衣類は編集不可', 403);

    $set = [];
    $args = [];
    if (array_key_exists('label', $body)) {
        $label = trim((string)$body['label']);
        if (mb_strlen($label) > 80) throw new ApiException('bad_request', 'label は 80 文字以下', 400);
        $set[] = 'label=?'; $args[] = $label;
    }
    if (array_key_exists('category', $body)) {
        $cat = (string)$body['category'];
        if (!in_array($cat, ['top','bottom','outer','shoes','other'], true)) $cat = 'other';
        $set[] = 'category=?'; $args[] = $cat;
    }
    if (array_key_exists('archived', $body)) {
        $set[] = $body['archived'] ? 'archived_at=NOW()' : 'archived_at=NULL';
    }
    if (empty($set)) { json_response(['ok' => true, 'noop' => true]); return; }
    $args[] = $iid;
    $pdo->prepare("UPDATE bingofit_items SET " . implode(',', $set) . " WHERE id=?")->execute($args);
    json_response(['ok' => true]);
}

function bingofit_items_delete(PDO $pdo, int $uid, int $iid): void {
    $st = $pdo->prepare("SELECT user_id FROM bingofit_items WHERE id=?");
    $st->execute([$iid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '他人の衣類は削除不可', 403);
    // soft delete (= archive)。 hard delete は今後保留 (盤に参照される可能性)。
    $pdo->prepare("UPDATE bingofit_items SET archived_at=NOW() WHERE id=? AND archived_at IS NULL")
        ->execute([$iid]);
    json_response(['ok' => true]);
}

function bingofit_items_retry_bg(PDO $pdo, int $uid, int $iid): void {
    $st = $pdo->prepare("SELECT user_id, bg_status FROM bingofit_items WHERE id=?");
    $st->execute([$iid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '他人の衣類', 403);
    if ($row['bg_status'] === 'pending') throw new ApiException('bad_request', 'すでに処理待ち', 400);
    $pdo->prepare("UPDATE bingofit_items SET bg_status='pending', bg_error=NULL WHERE id=?")
        ->execute([$iid]);
    json_response(['ok' => true]);
}

// ── 盤 ────────────────────────────────────────────────────────
function bingofit_week_start_jst(): string {
    // 既存 bingo と同じく日曜 (JST) を週始まりに。
    $d = new DateTime('now', new DateTimeZone('Asia/Tokyo'));
    $dow = (int)$d->format('w'); // 0=Sun
    $d->modify('-' . $dow . ' days');
    return $d->format('Y-m-d');
}

function bingofit_board_get(PDO $pdo, int $uid): void {
    $week = isset($_GET['week']) ? (string)$_GET['week'] : bingofit_week_start_jst();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $week)) throw new ApiException('bad_request', 'week は YYYY-MM-DD', 400);
    $isCurrent = ($week === bingofit_week_start_jst());

    $st = $pdo->prepare("SELECT * FROM bingofit_boards WHERE user_id=? AND week_start=?");
    $st->execute([$uid, $week]);
    $board = $st->fetch(PDO::FETCH_ASSOC);

    if (!$board && $isCurrent) {
        // 今週の盤を生成 (active items 25 未満なら盤を作らず登録誘導)。
        $stI = $pdo->prepare("SELECT id FROM bingofit_items WHERE user_id=? AND archived_at IS NULL");
        $stI->execute([$uid]);
        $itemIds = array_map('intval', $stI->fetchAll(PDO::FETCH_COLUMN));
        if (count($itemIds) < BINGOFIT_BOARD_CELLS) {
            json_response([
                'week_start'   => $week,
                'cells'        => [],
                'opens'        => new stdClass(),
                'bingo_lines'  => 0,
                'is_current'   => true,
                'need_items'   => BINGOFIT_BOARD_CELLS - count($itemIds),
                'active_count' => count($itemIds),
            ]);
            return;
        }
        // crc32(user . week) で決定論的シャッフル → 25 件抽出
        mt_srand((int)crc32($uid . '_' . $week));
        shuffle($itemIds);
        $cells = array_slice($itemIds, 0, BINGOFIT_BOARD_CELLS);
        mt_srand();
        $pdo->prepare("INSERT INTO bingofit_boards (user_id, week_start, cells_json) VALUES (?,?,?)")
            ->execute([$uid, $week, json_encode($cells)]);
        $st->execute([$uid, $week]);
        $board = $st->fetch(PDO::FETCH_ASSOC);
    }

    if (!$board) {
        json_response([
            'week_start'  => $week,
            'cells'       => [],
            'opens'       => new stdClass(),
            'bingo_lines' => 0,
            'is_current'  => $isCurrent,
        ]);
        return;
    }

    $cellIds = json_decode($board['cells_json'], true) ?: [];
    $cells = [];
    if (!empty($cellIds)) {
        $place = implode(',', array_fill(0, count($cellIds), '?'));
        $stD = $pdo->prepare("SELECT id, label, image_url, image_url_transparent, bg_status FROM bingofit_items WHERE id IN ($place)");
        $stD->execute($cellIds);
        $by = [];
        foreach ($stD->fetchAll(PDO::FETCH_ASSOC) as $r) $by[(int)$r['id']] = $r;
        foreach ($cellIds as $idx => $cid) {
            $r = $by[(int)$cid] ?? null;
            $cells[] = $r ? [
                'index'   => $idx,
                'item_id' => (int)$cid,
                'label'   => $r['label'],
                'image_url' => $r['image_url'],
                'image_url_transparent' => $r['image_url_transparent'],
                'bg_status' => $r['bg_status'],
            ] : [
                'index'   => $idx,
                'item_id' => (int)$cid,
                'label'   => '(削除済)',
                'image_url' => null,
                'image_url_transparent' => null,
                'bg_status' => 'failed',
            ];
        }
    }
    $stO = $pdo->prepare("SELECT cell_index, opened_at FROM bingofit_cell_opens WHERE board_id=?");
    $stO->execute([(int)$board['id']]);
    $opens = [];
    foreach ($stO->fetchAll(PDO::FETCH_ASSOC) as $o) $opens[(int)$o['cell_index']] = $o['opened_at'];
    $lines = bingofit_count_lines(array_keys($opens));
    json_response([
        'week_start'  => $board['week_start'],
        'board_id'    => (int)$board['id'],
        'cells'       => $cells,
        'opens'       => empty($opens) ? new stdClass() : $opens,
        'bingo_lines' => $lines,
        'is_current'  => $isCurrent,
    ]);
}

function bingofit_count_lines(array $openedIdxs): int {
    $set = array_flip($openedIdxs);
    $lines = 0;
    for ($r = 0; $r < 5; $r++) {
        $ok = true;
        for ($c = 0; $c < 5; $c++) if (!isset($set[$r * 5 + $c])) { $ok = false; break; }
        if ($ok) $lines++;
    }
    for ($c = 0; $c < 5; $c++) {
        $ok = true;
        for ($r = 0; $r < 5; $r++) if (!isset($set[$r * 5 + $c])) { $ok = false; break; }
        if ($ok) $lines++;
    }
    $ok = true; for ($i = 0; $i < 5; $i++) if (!isset($set[$i * 5 + $i])) { $ok = false; break; }
    if ($ok) $lines++;
    $ok = true; for ($i = 0; $i < 5; $i++) if (!isset($set[$i * 5 + (4 - $i)])) { $ok = false; break; }
    if ($ok) $lines++;
    return $lines;
}

function bingofit_cell_open(PDO $pdo, int $uid, int $idx, bool $open): void {
    if ($idx < 0 || $idx >= BINGOFIT_BOARD_CELLS) throw new ApiException('bad_request', 'cell_index 0-24', 400);
    $week = bingofit_week_start_jst();
    $st = $pdo->prepare("SELECT id, cells_json FROM bingofit_boards WHERE user_id=? AND week_start=?");
    $st->execute([$uid, $week]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '今週の盤がありません (GET /board で先に生成)', 404);
    $bid = (int)$row['id'];
    if ($open) {
        $pdo->prepare("INSERT INTO bingofit_cell_opens (board_id, cell_index) VALUES (?,?) ON DUPLICATE KEY UPDATE opened_at=opened_at")
            ->execute([$bid, $idx]);
        // v741 該当 item の last_worn_at を更新 (「最近着てない服」 サジェスト用)。
        $cellsArr = json_decode($row['cells_json'], true) ?: [];
        $itemId = (int)($cellsArr[$idx] ?? 0);
        if ($itemId > 0) {
            $pdo->prepare("UPDATE bingofit_items SET last_worn_at=NOW() WHERE id=? AND user_id=?")
                ->execute([$itemId, $uid]);
        }
    } else {
        $pdo->prepare("DELETE FROM bingofit_cell_opens WHERE board_id=? AND cell_index=?")->execute([$bid, $idx]);
    }
    $stO = $pdo->prepare("SELECT cell_index FROM bingofit_cell_opens WHERE board_id=?");
    $stO->execute([$bid]);
    $opened = array_map('intval', $stO->fetchAll(PDO::FETCH_COLUMN));
    $lines = bingofit_count_lines($opened);
    json_response(['ok' => true, 'bingo_lines' => $lines, 'opened_count' => count($opened)]);
}

// ── 履歴 ──────────────────────────────────────────────────────
function bingofit_history(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT b.id, b.week_start,
               (SELECT COUNT(*) FROM bingofit_cell_opens o WHERE o.board_id=b.id) AS opened_count
          FROM bingofit_boards b
         WHERE b.user_id=?
         ORDER BY b.week_start DESC LIMIT 12");
    $st->execute([$uid]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $stO = $pdo->prepare("SELECT cell_index FROM bingofit_cell_opens WHERE board_id=?");
        $stO->execute([(int)$r['id']]);
        $opened = array_map('intval', $stO->fetchAll(PDO::FETCH_COLUMN));
        $items[] = [
            'week_start'   => $r['week_start'],
            'opened_count' => (int)$r['opened_count'],
            'bingo_lines'  => bingofit_count_lines($opened),
        ];
    }
    json_response(['items' => $items]);
}
