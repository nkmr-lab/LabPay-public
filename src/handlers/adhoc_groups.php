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
            if ($next === 'expenses' && isset($seg[3]) && $method === 'DELETE') { group_expenses_del($pdo, $cfg, $id, (int)$seg[3]); return; }
            if ($next === 'settle'   && $method === 'POST')             { group_settle_notify($pdo, $cfg, $id); return; }
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
        SELECT g.id, g.slug, g.title, g.description, g.closed_at, g.created_at,
               uc.display_name AS creator_name,
               (SELECT COUNT(*) FROM adhoc_group_members WHERE group_id = g.id) AS member_count
          FROM adhoc_groups g
          JOIN users uc ON uc.id = g.creator_user_id
          JOIN adhoc_group_members m ON m.group_id = g.id AND m.user_id = ?
         ORDER BY g.closed_at IS NULL DESC, g.created_at DESC LIMIT 100");
    $st->execute([$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function groups_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $description = isset($body['description']) ? mb_substr((string)$body['description'], 0, 5000) : null;

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

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("INSERT INTO adhoc_groups (slug, creator_user_id, title, description) VALUES (?,?,?,?)");
        $st->execute([$slug, $u['id'], $title, $description]);
        $gid = (int)$pdo->lastInsertId();
        $st = $pdo->prepare("INSERT INTO adhoc_group_members (group_id, user_id) VALUES (?,?)");
        foreach ($memberIds as $uid) $st->execute([$gid, $uid]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

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

// 既存グループの slug を作成者/admin が後から付け替え。空文字 / null 指定で
// クリア (URL 用の名前を外す)。重複・全数字・不正文字はそれぞれエラー。
function groups_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_creator_or_admin($pdo, $id, $u);
    $body = read_json_body();
    if (!array_key_exists('slug', $body)) {
        throw new ApiException('bad_request', 'nothing to update', 400);
    }
    $raw = $body['slug'];
    if ($raw === null || $raw === '') {
        $pdo->prepare("UPDATE adhoc_groups SET slug = NULL WHERE id = ?")->execute([$id]);
        json_response(['ok' => true, 'slug' => null]);
        return;
    }
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
    $pdo->prepare("UPDATE adhoc_groups SET slug = ? WHERE id = ?")->execute([$s, $id]);
    json_response(['ok' => true, 'slug' => $s]);
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

    $st = $pdo->prepare("
        SELECT e.*, up.display_name AS payer_name, up.avatar_url AS payer_avatar_url
          FROM adhoc_group_expenses e
          JOIN users up ON up.id = e.payer_user_id
         WHERE e.group_id = ?
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
        $parts = json_decode((string)$r['participants_json'], true);
        $r['participants'] = is_array($parts) ? array_values(array_map('intval', $parts)) : [];
        unset($r['participants_json']);
        $n = max(1, count($r['participants']));
        $share = (int)floor($r['amount_jpy'] / $n);
        $leftover = $r['amount_jpy'] - $share * $n;
        $payerId = (int)$r['payer_user_id'];
        $paid[$payerId] = ($paid[$payerId] ?? 0) + $r['amount_jpy'];
        // Leftover を最初の参加者に乗せて、合計が常に amount_jpy にぴったり一致するように。
        foreach ($r['participants'] as $i => $pid) {
            $myShare = $share + ($i === 0 ? $leftover : 0);
            $spent[$pid] = ($spent[$pid] ?? 0) + $myShare;
        }
    }
    unset($r);

    // 全部の関与者 (払ったか使ったかどちらかでも) を拾う
    $allUids = array_unique(array_merge(array_keys($paid), array_keys($spent)));
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
    $participants = $allMembers;
    if (isset($body['participant_ids']) && is_array($body['participant_ids'])) {
        $req = array_values(array_unique(array_map('intval', $body['participant_ids'])));
        $bad = array_diff($req, $allMembers);
        if ($bad) throw new ApiException('bad_request', 'participant not in group', 400);
        if (!$req) throw new ApiException('bad_request', 'participant_ids cannot be empty', 400);
        $participants = $req;
    }

    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 500) : null;
    $amountOriginal = ($currency === 'JPY') ? null : (float)$amountRaw;

    $st = $pdo->prepare("INSERT INTO adhoc_group_expenses
        (group_id, payer_user_id, amount_jpy, amount_original, currency, rate_to_jpy,
         memo, participants_json, created_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?)");
    $st->execute([
        $id, $payerId, $amountJpy, $amountOriginal, $currency, $rate,
        $memo, json_encode($participants), $u['id'],
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

function group_expenses_del(PDO $pdo, array $cfg, int $groupId, int $eid): void {
    $u = Auth::requireUser($pdo, $cfg);
    group_assert_member($pdo, $groupId, (int)$u['id']);
    // Only the creator of the expense row can delete (admin override).
    $st = $pdo->prepare("SELECT created_by_user_id FROM adhoc_group_expenses
        WHERE id = ? AND group_id = ?");
    $st->execute([$eid, $groupId]);
    $owner = (int)$st->fetchColumn();
    if ($owner === 0) throw new ApiException('not_found', 'expense not found', 404);
    if ($owner !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '記録した本人のみ削除可能', 403);
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

    $balance = [];
    foreach ($rows as $r) {
        $amount = (int)$r['amount_jpy'];
        $parts = json_decode((string)$r['participants_json'], true);
        if (!is_array($parts) || !$parts) continue;
        $parts = array_values(array_map('intval', $parts));
        $n = count($parts);
        $share = (int)floor($amount / $n);
        $leftover = $amount - $share * $n;
        $balance[(int)$r['payer_user_id']] = ($balance[(int)$r['payer_user_id']] ?? 0) + $amount;
        foreach ($parts as $i => $pid) {
            $debit = $share + ($i === 0 ? $leftover : 0);
            $balance[$pid] = ($balance[$pid] ?? 0) - $debit;
        }
    }
    // Build name map.
    $uids = array_keys($balance);
    $names = [];
    if ($uids) {
        $place = implode(',', array_fill(0, count($uids), '?'));
        $stU = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
        $stU->execute($uids);
        foreach ($stU->fetchAll(PDO::FETCH_ASSOC) as $r) $names[(int)$r['id']] = $r['display_name'];
    }

    // Greedy transfer plan (same as compute_settlements()).
    $balances = [];
    foreach ($balance as $uid => $b) {
        $balances[] = ['user_id' => $uid, 'display_name' => $names[$uid] ?? "user#$uid", 'net_jpy' => (int)$b];
    }
    $plan = compute_settlements($balances);
    if (!$plan) {
        json_response(['ok' => true, 'sent' => 0, 'note' => 'no transfers required', 'previews' => []]);
        return;
    }

    // body.dry_run=true なら通知は送らず、各人に送ろうとしている本文だけを
    // previews[] で返す (フロントで「通知内容を確認」する用)。
    $body = read_json_body();
    $dryRun = !empty($body['dry_run']);

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
    json_response(['ok' => true, 'sent' => $sent, 'plan_count' => count($plan), 'previews' => $previews, 'dry_run' => $dryRun]);
}
