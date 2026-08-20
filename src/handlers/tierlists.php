<?php
// v549 #210 ティア表。起案者がお題 + 候補リストを作成、参加者が S/A/B/C/D/F に
//   振り分け、提出後他人の表が見える。
//   GET    /api/tierlists                自分が起案 or 1件以上回答した一覧 + 公開済み
//   POST   /api/tierlists                { title, description?, items[], tiers? }
//   GET    /api/tierlists/:id            詳細 (items + tiers + 自分の回答 + 全員回答 +
//                                          item × tier の集計)
//   PUT    /api/tierlists/:id/answer     { assignments: { itemId: tierKey } }
//   DELETE /api/tierlists/:id            起案者のみ
//   POST   /api/tierlists/:id/close      起案者のみ (締切る)
declare(strict_types=1);

// v582 5 段階 (S/A/B/C/D) に変更。既存データの F に振られた候補はデータ層では
//   残るが UI 側で C 扱いされる (TIER_DEFAULT に F が無い)。
const TIER_DEFAULT = [
    ['key' => 'S', 'label' => 'S', 'color' => '#ff6b6b'],
    ['key' => 'A', 'label' => 'A', 'color' => '#ff9e6b'],
    ['key' => 'B', 'label' => 'B', 'color' => '#ffd76b'],
    ['key' => 'C', 'label' => 'C', 'color' => '#9ee06b'],
    ['key' => 'D', 'label' => 'D', 'color' => '#6bb4ff'],
];

// v815 #410 「?」評価不能 (= 行ってない / 知らない) tier を全 tier list に強制付与。
//   新規 / 既存問わず適用するため、 detail / answer の読み出し時に append する。
function tier_with_unknown(array $tiers): array {
    $tiers = array_values($tiers);
    foreach ($tiers as $t) {
        if (($t['key'] ?? '') === '?') return $tiers; // 既にある
    }
    $tiers[] = ['key' => '?', 'label' => '?', 'color' => '#9ca3af'];
    return $tiers;
}

function route_tierlists(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) {
        if ($method === 'GET')  { tierlists_list($pdo, $uid); return; }
        if ($method === 'POST') { tierlists_create($pdo, $cfg, $uid); return; }
    }
    $tid = (int)$seg[1];
    $action = $seg[2] ?? '';
    if ($action === '' && $method === 'GET')    { tierlists_detail($pdo, $uid, $tid); return; }
    if ($action === 'answer' && $method === 'PUT')  { tierlists_answer($pdo, $cfg, $uid, $tid); return; }
    if ($action === '' && $method === 'DELETE') { tierlists_delete($pdo, $uid, $tid); return; }
    if ($action === 'close' && $method === 'POST')  { tierlists_close($pdo, $uid, $tid); return; }
    // v1346 fb#523 中村研（氏名01）要望「作成者だったら要素を追加・削除できるようになると嬉しい」
    //   PUT で統一 (既存の answer が PUT なので client の api.js の put() をそのまま流用するため)
    if ($action === 'items' && $method === 'PUT') { tierlists_items_patch($pdo, $uid, $tid); return; }
    json_error('not_found', "no tierlists route for $method", 404);
}

