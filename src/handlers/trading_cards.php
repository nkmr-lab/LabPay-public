<?php
// v1121 中村さん要望「ゼミの人のトレーディングカード + リアクション。ガチャ 30pt (10 連 250pt)」
//   + 「トレカについては、本人の許可アリのときのみ。作るのは誰でもできるけど、公開の前に
//   許可申請がある感じ」
//
// API:
//   GET    /api/trading-cards                    → 承認済カード一覧 (公開プール)
//   POST   /api/trading-cards                    → 作成 (status=pending、本人へ通知)
//   PATCH  /api/trading-cards/{id}               → 編集 (作成者 or 対象者、pending 中のみ)
//   POST   /api/trading-cards/{id}/approve       → 対象者が承認 (approved に)
//   POST   /api/trading-cards/{id}/reject        → 対象者が却下 (reject_reason)
//   POST   /api/trading-cards/{id}/archive       → 対象者 or 作成者 or admin が下げる
//   GET    /api/trading-cards/pending-for-me     → 自分宛の承認待ち
//   GET    /api/trading-cards/mine               → 自分が作った or 自分が対象のカード
//   GET    /api/trading-cards/collection         → 自分のガチャコレクション
//   POST   /api/trading-cards/gacha              → { pulls: 1 or 10 } → pt 徴収 + 抽選

declare(strict_types=1);

const TC_FEE_SINGLE = 30;
const TC_FEE_TEN    = 250;
const TC_PULL_MAX   = 10;
// レアリティごとの base 出現確率 (合計 100)。 10 連時は R 以上確定にする。
const TC_RARITY_WEIGHT_SINGLE = ['N' => 60, 'R' => 30, 'SR' => 8, 'SSR' => 2];

