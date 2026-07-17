<?php
// v1147 bokete — 中村さん要望「boketeの機能をつくって」
//   画像大喜利 (bokete.jp 的): お題 (画像 + 任意タイトル) を投稿 → 他の
//   メンバーが 面白い「ボケ」を書く → みんなが ⭐ で 評価 → ⭐ 数 で ランキング。
//   全員無料、 娯楽タブ (cat='game')。
//
// API:
//   GET    /api/bokete                     → お題一覧 (最近 50 件、 answer_count / top_stars 付き)
//   POST   /api/bokete                     → お題作成 { image_url, title?, deadline_at? }
//   GET    /api/bokete/{id}                → 詳細 (お題 + ボケ一覧 ⭐ 降順)
//   POST   /api/bokete/{id}/answers        → ボケ投稿 { text }
//   POST   /api/bokete/answers/{aid}/star  → ⭐ トグル
//   DELETE /api/bokete/{id}                → お題削除 (投稿者 or admin)
//   DELETE /api/bokete/answers/{aid}       → ボケ削除 (投稿者 or admin)

declare(strict_types=1);

const BOKETE_TEXT_MAX  = 500;
const BOKETE_TITLE_MAX = 200;

function route_bokete(PDO $pdo, array $cfg, string $method, array $seg): void {
    // /api/bokete
    if (!isset($seg[1])) {
        if ($method === 'GET')  { bokete_list($pdo, $cfg);   return; }
        if ($method === 'POST') { bokete_create($pdo, $cfg); return; }
    }
    // /api/bokete/answers/{aid}/star | DELETE /api/bokete/answers/{aid}
    if ($seg[1] === 'answers' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        $aid = (int)$seg[2];
        if (($seg[3] ?? '') === 'star' && $method === 'POST') { bokete_star_toggle($pdo, $cfg, $aid); return; }
        if (!isset($seg[3]) && $method === 'DELETE')          { bokete_answer_delete($pdo, $cfg, $aid); return; }
    }
    // /api/bokete/{id} / {id}/answers
    if (ctype_digit((string)$seg[1])) {
        $tid = (int)$seg[1];
        if (!isset($seg[2]) && $method === 'GET')                       { bokete_get($pdo, $cfg, $tid); return; }
        if (!isset($seg[2]) && $method === 'DELETE')                    { bokete_topic_delete($pdo, $cfg, $tid); return; }
        if (($seg[2] ?? '') === 'answers' && $method === 'POST')        { bokete_answer_create($pdo, $cfg, $tid); return; }
    }
    throw new ApiException('not_found', "no bokete route for $method", 404);
}

function _bokete_topic_shape(array $r, int $uid): array {
    return [
        'id'              => (int)$r['id'],
        'creator_user_id' => (int)$r['creator_user_id'],
        'creator_name'    => (string)($r['creator_name'] ?? ''),
        'creator_avatar'  => $r['creator_avatar'] ?? null,
        'image_url'       => (string)$r['image_url'],
        'title'           => (string)($r['title'] ?? ''),
        'deadline_at'     => $r['deadline_at'] ?? null,
        'created_at'      => (string)$r['created_at'],
        'is_mine'         => (int)$r['creator_user_id'] === $uid,
        'is_closed'       => !empty($r['deadline_at']) && strtotime((string)$r['deadline_at']) <= time(),
    ];
}

function bokete_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT t.id, t.creator_user_id, t.image_url, t.title, t.deadline_at, t.created_at,
                                 u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                 (SELECT COUNT(*) FROM bokete_answers a WHERE a.topic_id = t.id AND a.deleted_at IS NULL) AS answer_count,
                                 (SELECT COALESCE(MAX(sc.n),0) FROM
                                    (SELECT COUNT(*) AS n FROM bokete_stars s
                                       JOIN bokete_answers a ON a.id = s.answer_id
                                      WHERE a.topic_id = t.id AND a.deleted_at IS NULL
                                      GROUP BY s.answer_id) sc) AS top_stars
                            FROM bokete_topics t JOIN users u ON u.id = t.creator_user_id
                           WHERE t.deleted_at IS NULL
                           ORDER BY t.id DESC LIMIT 50");
    $st->execute();
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $item = _bokete_topic_shape($r, $uid);
        $item['answer_count'] = (int)$r['answer_count'];
        $item['top_stars']    = (int)$r['top_stars'];
        $items[] = $item;
    }
    json_response(['items' => $items]);
}

function bokete_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $img = trim((string)($body['image_url'] ?? ''));
    if ($img === '') throw new ApiException('bad_request', 'お題画像が必要 (/api/uploads/image で先にアップロード)', 400);
    if (mb_strlen($img) > 500) throw new ApiException('bad_request', 'image_url too long', 400);
    $title = isset($body['title']) ? trim((string)$body['title']) : '';
    if (mb_strlen($title) > BOKETE_TITLE_MAX) $title = mb_substr($title, 0, BOKETE_TITLE_MAX);
    $deadline = trim((string)($body['deadline_at'] ?? ''));
    $deadlineSql = null;
    if ($deadline !== '') {
        $ts = strtotime($deadline);
        if ($ts === false) throw new ApiException('bad_request', 'deadline_at の形式 (YYYY-MM-DD HH:MM) が不正', 400);
        $deadlineSql = date('Y-m-d H:i:s', $ts);
    }
    $st = $pdo->prepare("INSERT INTO bokete_topics (creator_user_id, image_url, title, deadline_at) VALUES (?, ?, ?, ?)");
    $st->execute([$uid, $img, $title ?: null, $deadlineSql]);
    $tid = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $tid]);
}