// v1346 起案者が締切前に items を追加 / 削除する。
//   { add: [{label, image_url?}, ...], remove: [id, id, ...] }
//   - 追加: 既存の最大 index + 1 から連番で新 id を発番 (i100 など、既存 id と衝突しない)。
//   - 削除: items から該当 id を除き、全 answers の assignments からも該当 id を消す。
//   - 締切後は不可、起案者のみ。
function tierlists_items_patch(PDO $pdo, int $uid, int $tid): void {
    $body = read_json_body();
    $add    = is_array($body['add'] ?? null)    ? $body['add']    : [];
    $remove = is_array($body['remove'] ?? null) ? $body['remove'] : [];
    $st = $pdo->prepare("SELECT creator_user_id, is_closed, items_json FROM tierlists WHERE id = ?");
    $st->execute([$tid]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'tierlist not found', 404);
    if ((int)$t['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ編集可', 403);
    if ($t['is_closed']) throw new ApiException('bad_request', '締切済みは編集不可', 400);
    $items = json_decode($t['items_json'] ?: '[]', true) ?: [];

    // 削除: id 一致の item を items から除く
    $removeSet = [];
    foreach ($remove as $rid) { $removeSet[(string)$rid] = true; }
    if ($removeSet) {
        $items = array_values(array_filter($items, fn($it) => !isset($removeSet[(string)($it['id'] ?? '')])));
    }

    // 追加: 既存 id の数字部分の最大 + 1 から連番。 i{N} 命名を継続。
    $maxIdx = -1;
    foreach ($items as $it) {
        if (preg_match('/^i(\d+)$/', (string)($it['id'] ?? ''), $m)) {
            $maxIdx = max($maxIdx, (int)$m[1]);
        }
    }
    foreach ($add as $it) {
        $lbl = mb_substr(trim((string)($it['label'] ?? '')), 0, 80);
        if ($lbl === '') continue;
        $maxIdx++;
        $items[] = [
            'id'        => 'i' . $maxIdx,
            'label'     => $lbl,
            'image_url' => isset($it['image_url']) && is_string($it['image_url']) ? mb_substr($it['image_url'], 0, 500) : null,
        ];
    }
    if (count($items) > 200) throw new ApiException('bad_request', '候補は 200 件まで', 400);
    if (!$items) throw new ApiException('bad_request', '候補が0件になる変更は不可', 400);

    db_tx($pdo, function () use ($pdo, $tid, $items, $removeSet) {
        $pdo->prepare("UPDATE tierlists SET items_json = ? WHERE id = ?")
            ->execute([json_encode($items, JSON_UNESCAPED_UNICODE), $tid]);
        // 削除された id は全 answers の assignments からも除く (残すと集計でゴミが出る)
        if ($removeSet) {
            $stA = $pdo->prepare("SELECT user_id, assignments_json FROM tierlist_answers WHERE tierlist_id = ?");
            $stA->execute([$tid]);
            $upd = $pdo->prepare("UPDATE tierlist_answers SET assignments_json = ? WHERE tierlist_id = ? AND user_id = ?");
            foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $a = json_decode($r['assignments_json'] ?: '{}', true) ?: [];
                if (!is_array($a)) $a = (array)$a;
                $changed = false;
                foreach (array_keys($a) as $k) {
                    if (isset($removeSet[(string)$k])) { unset($a[$k]); $changed = true; }
                }
                if ($changed) $upd->execute([json_encode($a, JSON_UNESCAPED_UNICODE), $tid, (int)$r['user_id']]);
            }
        }
    });
    json_response(['ok' => true, 'items' => $items]);
}

