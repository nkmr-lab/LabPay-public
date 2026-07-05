<?php
// /api/refs — Zotero-like 文献管理 (v925 MVP)。 ラボ全員 で 共有、 個人 note は 各自。
// DOI / arXiv ID / URL から metadata 自動取得 (crossref / arxiv API)。
// PDF 添付 は /uploads/refs/<sha>.pdf、 同 sha なら paper_translate/paper_review と 相互リンク。

declare(strict_types=1);

function route_refs(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { refs_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { refs_create($pdo, $cfg); return; }
    if ($sub === 'import_doi'   && $method === 'POST') { refs_import_doi($pdo, $cfg);   return; }
    if ($sub === 'import_arxiv' && $method === 'POST') { refs_import_arxiv($pdo, $cfg); return; }
    if ($sub === 'import_url'   && $method === 'POST') { refs_import_url($pdo, $cfg);   return; }
    // v927 track A
    if ($sub === 'import_bibtex' && $method === 'POST') { refs_import_bibtex($pdo, $cfg); return; }
    if ($sub === 'import_ris'    && $method === 'POST') { refs_import_ris($pdo, $cfg);    return; }
    if ($sub === 'extract_pdf'   && $method === 'POST') { refs_extract_pdf($pdo, $cfg);   return; }
    if ($sub === 'tags'         && $method === 'GET')  { refs_tags($pdo, $cfg);         return; }
    if ($sub === 'export' && ($seg[2] ?? '') === 'bibtex' && $method === 'GET') {
        refs_export_bibtex($pdo, $cfg); return;
    }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''           && $method === 'GET')    { refs_detail($pdo, $cfg, $id); return; }
        if ($next === ''           && $method === 'PATCH')  { refs_edit($pdo, $cfg, $id);   return; }
        if ($next === ''           && $method === 'DELETE') { refs_delete($pdo, $cfg, $id); return; }
        if ($next === 'note'       && $method === 'PATCH')  { refs_note_set($pdo, $cfg, $id); return; }
        if ($next === 'attach_pdf' && $method === 'POST')   { refs_attach_pdf($pdo, $cfg, $id); return; }
        if ($next === 'bibtex'     && $method === 'GET')    { refs_bibtex_single($pdo, $cfg, $id); return; }
        // v927 追加 添付
        if ($next === 'attachments' && $method === 'GET')   { refs_attachments_list($pdo, $cfg, $id); return; }
        if ($next === 'attachments' && $method === 'POST')  { refs_attachments_upload($pdo, $cfg, $id); return; }
        if ($next === 'attachments' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            refs_attachments_delete($pdo, $cfg, $id, (int)$seg[3]); return;
        }
    }
    throw new ApiException('not_found', 'route not found', 404);
}

// ─────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────

// DOI 正規化: URL や doi.org prefix を 剥がして 「10.xxxx/yyy」 だけ に する。
function _refs_normalize_doi(string $raw): string {
    $s = trim($raw);
    $s = preg_replace('#^https?://(dx\.)?doi\.org/#i', '', $s);
    $s = preg_replace('#^doi:#i', '', $s);
    $s = trim($s);
    return $s;
}

// arXiv ID 正規化: URL や バージョン を 保ったまま id だけ 抽出。
//   例: https://arxiv.org/abs/2401.12345v2 → 2401.12345v2
//       arXiv:2401.12345 → 2401.12345
function _refs_normalize_arxiv(string $raw): ?string {
    $s = trim($raw);
    if (preg_match('#arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,6})(v\d+)?#i', $s, $m)) {
        return $m[1] . ($m[2] ?? '');
    }
    if (preg_match('#^arxiv:\s*([0-9]{4}\.[0-9]{4,6})(v\d+)?$#i', $s, $m)) {
        return $m[1] . ($m[2] ?? '');
    }
    if (preg_match('#^([0-9]{4}\.[0-9]{4,6})(v\d+)?$#', $s, $m)) {
        return $m[1] . ($m[2] ?? '');
    }
    return null;
}

// crossref: DOI → JSON metadata。 https://api.crossref.org/works/{doi}
//   認証 不要、 mailto を 付ける と polite pool に。
function _refs_fetch_crossref(string $doi, string $email = 'labpay@nkmr.io'): ?array {
    $url = 'https://api.crossref.org/works/' . rawurlencode($doi) . '?mailto=' . rawurlencode($email);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_USERAGENT => 'LabPay/1.0 (mailto:' . $email . ')',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !$body) return null;
    $j = json_decode((string)$body, true);
    if (!is_array($j) || !isset($j['message'])) return null;
    $m = $j['message'];
    $authors = [];
    if (isset($m['author']) && is_array($m['author'])) {
        foreach ($m['author'] as $a) {
            $name = trim(((string)($a['given'] ?? '')) . ' ' . ((string)($a['family'] ?? '')));
            if ($name !== '') $authors[] = ['name' => $name] +
                (isset($a['ORCID']) ? ['orcid' => (string)$a['ORCID']] : []);
        }
    }
    $year = null;
    if (isset($m['issued']['date-parts'][0][0])) $year = (int)$m['issued']['date-parts'][0][0];
    elseif (isset($m['published-print']['date-parts'][0][0])) $year = (int)$m['published-print']['date-parts'][0][0];
    elseif (isset($m['published-online']['date-parts'][0][0])) $year = (int)$m['published-online']['date-parts'][0][0];
    $venue = (string)($m['container-title'][0] ?? $m['event']['name'] ?? '');
    $title = (string)(($m['title'][0] ?? '') ?: '');
    return [
        'doi'      => $doi,
        'title'    => $title,
        'authors'  => $authors,
        'year'     => $year,
        'venue'    => $venue,
        'abstract' => isset($m['abstract']) ? strip_tags((string)$m['abstract']) : '',
        'url'      => (string)($m['URL'] ?? ('https://doi.org/' . $doi)),
        'type'     => (string)($m['type'] ?? ''),
        'publisher'=> (string)($m['publisher'] ?? ''),
    ];
}