function route_trading_cards(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { tc_list_public($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { tc_create($pdo, $cfg);      return; }
    if ($sub === 'pending-for-me' && $method === 'GET') { tc_pending_for_me($pdo, $cfg); return; }
    if ($sub === 'mine'           && $method === 'GET') { tc_mine($pdo, $cfg);           return; }
    if ($sub === 'collection'     && $method === 'GET') { tc_collection($pdo, $cfg);     return; }
    if ($sub === 'gacha'          && $method === 'POST'){ tc_gacha($pdo, $cfg);          return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''         && $method === 'GET')   { tc_detail($pdo, $cfg, $id);   return; }
        if ($next === ''         && $method === 'PATCH') { tc_patch($pdo, $cfg, $id);    return; }
        if ($next === 'approve'  && $method === 'POST')  { tc_approve($pdo, $cfg, $id);  return; }
        if ($next === 'reject'   && $method === 'POST')  { tc_reject($pdo, $cfg, $id);   return; }
        if ($next === 'archive'  && $method === 'POST')  { tc_archive($pdo, $cfg, $id);  return; }
    }
    throw new ApiException('not_found', "no trading-cards route for $method $sub", 404);
}

function _tc_shape(array $r, int $requesterId): array {
    return [
        'id'                => (int)$r['id'],
        'target_user_id'    => (int)$r['target_user_id'],
        'target_name'       => (string)($r['target_name'] ?? ''),
        'target_avatar'     => $r['target_avatar'] ?? null,
        'created_by_user_id'=> (int)$r['created_by_user_id'],
        'creator_name'      => (string)($r['creator_name'] ?? ''),
        'creator_avatar'    => $r['creator_avatar'] ?? null,
        'catchphrase'       => (string)($r['catchphrase'] ?? ''),
        'reaction_text'     => (string)($r['reaction_text'] ?? ''),
        'rarity'            => (string)$r['rarity'],
        'image_url'         => $r['image_url'] ?: null,
        'background_color'  => $r['background_color'] ?: null,
        'stats'             => json_decode($r['stats_json'] ?: 'null', true),
        'status'            => (string)$r['status'],
        'reject_reason'     => $r['reject_reason'] ?: null,
        'created_at'        => (string)$r['created_at'],
        'approved_at'       => $r['approved_at'] ?: null,
        'is_target'         => ((int)$r['target_user_id'] === $requesterId),
        'is_creator'        => ((int)$r['created_by_user_id'] === $requesterId),
    ];
}

function _tc_select_base(): string {
    return "SELECT c.*, ut.display_name AS target_name, ut.avatar_url AS target_avatar,
                        uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                   FROM trading_cards c
              LEFT JOIN users ut ON ut.id = c.target_user_id
              LEFT JOIN users uc ON uc.id = c.created_by_user_id";
}

function tc_list_public(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->query(_tc_select_base() . " WHERE c.status = 'approved' ORDER BY FIELD(c.rarity,'SSR','SR','R','N'), c.id DESC LIMIT 200");
    $items = array_map(fn($r) => _tc_shape($r, (int)$u['id']), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function tc_pending_for_me(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare(_tc_select_base() . " WHERE c.status = 'pending' AND c.target_user_id = ? ORDER BY c.id DESC");
    $st->execute([(int)$u['id']]);
    $items = array_map(fn($r) => _tc_shape($r, (int)$u['id']), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function tc_mine(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare(_tc_select_base() . " WHERE c.created_by_user_id = ? OR c.target_user_id = ? ORDER BY c.id DESC LIMIT 200");
    $st->execute([$uid, $uid]);
    $items = array_map(fn($r) => _tc_shape($r, $uid), $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function tc_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare(_tc_select_base() . " WHERE c.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'card なし', 404);
    // pending/rejected は creator と target 以外に見せない
    if (in_array($r['status'], ['pending','rejected'], true)) {
        if ((int)$r['target_user_id'] !== (int)$u['id'] && (int)$r['created_by_user_id'] !== (int)$u['id']) {
            throw new ApiException('forbidden', '公開前のカードは本人と作成者のみ閲覧可', 403);
        }
    }
    json_response(['card' => _tc_shape($r, (int)$u['id'])]);
}

function tc_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $targetId = (int)($body['target_user_id'] ?? 0);
    if ($targetId <= 0) throw new ApiException('bad_request', 'target_user_id 必要', 400);
    // target が存在 human か確認
    $tSt = $pdo->prepare("SELECT id, display_name FROM users WHERE id = ? AND kind = 'human'");
    $tSt->execute([$targetId]);
    $target = $tSt->fetch(PDO::FETCH_ASSOC);
    if (!$target) throw new ApiException('bad_request', 'target が human user ではない', 400);
    $catchphrase = trim((string)($body['catchphrase'] ?? ''));
    if (mb_strlen($catchphrase) > 120) $catchphrase = mb_substr($catchphrase, 0, 120);
    $reaction    = trim((string)($body['reaction_text'] ?? ''));
    if (mb_strlen($reaction) > 60) $reaction = mb_substr($reaction, 0, 60);
    $rarity      = in_array($body['rarity'] ?? 'R', ['N','R','SR','SSR'], true) ? $body['rarity'] : 'R';
    $imageUrl    = trim((string)($body['image_url'] ?? '')) ?: null;
    $bg          = trim((string)($body['background_color'] ?? '')) ?: null;
    if ($bg && !preg_match('/^#[0-9A-Fa-f]{6,8}$/', $bg)) $bg = null;
    $stats       = isset($body['stats']) && is_array($body['stats']) ? json_encode($body['stats'], JSON_UNESCAPED_UNICODE) : null;
    // 自分自身のカードは即 approved で OK (本人がわざわざ作るケース)
    $uid = (int)$u['id'];
    $isSelf = ($targetId === $uid);
    $status = $isSelf ? 'approved' : 'pending';
    $st = $pdo->prepare("INSERT INTO trading_cards
        (target_user_id, created_by_user_id, catchphrase, reaction_text, rarity, image_url, background_color, stats_json, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([$targetId, $uid, $catchphrase ?: null, $reaction ?: null, $rarity, $imageUrl, $bg, $stats, $status, $isSelf ? date('Y-m-d H:i:s') : null]);
    $id = (int)$pdo->lastInsertId();
    // 本人へ承認依頼通知
    if (!$isSelf) {
        try {
            global $CFG;
            $creatorName = (string)$pdo->query("SELECT display_name FROM users WHERE id=" . (int)$uid)->fetchColumn();
            notify_safely($pdo, $CFG, $targetId, 'admin_notice',
                "🎴 {$creatorName} さんがあなたのトレカを作成しました。公開には承認が必要です → 「私宛の承認待ち」から確認",
                'trading_card', $id);
        } catch (Throwable $_) {}
    }
    $st2 = $pdo->prepare(_tc_select_base() . " WHERE c.id = ?");
    $st2->execute([$id]);
    json_response(['ok' => true, 'card' => _tc_shape($st2->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function tc_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT * FROM trading_cards WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'card なし', 404);
    // 編集は creator or target のみ、かつ pending 中のみ (approved 後は archive → 作り直しでお願い)
    if ((int)$r['created_by_user_id'] !== $uid && (int)$r['target_user_id'] !== $uid) {
        throw new ApiException('forbidden', '編集は作成者 or 本人のみ', 403);
    }
    if ($r['status'] !== 'pending') {
        throw new ApiException('bad_request', 'pending 中のみ編集可能', 400);
    }
    $body = read_json_body();
    $sets = []; $params = [];
    foreach (['catchphrase' => 120, 'reaction_text' => 60] as $k => $max) {
        if (array_key_exists($k, $body)) {
            $v = trim((string)$body[$k]);
            if (mb_strlen($v) > $max) $v = mb_substr($v, 0, $max);
            $sets[] = "$k = ?"; $params[] = $v ?: null;
        }
    }
    if (array_key_exists('rarity', $body) && in_array($body['rarity'], ['N','R','SR','SSR'], true)) {
        $sets[] = 'rarity = ?'; $params[] = $body['rarity'];
    }
    if (array_key_exists('image_url', $body)) {
        $sets[] = 'image_url = ?'; $params[] = trim((string)$body['image_url']) ?: null;
    }
    if (array_key_exists('background_color', $body)) {
        $bg = trim((string)$body['background_color']);
        if ($bg && !preg_match('/^#[0-9A-Fa-f]{6,8}$/', $bg)) $bg = null;
        $sets[] = 'background_color = ?'; $params[] = $bg;
    }
    if (array_key_exists('stats', $body)) {
        $sets[] = 'stats_json = ?'; $params[] = is_array($body['stats']) ? json_encode($body['stats'], JSON_UNESCAPED_UNICODE) : null;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $params[] = $id;
    $pdo->prepare("UPDATE trading_cards SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);
    $r2 = $pdo->prepare(_tc_select_base() . " WHERE c.id = ?");
    $r2->execute([$id]);
    json_response(['ok' => true, 'card' => _tc_shape($r2->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function tc_approve(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT * FROM trading_cards WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'card なし', 404);
    if ((int)$r['target_user_id'] !== $uid) throw new ApiException('forbidden', '承認は本人のみ', 403);
    if ($r['status'] !== 'pending') throw new ApiException('bad_request', 'pending 中のみ承認可', 400);
    $pdo->prepare("UPDATE trading_cards SET status = 'approved', approved_at = NOW() WHERE id = ?")->execute([$id]);
    // 作成者へ通知
    try {
        global $CFG;
        $targetName = (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        notify_safely($pdo, $CFG, (int)$r['created_by_user_id'], 'admin_notice',
            "🎴 {$targetName} さんがあなたが作ったトレカを承認しました! ガチャに登場します",
            'trading_card', $id);
    } catch (Throwable $_) {}
    $r2 = $pdo->prepare(_tc_select_base() . " WHERE c.id = ?");
    $r2->execute([$id]);
    json_response(['ok' => true, 'card' => _tc_shape($r2->fetch(PDO::FETCH_ASSOC), $uid)]);
}

function tc_reject(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $reason = trim((string)($body['reject_reason'] ?? ''));
    if (mb_strlen($reason) > 200) $reason = mb_substr($reason, 0, 200);
    $st = $pdo->prepare("SELECT * FROM trading_cards WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'card なし', 404);
    if ((int)$r['target_user_id'] !== $uid) throw new ApiException('forbidden', '却下は本人のみ', 403);
    if ($r['status'] !== 'pending') throw new ApiException('bad_request', 'pending 中のみ却下可', 400);
    $pdo->prepare("UPDATE trading_cards SET status = 'rejected', reject_reason = ? WHERE id = ?")->execute([$reason ?: null, $id]);
    try {
        global $CFG;
        $targetName = (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        notify_safely($pdo, $CFG, (int)$r['created_by_user_id'], 'admin_notice',
            "🎴 {$targetName} さんがあなたが作ったトレカを却下しました" . ($reason ? " ({$reason})" : ''),
            'trading_card', $id);
    } catch (Throwable $_) {}
    json_response(['ok' => true]);
}

function tc_archive(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM trading_cards WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'card なし', 404);
    if (!$isAdmin && (int)$r['target_user_id'] !== $uid && (int)$r['created_by_user_id'] !== $uid) {
        throw new ApiException('forbidden', '本人/作成者/admin のみ', 403);
    }
    $pdo->prepare("UPDATE trading_cards SET status = 'archived' WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

function tc_collection(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT c.*, ut.display_name AS target_name, ut.avatar_url AS target_avatar,
                                uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
                                col.count, col.first_got_at, col.last_got_at
                           FROM trading_card_collection col
                           JOIN trading_cards c ON c.id = col.card_id
                      LEFT JOIN users ut ON ut.id = c.target_user_id
                      LEFT JOIN users uc ON uc.id = c.created_by_user_id
                          WHERE col.user_id = ?
                       ORDER BY FIELD(c.rarity,'SSR','SR','R','N'), col.last_got_at DESC");
    $st->execute([$uid]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $shape = _tc_shape($r, $uid);
        $shape['count']        = (int)$r['count'];
        $shape['first_got_at'] = (string)$r['first_got_at'];
        $shape['last_got_at']  = (string)$r['last_got_at'];
        $items[] = $shape;
    }
    // 全カード数 (公開プール) と所持ユニーク数
    $poolCount = (int)$pdo->query("SELECT COUNT(*) FROM trading_cards WHERE status='approved'")->fetchColumn();
    json_response(['items' => $items, 'unique_count' => count($items), 'pool_count' => $poolCount]);
}

// 抽選: 10 連は R 以上確定 (最低 1 枚)。各 pull は独立抽選 + 10 連なら全枚 N の時に一枠 R+ に置換。
function _tc_draw_rarity(bool $guaranteeR): string {
    $w = TC_RARITY_WEIGHT_SINGLE;
    $sum = array_sum($w);
    $r = mt_rand(1, $sum);
    $acc = 0;
    foreach ($w as $rarity => $wt) {
        $acc += $wt;
        if ($r <= $acc) return $rarity;
    }
    return 'N';
}
function _tc_pick_card_by_rarity(PDO $pdo, string $rarity, ?int $excludeId = null): ?int {
    $sql = "SELECT id FROM trading_cards WHERE status = 'approved' AND rarity = ?";
    $args = [$rarity];
    if ($excludeId !== null) { $sql .= " AND id != ?"; $args[] = $excludeId; }
    $sql .= " ORDER BY RAND() LIMIT 1";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $id = (int)$st->fetchColumn();
    return $id > 0 ? $id : null;
}

function tc_gacha(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $pulls = (int)($body['pulls'] ?? 1);
    if (!in_array($pulls, [1, 10], true)) throw new ApiException('bad_request', 'pulls は 1 or 10', 400);
    $cost = $pulls === 10 ? TC_FEE_TEN : TC_FEE_SINGLE;
    // 公開カードが 0 なら回せない
    $poolCount = (int)$pdo->query("SELECT COUNT(*) FROM trading_cards WHERE status='approved'")->fetchColumn();
    if ($poolCount === 0) throw new ApiException('bad_request', 'まだ公開されたカードがありません', 400);
    // 残高チェック
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) throw new ApiException('insufficient_balance', "残高不足 (要 {$cost}pt、現在 {$bal}pt)", 400);

    $results = [];
    $pdo->beginTransaction();
    try {
        // 徴収
        Ledger::transfer($pdo, $uid, 1, $cost, 'gacha_buyin', 'trading_card', 0, "🎴 トレカガチャ {$pulls} 連");
        // 抽選
        $rarities = [];
        for ($i = 0; $i < $pulls; $i++) $rarities[] = _tc_draw_rarity(false);
        if ($pulls === 10) {
            // R 以上が 1 枚もなければ 1 枠を R に置換
            $hasR = false;
            foreach ($rarities as $r) if (in_array($r, ['R','SR','SSR'], true)) { $hasR = true; break; }
            if (!$hasR) $rarities[0] = 'R';
        }
        // 各 rarity で 1 枚ずつ引く。該当 rarity 在庫が無い場合は下位 → 上位で fallback
        $fallbackChain = ['SSR','SR','R','N'];
        foreach ($rarities as $rarity) {
            $cardId = _tc_pick_card_by_rarity($pdo, $rarity);
            if ($cardId === null) {
                // fallback: 順に探す
                foreach ($fallbackChain as $tryRarity) {
                    $cardId = _tc_pick_card_by_rarity($pdo, $tryRarity);
                    if ($cardId !== null) break;
                }
            }
            if ($cardId === null) continue;   // 万一何も無くても課金は成立、あとで補填する類は今回スキップ
            // collection upsert
            $pdo->prepare("INSERT INTO trading_card_collection (user_id, card_id, count) VALUES (?, ?, 1)
                            ON DUPLICATE KEY UPDATE count = count + 1, last_got_at = CURRENT_TIMESTAMP")
                ->execute([$uid, $cardId]);
            // pull 履歴
            $pdo->prepare("INSERT INTO trading_card_pulls (user_id, card_id, cost) VALUES (?, ?, ?)")
                ->execute([$uid, $cardId, intdiv($cost, $pulls)]);
            $results[] = $cardId;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 引いたカード詳細を返す
    if (!$results) {
        json_response(['ok' => true, 'pulled' => [], 'cost' => $cost, 'note' => '在庫不足']);
        return;
    }
    $place = implode(',', array_fill(0, count($results), '?'));
    $st = $pdo->prepare(_tc_select_base() . " WHERE c.id IN ($place)");
    $st->execute($results);
    $cardMap = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $cardMap[(int)$r['id']] = _tc_shape($r, $uid);
    // pull 順序を保つ
    $ordered = array_values(array_map(fn($id) => $cardMap[$id] ?? null, $results));
    json_response(['ok' => true, 'pulled' => $ordered, 'cost' => $cost, 'pool_count' => $poolCount]);
}
