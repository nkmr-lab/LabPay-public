<?php
// /api/zemi-videos — ゼミ動画 (URL限定公開のYouTube) を 一覧 + 検索 + 視聴 (v843 #426)。
//
//   GET    /api/zemi-videos                    一覧 (?q=keyword で title/description LIKE 検索)
//   GET    /api/zemi-videos/<id>               1 件取得
//   POST   /api/zemi-videos                    新規登録 { title, description, youtube_url, occurred_on }
//   PATCH  /api/zemi-videos/<id>               編集 (本人 / admin のみ)
//   DELETE /api/zemi-videos/<id>               削除 (本人 / admin のみ)
declare(strict_types=1);

function route_zemi_videos(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';

    if ($method === 'GET' && !isset($seg[1])) {
        zemi_videos_list($pdo, $cfg);
        return;
    }
    // v846 Cosense (nkmr-lab Scrapbox) の 「全体ゼミ」 タグページから YouTube URL を一括取り込み
    if ($method === 'POST' && ($seg[1] ?? '') === 'import-from-cosense') {
        if (!$isAdmin) throw new ApiException('forbidden', 'admin のみ', 403);
        zemi_videos_import_from_cosense($pdo, $cfg, $uid);
        return;
    }
    if ($method === 'POST' && !isset($seg[1])) {
        zemi_videos_create($pdo, $uid);
        return;
    }
    if (!isset($seg[1])) {
        throw new ApiException('not_found', "no route", 404);
    }
    $id = (int)$seg[1];
    if ($id <= 0) throw new ApiException('bad_request', 'id 不正', 400);

    if ($method === 'GET') {
        zemi_videos_get($pdo, $id);
        return;
    }
    if ($method === 'PATCH') {
        zemi_videos_update($pdo, $uid, $isAdmin, $id);
        return;
    }
    if ($method === 'DELETE') {
        zemi_videos_delete($pdo, $uid, $isAdmin, $id);
        return;
    }
    throw new ApiException('not_found', "no route for $method", 404);
}

// YouTube URL から ID を 抽出。 失敗で null。
//   対応: youtube.com/watch?v=XXX, youtu.be/XXX, youtube.com/embed/XXX, youtube.com/shorts/XXX
function zemi_videos_extract_youtube_id(string $url): ?string {
    $url = trim($url);
    if ($url === '') return null;
    if (preg_match('~(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})~', $url, $m)) {
        return $m[1];
    }
    // 純粋な 11 文字の YouTube ID 直接入力も許可
    if (preg_match('~^[A-Za-z0-9_-]{11}$~', $url)) return $url;
    return null;
}

function zemi_videos_row_to_array(array $r): array {
    $vid = (string)$r['youtube_id'];
    return [
        'id'           => (int)$r['id'],
        'user_id'      => (int)$r['user_id'],
        'title'        => (string)$r['title'],
        // v849 #436 YouTube タイトル (登録時に oEmbed で 取得した もの) を 優先 表示 する 用
        'youtube_title'  => $r['youtube_title']  ?? null,
        'youtube_author' => $r['youtube_author'] ?? null,
        'description'  => $r['description'],
        'youtube_id'   => $vid,
        'youtube_url'  => (string)$r['youtube_url'],
        'embed_url'    => 'https://www.youtube-nocookie.com/embed/' . rawurlencode($vid),
        'thumbnail_url'=> 'https://img.youtube.com/vi/' . rawurlencode($vid) . '/mqdefault.jpg',
        'occurred_on'  => $r['occurred_on'],
        'created_at'   => $r['created_at'],
        'author_name'  => $r['author_name'] ?? null,
        'author_avatar'=> $r['author_avatar'] ?? null,
    ];
}

// v849 #436 YouTube oEmbed API で title + author_name を 取得 (失敗時 null)
function zemi_videos_fetch_youtube_meta(string $videoId): array {
    $url = 'https://www.youtube.com/oembed?url=' . rawurlencode('https://www.youtube.com/watch?v=' . $videoId) . '&format=json';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_HTTPHEADER     => ['User-Agent: LabPay/zemi-videos'],
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200 || !$body) return ['title' => null, 'author' => null];
    $j = json_decode((string)$body, true);
    if (!is_array($j)) return ['title' => null, 'author' => null];
    return [
        'title'  => isset($j['title'])       ? mb_substr((string)$j['title'],       0, 300) : null,
        'author' => isset($j['author_name']) ? mb_substr((string)$j['author_name'], 0, 200) : null,
    ];
}