function bokete_get(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT t.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar
                            FROM bokete_topics t JOIN users u ON u.id = t.creator_user_id
                           WHERE t.id = ? AND t.deleted_at IS NULL");
    $st->execute([$tid]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'お題が見つかりません', 404);
    // ボケ + ⭐ 数 + 自分の ⭐ 状態
    $stA = $pdo->prepare("SELECT a.id, a.user_id, a.text, a.created_at,
                                 u.display_name AS user_name, u.avatar_url AS user_avatar,
                                 (SELECT COUNT(*) FROM bokete_stars s WHERE s.answer_id = a.id) AS stars,
                                 EXISTS(SELECT 1 FROM bokete_stars s WHERE s.answer_id = a.id AND s.user_id = ?) AS my_star
                            FROM bokete_answers a JOIN users u ON u.id = a.user_id
                           WHERE a.topic_id = ? AND a.deleted_at IS NULL
                           ORDER BY stars DESC, a.id DESC");
    $stA->execute([$uid, $tid]);
    $answers = [];
    foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $answers[] = [
            'id'          => (int)$r['id'],
            'user_id'     => (int)$r['user_id'],
            'user_name'   => (string)$r['user_name'],
            'user_avatar' => $r['user_avatar'],
            'text'        => (string)$r['text'],
            'stars'       => (int)$r['stars'],
            'my_star'     => (int)$r['my_star'] === 1,
            'is_mine'     => (int)$r['user_id'] === $uid,
            'created_at'  => (string)$r['created_at'],
        ];
    }
    json_response([
        'topic'   => _bokete_topic_shape($t, $uid),
        'answers' => $answers,
    ]);
}

function bokete_answer_create(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, deadline_at FROM bokete_topics WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$tid]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'お題なし', 404);
    if (!empty($t['deadline_at']) && strtotime((string)$t['deadline_at']) <= time()) {
        throw new ApiException('bad_request', '締切を過ぎました', 400);
    }
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'ボケの本文が必要', 400);
    if (mb_strlen($text) > BOKETE_TEXT_MAX) $text = mb_substr($text, 0, BOKETE_TEXT_MAX);
    $pdo->prepare("INSERT INTO bokete_answers (topic_id, user_id, text) VALUES (?, ?, ?)")
        ->execute([$tid, $uid, $text]);
    $aid = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $aid]);
}

function bokete_star_toggle(PDO $pdo, array $cfg, int $aid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT a.id, a.user_id, a.topic_id FROM bokete_answers a WHERE a.id = ? AND a.deleted_at IS NULL");
    $st->execute([$aid]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if (!$a) throw new ApiException('not_found', 'ボケなし', 404);
    if ((int)$a['user_id'] === $uid) throw new ApiException('bad_request', '自分のボケには ⭐ できません', 400);
    // toggle
    $stE = $pdo->prepare("SELECT 1 FROM bokete_stars WHERE answer_id = ? AND user_id = ?");
    $stE->execute([$aid, $uid]);
    if ($stE->fetchColumn()) {
        $pdo->prepare("DELETE FROM bokete_stars WHERE answer_id = ? AND user_id = ?")->execute([$aid, $uid]);
        $on = false;
    } else {
        $pdo->prepare("INSERT INTO bokete_stars (answer_id, user_id) VALUES (?, ?)")->execute([$aid, $uid]);
        $on = true;
    }
    $stN = $pdo->prepare("SELECT COUNT(*) FROM bokete_stars WHERE answer_id = ?");
    $stN->execute([$aid]);
    json_response(['ok' => true, 'on' => $on, 'stars' => (int)$stN->fetchColumn()]);
}

function bokete_topic_delete(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = ($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT creator_user_id FROM bokete_topics WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$tid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'お題なし', 404);
    if ((int)$row['creator_user_id'] !== $uid && !$isAdmin) throw new ApiException('forbidden', '投稿者のみ削除可', 403);
    $pdo->prepare("UPDATE bokete_topics SET deleted_at = NOW() WHERE id = ?")->execute([$tid]);
    json_response(['ok' => true]);
}

function bokete_answer_delete(PDO $pdo, array $cfg, int $aid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = ($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT user_id FROM bokete_answers WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$aid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'ボケなし', 404);
    if ((int)$row['user_id'] !== $uid && !$isAdmin) throw new ApiException('forbidden', '投稿者のみ削除可', 403);
    $pdo->prepare("UPDATE bokete_answers SET deleted_at = NOW() WHERE id = ?")->execute([$aid]);
    json_response(['ok' => true]);
}