// arXiv: id → Atom XML metadata。 http://export.arxiv.org/api/query?id_list=...
function _refs_fetch_arxiv(string $id): ?array {
    $url = 'http://export.arxiv.org/api/query?id_list=' . rawurlencode($id);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_USERAGENT => 'LabPay/1.0',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !$body) return null;
    // 単純 に XML から 必要 部分だけ 抜き取る。
    $x = @simplexml_load_string($body);
    if (!$x) return null;
    $x->registerXPathNamespace('a', 'http://www.w3.org/2005/Atom');
    $entries = $x->xpath('//a:entry');
    if (!$entries) return null;
    $e = $entries[0];
    $title = trim(preg_replace('/\s+/u', ' ', (string)$e->title));
    $abstract = trim(preg_replace('/\s+/u', ' ', (string)$e->summary));
    $published = (string)$e->published;
    $year = $published ? (int)substr($published, 0, 4) : null;
    $authors = [];
    foreach ($e->author as $a) {
        $n = trim((string)$a->name);
        if ($n !== '') $authors[] = ['name' => $n];
    }
    $urlAbs = null;
    foreach ($e->link as $lk) {
        $attrs = $lk->attributes();
        if ((string)$attrs['rel'] === 'alternate') $urlAbs = (string)$attrs['href'];
    }
    return [
        'arxiv_id' => $id,
        'title'    => $title,
        'authors'  => $authors,
        'year'     => $year,
        'venue'    => 'arXiv preprint',
        'abstract' => $abstract,
        'url'      => $urlAbs ?: ('https://arxiv.org/abs/' . $id),
    ];
}

// BibTeX 生成 (最小限)。 crossref 型 も arxiv 型 も カバー。
function _refs_generate_bibtex(array $r): string {
    $keyBase = 'ref';
    if (!empty($r['authors_json'])) {
        $arr = json_decode((string)$r['authors_json'], true);
        if (is_array($arr) && !empty($arr[0]['name'])) {
            $last = (string)$arr[0]['name'];
            if (strpos($last, ' ') !== false) $last = substr($last, strrpos($last, ' ') + 1);
            $keyBase = preg_replace('/[^A-Za-z]/', '', $last) ?: 'ref';
        }
    }
    $year = (int)($r['year'] ?? 0);
    $key = strtolower($keyBase) . ($year ?: '') . (int)$r['id'];
    $type = !empty($r['arxiv_id']) ? 'misc' : 'article';
    $lines = ['@' . $type . '{' . $key . ','];
    $esc = fn($s) => str_replace(['{', '}'], ['\{', '\}'], (string)$s);
    if (!empty($r['title']))    $lines[] = '  title = {' . $esc($r['title']) . '},';
    if (!empty($r['authors_json'])) {
        $arr = json_decode((string)$r['authors_json'], true);
        if (is_array($arr)) {
            $names = array_map(fn($a) => (string)($a['name'] ?? ''), $arr);
            $names = array_filter($names, fn($n) => $n !== '');
            if ($names) $lines[] = '  author = {' . $esc(implode(' and ', $names)) . '},';
        }
    }
    if (!empty($r['year']))     $lines[] = '  year = {' . (int)$r['year'] . '},';
    if (!empty($r['venue']))    $lines[] = '  journal = {' . $esc($r['venue']) . '},';
    if (!empty($r['doi']))      $lines[] = '  doi = {' . $esc($r['doi']) . '},';
    if (!empty($r['arxiv_id'])) $lines[] = '  eprint = {' . $esc($r['arxiv_id']) . '},';
    if (!empty($r['url']))      $lines[] = '  url = {' . $esc($r['url']) . '},';
    $lines[] = '}';
    return implode("\n", $lines);
}

function _refs_tags_from_body(array $body): ?string {
    if (!isset($body['tags'])) return null;
    if (!is_array($body['tags'])) return json_encode([], JSON_UNESCAPED_UNICODE);
    $tags = [];
    foreach ($body['tags'] as $t) {
        $s = trim((string)$t);
        if ($s === '') continue;
        if (mb_strlen($s) > 60) $s = mb_substr($s, 0, 60);
        if (!in_array($s, $tags, true)) $tags[] = $s;
        if (count($tags) >= 30) break;
    }
    return json_encode($tags, JSON_UNESCAPED_UNICODE);
}

function _refs_authors_from_body(array $body): ?string {
    if (!isset($body['authors'])) return null;
    if (!is_array($body['authors'])) return null;
    $out = [];
    foreach ($body['authors'] as $a) {
        if (is_string($a)) { $out[] = ['name' => trim($a)]; continue; }
        if (is_array($a) && !empty($a['name'])) $out[] = ['name' => trim((string)$a['name'])];
    }
    return json_encode(array_filter($out, fn($x) => $x['name'] !== ''), JSON_UNESCAPED_UNICODE);
}

// ─────────────────────────────────────────────────────
// import endpoints
// ─────────────────────────────────────────────────────

function refs_import_doi(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $raw = (string)($body['doi'] ?? '');
    if ($raw === '') throw new ApiException('bad_request', 'doi 必要', 400);
    $doi = _refs_normalize_doi($raw);
    if (!preg_match('#^10\.\d{4,9}/#', $doi)) {
        throw new ApiException('bad_request', 'DOI 形式が 正しく ない (例: 10.1145/xxxxx.yyyyy)', 400);
    }
    // 既存 チェック
    $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
    $st->execute([$doi]);
    $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    $meta = _refs_fetch_crossref($doi);
    if (!$meta) throw new ApiException('fetch_failed', 'crossref から metadata が 取れなかった (DOI が 未登録 or 障害)', 502);
    json_response([
        'meta'     => $meta,
        'existing' => $existing ? ['id' => (int)$existing['id'], 'title' => $existing['title']] : null,
    ]);
}

function refs_import_arxiv(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $raw = (string)($body['arxiv_id'] ?? '');
    if ($raw === '') throw new ApiException('bad_request', 'arxiv_id 必要', 400);
    $id = _refs_normalize_arxiv($raw);
    if (!$id) throw new ApiException('bad_request', 'arXiv ID 形式が 正しく ない (例: 2401.12345)', 400);
    $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
    $st->execute([$id]);
    $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    $meta = _refs_fetch_arxiv($id);
    if (!$meta) throw new ApiException('fetch_failed', 'arxiv API から metadata が 取れなかった', 502);
    json_response([
        'meta'     => $meta,
        'existing' => $existing ? ['id' => (int)$existing['id'], 'title' => $existing['title']] : null,
    ]);
}