function zemi_videos_list(PDO $pdo, array $cfg): void {
    $q = trim((string)($_GET['q'] ?? ''));
    $limit = max(1, min(200, (int)($_GET['limit'] ?? 60)));
    $sql = "SELECT zv.id, zv.user_id, zv.title, zv.youtube_title, zv.youtube_author,
                   zv.description, zv.youtube_id, zv.youtube_url,
                   zv.occurred_on, zv.created_at,
                   u.display_name AS author_name, u.avatar_url AS author_avatar
              FROM zemi_videos zv
              LEFT JOIN users u ON u.id = zv.user_id";
    $args = [];
    if ($q !== '' && mb_strlen($q) <= 100) {
        $sql .= " WHERE (zv.title LIKE ? OR zv.description LIKE ?)";
        $args[] = '%' . $q . '%';
        $args[] = '%' . $q . '%';
    }
    $sql .= " ORDER BY COALESCE(zv.occurred_on, DATE(zv.created_at)) DESC, zv.id DESC LIMIT $limit";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = array_map('zemi_videos_row_to_array', $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items, 'q' => $q]);
}

function zemi_videos_get(PDO $pdo, int $id): void {
    $st = $pdo->prepare("SELECT zv.*, u.display_name AS author_name, u.avatar_url AS author_avatar
                           FROM zemi_videos zv
                           LEFT JOIN users u ON u.id = zv.user_id
                          WHERE zv.id=?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '動画が見つかりません', 404);
    json_response(zemi_videos_row_to_array($r));
}

function zemi_videos_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    $desc  = trim((string)($body['description'] ?? ''));
    $url   = trim((string)($body['youtube_url'] ?? ''));
    $date  = trim((string)($body['occurred_on'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) {
        throw new ApiException('bad_request', 'タイトルは 1〜300 文字', 400);
    }
    if (mb_strlen($desc) > 5000) {
        throw new ApiException('bad_request', '説明は 5000 文字まで', 400);
    }
    $vid = zemi_videos_extract_youtube_id($url);
    if ($vid === null) {
        throw new ApiException('bad_request', 'YouTube URL が認識できませんでした (youtube.com / youtu.be 形式 か 11 文字の ID)', 400);
    }
    // v849 #435 重複防止: 既に同じ youtube_id が登録されていれば そちらを返す
    $exist = $pdo->prepare("SELECT id FROM zemi_videos WHERE youtube_id=?");
    $exist->execute([$vid]);
    $existId = (int)$exist->fetchColumn();
    if ($existId > 0) {
        throw new ApiException('conflict', "この YouTube 動画は既に登録されています (#{$existId})", 409);
    }
    $dateNorm = null;
    if ($date !== '') {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new ApiException('bad_request', '日付は YYYY-MM-DD 形式', 400);
        }
        $dateNorm = $date;
    }
    // v849 #436 YouTube oEmbed で 正式 タイトル + author を 取得 (失敗時 null)
    $meta = zemi_videos_fetch_youtube_meta($vid);
    $st = $pdo->prepare("INSERT INTO zemi_videos (user_id, title, youtube_title, youtube_author, description, youtube_id, youtube_url, occurred_on) VALUES (?,?,?,?,?,?,?,?)");
    $st->execute([$uid, $title, $meta['title'], $meta['author'], ($desc === '' ? null : $desc), $vid, $url, $dateNorm]);
    $newId = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $newId, 'youtube_title' => $meta['title']]);
}

