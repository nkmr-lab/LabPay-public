<?php
// /api/groups — グループ (ad-hoc, for short-lived contexts:
// 出張中, 旅行, 学会, 飲み会連幹事). Creator picks members; everyone in the
// group can post items (memo / url / time) into a shared feed and launch
// ルーレット or 飲み会割り勘 pre-filled with the group's members.

declare(strict_types=1);

function route_groups(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { groups_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { groups_create($pdo, $cfg); return; }

    if ($sub !== '') {
        $id = resolve_group_id($pdo, $sub);
        if ($id > 0) {
            $next = $seg[2] ?? '';
            if ($next === '' && $method === 'GET')    { groups_detail($pdo, $cfg, $id); return; }
            if ($next === '' && $method === 'PATCH')  { groups_patch($pdo, $cfg, $id);  return; }
            if ($next === '' && $method === 'DELETE') { groups_close($pdo, $cfg, $id);  return; }
            if ($next === 'items' && $method === 'POST')                { group_items_add($pdo, $cfg, $id);    return; }
            if ($next === 'items' && isset($seg[3]) && $method === 'DELETE') { group_items_del($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'members' && $method === 'POST')              { group_members_add($pdo, $cfg, $id);  return; }
            if ($next === 'members' && isset($seg[3]) && $method === 'DELETE') { group_members_del($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'expenses' && $method === 'GET')              { group_expenses_list($pdo, $cfg, $id); return; }
            if ($next === 'expenses' && $method === 'POST')             { group_expenses_add($pdo, $cfg, $id);  return; }
            if ($next === 'expenses' && isset($seg[3]) && $method === 'PATCH')  { group_expenses_patch($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'expenses' && isset($seg[3]) && $method === 'DELETE') { group_expenses_del($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'settle'   && $method === 'POST')             { group_settle_notify($pdo, $cfg, $id); return; }
            if ($next === 'receipts' && $method === 'GET')              { group_receipts_list($pdo, $cfg, $id);   return; }
            if ($next === 'receipts' && $method === 'POST')             { group_receipts_add($pdo, $cfg, $id);    return; }
            if ($next === 'receipts' && isset($seg[3]) && $method === 'DELETE') { group_receipts_delete($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'schedule' && $method === 'GET')              { group_schedule_list($pdo, $cfg, $id);   return; }
            if ($next === 'schedule' && $method === 'POST')             { group_schedule_add($pdo, $cfg, $id);    return; }
            // 「/schedule/{id}/move」 が generic PATCH /schedule/{id} に吸い込まれないよう
            // より具体的な move ルートを先に判定する。
            if ($next === 'schedule' && isset($seg[3]) && ($seg[4] ?? '') === 'move' && $method === 'PATCH') { group_schedule_move($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'schedule' && isset($seg[3]) && $method === 'PATCH')  { group_schedule_patch($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'schedule' && isset($seg[3]) && $method === 'DELETE') { group_schedule_del($pdo, $cfg, $id, (int)$seg[3]); return; }
        }
    }
    json_error('not_found', "no groups route for $method $sub", 404);
}

// Accept either a numeric id ("123") or a slug ("avi2026"). Returns the
// numeric id or 0 if not found. 数字オンリーは id として解決するので、slug は
// 必ず英字を含むよう INSERT 側で弾く。
function resolve_group_id(PDO $pdo, string $key): int {
    if ($key === '') return 0;
    if (ctype_digit($key)) {
        $st = $pdo->prepare("SELECT id FROM adhoc_groups WHERE id = ?");
        $st->execute([(int)$key]);
        return (int)$st->fetchColumn();
    }
    $st = $pdo->prepare("SELECT id FROM adhoc_groups WHERE slug = ?");
    $st->execute([$key]);
    return (int)$st->fetchColumn();
}

// Helpers
function group_assert_member(PDO $pdo, int $groupId, int $userId): void {
    $st = $pdo->prepare("SELECT 1 FROM adhoc_group_members WHERE group_id=? AND user_id=?");
    $st->execute([$groupId, $userId]);
    if ($st->fetchColumn() === false) {
        throw new ApiException('forbidden', 'メンバーではありません', 403);
    }
}
function group_assert_creator_or_admin(PDO $pdo, int $groupId, array $u): void {
    $st = $pdo->prepare("SELECT creator_user_id FROM adhoc_groups WHERE id=?");
    $st->execute([$groupId]);
    $cid = (int)$st->fetchColumn();
    if ($cid === 0) throw new ApiException('not_found', 'group not found', 404);
    if ($cid !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '作成者または admin だけが操作できます', 403);
    }
}

// ─── LIST + CREATE ───────────────────────────────────────────

function groups_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT g.id, g.slug, g.title, g.description, g.image_url,
               g.closed_at, g.created_at,
               uc.display_name AS creator_name,
               (SELECT COUNT(*) FROM adhoc_group_members WHERE group_id = g.id) AS member_count
          FROM adhoc_groups g
          JOIN users uc ON uc.id = g.creator_user_id
          JOIN adhoc_group_members m ON m.group_id = g.id AND m.user_id = ?
         ORDER BY g.closed_at IS NULL DESC, g.created_at DESC LIMIT 100");
    $st->execute([$u['id']]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    // 各グループのメンバ avatar 一覧 (リスト UI で並べる用)。 N+1 を避けるため
    // group_id IN (...) で 1 クエリにまとめる。
    if ($items) {
        $ids = array_map(fn($r) => (int)$r['id'], $items);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $mst = $pdo->prepare("
            SELECT m.group_id, u.id, u.display_name, u.avatar_url
              FROM adhoc_group_members m
              JOIN users u ON u.id = m.user_id
             WHERE m.group_id IN ($place)
             ORDER BY m.group_id, m.joined_at, u.id");
        $mst->execute($ids);
        $byGroup = [];
        foreach ($mst as $r) {
            $gid = (int)$r['group_id'];
            $byGroup[$gid][] = [
                'id'           => (int)$r['id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
            ];
        }
        foreach ($items as &$it) {
            $it['members'] = $byGroup[(int)$it['id']] ?? [];
        }
        unset($it);
    }
    json_response(['items' => $items]);
}

function groups_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $description = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;
    $imageUrl    = validate_product_image_url($body['image_url'] ?? null);

    // Optional slug: URL 用の短い名前。^[A-Za-z0-9_-]{1,64}$ で、かつ全数字は禁止
    // (数字オンリーは既存 id の解決と衝突するため)。空文字 / 未指定 は NULL。
    $slug = null;
    if (isset($body['slug']) && $body['slug'] !== null && $body['slug'] !== '') {
        $s = trim((string)$body['slug']);
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $s)) {
            throw new ApiException('bad_request', 'slug は英数字・_・- の 1..64 文字で', 400);
        }
        if (ctype_digit($s)) {
            throw new ApiException('bad_request', 'slug は数字だけの形式は使えません (id と衝突するため)', 400);
        }
        $check = $pdo->prepare("SELECT 1 FROM adhoc_groups WHERE slug = ?");
        $check->execute([$s]);
        if ($check->fetchColumn()) {
            throw new ApiException('conflict', "slug『{$s}』は既に使われています", 409);
        }
        $slug = $s;
    }

    $memberIds = array_values(array_unique(array_filter(array_map('intval', (array)($body['member_ids'] ?? [])))));
    // Creator is always a member.
    $memberIds[] = (int)$u['id'];
    $memberIds = array_values(array_unique($memberIds));

    // Verify members exist.
    $place = implode(',', array_fill(0, count($memberIds), '?'));
    $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($memberIds);
    $found = array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
    if (count($found) !== count($memberIds)) {
        throw new ApiException('bad_request', 'one or more member_ids not found', 400);
    }

    $gid = db_tx($pdo, function () use ($pdo, $slug, $u, $title, $description, $imageUrl, $memberIds) {
        $st = $pdo->prepare("INSERT INTO adhoc_groups (slug, creator_user_id, title, description, image_url) VALUES (?,?,?,?,?)");
        $st->execute([$slug, $u['id'], $title, $description, $imageUrl]);
        $gid = (int)$pdo->lastInsertId();
        $st = $pdo->prepare("INSERT INTO adhoc_group_members (group_id, user_id) VALUES (?,?)");
        foreach ($memberIds as $uid) $st->execute([$gid, $uid]);
        return $gid;
    });

    // Notify non-creator members.
    foreach ($memberIds as $uid) {
        if ($uid === (int)$u['id']) continue;
        notify_safely($pdo, $cfg, $uid, 'admin_notice',
            "👥 グループ「{$title}」に追加されました", 'group', $gid);
    }
    json_response(['ok' => true, 'id' => $gid, 'slug' => $slug]);
}

// ─── DETAIL ──────────────────────────────────────────────────

function groups_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $st = $pdo->prepare("
        SELECT g.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url
          FROM adhoc_groups g JOIN users uc ON uc.id = g.creator_user_id
         WHERE g.id = ?");
    $st->execute([$id]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'group not found', 404);

    $stM = $pdo->prepare("
        SELECT u.id, u.display_name, u.avatar_url, u.grade, m.joined_at
          FROM adhoc_group_members m
          JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?
         ORDER BY m.joined_at");
    $stM->execute([$id]);
    $g['members'] = $stM->fetchAll(PDO::FETCH_ASSOC);

    $stI = $pdo->prepare("
        SELECT i.*, u.display_name AS author_name, u.avatar_url AS author_avatar_url
          FROM adhoc_group_items i
          JOIN users u ON u.id = i.created_by_user_id
         WHERE i.group_id = ?
         ORDER BY i.id DESC LIMIT 100");
    $stI->execute([$id]);
    $g['items'] = $stI->fetchAll(PDO::FETCH_ASSOC);

    json_response($g);
}

// 既存グループの slug / image_url を作成者/admin が後から編集。slug は空文字 / null で
// クリア (URL 用の名前を外す)。image_url も同様に空 → NULL。重複・全数字・不正文字は
// それぞれエラー。
function groups_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $body = read_json_body();
    $hasSlug  = array_key_exists('slug', $body);
    $hasImage = array_key_exists('image_url', $body);
    $hasStart = array_key_exists('schedule_start_date', $body);
    $hasEnd   = array_key_exists('schedule_end_date', $body);
    if (!$hasSlug && !$hasImage && !$hasStart && !$hasEnd) {
        throw new ApiException('bad_request', 'nothing to update', 400);
    }
    $sets = []; $args = [];
    $respSlug = null; $respImage = null;
    if ($hasStart) {
        $v = $body['schedule_start_date'];
        if ($v === null || $v === '') { $sets[] = 'schedule_start_date = NULL'; }
        else {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v)) {
                throw new ApiException('bad_request', 'schedule_start_date は YYYY-MM-DD', 400);
            }
            $sets[] = 'schedule_start_date = ?'; $args[] = (string)$v;
        }
    }
    if ($hasEnd) {
        $v = $body['schedule_end_date'];
        if ($v === null || $v === '') { $sets[] = 'schedule_end_date = NULL'; }
        else {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v)) {
                throw new ApiException('bad_request', 'schedule_end_date は YYYY-MM-DD', 400);
            }
            $sets[] = 'schedule_end_date = ?'; $args[] = (string)$v;
        }
    }
    if ($hasSlug) {
        $raw = $body['slug'];
        if ($raw === null || $raw === '') {
            $sets[] = 'slug = NULL';
        } else {
            $s = trim((string)$raw);
            if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $s)) {
                throw new ApiException('bad_request', 'slug は英数字・_・- の 1..64 文字で', 400);
            }
            if (ctype_digit($s)) {
                throw new ApiException('bad_request', 'slug は数字だけの形式は使えません (id と衝突するため)', 400);
            }
            $check = $pdo->prepare("SELECT id FROM adhoc_groups WHERE slug = ? AND id <> ?");
            $check->execute([$s, $id]);
            if ($check->fetchColumn()) {
                throw new ApiException('conflict', "slug『{$s}』は既に使われています", 409);
            }
            $sets[] = 'slug = ?'; $args[] = $s; $respSlug = $s;
        }
    }
    if ($hasImage) {
        $img = validate_product_image_url($body['image_url']);
        if ($img === null) { $sets[] = 'image_url = NULL'; }
        else               { $sets[] = 'image_url = ?'; $args[] = $img; $respImage = $img; }
    }
    $args[] = $id;
    $pdo->prepare('UPDATE adhoc_groups SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($args);
    json_response(['ok' => true, 'slug' => $respSlug, 'image_url' => $respImage]);
}

function groups_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $pdo->prepare("UPDATE adhoc_groups SET closed_at = NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─── ITEMS ───────────────────────────────────────────────────

function group_items_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? 'memo');
    if (!in_array($kind, ['memo','url','time'], true)) {
        throw new ApiException('bad_request', 'kind must be memo/url/time', 400);
    }
    $text = isset($body['body']) ? mb_substr((string)$body['body'], 0, 5000) : null;
    $url  = null;
    if ($kind === 'url') {
        $raw = trim((string)($body['url'] ?? ''));
        if (!preg_match('#^https?://#', $raw)) {
            throw new ApiException('bad_request', 'url must start with http(s)://', 400);
        }
        $url = mb_substr($raw, 0, 2000);
    }
    $when = null;
    if ($kind === 'time') {
        $raw = trim((string)($body['scheduled_at'] ?? ''));
        $raw = str_replace('T', ' ', $raw);
        if (strlen($raw) === 16) $raw .= ':00';
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if (!$dt) throw new ApiException('bad_request', 'scheduled_at must be Y-m-d H:i', 400);
        $when = $dt->format('Y-m-d H:i:s');
    }
    $st = $pdo->prepare("INSERT INTO adhoc_group_items
        (group_id, kind, body, url, scheduled_at, created_by_user_id)
        VALUES (?,?,?,?,?,?)");
    $st->execute([$id, $kind, $text, $url, $when, $u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function group_items_del(PDO $pdo, array $cfg, int $groupId, int $itemId): void {
    $u = Auth::requireUser($pdo, $cfg);
    // Only the item's author can delete (admin override too).
    $st = $pdo->prepare("SELECT created_by_user_id FROM adhoc_group_items
        WHERE id = ? AND group_id = ?");
    $st->execute([$itemId, $groupId]);
    $owner = (int)$st->fetchColumn();
    if ($owner === 0) throw new ApiException('not_found', 'item not found', 404);
    if ($owner !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '投稿者のみ削除可能', 403);
    }
    $pdo->prepare("DELETE FROM adhoc_group_items WHERE id=?")->execute([$itemId]);
    json_response(['ok' => true]);
}

// ─── MEMBERS ─────────────────────────────────────────────────

// ─── RECEIPTS (レシートストック) ─────────────────────────────
// 撮影だけして後で 「これを ワリカ に使う」 二段運用のためのストック。
// taken_at / lat / lng はクライアントから送信、 GPS は許可された時だけ。

// Receipt = is_draft=1 の adhoc_group_expenses 行として一元管理。撮影時は最低限の
// メタ (image_url, taken_at, lat, lng) だけ入れて、 amount/payer/participants/memo
// は空状態。 後で /expenses/{id} の PATCH で精緻化すると、 amount > 0 になった
// 時点で backend が is_draft=0 に自動 flip 。
function group_receipts_list(PDO $pdo, array $cfg, int $groupId): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $groupId, (int)$u['id']);
    $st = $pdo->prepare("
        SELECT e.id, e.image_url, e.created_by_user_id AS uploaded_by_user_id,
               e.created_at, e.taken_at, e.lat, e.lng,
               u.display_name AS uploaded_by_name, u.avatar_url AS uploaded_by_avatar_url
          FROM adhoc_group_expenses e
          JOIN users u ON u.id = e.created_by_user_id
         WHERE e.group_id = ? AND e.is_draft = 1
         ORDER BY e.id DESC LIMIT 100");
    $st->execute([$groupId]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function group_receipts_add(PDO $pdo, array $cfg, int $groupId): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $groupId, (int)$u['id']);
    $body = read_json_body();
    $img = validate_product_image_url($body['image_url'] ?? null);
    if ($img === null) throw new ApiException('bad_request', 'image_url required', 400);
    $takenAt = null;
    if (!empty($body['taken_at'])) {
        $raw = str_replace('T', ' ', trim((string)$body['taken_at']));
        $raw = preg_replace('/[Zz].*$/', '', $raw);
        $raw = preg_replace('/[\+\-]\d{2}:?\d{2}$/', '', $raw);
        $raw = substr($raw, 0, 19);
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $raw);
        if ($dt) $takenAt = $dt->format('Y-m-d H:i:s');
    }
    $lat = isset($body['lat']) && is_numeric($body['lat']) ? (float)$body['lat'] : null;
    $lng = isset($body['lng']) && is_numeric($body['lng']) ? (float)$body['lng'] : null;
    if ($lat !== null && ($lat < -90 || $lat > 90))   $lat = null;
    if ($lng !== null && ($lng < -180 || $lng > 180)) $lng = null;

    // draft state: payer_user_id NULL、amount_jpy 0、participants '[]' (空配列)
    $st = $pdo->prepare("INSERT INTO adhoc_group_expenses
        (group_id, payer_user_id, amount_jpy, amount_original, currency, rate_to_jpy,
         memo, image_url, participants_json, created_by_user_id,
         is_draft, taken_at, lat, lng)
        VALUES (?, NULL, 0, NULL, 'JPY', NULL,
                NULL, ?, '[]', ?,
                1, ?, ?, ?)");
    $st->execute([$groupId, $img, $u['id'], $takenAt, $lat, $lng]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function group_receipts_delete(PDO $pdo, array $cfg, int $groupId, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $groupId, (int)$u['id']);
    // 安全側: draft (is_draft=1) のみ削除可。 通常支出 は /expenses/{id} DELETE で。
    $pdo->prepare("DELETE FROM adhoc_group_expenses
        WHERE id=? AND group_id=? AND is_draft=1")->execute([$rid, $groupId]);
    json_response(['ok' => true]);
}

function group_members_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $body = read_json_body();
    $uid = (int)require_field($body, 'user_id');
    $st = $pdo->prepare("SELECT display_name FROM users WHERE id=? AND kind='human'");
    $st->execute([$uid]);
    $name = $st->fetchColumn();
    if ($name === false) throw new ApiException('not_found', 'user not found', 404);
    $pdo->prepare("INSERT IGNORE INTO adhoc_group_members (group_id, user_id) VALUES (?,?)")
        ->execute([$id, $uid]);
    $stT = $pdo->prepare("SELECT title FROM adhoc_groups WHERE id=?");
    $stT->execute([$id]); $title = (string)$stT->fetchColumn();
    notify_safely($pdo, $cfg, $uid, 'admin_notice',
        "👥 グループ「{$title}」に追加されました", 'group', $id);
    json_response(['ok' => true]);
}

function group_members_del(PDO $pdo, array $cfg, int $groupId, int $uid): void {
    $u = Auth::requireUser($pdo, $cfg);
    // Self-remove is OK; otherwise creator/admin only.
    if ($uid !== (int)$u['id']) group_assert_creator_or_admin($pdo, $groupId, $u);
    $pdo->prepare("DELETE FROM adhoc_group_members WHERE group_id=? AND user_id=?")
        ->execute([$groupId, $uid]);
    json_response(['ok' => true]);
}

// ─── EXPENSES (ワリカ) ──────────────────────────────────────────
// Splitwise-style: each expense records (payer, amount in JPY, currency snapshot,
// memo, participants snapshot). Settlement computes net balance per user and
// proposes a minimal greedy transfer plan (largest creditor ↔ largest debtor).

function group_expenses_list(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);

    // draft (is_draft=1) は 「保存済みレシート」 で別管理。ワリカ集計には含めない。
    // payer_user_id は draft で NULL になり得るので INNER JOIN ではなく LEFT JOIN。
    $st = $pdo->prepare("
        SELECT e.*, up.display_name AS payer_name, up.avatar_url AS payer_avatar_url
          FROM adhoc_group_expenses e
          LEFT JOIN users up ON up.id = e.payer_user_id
         WHERE e.group_id = ? AND e.is_draft = 0
         ORDER BY e.id DESC LIMIT 200");
    $st->execute([$id]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    // Compute per-user numbers:
    //   paid_jpy  = この人が立替えた合計 (各 expense の amount_jpy 全額)
    //   spent_jpy = この人が「使った額」(参加した expense における自分の取り分の合計)
    //   net_jpy   = paid_jpy - spent_jpy  (＋なら受取、−なら支払)
    // 「貸し借り情報」 = net (送金プランの元) / 「支出情報」 = spent + paid
    $paid  = []; // user_id => int
    $spent = []; // user_id => int
    foreach ($rows as &$r) {
        $r['amount_jpy'] = (int)$r['amount_jpy'];
        // participants_json は 2 形式を受ける:
        //   旧 (legacy):  [1, 2, 3]                              全員等分
        //   新 (rich):    [{"u":1,"fixed":5000},{"u":2},{"u":3}] 一部固定 + 残り等分
        // 内部で 「ids + fixed map」 に normalize して扱う。
        $parts = json_decode((string)$r['participants_json'], true);
        $ids = []; $fixed = []; // user_id => int
        if (is_array($parts)) {
            foreach ($parts as $p) {
                if (is_array($p) && isset($p['u'])) {
                    $uid = (int)$p['u'];
                    $ids[] = $uid;
                    if (isset($p['fixed'])) $fixed[$uid] = max(0, (int)$p['fixed']);
                } else {
                    $ids[] = (int)$p;
                }
            }
        }
        unset($r['participants_json']);
        $r['participants'] = $ids;
        // 各参加者の share を計算 (固定 + 残り等分 + rounding leftover) して
        // フロントが breakdown 表示できるように shares を返す。
        $r['shares'] = [];
        $fixedTotal = array_sum($fixed);
        $unfixed = array_values(array_filter($ids, fn($u) => !isset($fixed[$u])));
        $remaining = max(0, $r['amount_jpy'] - $fixedTotal);
        $n = count($unfixed);
        $share = $n > 0 ? (int)floor($remaining / $n) : 0;
        $leftover = $n > 0 ? $remaining - $share * $n : 0;
        $payerId = (int)$r['payer_user_id'];
        $paid[$payerId] = ($paid[$payerId] ?? 0) + $r['amount_jpy'];
        $sharesByUid = [];
        $uIdx = 0;
        foreach ($ids as $pid) {
            if (isset($fixed[$pid])) {
                $sharesByUid[$pid] = ['share_jpy' => $fixed[$pid], 'fixed' => true];
            } else {
                $myShare = $share + ($uIdx === 0 ? $leftover : 0);
                $sharesByUid[$pid] = ['share_jpy' => $myShare, 'fixed' => false];
                $uIdx++;
            }
            $spent[$pid] = ($spent[$pid] ?? 0) + $sharesByUid[$pid]['share_jpy'];
        }
        foreach ($ids as $pid) {
            $r['shares'][] = ['user_id' => $pid] + $sharesByUid[$pid];
        }
    }
    unset($r);

    // 全部の関与者 (払ったか使ったかどちらかでも) を拾う。
    // 注: array_unique は元の key を保持するので [0=>A, 2=>B] のように index が
    // 飛ぶことがあり、その配列をそのまま $st->execute() に渡すと PDO が positional
    // binding を array key で解釈して 「Invalid parameter number」 になる。
    // array_values で 0,1,2,... に詰め直してから渡す。
    $allUids = array_values(array_unique(array_merge(array_keys($paid), array_keys($spent))));
    $byUser = [];
    if ($allUids) {
        $place = implode(',', array_fill(0, count($allUids), '?'));
        $stU = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
        $stU->execute($allUids);
        foreach ($stU->fetchAll(PDO::FETCH_ASSOC) as $r) $byUser[(int)$r['id']] = $r;
    }
    $balances = [];
    foreach ($allUids as $uid) {
        $info = $byUser[$uid] ?? ['display_name' => "user#$uid", 'avatar_url' => null];
        $p = (int)($paid[$uid]  ?? 0);
        $s = (int)($spent[$uid] ?? 0);
        $balances[] = [
            'user_id' => $uid,
            'display_name' => $info['display_name'],
            'avatar_url'   => $info['avatar_url'],
            'paid_jpy'     => $p,
            'spent_jpy'    => $s,
            'net_jpy'      => $p - $s,
        ];
    }
    // Sort: 大口債権者が上、大口債務者が下
    usort($balances, fn($a, $b) => $b['net_jpy'] <=> $a['net_jpy']);

    // Settlement plan: greedy match of creditors and debtors.
    $settlements = compute_settlements($balances);

    $total = 0;
    foreach ($rows as $r) $total += (int)$r['amount_jpy'];

    json_response([
        'expenses'    => $rows,
        'balances'    => $balances,
        'settlements' => $settlements,
        'total_jpy'   => $total,
        'count'       => count($rows),
    ]);
}

// Greedy minimal-transfer settlement. Not provably optimal in pathological
// cases but produces small plans for typical lab/trip groups.
function compute_settlements(array $balances): array {
    $cred = []; $debt = [];
    foreach ($balances as $b) {
        if ($b['net_jpy'] > 0) $cred[] = ['user_id' => $b['user_id'], 'name' => $b['display_name'], 'remaining' => $b['net_jpy']];
        elseif ($b['net_jpy'] < 0) $debt[] = ['user_id' => $b['user_id'], 'name' => $b['display_name'], 'remaining' => -$b['net_jpy']];
    }
    usort($cred, fn($a, $b) => $b['remaining'] <=> $a['remaining']);
    usort($debt, fn($a, $b) => $b['remaining'] <=> $a['remaining']);

    $plan = [];
    $i = 0; $j = 0;
    while ($i < count($cred) && $j < count($debt)) {
        $amt = min($cred[$i]['remaining'], $debt[$j]['remaining']);
        if ($amt <= 0) break;
        $plan[] = [
            'from_user_id' => $debt[$j]['user_id'],
            'from_name'    => $debt[$j]['name'],
            'to_user_id'   => $cred[$i]['user_id'],
            'to_name'      => $cred[$i]['name'],
            'amount_jpy'   => $amt,
        ];
        $cred[$i]['remaining'] -= $amt;
        $debt[$j]['remaining'] -= $amt;
        if ($cred[$i]['remaining'] === 0) $i++;
        if ($debt[$j]['remaining'] === 0) $j++;
    }
    return $plan;
}

function group_expenses_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);

    $body = read_json_body();
    $amountRaw = $body['amount'] ?? null;
    if (!is_numeric($amountRaw) || (float)$amountRaw <= 0) {
        throw new ApiException('bad_request', 'amount must be positive', 400);
    }
    $currency = strtoupper(trim((string)($body['currency'] ?? 'JPY')));
    if (!preg_match('/^[A-Z]{3}$/', $currency)) {
        throw new ApiException('bad_request', 'currency must be 3-letter ISO code', 400);
    }
    $rate = ($currency === 'JPY') ? null : (float)($body['rate_to_jpy'] ?? 0);
    if ($currency !== 'JPY' && (!$rate || $rate <= 0)) {
        // Client didn't preview a rate (or fetch failed) — try server-side
        // snapshot via /api/fx's helper. If that also fails, surface 502 so
        // the user knows to retry / enter manually.
        $live = fx_rate_to_jpy($currency);
        if ($live === null) {
            throw new ApiException('bad_gateway',
                "為替レートを取得できませんでした (currency=$currency)。手動で入力してください", 502);
        }
        $rate = $live;
    }
    $amountJpy = ($currency === 'JPY')
        ? (int)round((float)$amountRaw)
        : (int)round((float)$amountRaw * $rate);
    if ($amountJpy <= 0) throw new ApiException('bad_request', 'computed amount_jpy <= 0', 400);

    $payerId = isset($body['payer_user_id']) ? (int)$body['payer_user_id'] : (int)$u['id'];
    // Snapshot participants: default to all current members. Allow caller to
    // restrict via participant_ids (used when an expense only applies to a
    // subset, e.g. "ランチに来た人だけ").
    $stM = $pdo->prepare("SELECT user_id FROM adhoc_group_members WHERE group_id=?");
    $stM->execute([$id]);
    $allMembers = array_map('intval', array_column($stM->fetchAll(PDO::FETCH_ASSOC), 'user_id'));
    if (!$allMembers) throw new ApiException('bad_request', 'group has no members', 400);
    if (!in_array($payerId, $allMembers, true)) {
        throw new ApiException('bad_request', 'payer must be a group member', 400);
    }
    // participants は 2 形式どちらも受ける:
    //   participant_ids: [1, 2, 3]                                (旧 / 全員等分)
    //   participants:    [{user_id:1, fixed:5000}, {user_id:2}]   (新 / 固定額あり)
    // どちらも省略すれば 「全員」 が対象 (= 全員等分)。
    $participants = $allMembers;
    if (isset($body['participants']) && is_array($body['participants'])) {
        $rich = []; $seen = [];
        foreach ($body['participants'] as $p) {
            if (!is_array($p) || !isset($p['user_id'])) continue;
            $uid = (int)$p['user_id'];
            if ($uid <= 0 || isset($seen[$uid])) continue;
            $seen[$uid] = true;
            if (!in_array($uid, $allMembers, true)) {
                throw new ApiException('bad_request', 'participant not in group', 400);
            }
            $entry = ['u' => $uid];
            if (isset($p['fixed'])) {
                $f = (int)$p['fixed'];
                if ($f < 0) throw new ApiException('bad_request', 'fixed must be >= 0', 400);
                if ($f > 0) $entry['fixed'] = $f;
            }
            $rich[] = $entry;
        }
        if (!$rich) throw new ApiException('bad_request', 'participants cannot be empty', 400);
        $participants = $rich;
    } elseif (isset($body['participant_ids']) && is_array($body['participant_ids'])) {
        $req = array_values(array_unique(array_map('intval', $body['participant_ids'])));
        $bad = array_diff($req, $allMembers);
        if ($bad) throw new ApiException('bad_request', 'participant not in group', 400);
        if (!$req) throw new ApiException('bad_request', 'participant_ids cannot be empty', 400);
        $participants = $req;
    }

    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 500) : null;
    $imageUrl = validate_product_image_url($body['image_url'] ?? null);
    $amountOriginal = ($currency === 'JPY') ? null : (float)$amountRaw;

    $st = $pdo->prepare("INSERT INTO adhoc_group_expenses
        (group_id, payer_user_id, amount_jpy, amount_original, currency, rate_to_jpy,
         memo, image_url, participants_json, created_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)");
    $st->execute([
        $id, $payerId, $amountJpy, $amountOriginal, $currency, $rate,
        $memo, $imageUrl, json_encode($participants), $u['id'],
    ]);
    $eid = (int)$pdo->lastInsertId();

    // Notify the payer if creator ≠ payer (someone logged on behalf of another).
    if ($payerId !== (int)$u['id']) {
        $stT = $pdo->prepare("SELECT title FROM adhoc_groups WHERE id=?");
        $stT->execute([$id]); $title = (string)$stT->fetchColumn();
        notify_safely($pdo, $cfg, $payerId, 'admin_notice',
            "💸 「{$title}」の立替を登録しました: ¥" . number_format($amountJpy),
            'group', $id);
    }
    json_response(['ok' => true, 'id' => $eid]);
}

// 既に投稿済みの支出を編集 (記録者本人 or admin のみ)。
// body で渡せる項目: payer_user_id / amount (+ currency + rate_to_jpy) / memo / participant_ids
// 各項目は省略可。currency を変えるときは amount も lookup し直しが必要。
function group_expenses_patch(PDO $pdo, array $cfg, int $groupId, int $eid): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 編集はグループメンバーなら誰でも可 (入力ミスを他の人が直せるように)。
    group_assert_member($pdo, $groupId, (int)$u['id']);
    $st = $pdo->prepare("SELECT * FROM adhoc_group_expenses WHERE id=? AND group_id=?");
    $st->execute([$eid, $groupId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'expense not found', 404);
    $body = read_json_body();

    // 既存のメンバー (validation 用)
    $stM = $pdo->prepare("SELECT user_id FROM adhoc_group_members WHERE group_id=?");
    $stM->execute([$groupId]);
    $allMembers = array_map('intval', array_column($stM->fetchAll(PDO::FETCH_ASSOC), 'user_id'));

    $sets = []; $args = [];

    if (array_key_exists('memo', $body)) {
        $memo = ($body['memo'] === null || $body['memo'] === '')
            ? null : mb_substr((string)$body['memo'], 0, 500);
        $sets[] = 'memo = ?'; $args[] = $memo;
    }
    if (array_key_exists('image_url', $body)) {
        $img = validate_product_image_url($body['image_url']);
        if ($img === null) { $sets[] = 'image_url = NULL'; }
        else               { $sets[] = 'image_url = ?'; $args[] = $img; }
    }
    $rowIsDraft = (int)($row['is_draft'] ?? 0) === 1;
    if (array_key_exists('payer_user_id', $body)) {
        $pidRaw = $body['payer_user_id'];
        if ($pidRaw === null || $pidRaw === '') {
            // draft が 「立替人未確定」 状態を許すため NULL も受ける。
            $sets[] = 'payer_user_id = NULL';
        } else {
            $pid = (int)$pidRaw;
            if (!in_array($pid, $allMembers, true)) {
                throw new ApiException('bad_request', 'payer must be a group member', 400);
            }
            $sets[] = 'payer_user_id = ?'; $args[] = $pid;
        }
    }
    $amountJpyAfter = null; // auto-flip 判定用 (PATCH 後の amount_jpy)
    if (array_key_exists('amount', $body) || array_key_exists('currency', $body) || array_key_exists('rate_to_jpy', $body)) {
        $amountRaw = $body['amount'] ?? null;
        if (!is_numeric($amountRaw)) {
            throw new ApiException('bad_request', 'amount must be numeric', 400);
        }
        // draft は 0 を許容 (未確定状態を維持できる)。 通常支出は > 0 必須。
        if (!$rowIsDraft && (float)$amountRaw <= 0) {
            throw new ApiException('bad_request', 'amount must be positive', 400);
        }
        $currency = strtoupper(trim((string)($body['currency'] ?? $row['currency'])));
        if (!preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new ApiException('bad_request', 'currency must be 3-letter ISO code', 400);
        }
        $rate = ($currency === 'JPY') ? null : (float)($body['rate_to_jpy'] ?? 0);
        if ($currency !== 'JPY' && (!$rate || $rate <= 0)) {
            $live = fx_rate_to_jpy($currency);
            if ($live === null) {
                throw new ApiException('bad_gateway',
                    "為替レートを取得できませんでした (currency=$currency)", 502);
            }
            $rate = $live;
        }
        $amountJpy = ($currency === 'JPY')
            ? (int)round((float)$amountRaw)
            : (int)round((float)$amountRaw * $rate);
        $amountOriginal = ($currency === 'JPY') ? null : (float)$amountRaw;
        $sets[] = 'amount_jpy = ?';      $args[] = $amountJpy;
        $sets[] = 'amount_original = ?'; $args[] = $amountOriginal;
        $sets[] = 'currency = ?';        $args[] = $currency;
        $sets[] = 'rate_to_jpy = ?';     $args[] = $rate;
        $amountJpyAfter = $amountJpy;
    }
    // draft の auto-complete: amount_jpy > 0 が入った時点で is_draft = 0 に。
    // (今 patch で amount を触らない場合は元の amount_jpy をチェック)
    if ($rowIsDraft) {
        $effAmount = $amountJpyAfter ?? (int)$row['amount_jpy'];
        if ($effAmount > 0) {
            $sets[] = 'is_draft = 0';
        }
    }
    if (array_key_exists('participants', $body) && is_array($body['participants'])) {
        $rich = []; $seen = [];
        foreach ($body['participants'] as $p) {
            if (!is_array($p) || !isset($p['user_id'])) continue;
            $uid = (int)$p['user_id'];
            if ($uid <= 0 || isset($seen[$uid])) continue;
            $seen[$uid] = true;
            if (!in_array($uid, $allMembers, true)) {
                throw new ApiException('bad_request', 'participant not in group', 400);
            }
            $entry = ['u' => $uid];
            if (isset($p['fixed'])) {
                $f = (int)$p['fixed'];
                if ($f < 0) throw new ApiException('bad_request', 'fixed must be >= 0', 400);
                if ($f > 0) $entry['fixed'] = $f;
            }
            $rich[] = $entry;
        }
        if (!$rich) throw new ApiException('bad_request', 'participants cannot be empty', 400);
        $sets[] = 'participants_json = ?'; $args[] = json_encode($rich);
    } elseif (array_key_exists('participant_ids', $body) && is_array($body['participant_ids'])) {
        $req = array_values(array_unique(array_map('intval', $body['participant_ids'])));
        $bad = array_diff($req, $allMembers);
        if ($bad) throw new ApiException('bad_request', 'participant not in group', 400);
        if (!$req) throw new ApiException('bad_request', 'participant_ids cannot be empty', 400);
        $sets[] = 'participants_json = ?'; $args[] = json_encode($req);
    }

    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $args[] = $eid;
    $pdo->prepare('UPDATE adhoc_group_expenses SET ' . implode(', ', $sets) . ' WHERE id=?')
        ->execute($args);
    json_response(['ok' => true]);
}

function group_expenses_del(PDO $pdo, array $cfg, int $groupId, int $eid): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 削除もグループメンバーなら誰でも可 (入力ミスの掃除がしやすいように)。
    // 既に削除済みなら idempotent に成功扱いで返す (race / 二重クリック対応)。
    group_assert_member($pdo, $groupId, (int)$u['id']);
    $st = $pdo->prepare("SELECT 1 FROM adhoc_group_expenses WHERE id=? AND group_id=?");
    $st->execute([$eid, $groupId]);
    if ($st->fetchColumn() === false) {
        json_response(['ok' => true, 'already_deleted' => true]);
        return;
    }
    $pdo->prepare("DELETE FROM adhoc_group_expenses WHERE id=?")->execute([$eid]);
    json_response(['ok' => true]);
}

// 精算「全員に通知」: recompute net balances + transfer plan, send one
// notification per directional pair (debtor sees a 'send' line, creditor sees
// a 'receive' line). Settlement happens outside LabPay (cash/PayPay/bank),
// so no pt movement.
function group_settle_notify(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);

    $stT = $pdo->prepare("SELECT title FROM adhoc_groups WHERE id=?");
    $stT->execute([$id]);
    $title = (string)$stT->fetchColumn();
    if ($title === '') throw new ApiException('not_found', 'group not found', 404);

    // Re-derive expenses → balances → settlements (same logic as the GET).
    $st = $pdo->prepare("
        SELECT id, payer_user_id, amount_jpy, participants_json
          FROM adhoc_group_expenses WHERE group_id = ?");
    $st->execute([$id]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) throw new ApiException('bad_request', '支出がまだありません', 400);

    // paid / spent / net を集計 (group_expenses_list と同じロジック、
    // legacy [id,...] と新 [{u, fixed?}, ...] の両方を受ける)。
    $paid  = [];
    $spent = [];
    foreach ($rows as $r) {
        $amount = (int)$r['amount_jpy'];
        $parts = json_decode((string)$r['participants_json'], true);
        if (!is_array($parts) || !$parts) continue;
        $ids = []; $fixed = [];
        foreach ($parts as $p) {
            if (is_array($p) && isset($p['u'])) {
                $uid = (int)$p['u'];
                $ids[] = $uid;
                if (isset($p['fixed'])) $fixed[$uid] = max(0, (int)$p['fixed']);
            } else {
                $ids[] = (int)$p;
            }
        }
        if (!$ids) continue;
        $unfixed = array_values(array_filter($ids, fn($x) => !isset($fixed[$x])));
        $remaining = max(0, $amount - array_sum($fixed));
        $n = count($unfixed);
        $share = $n > 0 ? (int)floor($remaining / $n) : 0;
        $leftover = $n > 0 ? $remaining - $share * $n : 0;
        $paid[(int)$r['payer_user_id']] = ($paid[(int)$r['payer_user_id']] ?? 0) + $amount;
        $uIdx = 0;
        foreach ($ids as $pid) {
            if (isset($fixed[$pid])) {
                $spent[$pid] = ($spent[$pid] ?? 0) + $fixed[$pid];
            } else {
                $myShare = $share + ($uIdx === 0 ? $leftover : 0);
                $spent[$pid] = ($spent[$pid] ?? 0) + $myShare;
                $uIdx++;
            }
        }
    }
    // Build name map across everyone who paid or spent.
    // array_values で 0,1,2,... に詰め直す (array_unique は元 key 維持で gap が出るため)。
    $uids = array_values(array_unique(array_merge(array_keys($paid), array_keys($spent))));
    $names = [];
    if ($uids) {
        $place = implode(',', array_fill(0, count($uids), '?'));
        $stU = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
        $stU->execute($uids);
        foreach ($stU->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];
    }
    $balances = [];
    foreach ($uids as $uid) {
        $p = (int)($paid[$uid]  ?? 0);
        $s = (int)($spent[$uid] ?? 0);
        $balances[] = [
            'user_id'      => $uid,
            'display_name' => $names[$uid] ?? "user#$uid",
            'paid_jpy'     => $p,
            'spent_jpy'    => $s,
            'net_jpy'      => $p - $s,
        ];
    }
    $plan = compute_settlements($balances);
    // body.kind:
    //   'transfer' (default) — 推奨送金プランベース。「→ X に ¥Y 送って」「← X から ¥Y 受け取れます」
    //   'spent'              — 支払った総額ベース。「あなたが使った額は ¥X 円です」
    // body.dry_run=true なら通知は送らず previews[] だけ返す。
    $body = read_json_body();
    $dryRun = !empty($body['dry_run']);
    $kind = (string)($body['kind'] ?? 'transfer');
    if (!in_array($kind, ['transfer','spent'], true)) {
        throw new ApiException('bad_request', "kind must be 'transfer' or 'spent'", 400);
    }

    if ($kind === 'spent') {
        // 個々人の使った額 (spent_jpy) を通知。0 の人はスキップ。
        $previews = [];
        $sent = 0;
        foreach ($balances as $b) {
            $spent = (int)($b['spent_jpy'] ?? 0);
            if ($spent <= 0) continue;
            $msg = "💴 グループ「{$title}」: あなたが使った額は ¥" . number_format($spent) . " です";
            $previews[] = [
                'user_id' => (int)$b['user_id'],
                'display_name' => $b['display_name'],
                'message' => $msg,
            ];
            if (!$dryRun) {
                notify_safely($pdo, $cfg, (int)$b['user_id'], 'admin_notice', $msg, 'group', $id);
                $sent++;
            }
        }
        json_response(['ok' => true, 'sent' => $sent, 'kind' => 'spent', 'previews' => $previews, 'dry_run' => $dryRun]);
        return;
    }

    // kind=transfer: 推奨送金プランに従って通知
    if (!$plan) {
        json_response(['ok' => true, 'sent' => 0, 'note' => 'no transfers required', 'previews' => [], 'kind' => 'transfer']);
        return;
    }

    // For each member with at least one outgoing or incoming line, send a
    // single notification summarizing their share of the plan. One per person
    // (not one per pair) so people don't get spammed in larger groups.
    $perUser = []; // user_id => ['send' => [], 'recv' => []]
    foreach ($plan as $p) {
        $perUser[$p['from_user_id']]['send'][] = $p;
        $perUser[$p['to_user_id']]['recv'][]   = $p;
    }
    $previews = [];
    $sent = 0;
    foreach ($perUser as $uid => $lines) {
        $msg = "💴 グループ「{$title}」精算:\n";
        foreach (($lines['send'] ?? []) as $p) {
            $msg .= "→ {$p['to_name']} に ¥" . number_format($p['amount_jpy']) . " を送ってください\n";
        }
        foreach (($lines['recv'] ?? []) as $p) {
            $msg .= "← {$p['from_name']} から ¥" . number_format($p['amount_jpy']) . " を受け取れます\n";
        }
        $msgBody = rtrim($msg);
        $previews[] = ['user_id' => (int)$uid, 'display_name' => $names[$uid] ?? "user#$uid", 'message' => $msgBody];
        if (!$dryRun) {
            notify_safely($pdo, $cfg, (int)$uid, 'admin_notice', $msgBody, 'group', $id);
            $sent++;
        }
    }
    json_response(['ok' => true, 'sent' => $sent, 'plan_count' => count($plan), 'previews' => $previews, 'dry_run' => $dryRun, 'kind' => 'transfer']);
}

// ─── スケジュール / 行程 ──────────────────────────────────────────────
// グループ (主に学会 / 旅行) の日程表。 schedule_start_date 〜 schedule_end_date
// の範囲内の各日にアイテムを並べる。 並び順は start_time → sort_order → id。

const GROUP_SCHEDULE_KINDS = [
    'flight','train','bus','taxi','car','walk','move',
    'hotel','conf','meeting','food','fun','other',
];

function group_schedule_list(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $st = $pdo->prepare("SELECT schedule_start_date, schedule_end_date FROM adhoc_groups WHERE id=?");
    $st->execute([$id]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'group not found', 404);
    $st = $pdo->prepare("
        SELECT s.id, s.day_date, s.end_date, s.start_time, s.end_time,
               s.duration_minutes, s.kind, s.title,
               s.location, s.memo, s.image_url, s.url, s.link_pair_id,
               s.sort_order, s.created_by_user_id,
               u.display_name AS created_by_name
          FROM adhoc_group_schedule_items s
          JOIN users u ON u.id = s.created_by_user_id
         WHERE s.group_id = ?
         ORDER BY s.day_date,
                  (s.start_time IS NULL),
                  s.start_time,
                  s.sort_order,
                  s.id");
    $st->execute([$id]);
    json_response([
        'start_date' => $g['schedule_start_date'],
        'end_date'   => $g['schedule_end_date'],
        'items'      => $st->fetchAll(PDO::FETCH_ASSOC),
    ]);
}

function group_schedule_add(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $day = (string)($body['day_date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
        throw new ApiException('bad_request', 'day_date は YYYY-MM-DD', 400);
    }
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    $kind = (string)($body['kind'] ?? 'other');
    if (!in_array($kind, GROUP_SCHEDULE_KINDS, true)) $kind = 'other';
    $startTime = null;
    if (!empty($body['start_time'])) {
        $st0 = (string)$body['start_time'];
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $st0)) {
            throw new ApiException('bad_request', 'start_time は HH:MM', 400);
        }
        $startTime = strlen($st0) === 5 ? $st0 . ':00' : $st0;
    }
    $duration = isset($body['duration_minutes']) && $body['duration_minutes'] !== ''
        ? max(0, min(60 * 48, (int)$body['duration_minutes'])) : null;
    $location = isset($body['location']) ? mb_substr((string)$body['location'], 0, 500) : null;
    if ($location === '') $location = null;
    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 2000) : null;
    if ($memo === '') $memo = null;
    $imageUrl = validate_product_image_url($body['image_url'] ?? null);
    $extraUrl = null;
    if (!empty($body['url'])) {
        $raw = trim((string)$body['url']);
        if (!preg_match('#^https?://#i', $raw)) {
            throw new ApiException('bad_request', 'url は http(s) で始まる必要があります', 400);
        }
        if (mb_strlen($raw) > 2000) throw new ApiException('bad_request', 'url 長すぎ', 400);
        $extraUrl = $raw;
    }
    // 終了日 / 終了時刻 / ペア id (どれも任意)。
    $endDate = null;
    if (!empty($body['end_date'])) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$body['end_date'])) {
            throw new ApiException('bad_request', 'end_date は YYYY-MM-DD', 400);
        }
        $endDate = (string)$body['end_date'];
        if ($endDate < $day) throw new ApiException('bad_request', 'end_date は day_date 以降', 400);
    }
    $endTime = null;
    if (!empty($body['end_time'])) {
        $et = (string)$body['end_time'];
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $et)) {
            throw new ApiException('bad_request', 'end_time は HH:MM', 400);
        }
        $endTime = strlen($et) === 5 ? $et . ':00' : $et;
    }
    $linkPair = null;
    if (!empty($body['link_pair_id'])) {
        $lp = trim((string)$body['link_pair_id']);
        if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $lp)) {
            throw new ApiException('bad_request', 'link_pair_id 形式不正', 400);
        }
        $linkPair = $lp;
    }
    // 同日の末尾に積む。
    $stm = $pdo->prepare("SELECT COALESCE(MAX(sort_order),0)
        FROM adhoc_group_schedule_items WHERE group_id=? AND day_date=?");
    $stm->execute([$id, $day]);
    $sortOrder = ((int)$stm->fetchColumn()) + 1;
    $ins = $pdo->prepare("INSERT INTO adhoc_group_schedule_items
        (group_id, day_date, end_date, start_time, end_time, duration_minutes, kind, title,
         location, memo, image_url, url, link_pair_id, sort_order, created_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    $ins->execute([$id, $day, $endDate, $startTime, $endTime, $duration, $kind, $title,
        $location, $memo, $imageUrl, $extraUrl, $linkPair, $sortOrder, $u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function group_schedule_patch(PDO $pdo, array $cfg, int $id, int $itemId): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $stE = $pdo->prepare("SELECT created_by_user_id FROM adhoc_group_schedule_items WHERE id=? AND group_id=?");
    $stE->execute([$itemId, $id]);
    $row = $stE->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'item not found', 404);
    // 編集は creator or group creator or admin (= 緩め)
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('day_date', $body)) {
        $v = (string)$body['day_date'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw new ApiException('bad_request', 'day_date は YYYY-MM-DD', 400);
        }
        $sets[] = 'day_date = ?'; $args[] = $v;
    }
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) {
            throw new ApiException('bad_request', 'title 1..200', 400);
        }
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('kind', $body)) {
        $k = (string)$body['kind'];
        if (!in_array($k, GROUP_SCHEDULE_KINDS, true)) $k = 'other';
        $sets[] = 'kind = ?'; $args[] = $k;
    }
    if (array_key_exists('start_time', $body)) {
        $v = $body['start_time'];
        if ($v === null || $v === '') { $sets[] = 'start_time = NULL'; }
        else {
            $st0 = (string)$v;
            if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $st0)) {
                throw new ApiException('bad_request', 'start_time は HH:MM', 400);
            }
            $sets[] = 'start_time = ?'; $args[] = strlen($st0) === 5 ? $st0 . ':00' : $st0;
        }
    }
    if (array_key_exists('duration_minutes', $body)) {
        $v = $body['duration_minutes'];
        if ($v === null || $v === '') { $sets[] = 'duration_minutes = NULL'; }
        else { $sets[] = 'duration_minutes = ?'; $args[] = max(0, min(60 * 48, (int)$v)); }
    }
    if (array_key_exists('location', $body)) {
        $v = $body['location'];
        if ($v === null || $v === '') { $sets[] = 'location = NULL'; }
        else { $sets[] = 'location = ?'; $args[] = mb_substr((string)$v, 0, 500); }
    }
    if (array_key_exists('memo', $body)) {
        $v = $body['memo'];
        if ($v === null || $v === '') { $sets[] = 'memo = NULL'; }
        else { $sets[] = 'memo = ?'; $args[] = mb_substr((string)$v, 0, 2000); }
    }
    if (array_key_exists('image_url', $body)) {
        $v = validate_product_image_url($body['image_url']);
        if ($v === null) { $sets[] = 'image_url = NULL'; }
        else             { $sets[] = 'image_url = ?'; $args[] = $v; }
    }
    if (array_key_exists('url', $body)) {
        $v = $body['url'];
        if ($v === null || $v === '') { $sets[] = 'url = NULL'; }
        else {
            $raw = trim((string)$v);
            if (!preg_match('#^https?://#i', $raw)) {
                throw new ApiException('bad_request', 'url は http(s) で始まる必要があります', 400);
            }
            if (mb_strlen($raw) > 2000) throw new ApiException('bad_request', 'url 長すぎ', 400);
            $sets[] = 'url = ?'; $args[] = $raw;
        }
    }
    if (array_key_exists('end_date', $body)) {
        $v = $body['end_date'];
        if ($v === null || $v === '') { $sets[] = 'end_date = NULL'; }
        else {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v)) {
                throw new ApiException('bad_request', 'end_date は YYYY-MM-DD', 400);
            }
            $sets[] = 'end_date = ?'; $args[] = (string)$v;
        }
    }
    if (array_key_exists('end_time', $body)) {
        $v = $body['end_time'];
        if ($v === null || $v === '') { $sets[] = 'end_time = NULL'; }
        else {
            $et = (string)$v;
            if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $et)) {
                throw new ApiException('bad_request', 'end_time は HH:MM', 400);
            }
            $sets[] = 'end_time = ?'; $args[] = strlen($et) === 5 ? $et . ':00' : $et;
        }
    }
    if (array_key_exists('link_pair_id', $body)) {
        $v = $body['link_pair_id'];
        if ($v === null || $v === '') { $sets[] = 'link_pair_id = NULL'; }
        else {
            $lp = trim((string)$v);
            if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $lp)) {
                throw new ApiException('bad_request', 'link_pair_id 形式不正', 400);
            }
            $sets[] = 'link_pair_id = ?'; $args[] = $lp;
        }
    }
    if (!$sets) throw new ApiException('bad_request', 'nothing to update', 400);
    $args[] = $itemId; $args[] = $id;
    $pdo->prepare('UPDATE adhoc_group_schedule_items SET ' . implode(', ', $sets)
        . ' WHERE id = ? AND group_id = ?')->execute($args);
    json_response(['ok' => true]);
}