function tierlists_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("
        SELECT t.id, t.title, t.description, t.is_closed, t.created_at,
               t.creator_user_id, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar,
               (SELECT COUNT(*) FROM tierlist_answers a WHERE a.tierlist_id = t.id) AS answer_count,
               EXISTS(SELECT 1 FROM tierlist_answers a WHERE a.tierlist_id = t.id AND a.user_id = ?) AS my_answered
          FROM tierlists t JOIN users uc ON uc.id = t.creator_user_id
         ORDER BY t.id DESC LIMIT 50");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']              = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['is_closed']       = (bool)$r['is_closed'];
        $r['answer_count']    = (int)$r['answer_count'];
        $r['my_answered']     = (bool)$r['my_answered'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function tierlists_create(PDO $pdo, array $cfg, int $uid): void {
    $body  = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1-200', 400);
    $desc = isset($body['description']) ? mb_substr(trim((string)$body['description']), 0, 500) : null;
    if ($desc === '') $desc = null;
    $items = $body['items'] ?? [];
    if (!is_array($items) || !$items) throw new ApiException('bad_request', 'items 必須', 400);
    if (count($items) > 200) throw new ApiException('bad_request', '候補は 200 件まで', 400);
    $cleanItems = [];
    foreach ($items as $idx => $it) {
        $lbl = mb_substr(trim((string)($it['label'] ?? '')), 0, 80);
        if ($lbl === '') continue;
        $cleanItems[] = [
            'id'        => 'i' . $idx,
            'label'     => $lbl,
            'image_url' => isset($it['image_url']) && is_string($it['image_url']) ? mb_substr($it['image_url'], 0, 500) : null,
        ];
    }
    if (!$cleanItems) throw new ApiException('bad_request', '有効な候補が無い', 400);
    $tiers = isset($body['tiers']) && is_array($body['tiers']) && $body['tiers'] ? $body['tiers'] : TIER_DEFAULT;
    $tiers = array_map(fn($t) => [
        'key'   => mb_substr((string)($t['key'] ?? ''), 0, 8),
        'label' => mb_substr((string)($t['label'] ?? $t['key'] ?? ''), 0, 20),
        'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string)($t['color'] ?? '')) ? $t['color'] : '#888888',
    ], $tiers);
    $tiers = array_values(array_filter($tiers, fn($t) => $t['key'] !== ''));
    if (count($tiers) < 2 || count($tiers) > 12) throw new ApiException('bad_request', 'tiers は 2〜12 段', 400);

    $st = $pdo->prepare("INSERT INTO tierlists (creator_user_id, title, description, items_json, tiers_json) VALUES (?,?,?,?,?)");
    $st->execute([$uid, $title, $desc, json_encode($cleanItems, JSON_UNESCAPED_UNICODE), json_encode($tiers, JSON_UNESCAPED_UNICODE)]);
    $id = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $id]);
}

