<?php
// v970 /api/nkmr-albums — 中村研 アルバム CRUD。
//   GET  /api/nkmr-albums                 → { sections: [{title, albums: [{id, title, url, flag, sort_order, created_by, created_by_name}]}] }
//   POST /api/nkmr-albums                 → 追加 (auth 済 は 誰でも 可)
//                                            body: {section, title, url, flag?}
//   PATCH  /api/nkmr-albums/{id}          → 編集 (作成者 or admin)
//   DELETE /api/nkmr-albums/{id}          → 削除 (作成者 or admin)
//
//   セクション 名 は 自由 文字列。 「2026」 の ように 4 桁 数字 だけ か、 「過去のもの」 等 の
//   ラベル も 可。 表示 順 は section DESC (新しい 年度 が 上)、 non-数字 は 末尾。

declare(strict_types=1);

function route_nkmr_albums(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === '' && $method === 'GET') {
        nkmr_albums_list($pdo, $cfg);
        return;
    }
    if ($sub === '' && $method === 'POST') {
        nkmr_albums_create($pdo, $cfg);
        return;
    }
    if ($sub !== '' && ctype_digit($sub) && $method === 'PATCH') {
        nkmr_albums_update($pdo, $cfg, (int)$sub);
        return;
    }
    if ($sub !== '' && ctype_digit($sub) && $method === 'DELETE') {
        nkmr_albums_delete($pdo, $cfg, (int)$sub);
        return;
    }
    throw new ApiException('not_found', "no nkmr-albums route for $method $sub", 404);
}

function nkmr_albums_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $rows = $pdo->query("
        SELECT a.id, a.section, a.title, a.url, a.flag, a.location, a.sort_order, a.created_by,
               u.display_name AS created_by_name
          FROM nkmr_albums a
          LEFT JOIN users u ON u.id = a.created_by
          ORDER BY a.section DESC, a.sort_order ASC, a.id ASC
    ")->fetchAll(PDO::FETCH_ASSOC);

    // section で group
    $grouped = [];
    foreach ($rows as $r) {
        $sec = (string)$r['section'];
        if (!isset($grouped[$sec])) $grouped[$sec] = [];
        $grouped[$sec][] = [
            'id'              => (int)$r['id'],
            'title'           => $r['title'],
            'url'             => $r['url'],
            'flag'            => $r['flag'] ?? '',
            'location'        => $r['location'] ?? '',
            'sort_order'      => (int)$r['sort_order'],
            'created_by'      => $r['created_by'] ? (int)$r['created_by'] : null,
            'created_by_name' => $r['created_by_name'] ?? null,
        ];
    }
    // section を 「数字 4 桁 (降順) → 数字なし (末尾)」 で 並べ替え
    uksort($grouped, function ($a, $b) {
        // PHP は 「2026」 等 の 数字 だけ の キー を int に 変換 する ので (string) キャスト 必須
        $sa = (string)$a; $sb = (string)$b;
        $an = preg_match('/^\d{4}$/', $sa) ? (int)$sa : -1;
        $bn = preg_match('/^\d{4}$/', $sb) ? (int)$sb : -1;
        if ($an === $bn) return strcmp($sa, $sb);
        return $bn - $an;   // 大きい 年度 が 先
    });
    $sections = [];
    foreach ($grouped as $title => $albums) {
        $sections[] = ['title' => $title, 'albums' => $albums];
    }
    json_response(['sections' => $sections]);
}