// 汎用 URL: DOI or arXiv ID が URL 内に あれば 抽出 して 対応 endpoint に 委譲。
function refs_import_url(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $url = trim((string)($body['url'] ?? ''));
    if ($url === '') throw new ApiException('bad_request', 'url 必要', 400);
    if (!preg_match('#^https?://#i', $url)) throw new ApiException('bad_request', 'http(s) URL のみ', 400);
    // DOI パターン (10.xxxx/yyy)
    if (preg_match('#(?:doi\.org/|/doi/(?:abs/|full/)?)(10\.\d{4,9}/[^\s?#]+)#i', $url, $m)) {
        $doi = _refs_normalize_doi($m[1]);
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
        $st->execute([$doi]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        $meta = _refs_fetch_crossref($doi);
        if (!$meta) throw new ApiException('fetch_failed', 'crossref から 取れなかった', 502);
        json_response(['meta' => $meta, 'existing' => $existing ?: null]);
        return;
    }
    // arXiv
    $id = _refs_normalize_arxiv($url);
    if ($id) {
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
        $st->execute([$id]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        $meta = _refs_fetch_arxiv($id);
        if (!$meta) throw new ApiException('fetch_failed', 'arxiv から 取れなかった', 502);
        json_response(['meta' => $meta, 'existing' => $existing ?: null]);
        return;
    }
    throw new ApiException('bad_request', 'DOI or arXiv ID を URL から 抽出 できなかった。 直接 「DOI」 タブ で 入力 して ください', 400);
}

// ─────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────

function refs_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '') throw new ApiException('bad_request', 'title 必要', 400);
    if (mb_strlen($title) > 1000) $title = mb_substr($title, 0, 1000);
    $doi = trim((string)($body['doi'] ?? ''));
    $doi = $doi !== '' ? _refs_normalize_doi($doi) : '';
    if ($doi !== '' && !preg_match('#^10\.\d{4,9}/#', $doi)) $doi = '';
    $arxivId = trim((string)($body['arxiv_id'] ?? ''));
    if ($arxivId !== '') $arxivId = _refs_normalize_arxiv($arxivId) ?? '';
    // 二重登録 防止 (force=1 で バイパス 可)
    if ($doi !== '' && empty($body['force'])) {
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
        $st->execute([$doi]);
        if ($ex = $st->fetch(PDO::FETCH_ASSOC)) {
            throw new ApiException('duplicate',
                "同じ DOI が すでに 登録済 「{$ex['title']}」 (id={$ex['id']})。 上書き するなら force=1。",
                409, ['existing_id' => (int)$ex['id']]);
        }
    }
    if ($arxivId !== '' && empty($body['force'])) {
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
        $st->execute([$arxivId]);
        if ($ex = $st->fetch(PDO::FETCH_ASSOC)) {
            throw new ApiException('duplicate',
                "同じ arXiv ID が すでに 登録済 「{$ex['title']}」 (id={$ex['id']})。 上書き するなら force=1。",
                409, ['existing_id' => (int)$ex['id']]);
        }
    }
    $year = isset($body['year']) && $body['year'] !== '' ? (int)$body['year'] : null;
    $venue = trim((string)($body['venue'] ?? ''));
    if (mb_strlen($venue) > 500) $venue = mb_substr($venue, 0, 500);
    $abstract = trim((string)($body['abstract'] ?? ''));
    $url = trim((string)($body['url'] ?? ''));
    if ($url !== '' && !preg_match('#^https?://#', $url)) $url = '';
    if (mb_strlen($url) > 1000) $url = mb_substr($url, 0, 1000);
    $authorsJson = _refs_authors_from_body($body);
    $tagsJson = _refs_tags_from_body($body);

    $st = $pdo->prepare("INSERT INTO refs
        (doi, arxiv_id, title, authors_json, year, venue, abstract, url, tags_json, added_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)");
    $st->execute([
        $doi ?: null, $arxivId ?: null, $title, $authorsJson,
        $year, $venue ?: null, $abstract ?: null, $url ?: null,
        $tagsJson, (int)$u['id'],
    ]);
    $refId = (int)$pdo->lastInsertId();
    // BibTeX を あらかじめ 焼き込む (後で 参照 楽)。
    $row = $pdo->query("SELECT * FROM refs WHERE id = " . $refId)->fetch(PDO::FETCH_ASSOC);
    $bibtex = _refs_generate_bibtex($row);
    $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([$bibtex, $refId]);
    json_response(['ok' => true, 'id' => $refId]);
}

function refs_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $q      = trim((string)($_GET['q'] ?? ''));
    $tag    = trim((string)($_GET['tag'] ?? ''));
    $year   = (int)($_GET['year'] ?? 0);
    $status = trim((string)($_GET['status'] ?? ''));  // 自分の 読状態
    $sort   = (string)($_GET['sort'] ?? 'new');       // new | year | title
    $limit  = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $sql = "SELECT r.id, r.doi, r.arxiv_id, r.title, r.authors_json, r.year, r.venue,
                   r.url, r.pdf_path, r.tags_json, r.added_by_user_id, r.created_at,
                   u.display_name AS added_by_name, u.avatar_url AS added_by_avatar,
                   n.status AS my_status, n.note AS my_note
              FROM refs r
              LEFT JOIN users u ON u.id = r.added_by_user_id
              LEFT JOIN ref_notes n ON n.ref_id = r.id AND n.user_id = ?
             WHERE 1=1";
    $args = [$uid];
    if ($q !== '' && mb_strlen($q) <= 200) {
        $sql .= " AND (r.title LIKE ? OR r.abstract LIKE ? OR r.authors_json LIKE ? OR r.venue LIKE ?)";
        $like = '%' . $q . '%';
        array_push($args, $like, $like, $like, $like);
    }
    if ($tag !== '') {
        $sql .= " AND r.tags_json LIKE ?";
        $args[] = '%"' . str_replace('"', '', $tag) . '"%';
    }
    if ($year > 0) { $sql .= " AND r.year = ?"; $args[] = $year; }
    if (in_array($status, ['unread','reading','read'], true)) {
        $sql .= " AND n.status = ?";
        $args[] = $status;
    }
    if ($sort === 'year')       $sql .= " ORDER BY r.year DESC, r.id DESC";
    else if ($sort === 'title') $sql .= " ORDER BY r.title ASC";
    else                        $sql .= " ORDER BY r.id DESC";
    $sql .= " LIMIT $limit OFFSET $offset";

    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = array_map(function ($r) {
        $r['authors'] = $r['authors_json'] ? (json_decode((string)$r['authors_json'], true) ?: []) : [];
        $r['tags']    = $r['tags_json']    ? (json_decode((string)$r['tags_json'], true)    ?: []) : [];
        unset($r['authors_json'], $r['tags_json']);
        $r['id']              = (int)$r['id'];
        $r['year']            = $r['year'] !== null ? (int)$r['year'] : null;
        $r['added_by_user_id'] = (int)$r['added_by_user_id'];
        $r['my_status']       = $r['my_status'] ?: 'unread';
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));

    // 総件数 (ページング 用、 filter 反映)
    $countSql = "SELECT COUNT(*) FROM refs r
                 LEFT JOIN ref_notes n ON n.ref_id = r.id AND n.user_id = ?
                 WHERE 1=1";
    $cargs = [$uid];
    if ($q !== '' && mb_strlen($q) <= 200) {
        $countSql .= " AND (r.title LIKE ? OR r.abstract LIKE ? OR r.authors_json LIKE ? OR r.venue LIKE ?)";
        $like = '%' . $q . '%'; array_push($cargs, $like, $like, $like, $like);
    }
    if ($tag !== '') { $countSql .= " AND r.tags_json LIKE ?"; $cargs[] = '%"' . str_replace('"', '', $tag) . '"%'; }
    if ($year > 0)   { $countSql .= " AND r.year = ?"; $cargs[] = $year; }
    if (in_array($status, ['unread','reading','read'], true)) { $countSql .= " AND n.status = ?"; $cargs[] = $status; }
    $stc = $pdo->prepare($countSql);
    $stc->execute($cargs);
    $total = (int)$stc->fetchColumn();

    json_response(['items' => $items, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

function refs_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT r.*, u.display_name AS added_by_name, u.avatar_url AS added_by_avatar
                          FROM refs r LEFT JOIN users u ON u.id = r.added_by_user_id
                         WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', '文献 が 見つからない', 404);

    // 自分 の note + 状態
    $stN = $pdo->prepare("SELECT note, status FROM ref_notes WHERE ref_id = ? AND user_id = ?");
    $stN->execute([$id, $uid]);
    $mine = $stN->fetch(PDO::FETCH_ASSOC) ?: ['note' => null, 'status' => 'unread'];

    // ラボメン の note / 状態 (自分 以外、 note が ある分 だけ)
    $stO = $pdo->prepare("SELECT n.user_id, n.note, n.status, n.updated_at,
                                 u.display_name, u.avatar_url
                            FROM ref_notes n JOIN users u ON u.id = n.user_id
                           WHERE n.ref_id = ? AND n.user_id != ? AND (n.note IS NOT NULL AND n.note != '')
                        ORDER BY n.updated_at DESC");
    $stO->execute([$id, $uid]);
    $othersNotes = $stO->fetchAll(PDO::FETCH_ASSOC);

    // 各 状態 の 人数 (ラボ全員 の 進捗 感)
    $stS = $pdo->prepare("SELECT status, COUNT(*) AS n FROM ref_notes WHERE ref_id = ? GROUP BY status");
    $stS->execute([$id]);
    $statusCounts = ['unread' => 0, 'reading' => 0, 'read' => 0];
    foreach ($stS as $row) $statusCounts[$row['status']] = (int)$row['n'];

    // v926 相互 リンク 拡張: 同 PDF SHA の paper_translate / paper_full / paper_review を
    //   ラボ全員 の 分 まで 拾う (共有 済 or 自分 の)。 status=done は 「開く」、 processing は 「進行中」。
    //   これ で 「A さん が 既に 要約 済 の 論文」 が refs 詳細 に 出て 二重処理 防止。
    $links = [];
    if (!empty($r['pdf_sha256'])) {
        // paper_translate (要約)
        $stPT = $pdo->prepare("SELECT pt.id, pt.share_token, pt.status, pt.user_id, pt.is_shared, pt.model,
                                       u.display_name AS runner_name, u.avatar_url AS runner_avatar
                                  FROM paper_translates pt LEFT JOIN users u ON u.id = pt.user_id
                                 WHERE pt.pdf_sha256 = ?
                                   AND (pt.user_id = ? OR pt.is_shared = 1)
                                   AND pt.status IN ('done','processing','pending')
                              ORDER BY (pt.user_id = ?) DESC, pt.id DESC LIMIT 5");
        $stPT->execute([$r['pdf_sha256'], $uid, $uid]);
        foreach ($stPT->fetchAll(PDO::FETCH_ASSOC) as $pt) {
            $links[] = [
                'kind'         => 'paper_translate',
                'label'        => '要約',
                'url'          => '#/paper-summary/r/' . $pt['share_token'],
                'status'       => $pt['status'],
                'model'        => $pt['model'],
                'is_mine'      => ((int)$pt['user_id'] === $uid),
                'runner_name'  => $pt['runner_name'],
                'runner_avatar'=> $pt['runner_avatar'],
            ];
        }
        // paper_full_translate (全訳)
        $stPF = $pdo->prepare("SELECT pft.id, pft.share_token, pft.status, pft.user_id, pft.is_shared,
                                       pft.model, pft.direction,
                                       u.display_name AS runner_name, u.avatar_url AS runner_avatar
                                  FROM paper_full_translations pft LEFT JOIN users u ON u.id = pft.user_id
                                 WHERE pft.pdf_sha256 = ?
                                   AND (pft.user_id = ? OR pft.is_shared = 1)
                                   AND pft.status IN ('done','processing','pending')
                              ORDER BY (pft.user_id = ?) DESC, pft.id DESC LIMIT 5");
        $stPF->execute([$r['pdf_sha256'], $uid, $uid]);
        foreach ($stPF->fetchAll(PDO::FETCH_ASSOC) as $pf) {
            $links[] = [
                'kind'         => 'paper_full_translate',
                'label'        => '全訳 (' . ($pf['direction'] === 'ja2en' ? '日→英' : '英→日') . ')',
                'url'          => '#/paper-translate-full/r/' . $pf['share_token'],
                'status'       => $pf['status'],
                'model'        => $pf['model'],
                'is_mine'      => ((int)$pf['user_id'] === $uid),
                'runner_name'  => $pf['runner_name'],
                'runner_avatar'=> $pf['runner_avatar'],
            ];
        }
        // paper_review (査読): pdf_path が refs.pdf_path と 一致 で 追う。 paper_reviews は
        //   pdf_sha256 列 を 持って ない ので パス 一致 で 拾う (どちら も /uploads/refs/... 参照)。
        if (!empty($r['pdf_path'])) {
            $stPR = $pdo->prepare("SELECT pr.id, pr.share_token, pr.status, pr.user_id,
                                           pr.target_venue,
                                           u.display_name AS runner_name, u.avatar_url AS runner_avatar
                                      FROM paper_reviews pr LEFT JOIN users u ON u.id = pr.user_id
                                     WHERE pr.pdf_path = ? AND pr.user_id = ?
                                       AND pr.status IN ('done','processing','pending')
                                  ORDER BY pr.id DESC LIMIT 3");
            $stPR->execute([$r['pdf_path'], $uid]);
            foreach ($stPR->fetchAll(PDO::FETCH_ASSOC) as $pr) {
                $links[] = [
                    'kind'         => 'paper_review',
                    'label'        => '査読 (' . $pr['target_venue'] . ')',
                    'url'          => '#/paper-review/r/' . $pr['share_token'],
                    'status'       => $pr['status'],
                    'is_mine'      => true,
                    'runner_name'  => $pr['runner_name'],
                    'runner_avatar'=> $pr['runner_avatar'],
                ];
            }
        }
    }

    json_response([
        'id'               => (int)$r['id'],
        'doi'              => $r['doi'],
        'arxiv_id'         => $r['arxiv_id'],
        'title'            => $r['title'],
        'authors'          => $r['authors_json'] ? (json_decode((string)$r['authors_json'], true) ?: []) : [],
        'year'             => $r['year'] !== null ? (int)$r['year'] : null,
        'venue'            => $r['venue'],
        'abstract'         => $r['abstract'],
        'url'              => $r['url'],
        'pdf_path'         => $r['pdf_path'],
        'pdf_sha256'       => $r['pdf_sha256'],
        'bibtex'           => $r['bibtex'],
        'tags'             => $r['tags_json'] ? (json_decode((string)$r['tags_json'], true) ?: []) : [],
        'added_by_user_id' => (int)$r['added_by_user_id'],
        'added_by_name'    => $r['added_by_name'],
        'added_by_avatar'  => $r['added_by_avatar'],
        'created_at'       => $r['created_at'],
        'my'               => ['note' => $mine['note'], 'status' => $mine['status'] ?: 'unread'],
        'others_notes'     => $othersNotes,
        'status_counts'    => $statusCounts,
        'links'            => $links,
    ]);
}

function refs_edit(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT added_by_user_id FROM refs WHERE id = ?");
    $st->execute([$id]);
    $addedBy = (int)$st->fetchColumn();
    if (!$addedBy) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($addedBy !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ 編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空 不可', 400);
        $sets[] = 'title = ?'; $args[] = mb_substr($t, 0, 1000);
    }
    if (array_key_exists('year', $body)) {
        $sets[] = 'year = ?';
        $args[] = ($body['year'] === '' || $body['year'] === null) ? null : (int)$body['year'];
    }
    if (array_key_exists('venue', $body)) {
        $sets[] = 'venue = ?';
        $args[] = mb_substr(trim((string)$body['venue']), 0, 500) ?: null;
    }
    if (array_key_exists('abstract', $body)) {
        $sets[] = 'abstract = ?';
        $args[] = trim((string)$body['abstract']) ?: null;
    }
    if (array_key_exists('url', $body)) {
        $s = trim((string)$body['url']);
        if ($s !== '' && !preg_match('#^https?://#', $s)) $s = '';
        $sets[] = 'url = ?'; $args[] = mb_substr($s, 0, 1000) ?: null;
    }
    if (array_key_exists('tags', $body)) {
        $sets[] = 'tags_json = ?'; $args[] = _refs_tags_from_body($body);
    }
    if (array_key_exists('authors', $body)) {
        $sets[] = 'authors_json = ?'; $args[] = _refs_authors_from_body($body);
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE refs SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    // bibtex を 再生成
    $r = $pdo->query("SELECT * FROM refs WHERE id = " . (int)$id)->fetch(PDO::FETCH_ASSOC);
    $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex($r), $id]);
    json_response(['ok' => true]);
}

function refs_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT added_by_user_id, pdf_path FROM refs WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['added_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ 削除可', 403);
    }
    // PDF 実体 も 削除 (他 で 参照 して なければ)
    if (!empty($r['pdf_path'])) {
        $abs = '/var/www/labpay/public' . $r['pdf_path'];
        if (is_file($abs)) @unlink($abs);
    }
    $pdo->prepare("DELETE FROM refs WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// note (自分 の note + 読状態)
// ─────────────────────────────────────────────────────

function refs_note_set(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 存在確認
    $ex = $pdo->prepare("SELECT 1 FROM refs WHERE id = ?");
    $ex->execute([$id]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', '文献 なし', 404);
    $body = read_json_body();
    $note = null;
    if (array_key_exists('note', $body)) {
        $note = trim((string)$body['note']);
        if ($note === '') $note = null;
    }
    $status = trim((string)($body['status'] ?? ''));
    if ($status !== '' && !in_array($status, ['unread','reading','read'], true)) {
        throw new ApiException('bad_request', 'status は unread/reading/read', 400);
    }
    // upsert
    $st = $pdo->prepare("INSERT INTO ref_notes (ref_id, user_id, note, status)
                         VALUES (?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                           note = COALESCE(VALUES(note), note),
                           status = IF(VALUES(status) IS NULL OR VALUES(status) = '', status, VALUES(status))");
    $st->execute([$id, $uid, $note, $status ?: 'unread']);
    // 更新後 の row を 返す
    $stR = $pdo->prepare("SELECT note, status FROM ref_notes WHERE ref_id = ? AND user_id = ?");
    $stR->execute([$id, $uid]);
    $row = $stR->fetch(PDO::FETCH_ASSOC) ?: ['note' => null, 'status' => 'unread'];
    json_response(['ok' => true] + $row);
}

// ─────────────────────────────────────────────────────
// PDF 添付
// ─────────────────────────────────────────────────────

function refs_attach_pdf(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT added_by_user_id, pdf_path FROM refs WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    // PDF 添付 は ラボメン 誰でも 可 (共有 資産 として)。 起案者 縛り は 付けない。
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'multipart/form-data で 送って', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が 必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmp = $f['tmp_name'];
    $head = @file_get_contents($tmp, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF で ない', 400);
    $sha = hash_file('sha256', $tmp);
    $publicDir = '/var/www/labpay/public';
    $rel = '/uploads/refs/' . substr($sha, 0, 2) . '/' . $sha . '.pdf';
    $abs = $publicDir . $rel;
    @mkdir(dirname($abs), 0775, true);
    if (!copy($tmp, $abs)) throw new ApiException('server_error', 'PDF 保存失敗', 500);
    @chmod($abs, 0644);
    // 旧 PDF (別ファイル) は 削除
    if (!empty($r['pdf_path']) && $r['pdf_path'] !== $rel) {
        $oldAbs = $publicDir . $r['pdf_path'];
        if (is_file($oldAbs)) @unlink($oldAbs);
    }
    $pdo->prepare("UPDATE refs SET pdf_path = ?, pdf_sha256 = ? WHERE id = ?")
        ->execute([$rel, $sha, $id]);
    json_response(['ok' => true, 'pdf_path' => $rel, 'pdf_sha256' => $sha]);
}

// ─────────────────────────────────────────────────────
// BibTeX export
// ─────────────────────────────────────────────────────

function refs_bibtex_single(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT bibtex FROM refs WHERE id = ?");
    $st->execute([$id]);
    $bt = (string)$st->fetchColumn();
    if ($bt === '') throw new ApiException('not_found', 'BibTeX なし', 404);
    header('Content-Type: text/plain; charset=utf-8');
    echo $bt;
}

function refs_export_bibtex(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $tag = trim((string)($_GET['tag'] ?? ''));
    $sql = "SELECT bibtex FROM refs WHERE bibtex IS NOT NULL AND bibtex != ''";
    $args = [];
    if ($tag !== '') { $sql .= " AND tags_json LIKE ?"; $args[] = '%"' . str_replace('"', '', $tag) . '"%'; }
    $sql .= " ORDER BY id DESC";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $parts = [];
    foreach ($st as $r) $parts[] = (string)$r['bibtex'];
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="labpay_refs' . ($tag ? '_' . preg_replace('/[^A-Za-z0-9_-]/', '', $tag) : '') . '.bib"');
    echo implode("\n\n", $parts);
}

// ─────────────────────────────────────────────────────
// tags 一覧 (chip UI 用)
// ─────────────────────────────────────────────────────

function refs_tags(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->query("SELECT tags_json FROM refs WHERE tags_json IS NOT NULL AND tags_json != '[]'");
    $counts = [];
    foreach ($st as $r) {
        $arr = json_decode((string)$r['tags_json'], true);
        if (!is_array($arr)) continue;
        foreach ($arr as $t) {
            $t = (string)$t;
            if ($t === '') continue;
            $counts[$t] = ($counts[$t] ?? 0) + 1;
        }
    }
    arsort($counts);
    $out = [];
    foreach ($counts as $t => $c) $out[] = ['tag' => $t, 'count' => $c];
    json_response(['tags' => $out]);
}

// ─────────────────────────────────────────────────────
// v927 track A: BibTeX / RIS ファイル 一括 import
// ─────────────────────────────────────────────────────

// ざっくり BibTeX パーサ (ネスト braces 対応、 主要 field を 拾う)。
//   Zotero や Mendeley の 標準 export で 動く 想定。 個別 の 難解 pattern は 諦める。
function _refs_parse_bibtex(string $content): array {
    $entries = [];
    // @type{key, field = {value}, field = "value", ...} を 抽出
    if (!preg_match_all('/@(\w+)\s*\{\s*([^,\s]+)\s*,(.*?)\n\s*\}\s*(?=@|\z)/is', $content, $m, PREG_SET_ORDER)) {
        // 最後 の エントリ は `\n}` の 後 に 何も 無い ケース も 拾う
        preg_match_all('/@(\w+)\s*\{\s*([^,\s]+)\s*,(.+)/is', $content, $m, PREG_SET_ORDER);
    }
    foreach ($m as $ent) {
        $type = strtolower($ent[1]);
        if ($type === 'string' || $type === 'preamble' || $type === 'comment') continue;
        $key  = $ent[2];
        $bodyRaw = $ent[3];
        $fields = [];
        // field = { ... } または field = "..." または field = value を 拾う。
        //   ネスト braces に 弱いが 標準 export で は 大体 動く。
        $len = strlen($bodyRaw); $i = 0;
        while ($i < $len) {
            // field 名
            if (!preg_match('/\G([\s,]*)(\w+)\s*=\s*/A', $bodyRaw, $mm, 0, $i)) break;
            $i += strlen($mm[0]);
            $name = strtolower($mm[2]);
            // 値: {..} / ".." / 素値
            if ($i >= $len) break;
            $c = $bodyRaw[$i];
            $val = '';
            if ($c === '{') {
                $depth = 0; $start = $i;
                while ($i < $len) {
                    $ch = $bodyRaw[$i];
                    if ($ch === '{') $depth++;
                    elseif ($ch === '}') { $depth--; if ($depth === 0) { $i++; break; } }
                    $i++;
                }
                $val = substr($bodyRaw, $start + 1, $i - $start - 2);
            } elseif ($c === '"') {
                $i++; $start = $i;
                while ($i < $len && $bodyRaw[$i] !== '"') $i++;
                $val = substr($bodyRaw, $start, $i - $start);
                if ($i < $len) $i++;
            } else {
                preg_match('/\G([^,\s]+)/A', $bodyRaw, $mm2, 0, $i);
                $val = $mm2[1] ?? '';
                $i += strlen($val);
            }
            // 掃除
            $val = preg_replace('/\s+/', ' ', $val);
            $val = str_replace(['{', '}', '\\&', '\\%', '\\_'], ['', '', '&', '%', '_'], $val);
            $fields[$name] = trim($val);
        }
        $entries[] = ['type' => $type, 'key' => $key, 'fields' => $fields];
    }
    return $entries;
}

// RIS: 行 ベース。 TY = 開始、 ER = 終端。 AU / TI / PY / JO / DO / N2 (abstract) など。
function _refs_parse_ris(string $content): array {
    $entries = [];
    $cur = null;
    foreach (preg_split("/\r\n|\r|\n/", $content) as $line) {
        if (preg_match('/^([A-Z0-9]{2})\s+-\s+(.*)$/', $line, $m)) {
            $tag = $m[1]; $val = trim($m[2]);
            if ($tag === 'TY') { $cur = ['type' => strtolower($val), 'authors' => [], 'fields' => []]; continue; }
            if ($tag === 'ER') { if ($cur) $entries[] = $cur; $cur = null; continue; }
            if (!$cur) continue;
            if ($tag === 'AU' || $tag === 'A1') { $cur['authors'][] = $val; continue; }
            if ($tag === 'TI' || $tag === 'T1') $cur['fields']['title'] = $val;
            elseif ($tag === 'PY' || $tag === 'Y1') $cur['fields']['year'] = (int)substr($val, 0, 4);
            elseif ($tag === 'JO' || $tag === 'JF' || $tag === 'JA' || $tag === 'T2') $cur['fields']['venue'] = $val;
            elseif ($tag === 'DO')  $cur['fields']['doi'] = $val;
            elseif ($tag === 'UR')  $cur['fields']['url'] = $val;
            elseif ($tag === 'N2' || $tag === 'AB') $cur['fields']['abstract'] = $val;
            elseif ($tag === 'KW') { $cur['fields']['keywords'][] = $val; }
        }
    }
    if ($cur) $entries[] = $cur;
    return $entries;
}

// BibTeX の 生 authors 文字列 「A and B and C」 を [{name}, ...] に。
function _refs_split_bibtex_authors(string $raw): array {
    $parts = preg_split('/\s+and\s+/i', $raw);
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p === '') continue;
        // 「Family, Given」 → 「Given Family」 に 正規化
        if (strpos($p, ',') !== false) {
            [$family, $given] = array_map('trim', explode(',', $p, 2));
            $p = ($given !== '' ? $given . ' ' : '') . $family;
        }
        $out[] = ['name' => $p];
    }
    return $out;
}

function refs_import_bibtex(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // multipart or text body
    $content = '';
    if (isset($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $content = (string)file_get_contents($_FILES['file']['tmp_name']);
    } else {
        $body = read_json_body();
        $content = (string)($body['bibtex'] ?? '');
    }
    if ($content === '') throw new ApiException('bad_request', 'file か bibtex 本文 が 必要', 400);
    if (strlen($content) > 5 * 1024 * 1024) throw new ApiException('bad_request', '5MB まで', 400);

    $parsed = _refs_parse_bibtex($content);
    if (!$parsed) throw new ApiException('bad_request', 'BibTeX エントリ が 見つからなかった', 400);

    $added = 0; $skipped = 0; $results = [];
    foreach ($parsed as $ent) {
        $f = $ent['fields'];
        $title = $f['title'] ?? '';
        if ($title === '') { $skipped++; $results[] = ['status' => 'skip', 'reason' => 'title なし']; continue; }
        $doi = isset($f['doi']) ? _refs_normalize_doi($f['doi']) : '';
        if ($doi !== '' && !preg_match('#^10\.\d{4,9}/#', $doi)) $doi = '';
        $arxiv = isset($f['eprint']) ? _refs_normalize_arxiv($f['eprint']) : null;
        // 既存 チェック
        if ($doi !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([$doi]);
            if ($ex = (int)$st->fetchColumn()) {
                $skipped++; $results[] = ['status' => 'dup', 'existing_id' => $ex, 'title' => $title]; continue;
            }
        }
        $authors = !empty($f['author']) ? _refs_split_bibtex_authors($f['author']) : [];
        $year = isset($f['year']) ? (int)$f['year'] : null;
        $venue = $f['journal'] ?? $f['booktitle'] ?? '';
        $url = $f['url'] ?? '';
        if ($url !== '' && !preg_match('#^https?://#', $url)) $url = '';
        $abstract = $f['abstract'] ?? '';
        $tags = [];
        if (!empty($f['keywords'])) {
            foreach (preg_split('/[;,]/', (string)$f['keywords']) as $t) {
                $t = trim($t); if ($t !== '') $tags[] = $t;
            }
        }
        $ins = $pdo->prepare("INSERT INTO refs
            (doi, arxiv_id, title, authors_json, year, venue, abstract, url, tags_json, added_by_user_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)");
        $ins->execute([
            $doi ?: null, $arxiv ?: null, $title,
            json_encode($authors, JSON_UNESCAPED_UNICODE),
            $year ?: null, $venue ?: null, $abstract ?: null,
            $url ?: null,
            $tags ? json_encode($tags, JSON_UNESCAPED_UNICODE) : null,
            $uid,
        ]);
        $refId = (int)$pdo->lastInsertId();
        $row = $pdo->query("SELECT * FROM refs WHERE id = $refId")->fetch(PDO::FETCH_ASSOC);
        $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex($row), $refId]);
        $added++; $results[] = ['status' => 'added', 'id' => $refId, 'title' => $title];
    }
    json_response(['added' => $added, 'skipped' => $skipped, 'total' => count($parsed), 'results' => $results]);
}

function refs_import_ris(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $content = '';
    if (isset($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $content = (string)file_get_contents($_FILES['file']['tmp_name']);
    } else {
        $body = read_json_body();
        $content = (string)($body['ris'] ?? '');
    }
    if ($content === '') throw new ApiException('bad_request', 'file か ris 本文 が 必要', 400);
    if (strlen($content) > 5 * 1024 * 1024) throw new ApiException('bad_request', '5MB まで', 400);

    $parsed = _refs_parse_ris($content);
    if (!$parsed) throw new ApiException('bad_request', 'RIS エントリ が 見つからなかった', 400);

    $added = 0; $skipped = 0; $results = [];
    foreach ($parsed as $ent) {
        $f = $ent['fields'];
        $title = $f['title'] ?? '';
        if ($title === '') { $skipped++; continue; }
        $doi = isset($f['doi']) ? _refs_normalize_doi($f['doi']) : '';
        if ($doi !== '' && !preg_match('#^10\.\d{4,9}/#', $doi)) $doi = '';
        if ($doi !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([$doi]);
            if ($ex = (int)$st->fetchColumn()) { $skipped++; $results[] = ['status' => 'dup', 'existing_id' => $ex]; continue; }
        }
        $authors = array_map(fn($n) => ['name' => trim($n)], $ent['authors']);
        $tags = $f['keywords'] ?? [];
        $ins = $pdo->prepare("INSERT INTO refs
            (doi, title, authors_json, year, venue, abstract, url, tags_json, added_by_user_id)
            VALUES (?,?,?,?,?,?,?,?,?)");
        $ins->execute([
            $doi ?: null, $title,
            json_encode($authors, JSON_UNESCAPED_UNICODE),
            !empty($f['year']) ? (int)$f['year'] : null,
            $f['venue'] ?? null, $f['abstract'] ?? null,
            (!empty($f['url']) && preg_match('#^https?://#', $f['url'])) ? $f['url'] : null,
            $tags ? json_encode($tags, JSON_UNESCAPED_UNICODE) : null,
            $uid,
        ]);
        $refId = (int)$pdo->lastInsertId();
        $row = $pdo->query("SELECT * FROM refs WHERE id = $refId")->fetch(PDO::FETCH_ASSOC);
        $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex($row), $refId]);
        $added++; $results[] = ['status' => 'added', 'id' => $refId, 'title' => $title];
    }
    json_response(['added' => $added, 'skipped' => $skipped, 'total' => count($parsed), 'results' => $results]);
}

// ─────────────────────────────────────────────────────
// v927 track A: PDF から metadata 抽出 (pdftotext + crossref + OpenAI)
// ─────────────────────────────────────────────────────

function refs_extract_pdf(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'multipart/form-data で 送って', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が 必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '30MB まで', 400);
    $tmp = $f['tmp_name'];
    $head = @file_get_contents($tmp, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF で ない', 400);

    // pdftotext で 先頭 2 ページ を テキスト化
    $txtOut = sys_get_temp_dir() . '/refs_pdftxt_' . uniqid() . '.txt';
    $cmd = sprintf('pdftotext -f 1 -l 2 -layout %s %s 2>&1',
        escapeshellarg($tmp), escapeshellarg($txtOut));
    exec($cmd, $out, $rc);
    $text = '';
    if ($rc === 0 && is_file($txtOut)) {
        $text = (string)file_get_contents($txtOut);
        @unlink($txtOut);
    }
    if ($text === '') throw new ApiException('server_error', 'PDF から テキスト を 抽出 できなかった', 500);

    // 1) 本文 から DOI を 検出 → crossref
    if (preg_match('#\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b#', $text, $m)) {
        $doi = _refs_normalize_doi(rtrim($m[1], '.,)'));
        $meta = _refs_fetch_crossref($doi);
        if ($meta) {
            // 既存 チェック
            $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([$doi]);
            $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            json_response([
                'method'   => 'pdf_doi_crossref',
                'meta'     => $meta,
                'existing' => $existing ?: null,
            ]);
            return;
        }
    }
    // 2) arxiv ID を 検出
    if (preg_match('#\b(?:arXiv[:\s]*)?([0-9]{4}\.[0-9]{4,6})(v\d+)?\b#i', $text, $m)) {
        $id = $m[1] . ($m[2] ?? '');
        $meta = _refs_fetch_arxiv($id);
        if ($meta) {
            $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
            $st->execute([$id]);
            $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            json_response([
                'method'   => 'pdf_arxiv_api',
                'meta'     => $meta,
                'existing' => $existing ?: null,
            ]);
            return;
        }
    }
    // 3) OpenAI に 「先頭 テキスト から metadata を JSON で 抽出」 させる
    $head = mb_substr($text, 0, 4000);
    $apiKey = (string)$cfg['openai']['api_key'];
    $payload = [
        'model' => 'gpt-5-mini',
        'messages' => [
            ['role' => 'system', 'content' => '研究論文 の 先頭 部分 の テキスト を 受け取り、 metadata を JSON で 返します。 keys: title (string), authors (array of string), year (int or null), venue (string or null), abstract (string or null), doi (string or null)。 見つからない 項目 は null。 出力 は JSON のみ、 コメント不要。'],
            ['role' => 'user', 'content' => "以下 の テキスト から metadata を 抽出:\n\n" . $head],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 4000,
    ];
    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 60,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$resp || $code >= 400) throw new ApiException('upstream_error', 'OpenAI HTTP ' . $code, 502);
    $j = json_decode((string)$resp, true);
    $content = $j['choices'][0]['message']['content'] ?? '';
    $parsed = json_decode((string)$content, true);
    if (!is_array($parsed)) throw new ApiException('upstream_error', 'OpenAI が JSON を 返さなかった', 502);
    // authors を array of {name} に 正規化
    $authors = [];
    foreach ((array)($parsed['authors'] ?? []) as $a) {
        if (is_string($a) && trim($a) !== '') $authors[] = ['name' => trim($a)];
    }
    $meta = [
        'title'    => (string)($parsed['title'] ?? ''),
        'authors'  => $authors,
        'year'     => isset($parsed['year']) && $parsed['year'] !== null ? (int)$parsed['year'] : null,
        'venue'    => (string)($parsed['venue'] ?? ''),
        'abstract' => (string)($parsed['abstract'] ?? ''),
        'doi'      => (string)($parsed['doi'] ?? ''),
    ];
    // 既存 チェック (DOI 有り なら)
    $existing = null;
    if ($meta['doi'] !== '') {
        $doi2 = _refs_normalize_doi($meta['doi']);
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
        $st->execute([$doi2]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    json_response([
        'method'   => 'pdf_openai_extract',
        'meta'     => $meta,
        'existing' => $existing,
    ]);
}

// ─────────────────────────────────────────────────────
// v927 track A: ref_attachments (複数 添付)
// ─────────────────────────────────────────────────────

function refs_attachments_list(PDO $pdo, array $cfg, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT a.id, a.kind, a.path, a.sha256, a.filename, a.mime, a.size_bytes,
                                a.caption, a.uploaded_by_user_id, a.created_at,
                                u.display_name AS uploaded_by_name, u.avatar_url AS uploaded_by_avatar
                           FROM ref_attachments a LEFT JOIN users u ON u.id = a.uploaded_by_user_id
                          WHERE a.ref_id = ? ORDER BY a.id DESC");
    $st->execute([$refId]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function refs_attachments_upload(PDO $pdo, array $cfg, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $ex = $pdo->prepare("SELECT 1 FROM refs WHERE id = ?");
    $ex->execute([$refId]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', '文献 なし', 404);
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file が 必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '30MB まで', 400);
    $kind = (string)($_POST['kind'] ?? 'other');
    if (!in_array($kind, ['pdf','supplement','slides','video','image','other'], true)) $kind = 'other';
    $caption = trim((string)($_POST['caption'] ?? ''));
    if (mb_strlen($caption) > 500) $caption = mb_substr($caption, 0, 500);
    $tmp = $f['tmp_name'];
    $sha = hash_file('sha256', $tmp);
    $origName = (string)$f['name'];
    $ext = pathinfo($origName, PATHINFO_EXTENSION);
    if (mb_strlen($ext) > 8) $ext = '';
    $ext = preg_replace('/[^A-Za-z0-9]/', '', $ext);
    $rel = '/uploads/refs/attachments/' . substr($sha, 0, 2) . '/' . $sha . ($ext ? '.' . strtolower($ext) : '');
    $publicDir = '/var/www/labpay/public';
    $abs = $publicDir . $rel;
    @mkdir(dirname($abs), 0775, true);
    if (!copy($tmp, $abs)) throw new ApiException('server_error', '保存失敗', 500);
    @chmod($abs, 0644);
    $mime = (string)($f['type'] ?? '');
    $ins = $pdo->prepare("INSERT INTO ref_attachments
        (ref_id, kind, path, sha256, filename, mime, size_bytes, caption, uploaded_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$refId, $kind, $rel, $sha, mb_substr($origName, 0, 255),
                   $mime ?: null, (int)$f['size'], $caption ?: null, (int)$u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'path' => $rel]);
}

function refs_attachments_delete(PDO $pdo, array $cfg, int $refId, int $attId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT path, uploaded_by_user_id FROM ref_attachments WHERE id = ? AND ref_id = ?");
    $st->execute([$attId, $refId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['uploaded_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', 'アップロード者 or admin のみ 削除可', 403);
    }
    $abs = '/var/www/labpay/public' . $r['path'];
    if (is_file($abs)) @unlink($abs);
    $pdo->prepare("DELETE FROM ref_attachments WHERE id = ?")->execute([$attId]);
    json_response(['ok' => true]);
}