function tierlists_detail(PDO $pdo, int $uid, int $tid): void {
    $st = $pdo->prepare("SELECT t.*, uc.display_name AS creator_name, uc.avatar_url AS creator_avatar
                          FROM tierlists t JOIN users uc ON uc.id = t.creator_user_id
                         WHERE t.id = ?");
    $st->execute([$tid]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'tierlist not found', 404);
    $items = json_decode($t['items_json'] ?: '[]', true) ?: [];
    $tiers = json_decode($t['tiers_json'] ?: 'null', true) ?: TIER_DEFAULT;
    // v815 #410 「?」評価不能 tier を常に末尾に追加
    $tiers = tier_with_unknown($tiers);

    $stA = $pdo->prepare("SELECT a.user_id, a.assignments_json, a.updated_at, u.display_name, u.avatar_url
                            FROM tierlist_answers a JOIN users u ON u.id = a.user_id
                           WHERE a.tierlist_id = ? ORDER BY a.updated_at");
    $stA->execute([$tid]);
    $answers = [];
    $myAnswer = null;
    foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $a = [
            'user_id'      => (int)$r['user_id'],
            'display_name' => $r['display_name'],
            'avatar_url'   => $r['avatar_url'],
            'assignments'  => json_decode($r['assignments_json'] ?: '{}', true) ?: new stdClass(),
            'updated_at'   => $r['updated_at'],
        ];
        if ((int)$r['user_id'] === $uid) $myAnswer = $a;
        else $answers[] = $a;
    }
    // 集計: item ごとに各 tier に何人入れたか
    $agg = [];
    foreach ($items as $it) {
        $agg[$it['id']] = [];
        foreach ($tiers as $tt) $agg[$it['id']][$tt['key']] = 0;
    }
    $allAnswers = $myAnswer ? array_merge([$myAnswer], $answers) : $answers;
    foreach ($allAnswers as $a) {
        $as = $a['assignments'] ?: [];
        if (is_object($as)) $as = (array)$as;
        foreach ($as as $iid => $tk) {
            if (isset($agg[$iid][$tk])) $agg[$iid][$tk]++;
        }
    }
    json_response([
        'id'              => (int)$t['id'],
        'title'           => $t['title'],
        'description'     => $t['description'],
        'is_closed'       => (bool)$t['is_closed'],
        'created_at'      => $t['created_at'],
        'creator_user_id' => (int)$t['creator_user_id'],
        'creator_name'    => $t['creator_name'],
        'creator_avatar'  => $t['creator_avatar'],
        'is_creator'      => (int)$t['creator_user_id'] === $uid,
        'items'           => $items,
        'tiers'           => $tiers,
        'my_answer'       => $myAnswer,
        'other_answers'   => $answers,
        'aggregation'     => $agg,
        'answer_count'    => count($allAnswers),
    ]);
}

function tierlists_answer(PDO $pdo, array $cfg, int $uid, int $tid): void {
    $body = read_json_body();
    $assignments = $body['assignments'] ?? null;
    if (!is_array($assignments)) throw new ApiException('bad_request', 'assignments required', 400);
    $st = $pdo->prepare("SELECT items_json, tiers_json, is_closed, creator_user_id, title FROM tierlists WHERE id = ?");
    $st->execute([$tid]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'tierlist not found', 404);
    if ($t['is_closed']) throw new ApiException('bad_request', '締切られています', 400);
    $items = json_decode($t['items_json'] ?: '[]', true) ?: [];
    $tiers = json_decode($t['tiers_json'] ?: 'null', true) ?: TIER_DEFAULT;
    // v815 #410 「?」を受け入れるように
    $tiers = tier_with_unknown($tiers);
    $itemIds = array_flip(array_column($items, 'id'));
    $tierKeys = array_flip(array_column($tiers, 'key'));
    $clean = [];
    foreach ($assignments as $iid => $tk) {
        $iid = (string)$iid; $tk = (string)$tk;
        if (!isset($itemIds[$iid])) continue;
        if (!isset($tierKeys[$tk])) continue;
        $clean[$iid] = $tk;
    }
    $isNew = false;
    $stC = $pdo->prepare("SELECT 1 FROM tierlist_answers WHERE tierlist_id = ? AND user_id = ?");
    $stC->execute([$tid, $uid]);
    if (!$stC->fetchColumn()) $isNew = true;
    $pdo->prepare("INSERT INTO tierlist_answers (tierlist_id, user_id, assignments_json) VALUES (?,?,?)
                   ON DUPLICATE KEY UPDATE assignments_json = VALUES(assignments_json)")
        ->execute([$tid, $uid, json_encode($clean, JSON_UNESCAPED_UNICODE)]);
    // 起案者に通知 (初回のみ)
    if ($isNew && (int)$t['creator_user_id'] !== $uid) {
        try {
            global $CFG;
            notify_safely($pdo, $CFG, (int)$t['creator_user_id'], 'admin_notice',
                "🎯 ティア表「{$t['title']}」に回答がありました",
                'tierlist', $tid);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true]);
}

function tierlists_delete(PDO $pdo, int $uid, int $tid): void {
    $st = $pdo->prepare("SELECT creator_user_id FROM tierlists WHERE id = ?");
    $st->execute([$tid]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'tierlist not found', 404);
    if ($owner !== $uid) throw new ApiException('forbidden', '起案者のみ削除可', 403);
    $pdo->prepare("DELETE FROM tierlists WHERE id = ?")->execute([$tid]);
    json_response(['ok' => true]);
}

function tierlists_close(PDO $pdo, int $uid, int $tid): void {
    $st = $pdo->prepare("SELECT creator_user_id FROM tierlists WHERE id = ?");
    $st->execute([$tid]);
    $owner = (int)$st->fetchColumn();
    if (!$owner) throw new ApiException('not_found', 'tierlist not found', 404);
    if ($owner !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
    $pdo->prepare("UPDATE tierlists SET is_closed = 1 WHERE id = ?")->execute([$tid]);
    json_response(['ok' => true]);
}