function group_schedule_del(PDO $pdo, array $cfg, int $id, int $itemId): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $pdo->prepare("DELETE FROM adhoc_group_schedule_items WHERE id=? AND group_id=?")->execute([$itemId, $id]);
    json_response(['ok' => true]);
}

// PATCH /api/groups/{id}/schedule/{itemId}/move  body: {dir: 'up'|'down'}
// 同日の隣の項目と sort_order を swap (時刻が同じ枠の中で並び替え)。
function group_schedule_move(PDO $pdo, array $cfg, int $id, int $itemId): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $dir = (string)($body['dir'] ?? '');
    if (!in_array($dir, ['up','down'], true)) {
        throw new ApiException('bad_request', "dir must be 'up' or 'down'", 400);
    }
    $st = $pdo->prepare("SELECT day_date, sort_order FROM adhoc_group_schedule_items WHERE id=? AND group_id=?");
    $st->execute([$itemId, $id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'item not found', 404);
    $cmp = $dir === 'up' ? '<' : '>';
    $ord = $dir === 'up' ? 'DESC' : 'ASC';
    $stN = $pdo->prepare("SELECT id, sort_order FROM adhoc_group_schedule_items
            WHERE group_id=? AND day_date=? AND sort_order $cmp ?
            ORDER BY sort_order $ord LIMIT 1");
    $stN->execute([$id, $row['day_date'], (int)$row['sort_order']]);
    $nei = $stN->fetch(PDO::FETCH_ASSOC);
    if (!$nei) { json_response(['ok' => true, 'moved' => false]); return; }
    db_tx($pdo, function () use ($pdo, $row, $nei, $itemId) {
        $pdo->prepare("UPDATE adhoc_group_schedule_items SET sort_order=? WHERE id=?")
            ->execute([(int)$nei['sort_order'], $itemId]);
        $pdo->prepare("UPDATE adhoc_group_schedule_items SET sort_order=? WHERE id=?")
            ->execute([(int)$row['sort_order'], (int)$nei['id']]);
    });
    json_response(['ok' => true, 'moved' => true]);
}