function nkmr_albums_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $b = read_json_body();
    $section  = trim((string)($b['section']  ?? ''));
    $title    = trim((string)($b['title']    ?? ''));
    $url      = trim((string)($b['url']      ?? ''));
    $flag     = trim((string)($b['flag']     ?? ''));
    $location = trim((string)($b['location'] ?? ''));

    if ($section === '' || strlen($section) > 60) {
        throw new ApiException('bad_request', 'section (1-60 chars)', 400);
    }
    if ($title === '' || strlen($title) > 200) {
        throw new ApiException('bad_request', 'title (1-200 chars)', 400);
    }
    if (!preg_match('#^https?://\S+$#', $url) || strlen($url) > 500) {
        throw new ApiException('bad_request', 'url must be http(s), <=500 chars', 400);
    }
    if (mb_strlen($flag) > 20) {
        throw new ApiException('bad_request', 'flag too long', 400);
    }
    if (mb_strlen($location) > 80) {
        throw new ApiException('bad_request', 'location too long', 400);
    }

    // 同 URL 既存 チェック
    $chk = $pdo->prepare("SELECT id FROM nkmr_albums WHERE url = ?");
    $chk->execute([$url]);
    if ($chk->fetchColumn()) {
        throw new ApiException('conflict', 'この URL は 既に 登録 されて います', 409);
    }

    // sort_order = 同 section 内 の MAX + 10
    $maxSt = $pdo->prepare("SELECT COALESCE(MAX(sort_order), 0) FROM nkmr_albums WHERE section = ?");
    $maxSt->execute([$section]);
    $newOrder = (int)$maxSt->fetchColumn() + 10;

    $ins = $pdo->prepare("
        INSERT INTO nkmr_albums (section, title, url, flag, location, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$section, $title, $url,
                   $flag !== '' ? $flag : null,
                   $location !== '' ? $location : null,
                   $newOrder, (int)$u['id']]);
    $id = (int)$pdo->lastInsertId();
    json_response(['id' => $id]);
}

function nkmr_albums_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT created_by FROM nkmr_albums WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'album not found', 404);
    $isOwner = ((int)$row['created_by'] === (int)$u['id']);
    if (!$isOwner && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '作成者 のみ 編集 可', 403);
    }

    $b = read_json_body();
    $sets = [];
    $vals = [];
    if (isset($b['section'])) {
        $v = trim((string)$b['section']);
        if ($v === '' || strlen($v) > 60) throw new ApiException('bad_request', 'section (1-60)', 400);
        $sets[] = 'section = ?'; $vals[] = $v;
    }
    if (isset($b['title'])) {
        $v = trim((string)$b['title']);
        if ($v === '' || strlen($v) > 200) throw new ApiException('bad_request', 'title (1-200)', 400);
        $sets[] = 'title = ?'; $vals[] = $v;
    }
    if (isset($b['url'])) {
        $v = trim((string)$b['url']);
        if (!preg_match('#^https?://\S+$#', $v) || strlen($v) > 500) {
            throw new ApiException('bad_request', 'url must be http(s), <=500', 400);
        }
        // 他 レコード と URL 衝突 チェック
        $chk = $pdo->prepare("SELECT id FROM nkmr_albums WHERE url = ? AND id != ?");
        $chk->execute([$v, $id]);
        if ($chk->fetchColumn()) throw new ApiException('conflict', 'この URL は 既に 登録 されて います', 409);
        $sets[] = 'url = ?'; $vals[] = $v;
    }
    if (isset($b['flag'])) {
        $v = trim((string)$b['flag']);
        if (mb_strlen($v) > 20) throw new ApiException('bad_request', 'flag too long', 400);
        $sets[] = 'flag = ?'; $vals[] = ($v !== '' ? $v : null);
    }
    if (isset($b['location'])) {
        $v = trim((string)$b['location']);
        if (mb_strlen($v) > 80) throw new ApiException('bad_request', 'location too long', 400);
        $sets[] = 'location = ?'; $vals[] = ($v !== '' ? $v : null);
    }
    if (!$sets) { json_response(['id' => $id]); return; }
    $vals[] = $id;
    $pdo->prepare("UPDATE nkmr_albums SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
    json_response(['id' => $id]);
}

function nkmr_albums_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT created_by FROM nkmr_albums WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'album not found', 404);
    $isOwner = ((int)$row['created_by'] === (int)$u['id']);
    if (!$isOwner && $u['role'] !== 'admin') {
        throw new ApiException('forbidden', '作成者 のみ 削除 可', 403);
    }
    $pdo->prepare("DELETE FROM nkmr_albums WHERE id = ?")->execute([$id]);
    json_response(['deleted' => true]);
}