function zemi_videos_update(PDO $pdo, int $uid, bool $isAdmin, int $id): void {
    $body = read_json_body();
    $st = $pdo->prepare("SELECT user_id FROM zemi_videos WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '動画が見つかりません', 404);
    if ((int)$row['user_id'] !== $uid && !$isAdmin) {
        throw new ApiException('forbidden', '本人 / admin のみ編集可', 403);
    }
    $sets = [];
    $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 300) throw new ApiException('bad_request', 'タイトル 1〜300 文字', 400);
        $sets[] = 'title=?'; $args[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        if (mb_strlen($d) > 5000) throw new ApiException('bad_request', '説明 5000 文字まで', 400);
        $sets[] = 'description=?'; $args[] = ($d === '' ? null : $d);
    }
    if (array_key_exists('youtube_url', $body)) {
        $u = trim((string)$body['youtube_url']);
        $vid = zemi_videos_extract_youtube_id($u);
        if ($vid === null) throw new ApiException('bad_request', 'YouTube URL が不正', 400);
        $sets[] = 'youtube_id=?';  $args[] = $vid;
        $sets[] = 'youtube_url=?'; $args[] = $u;
    }
    if (array_key_exists('occurred_on', $body)) {
        $d = trim((string)$body['occurred_on']);
        if ($d !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
            throw new ApiException('bad_request', '日付は YYYY-MM-DD', 400);
        }
        $sets[] = 'occurred_on=?'; $args[] = ($d === '' ? null : $d);
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE zemi_videos SET " . implode(', ', $sets) . " WHERE id=?")->execute($args);
    json_response(['ok' => true]);
}

function zemi_videos_delete(PDO $pdo, int $uid, bool $isAdmin, int $id): void {
    $st = $pdo->prepare("SELECT user_id FROM zemi_videos WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', '動画が見つかりません', 404);
    if ((int)$row['user_id'] !== $uid && !$isAdmin) {
        throw new ApiException('forbidden', '本人 / admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM zemi_videos WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// v846 Cosense (nkmr-lab) の 「全体ゼミ」 タグページから YouTube URL を一括取り込み。
//
//   1. タグページ /api/pages/<project>/全体ゼミ を取得 → relatedPages.links1hop で
//      タグが貼られた全ページのタイトル一覧を得る
//   2. 各ページの本文 (lines) を取得 → YouTube URL を正規表現で抽出
//   3. 既存の youtube_id と重複しないものを zemi_videos に INSERT
//      (title = ページタイトル、 description = 本文先頭の非空行 + URL周辺のテキスト、
//       occurred_on = ページタイトルから日付抽出、 user_id = 取り込み実行者)
function zemi_videos_import_from_cosense(PDO $pdo, array $cfg, int $uid): void {
    $pat = cosense_user_pat($pdo, $uid);
    if ($pat === null) {
        throw new ApiException('precondition', 'Scrapboxの鍵 (PAT) が未登録です。 設定 → Cosense連携 で登録してください', 412);
    }
    $tag = (string)($_GET['tag'] ?? '全体ゼミ');
    if ($tag === '') $tag = '全体ゼミ';

    // v851 #438 修正: relatedPages.links1hop (= タグページに backlinks してる ページ群) は、
    //   研究ノートや月報など 「全体ゼミ」 をテキスト中で参照しているだけの ノイズページが大量
    //   に混じる。 そこから YouTube URL を 拾うと 「踊歌ってみた」 みたいな 個人の音楽動画 が
    //   ゼミ動画として 登録されてしまう。
    //   タグページの `links` (= outgoing) を 使い、 「全体ゼミ」 で始まる ページタイトル に
    //   限定する ことで、 実際の ゼミページ ([全体ゼミ 2026.04.30] みたいなやつ) だけ拾う。
    $baseUrl = cosense_base($cfg) . '/api/pages/' . rawurlencode(cosense_project($cfg)) . '/' . rawurlencode($tag);
    $res = cosense_http('GET', $baseUrl, ['pat' => $pat]);
    if ($res['status'] !== 200) {
        throw new ApiException('upstream', "Cosense からのタグページ取得に失敗 (HTTP {$res['status']})。 タグ「{$tag}」 が存在するか確認", 502);
    }
    $tagPage = json_decode($res['body'], true);
    if (!is_array($tagPage)) {
        throw new ApiException('upstream', 'Cosense レスポンス が JSON ではありません', 502);
    }
    // 候補ページタイトル を 3 系統 から かき集めて、 タグ名で始まるものだけに 絞る。
    //   (a) page.links (= outgoing。 v1 でも 値は ある)
    //   (b) page.lines を スキャン して [全体ゼミ XXX] パターンを抜く (= 確実な outgoing)
    //   (c) relatedPages.links1hop (= incoming = backlinks。 タグが付いてるページ群)
    //   いずれも 「全体ゼミ XXXX」 で始まるタイトルに限定して dedupe。
    $prefix = $tag;
    $matchesPrefix = function($s) use ($prefix) {
        if (!is_string($s) || $s === '') return false;
        if (mb_strpos($s, $prefix) !== 0) return false;
        if ($s === $prefix) return false;
        // 次の文字が空白 / アンダーバー / カッコ / 数字 等で 「全体ゼミの後に何か追記がある」 形のみ採用
        return preg_match('/^' . preg_quote($prefix, '/') . '[\s_\-（(\d]/u', $s) === 1;
    };
    $titles = [];
    $seen = [];
    foreach (($tagPage['links'] ?? []) as $t) {
        $s = is_string($t) ? $t : (string)($t['title'] ?? '');
        if ($matchesPrefix($s) && !isset($seen[$s])) { $titles[] = $s; $seen[$s] = true; }
    }
    foreach (($tagPage['lines'] ?? []) as $ln) {
        $t = (string)($ln['text'] ?? '');
        if (preg_match_all('/\[([^\]]+)\]/u', $t, $mm)) {
            foreach ($mm[1] as $cand) {
                $cand = trim($cand);
                // [* xxx] や [/ xxx] 等の 装飾記法 を除外
                if ($cand === '' || preg_match('/^[\*\/\-]/u', $cand)) continue;
                // [text url] 形式 (URL 入りの装飾) は URL を含むので除外
                if (preg_match('~https?://~', $cand)) continue;
                if ($matchesPrefix($cand) && !isset($seen[$cand])) { $titles[] = $cand; $seen[$cand] = true; }
            }
        }
    }
    foreach (($tagPage['relatedPages']['links1hop'] ?? []) as $lp) {
        $s = is_string($lp) ? $lp : (string)($lp['title'] ?? '');
        if ($matchesPrefix($s) && !isset($seen[$s])) { $titles[] = $s; $seen[$s] = true; }
    }
    $linked = array_map(fn($t) => ['title' => $t], $titles);

    $stats = ['tag' => $tag, 'pages_scanned' => 0, 'urls_found' => 0, 'inserted' => 0, 'skipped_existing' => 0, 'errors' => 0];
    $details = []; // pages with何 videos imported

    // 既存 youtube_id セット (重複防止)
    $existing = [];
    $exSt = $pdo->query("SELECT youtube_id FROM zemi_videos");
    foreach ($exSt->fetchAll(PDO::FETCH_COLUMN) as $vid) $existing[$vid] = true;

    foreach ($linked as $lp) {
        $title = (string)($lp['title'] ?? '');
        if ($title === '') continue;
        $stats['pages_scanned']++;
        // 個別ページの本文取得 (v2 で lines が一覧で取れる)
        $r = cosense_v2_get_page($cfg, $title, $pat);
        if (!$r['ok']) { $stats['errors']++; continue; }
        $lines = $r['page']['lines'] ?? [];
        $allText = '';
        foreach ($lines as $ln) {
            $t = (string)($ln['text'] ?? '');
            $allText .= $t . "\n";
        }
        // YouTube URL 抽出
        preg_match_all(
            '~https?://(?:www\.|m\.)?(?:youtu(?:be\.com/(?:watch\?(?:[^\s\]]*&)?v=|embed/|shorts/|v/)|\.be/))([A-Za-z0-9_-]{11})~',
            $allText, $matches, PREG_SET_ORDER
        );
        if (!$matches) continue;
        // ページタイトルから日付抽出 (YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD)
        $occurred = null;
        if (preg_match('/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/u', $title, $dm)) {
            $occurred = sprintf('%04d-%02d-%02d', (int)$dm[1], (int)$dm[2], (int)$dm[3]);
        }
        // ページの最初の非空行を description として使う (タイトル除外)
        $descLines = [];
        foreach ($lines as $i => $ln) {
            if ($i === 0) continue; // 1 行目は タイトル
            $t = trim((string)($ln['text'] ?? ''));
            if ($t === '') continue;
            $descLines[] = $t;
            if (count($descLines) >= 3) break;
        }
        $desc = trim(implode("\n", $descLines));
        if ($desc === '') $desc = null;

        $seenInThisPage = [];
        foreach ($matches as $m) {
            $url = $m[0];
            $vid = $m[1];
            $stats['urls_found']++;
            if (isset($existing[$vid]) || isset($seenInThisPage[$vid])) {
                $stats['skipped_existing']++;
                continue;
            }
            $seenInThisPage[$vid] = true;
            $existing[$vid] = true;
            try {
                // v849 #436 import 時も oEmbed で YouTube タイトル を 取得 (= 動画一覧の表示が良くなる)
                $meta = zemi_videos_fetch_youtube_meta($vid);
                $ins = $pdo->prepare("INSERT INTO zemi_videos (user_id, title, youtube_title, youtube_author, description, youtube_id, youtube_url, occurred_on) VALUES (?,?,?,?,?,?,?,?)");
                $ins->execute([$uid, mb_substr($title, 0, 300), $meta['title'], $meta['author'], $desc, $vid, $url, $occurred]);
                $stats['inserted']++;
                $details[] = ['page' => $title, 'youtube_id' => $vid, 'youtube_title' => $meta['title'], 'occurred_on' => $occurred];
            } catch (Throwable $e) {
                $stats['errors']++;
            }
        }
    }
    json_response(['ok' => true, 'stats' => $stats, 'inserted_pages' => $details]);
}
