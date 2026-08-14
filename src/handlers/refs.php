<?php
// /api/refs — Zotero-like 文献管理 (v925 MVP)。ラボ全員で共有、個人 note は各自。
// DOI / arXiv ID / URL から metadata 自動取得 (crossref / arxiv API)。
// PDF 添付は /uploads/refs/<sha>.pdf、同 sha なら paper_translate/paper_review と相互リンク。

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
    // v929: Zotero API 直接 + CSL-JSON + EndNote XML の追加 import
    if ($sub === 'import_zotero'  && $method === 'POST') { refs_import_zotero($pdo, $cfg);  return; }
    if ($sub === 'import_csljson' && $method === 'POST') { refs_import_csljson($pdo, $cfg); return; }
    if ($sub === 'import_endnote' && $method === 'POST') { refs_import_endnote($pdo, $cfg); return; }
    // v930: 参考文献リスト生成 (複数 ref に対して一括 CSL 引用)
    if ($sub === 'bibliography'   && $method === 'POST') { refs_bibliography($pdo, $cfg);   return; }
    // v931: Semantic Scholar 連携
    if ($sub === 'ss_search'      && $method === 'POST') { refs_ss_search($pdo, $cfg);      return; }
    if ($sub === 'ss_recommend'   && $method === 'POST') { refs_ss_recommend($pdo, $cfg);   return; }
    // v928 track B
    if ($sub === 'collections') {
        $subid = $seg[2] ?? '';
        if ($subid === '' && $method === 'GET')  { refs_collections_list($pdo, $cfg);   return; }
        if ($subid === '' && $method === 'POST') { refs_collections_create($pdo, $cfg); return; }
        if (ctype_digit((string)$subid)) {
            $cid = (int)$subid;
            $subnext = $seg[3] ?? '';
            if ($subnext === '' && $method === 'GET')    { refs_collection_detail($pdo, $cfg, $cid); return; }
            if ($subnext === '' && $method === 'PATCH')  { refs_collection_edit($pdo, $cfg, $cid);   return; }
            if ($subnext === '' && $method === 'DELETE') { refs_collection_delete($pdo, $cfg, $cid); return; }
            if ($subnext === 'refs' && ctype_digit((string)($seg[4] ?? '')) && $method === 'POST') {
                refs_collection_add_ref($pdo, $cfg, $cid, (int)$seg[4]); return;
            }
            if ($subnext === 'refs' && ctype_digit((string)($seg[4] ?? '')) && $method === 'DELETE') {
                refs_collection_remove_ref($pdo, $cfg, $cid, (int)$seg[4]); return;
            }
        }
    }
    if ($sub === 'saved_searches') {
        $subid = $seg[2] ?? '';
        if ($subid === '' && $method === 'GET')    { refs_saved_searches_list($pdo, $cfg);   return; }
        if ($subid === '' && $method === 'POST')   { refs_saved_searches_create($pdo, $cfg); return; }
        if (ctype_digit((string)$subid) && $method === 'DELETE') {
            refs_saved_search_delete($pdo, $cfg, (int)$subid); return;
        }
    }
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
        // v927 追加添付
        if ($next === 'attachments' && $method === 'GET')   { refs_attachments_list($pdo, $cfg, $id); return; }
        if ($next === 'attachments' && $method === 'POST')  { refs_attachments_upload($pdo, $cfg, $id); return; }
        if ($next === 'attachments' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            refs_attachments_delete($pdo, $cfg, $id, (int)$seg[3]); return;
        }
        // v928 track B: soft-delete restore + related items
        if ($next === 'restore'    && $method === 'POST')   { refs_restore($pdo, $cfg, $id); return; }
        if ($next === 'relations'  && $method === 'GET')    { refs_relations_list($pdo, $cfg, $id); return; }
        if ($next === 'relations'  && $method === 'POST')   { refs_relations_add($pdo, $cfg, $id); return; }
        if ($next === 'relations' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            refs_relations_remove($pdo, $cfg, $id, (int)$seg[3]); return;
        }
        // v929: citation (CSL) + highlights
        if ($next === 'citation'   && $method === 'GET')    { refs_citation($pdo, $cfg, $id); return; }
        // v931: Semantic Scholar 個別 endpoint
        if ($next === 'ss_references' && $method === 'GET')  { refs_ss_references($pdo, $cfg, $id);  return; }
        if ($next === 'ss_citations'  && $method === 'GET')  { refs_ss_citations($pdo, $cfg, $id);   return; }
        if ($next === 'ss_enrich'     && $method === 'POST') { refs_ss_enrich($pdo, $cfg, $id);      return; }
        if ($next === 'highlights' && $method === 'GET')    { refs_highlights_list($pdo, $cfg, $id); return; }
        if ($next === 'highlights' && $method === 'POST')   { refs_highlights_add($pdo, $cfg, $id); return; }
        if ($next === 'highlights' && ctype_digit((string)($seg[3] ?? '')) && $method === 'PATCH') {
            refs_highlights_edit($pdo, $cfg, $id, (int)$seg[3]); return;
        }
        if ($next === 'highlights' && ctype_digit((string)($seg[3] ?? '')) && $method === 'DELETE') {
            refs_highlights_delete($pdo, $cfg, $id, (int)$seg[3]); return;
        }
    }
    throw new ApiException('not_found', 'route not found', 404);
}

// ─────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────

// DOI 正規化: URL や doi.org prefix を剥がして「10.xxxx/yyy」だけにする。
function _refs_normalize_doi(string $raw): string {
    $s = trim($raw);
    $s = preg_replace('#^https?://(dx\.)?doi\.org/#i', '', $s);
    $s = preg_replace('#^doi:#i', '', $s);
    $s = trim($s);
    return $s;
}

// arXiv ID 正規化: URL やバージョンを保ったまま id だけ抽出。
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
//   認証不要、 mailto を付けると polite pool に。
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
    // v1099 crossref の subject (キーワード / トピック) は論文によっては埋まっている。
    //   例: "Human-Computer Interaction", "Hardware and Architecture" 等。
    //   pdf 本文の Keywords 行と併せて bulk import に使う。
    $keywords = [];
    foreach ((array)($m['subject'] ?? []) as $s) {
        $s = trim((string)$s);
        if ($s !== '') $keywords[] = $s;
    }
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
        'keywords' => $keywords,
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
    // 単純に XML から必要部分だけ抜き取る。
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

// BibTeX 生成 (最小限)。 crossref 型も arxiv 型もカバー。
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
        throw new ApiException('bad_request', 'DOI 形式が正しくない (例: 10.1145/xxxxx.yyyyy)', 400);
    }
    // 既存チェック
    $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
    $st->execute([$doi]);
    $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    $meta = _refs_fetch_crossref($doi);
    if (!$meta) throw new ApiException('fetch_failed', 'crossref から metadata が取れなかった (DOI が未登録 or 障害)', 502);
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
    if (!$id) throw new ApiException('bad_request', 'arXiv ID 形式が正しくない (例: 2401.12345)', 400);
    $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
    $st->execute([$id]);
    $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    $meta = _refs_fetch_arxiv($id);
    if (!$meta) throw new ApiException('fetch_failed', 'arxiv API から metadata が取れなかった', 502);
    json_response([
        'meta'     => $meta,
        'existing' => $existing ? ['id' => (int)$existing['id'], 'title' => $existing['title']] : null,
    ]);
}

// 汎用 URL: DOI or arXiv ID が URL 内にあれば抽出して対応 endpoint に委譲。
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
        if (!$meta) throw new ApiException('fetch_failed', 'crossref から取れなかった', 502);
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
        if (!$meta) throw new ApiException('fetch_failed', 'arxiv から取れなかった', 502);
        json_response(['meta' => $meta, 'existing' => $existing ?: null]);
        return;
    }
    throw new ApiException('bad_request', 'DOI or arXiv ID を URL から抽出できなかった。直接「DOI」タブで入力してください', 400);
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
    // 二重登録防止 (force=1 でバイパス可)
    if ($doi !== '' && empty($body['force'])) {
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
        $st->execute([$doi]);
        if ($ex = $st->fetch(PDO::FETCH_ASSOC)) {
            throw new ApiException('duplicate',
                "同じ DOI がすでに登録済「{$ex['title']}」 (id={$ex['id']})。上書きするなら force=1。",
                409, ['existing_id' => (int)$ex['id']]);
        }
    }
    if ($arxivId !== '' && empty($body['force'])) {
        $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
        $st->execute([$arxivId]);
        if ($ex = $st->fetch(PDO::FETCH_ASSOC)) {
            throw new ApiException('duplicate',
                "同じ arXiv ID がすでに登録済「{$ex['title']}」 (id={$ex['id']})。上書きするなら force=1。",
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
    // v929: item_type + extra_json (type別 field: isbn, publisher, edition, thesis_type, pages, volume, issue, editor 等)
    $itemType = _refs_normalize_item_type((string)($body['item_type'] ?? 'article'));
    $extraJson = _refs_extra_from_body($body);

    $st = $pdo->prepare("INSERT INTO refs
        (doi, arxiv_id, title, item_type, authors_json, year, venue, abstract, url, tags_json, extra_json, added_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    $st->execute([
        $doi ?: null, $arxivId ?: null, $title, $itemType, $authorsJson,
        $year, $venue ?: null, $abstract ?: null, $url ?: null,
        $tagsJson, $extraJson, (int)$u['id'],
    ]);
    $refId = (int)$pdo->lastInsertId();
    // BibTeX をあらかじめ焼き込む (後で参照楽)。
    $row = $pdo->query("SELECT * FROM refs WHERE id = " . $refId)->fetch(PDO::FETCH_ASSOC);
    $bibtex = _refs_generate_bibtex_v2($row);
    $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([$bibtex, $refId]);
    json_response(['ok' => true, 'id' => $refId]);
}

function refs_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $q      = trim((string)($_GET['q'] ?? ''));
    $tag    = trim((string)($_GET['tag'] ?? ''));
    $year   = (int)($_GET['year'] ?? 0);
    $status = trim((string)($_GET['status'] ?? ''));  // 自分の読状態
    $sort   = (string)($_GET['sort'] ?? 'new');       // new | year | title
    $limit  = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    // v928 track B: trash view + collection filter
    $trash = (int)($_GET['trash'] ?? 0) === 1;
    $collectionId = (int)($_GET['collection_id'] ?? 0);
    $uncategorized = (int)($_GET['uncategorized'] ?? 0) === 1;

    // v930 fulltext 検索
    $ftQ = trim((string)($_GET['fulltext_q'] ?? ''));

    // v1324 中村さん要望「文献一覧 で 要約/全訳 の 有無 を 表示」
    //   pdf_sha256 が 一致する paper_translates/paper_full_translations の
    //   自分 or 共有 分 の done / 進行中 の カウント を 添える。
    $sql = "SELECT r.id, r.doi, r.arxiv_id, r.title, r.authors_json, r.year, r.venue,
                   r.url, r.pdf_path, r.tags_json, r.added_by_user_id, r.created_at, r.deleted_at,
                   r.citation_count, r.pdf_sha256,
                   u.display_name AS added_by_name, u.avatar_url AS added_by_avatar,
                   n.status AS my_status, n.note AS my_note,
                   (SELECT COUNT(*) FROM paper_translates pt
                     WHERE pt.pdf_sha256 = r.pdf_sha256
                       AND (pt.user_id = ? OR pt.is_shared = 1)
                       AND pt.status = 'done') AS summary_done_count,
                   (SELECT COUNT(*) FROM paper_translates pt
                     WHERE pt.pdf_sha256 = r.pdf_sha256
                       AND (pt.user_id = ? OR pt.is_shared = 1)
                       AND pt.status IN ('pending','processing')) AS summary_running_count,
                   (SELECT COUNT(*) FROM paper_full_translations pft
                     WHERE pft.pdf_sha256 = r.pdf_sha256
                       AND (pft.user_id = ? OR pft.is_shared = 1)
                       AND pft.status = 'done') AS fulltrans_done_count,
                   (SELECT COUNT(*) FROM paper_full_translations pft
                     WHERE pft.pdf_sha256 = r.pdf_sha256
                       AND (pft.user_id = ? OR pft.is_shared = 1)
                       AND pft.status IN ('pending','processing')) AS fulltrans_running_count
              FROM refs r
              LEFT JOIN users u ON u.id = r.added_by_user_id
              LEFT JOIN ref_notes n ON n.ref_id = r.id AND n.user_id = ?
             WHERE 1=1";
    // v1324 pt subquery 4 個 + note join 1 個 = args 先頭 に uid を 5 回
    $args = [$uid, $uid, $uid, $uid, $uid];
    if ($trash)  $sql .= " AND r.deleted_at IS NOT NULL";
    else         $sql .= " AND r.deleted_at IS NULL";
    if ($ftQ !== '' && mb_strlen($ftQ) <= 200) {
        $sql .= " AND r.`fulltext` LIKE ?";
        $args[] = '%' . $ftQ . '%';
    }
    if ($collectionId > 0) {
        $sql .= " AND EXISTS (SELECT 1 FROM ref_collection_items ci WHERE ci.ref_id = r.id AND ci.collection_id = ?)";
        $args[] = $collectionId;
    } elseif ($uncategorized) {
        $sql .= " AND NOT EXISTS (SELECT 1 FROM ref_collection_items ci WHERE ci.ref_id = r.id)";
    }
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
        $r['citation_count']  = isset($r['citation_count']) && $r['citation_count'] !== null ? (int)$r['citation_count'] : null;
        // v1324 要約/全訳 の 集計 を int 化
        $r['summary_done_count']     = (int)($r['summary_done_count'] ?? 0);
        $r['summary_running_count']  = (int)($r['summary_running_count'] ?? 0);
        $r['fulltrans_done_count']   = (int)($r['fulltrans_done_count'] ?? 0);
        $r['fulltrans_running_count']= (int)($r['fulltrans_running_count'] ?? 0);
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));

    // 総件数 (ページング用、 filter 反映)
    $countSql = "SELECT COUNT(*) FROM refs r
                 LEFT JOIN ref_notes n ON n.ref_id = r.id AND n.user_id = ?
                 WHERE 1=1";
    $cargs = [$uid];
    if ($trash)  $countSql .= " AND r.deleted_at IS NOT NULL";
    else         $countSql .= " AND r.deleted_at IS NULL";
    if ($ftQ !== '' && mb_strlen($ftQ) <= 200) {
        $countSql .= " AND r.`fulltext` LIKE ?";
        $cargs[] = '%' . $ftQ . '%';
    }
    if ($collectionId > 0) {
        $countSql .= " AND EXISTS (SELECT 1 FROM ref_collection_items ci WHERE ci.ref_id = r.id AND ci.collection_id = ?)";
        $cargs[] = $collectionId;
    } elseif ($uncategorized) {
        $countSql .= " AND NOT EXISTS (SELECT 1 FROM ref_collection_items ci WHERE ci.ref_id = r.id)";
    }
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
    if (!$r) throw new ApiException('not_found', '文献が見つからない', 404);

    // 自分の note + 状態
    $stN = $pdo->prepare("SELECT note, status FROM ref_notes WHERE ref_id = ? AND user_id = ?");
    $stN->execute([$id, $uid]);
    $mine = $stN->fetch(PDO::FETCH_ASSOC) ?: ['note' => null, 'status' => 'unread'];

    // ラボメンの note / 状態 (自分以外、 note がある分だけ)
    $stO = $pdo->prepare("SELECT n.user_id, n.note, n.status, n.updated_at,
                                 u.display_name, u.avatar_url
                            FROM ref_notes n JOIN users u ON u.id = n.user_id
                           WHERE n.ref_id = ? AND n.user_id != ? AND (n.note IS NOT NULL AND n.note != '')
                        ORDER BY n.updated_at DESC");
    $stO->execute([$id, $uid]);
    $othersNotes = $stO->fetchAll(PDO::FETCH_ASSOC);

    // 各状態の人数 (ラボ全員の進捗感)
    $stS = $pdo->prepare("SELECT status, COUNT(*) AS n FROM ref_notes WHERE ref_id = ? GROUP BY status");
    $stS->execute([$id]);
    $statusCounts = ['unread' => 0, 'reading' => 0, 'read' => 0];
    foreach ($stS as $row) $statusCounts[$row['status']] = (int)$row['n'];

    // v926 相互リンク拡張: 同 PDF SHA の paper_translate / paper_full / paper_review を
    //   ラボ全員の分まで拾う (共有済 or 自分の)。 status=done は「開く」、 processing は「進行中」。
    //   これで「A さんが既に要約済の論文」が refs 詳細に出て二重処理防止。
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
        // paper_review (査読): pdf_path が refs.pdf_path と一致で追う。 paper_reviews は
        //   pdf_sha256 列を持ってないのでパス一致で拾う (どちらも /uploads/refs/... 参照)。
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

    // v928 track B: この refs が所属する collections
    $stC = $pdo->prepare("SELECT c.id, c.name, c.icon FROM ref_collections c
                            JOIN ref_collection_items ci ON ci.collection_id = c.id
                           WHERE ci.ref_id = ? ORDER BY c.name");
    $stC->execute([$id]);
    $collections = $stC->fetchAll(PDO::FETCH_ASSOC);

    json_response([
        'id'               => (int)$r['id'],
        'doi'              => $r['doi'],
        'arxiv_id'         => $r['arxiv_id'],
        'title'            => $r['title'],
        'item_type'        => $r['item_type'] ?? 'article',
        'semantic_scholar_id' => $r['semantic_scholar_id'] ?? null,
        'citation_count'   => $r['citation_count'] !== null ? (int)$r['citation_count'] : null,
        'reference_count'  => $r['reference_count'] !== null ? (int)$r['reference_count'] : null,
        'authors'          => $r['authors_json'] ? (json_decode((string)$r['authors_json'], true) ?: []) : [],
        'year'             => $r['year'] !== null ? (int)$r['year'] : null,
        'venue'            => $r['venue'],
        'abstract'         => $r['abstract'],
        'url'              => $r['url'],
        'pdf_path'         => $r['pdf_path'],
        'pdf_sha256'       => $r['pdf_sha256'],
        'bibtex'           => $r['bibtex'],
        'tags'             => $r['tags_json'] ? (json_decode((string)$r['tags_json'], true) ?: []) : [],
        'extra'            => (!empty($r['extra_json'])) ? (json_decode((string)$r['extra_json'], true) ?: []) : [],
        'added_by_user_id' => (int)$r['added_by_user_id'],
        'added_by_name'    => $r['added_by_name'],
        'added_by_avatar'  => $r['added_by_avatar'],
        'created_at'       => $r['created_at'],
        'deleted_at'       => $r['deleted_at'] ?? null,
        'my'               => ['note' => $mine['note'], 'status' => $mine['status'] ?: 'unread'],
        'others_notes'     => $othersNotes,
        'status_counts'    => $statusCounts,
        'links'            => $links,
        'collections'      => $collections,
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
        throw new ApiException('forbidden', '登録者 or admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '') throw new ApiException('bad_request', 'title 空不可', 400);
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
    // v929: item_type + extra_json
    if (array_key_exists('item_type', $body)) {
        $sets[] = 'item_type = ?'; $args[] = _refs_normalize_item_type((string)$body['item_type']);
    }
    if (array_key_exists('extra', $body) || array_key_exists('extra_json', $body)) {
        $sets[] = 'extra_json = ?'; $args[] = _refs_extra_from_body($body);
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE refs SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    // bibtex を再生成
    $r = $pdo->query("SELECT * FROM refs WHERE id = " . (int)$id)->fetch(PDO::FETCH_ASSOC);
    $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex_v2($r), $id]);
    json_response(['ok' => true]);
}

function refs_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT added_by_user_id, deleted_at FROM refs WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$r['added_by_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ削除可', 403);
    }
    // v928 track B: 既に trash に入っている時は完全削除 (hard delete)。それ以外は soft delete。
    if (!empty($r['deleted_at'])) {
        // 完全削除は admin だけ許可
        if (!$isAdmin) throw new ApiException('forbidden', 'trash 内の完全削除は admin のみ', 403);
        $stF = $pdo->prepare("SELECT pdf_path FROM refs WHERE id = ?");
        $stF->execute([$id]);
        $pdf = (string)$stF->fetchColumn();
        if ($pdf !== '') {
            $abs = '/var/www/labpay/public' . $pdf;
            if (is_file($abs)) @unlink($abs);
        }
        $pdo->prepare("DELETE FROM refs WHERE id = ?")->execute([$id]);
        json_response(['ok' => true, 'action' => 'purged']);
        return;
    }
    $pdo->prepare("UPDATE refs SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true, 'action' => 'trashed']);
}

// v928 track B: trash から復元
function refs_restore(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT added_by_user_id FROM refs WHERE id = ? AND deleted_at IS NOT NULL");
    $st->execute([$id]);
    $addedBy = (int)$st->fetchColumn();
    if (!$addedBy) throw new ApiException('not_found', 'trash 内に存在せず', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($addedBy !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '登録者 or admin のみ復元可', 403);
    }
    $pdo->prepare("UPDATE refs SET deleted_at = NULL WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// note (自分の note + 読状態)
// ─────────────────────────────────────────────────────

function refs_note_set(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 存在確認
    $ex = $pdo->prepare("SELECT 1 FROM refs WHERE id = ?");
    $ex->execute([$id]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', '文献なし', 404);
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
    // 更新後の row を返す
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
    // PDF 添付はラボメン誰でも可 (共有資産として)。起案者縛りは付けない。
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'multipart/form-data で送って', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmp = $f['tmp_name'];
    $head = @file_get_contents($tmp, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF でない', 400);
    $sha = hash_file('sha256', $tmp);
    $publicDir = '/var/www/labpay/public';
    $rel = '/uploads/refs/' . substr($sha, 0, 2) . '/' . $sha . '.pdf';
    $abs = $publicDir . $rel;
    @mkdir(dirname($abs), 0775, true);
    if (!copy($tmp, $abs)) throw new ApiException('server_error', 'PDF 保存失敗', 500);
    @chmod($abs, 0644);
    // 旧 PDF (別ファイル) は削除
    if (!empty($r['pdf_path']) && $r['pdf_path'] !== $rel) {
        $oldAbs = $publicDir . $r['pdf_path'];
        if (is_file($oldAbs)) @unlink($oldAbs);
    }
    // v930 PDF から fulltext を抽出して保存 (全文検索用)
    $fulltext = _refs_extract_pdf_fulltext($abs);
    $pdo->prepare("UPDATE refs SET pdf_path = ?, pdf_sha256 = ?, `fulltext` = ? WHERE id = ?")
        ->execute([$rel, $sha, $fulltext, $id]);
    json_response(['ok' => true, 'pdf_path' => $rel, 'pdf_sha256' => $sha, 'fulltext_chars' => mb_strlen((string)$fulltext)]);
}

// v930 pdftotext で PDF 全ページを text 抽出 (fulltext 検索用)。
function _refs_extract_pdf_fulltext(string $absPath): ?string {
    if (!is_file($absPath)) return null;
    $txtOut = sys_get_temp_dir() . '/refs_ft_' . uniqid() . '.txt';
    $cmd = sprintf('pdftotext -layout %s %s 2>&1', escapeshellarg($absPath), escapeshellarg($txtOut));
    exec($cmd, $out, $rc);
    if ($rc !== 0 || !is_file($txtOut)) return null;
    $text = (string)file_get_contents($txtOut);
    @unlink($txtOut);
    // MEDIUMTEXT 上限 (~16 MB) の範囲に抑える。通常論文の PDF は 100KB 以下になる。
    if (strlen($text) > 8 * 1024 * 1024) $text = substr($text, 0, 8 * 1024 * 1024);
    return $text !== '' ? $text : null;
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
// v927 track A: BibTeX / RIS ファイル一括 import
// ─────────────────────────────────────────────────────

// ざっくり BibTeX パーサ (ネスト braces 対応、主要 field を拾う)。
//   Zotero や Mendeley の標準 export で動く想定。個別の難解 pattern は諦める。
function _refs_parse_bibtex(string $content): array {
    $entries = [];
    // @type{key, field = {value}, field = "value", ...} を抽出
    if (!preg_match_all('/@(\w+)\s*\{\s*([^,\s]+)\s*,(.*?)\n\s*\}\s*(?=@|\z)/is', $content, $m, PREG_SET_ORDER)) {
        // 最後のエントリは `\n}` の後に何も無いケースも拾う
        preg_match_all('/@(\w+)\s*\{\s*([^,\s]+)\s*,(.+)/is', $content, $m, PREG_SET_ORDER);
    }
    foreach ($m as $ent) {
        $type = strtolower($ent[1]);
        if ($type === 'string' || $type === 'preamble' || $type === 'comment') continue;
        $key  = $ent[2];
        $bodyRaw = $ent[3];
        $fields = [];
        // field = { ... } または field = "..." または field = value を拾う。
        //   ネスト braces に弱いが標準 export では大体動く。
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

// RIS: 行ベース。 TY = 開始、 ER = 終端。 AU / TI / PY / JO / DO / N2 (abstract) など。
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

// BibTeX の生 authors 文字列「A and B and C」を [{name}, ...] に。
function _refs_split_bibtex_authors(string $raw): array {
    $parts = preg_split('/\s+and\s+/i', $raw);
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p === '') continue;
        // 「Family, Given」 → 「Given Family」に正規化
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
    if ($content === '') throw new ApiException('bad_request', 'file か bibtex 本文が必要', 400);
    if (strlen($content) > 5 * 1024 * 1024) throw new ApiException('bad_request', '5MB まで', 400);

    $parsed = _refs_parse_bibtex($content);
    if (!$parsed) throw new ApiException('bad_request', 'BibTeX エントリが見つからなかった', 400);

    $added = 0; $skipped = 0; $results = [];
    foreach ($parsed as $ent) {
        $f = $ent['fields'];
        $title = $f['title'] ?? '';
        if ($title === '') { $skipped++; $results[] = ['status' => 'skip', 'reason' => 'title なし']; continue; }
        $doi = isset($f['doi']) ? _refs_normalize_doi($f['doi']) : '';
        if ($doi !== '' && !preg_match('#^10\.\d{4,9}/#', $doi)) $doi = '';
        $arxiv = isset($f['eprint']) ? _refs_normalize_arxiv($f['eprint']) : null;
        // 既存チェック
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
        $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex_v2($row), $refId]);
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
    if ($content === '') throw new ApiException('bad_request', 'file か ris 本文が必要', 400);
    if (strlen($content) > 5 * 1024 * 1024) throw new ApiException('bad_request', '5MB まで', 400);

    $parsed = _refs_parse_ris($content);
    if (!$parsed) throw new ApiException('bad_request', 'RIS エントリが見つからなかった', 400);

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
        $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex_v2($row), $refId]);
        $added++; $results[] = ['status' => 'added', 'id' => $refId, 'title' => $title];
    }
    json_response(['added' => $added, 'skipped' => $skipped, 'total' => count($parsed), 'results' => $results]);
}

// ─────────────────────────────────────────────────────
// v927 track A: PDF から metadata 抽出 (pdftotext + crossref + OpenAI)
// ─────────────────────────────────────────────────────

// v1099 PDF テキストの先頭数千字から Keywords 行を検出。
//   ACM: "CCS Concepts: ..." + "Additional Key Words and Phrases: X, Y, Z"
//   IEEE: "Index Terms— X, Y, Z"
//   Springer / Elsevier: "Keywords: X, Y, Z" (改行で続く場合も対応)
//   小文字化してキーを認識、区切りはカンマ / セミコロン / 中黒。
//   返り値は最大 15 件、 1 件 60 文字まで。
function _refs_extract_keywords_from_text(string $text): array {
    $head = mb_substr($text, 0, 8000);
    // 改行で区切って各行を走査、見つかったら続きの行も 1 行だけ追加取り込み
    $lines = preg_split('/\r?\n/', $head);
    $rawKw = '';
    $patterns = [
        '/^\s*(?:additional\s+)?key\s*words?(?:\s+and\s+phrases)?\s*[:：\-—]\s*(.+)$/i',
        '/^\s*keywords?\s*[:：\-—]\s*(.+)$/i',
        '/^\s*index\s+terms?\s*[:：\-—]\s*(.+)$/i',
        '/^\s*ccs\s+concepts?\s*[:：\-—]\s*(.+)$/i',
    ];
    $n = count($lines);
    for ($i = 0; $i < $n; $i++) {
        foreach ($patterns as $p) {
            if (preg_match($p, $lines[$i], $mm)) {
                $rawKw = trim($mm[1]);
                // 続きの行がインデントだけで続いている場合 (折り返し) は 1 行だけ継続
                for ($j = $i + 1; $j < min($i + 4, $n); $j++) {
                    $nx = trim($lines[$j]);
                    if ($nx === '') break;
                    // 次のセクションヘッダぽい (大文字 or 番号始まり) なら break
                    if (preg_match('/^\s*(\d+\.|[A-Z][A-Z ]{3,}|abstract|introduction|１\.|1 )/', $nx)) break;
                    $rawKw .= ', ' . $nx;
                }
                break 2;
            }
        }
    }
    if ($rawKw === '') return [];
    // 区切り: カンマ / セミコロン / 中黒 / ・ / • / | / bullet
    $parts = preg_split('/\s*[,;、|・•]\s*/u', $rawKw);
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p, " .\t\n\r\0\x0B");
        if ($p === '') continue;
        if (mb_strlen($p) > 60) $p = mb_substr($p, 0, 60);
        // 明らかに長すぎ (文になっている) は除外
        if (mb_strlen($p) < 2) continue;
        if (!in_array($p, $out, true)) $out[] = $p;
        if (count($out) >= 15) break;
    }
    return $out;
}

// v1099 2 つのキーワード配列を順序保存で重複除去 (a を優先)、最大 15 件。
function _refs_merge_keywords(array $a, array $b): array {
    $out = [];
    $seen = [];
    foreach ([$a, $b] as $arr) {
        foreach ($arr as $k) {
            $k = trim((string)$k);
            if ($k === '') continue;
            if (mb_strlen($k) > 60) $k = mb_substr($k, 0, 60);
            $key = mb_strtolower($k);
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $out[] = $k;
            if (count($out) >= 15) return $out;
        }
    }
    return $out;
}

function refs_extract_pdf(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'multipart/form-data で送って', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '30MB まで', 400);
    $tmp = $f['tmp_name'];
    $head = @file_get_contents($tmp, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF でない', 400);

    // pdftotext で先頭 2 ページをテキスト化
    $txtOut = sys_get_temp_dir() . '/refs_pdftxt_' . uniqid() . '.txt';
    $cmd = sprintf('pdftotext -f 1 -l 2 -layout %s %s 2>&1',
        escapeshellarg($tmp), escapeshellarg($txtOut));
    exec($cmd, $out, $rc);
    $text = '';
    if ($rc === 0 && is_file($txtOut)) {
        $text = (string)file_get_contents($txtOut);
        @unlink($txtOut);
    }
    if ($text === '') throw new ApiException('server_error', 'PDF からテキストを抽出できなかった', 500);

    // v1099 PDF 本文に明示された Keywords / Index Terms / CCS Concepts を先に抽出。
    //   crossref / arXiv API にはキーワードが無いことが多いので、論文内の明示
    //   キーワードを最も信頼して merge する。
    $pdfKeywords = _refs_extract_keywords_from_text($text);

    // 1) 本文から DOI を検出 → crossref
    if (preg_match('#\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b#', $text, $m)) {
        $doi = _refs_normalize_doi(rtrim($m[1], '.,)'));
        $meta = _refs_fetch_crossref($doi);
        if ($meta) {
            // 既存チェック
            $st = $pdo->prepare("SELECT id, title FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([$doi]);
            $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            // PDF 内明示キーワードを優先 merge (crossref subject があれば後ろに足す)
            $meta['keywords'] = _refs_merge_keywords($pdfKeywords, (array)($meta['keywords'] ?? []));
            json_response([
                'method'   => 'pdf_doi_crossref',
                'meta'     => $meta,
                'existing' => $existing ?: null,
            ]);
            return;
        }
    }
    // 2) arxiv ID を検出
    if (preg_match('#\b(?:arXiv[:\s]*)?([0-9]{4}\.[0-9]{4,6})(v\d+)?\b#i', $text, $m)) {
        $id = $m[1] . ($m[2] ?? '');
        $meta = _refs_fetch_arxiv($id);
        if ($meta) {
            $st = $pdo->prepare("SELECT id, title FROM refs WHERE arxiv_id = ? LIMIT 1");
            $st->execute([$id]);
            $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            $meta['keywords'] = $pdfKeywords;
            json_response([
                'method'   => 'pdf_arxiv_api',
                'meta'     => $meta,
                'existing' => $existing ?: null,
            ]);
            return;
        }
    }
    // 3) OpenAI に「先頭テキストから metadata を JSON で抽出」させる
    $head = mb_substr($text, 0, 4000);
    $apiKey = (string)$cfg['openai']['api_key'];
    $payload = [
        'model' => 'gpt-5-mini',
        'messages' => [
            ['role' => 'system', 'content' => '研究論文の先頭部分のテキストを受け取り、 metadata を JSON で返します。 keys: title (string), authors (array of string), year (int or null), venue (string or null), abstract (string or null), doi (string or null), keywords (array of string, 最大 15 件、論文中の Keywords / Index Terms / Additional Key Words / CCS Concepts 相当。明示が無ければタイトルと abstract から主要なトピック語を 3〜8 件生成)。見つからない項目は null。出力は JSON のみ、コメント不要。'],
            ['role' => 'user', 'content' => "以下のテキストから metadata を抽出:\n\n" . $head],
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
    if (!is_array($parsed)) throw new ApiException('upstream_error', 'OpenAI が JSON を返さなかった', 502);
    // authors を array of {name} に正規化
    $authors = [];
    foreach ((array)($parsed['authors'] ?? []) as $a) {
        if (is_string($a) && trim($a) !== '') $authors[] = ['name' => trim($a)];
    }
    // v1099 OpenAI が返した keywords を正規化。明示抽出 (pdfKeywords) と併せて前優先で merge。
    $openaiKw = [];
    foreach ((array)($parsed['keywords'] ?? []) as $k) {
        if (is_string($k)) {
            $k = trim($k);
            if ($k !== '') $openaiKw[] = $k;
        }
    }
    $meta = [
        'title'    => (string)($parsed['title'] ?? ''),
        'authors'  => $authors,
        'year'     => isset($parsed['year']) && $parsed['year'] !== null ? (int)$parsed['year'] : null,
        'venue'    => (string)($parsed['venue'] ?? ''),
        'abstract' => (string)($parsed['abstract'] ?? ''),
        'doi'      => (string)($parsed['doi'] ?? ''),
        'keywords' => _refs_merge_keywords($pdfKeywords, $openaiKw),
    ];
    // 既存チェック (DOI 有りなら)
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
// v927 track A: ref_attachments (複数添付)
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
    if (!$ex->fetchColumn()) throw new ApiException('not_found', '文献なし', 404);
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file が必要', 400);
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
        throw new ApiException('forbidden', 'アップロード者 or admin のみ削除可', 403);
    }
    $abs = '/var/www/labpay/public' . $r['path'];
    if (is_file($abs)) @unlink($abs);
    $pdo->prepare("DELETE FROM ref_attachments WHERE id = ?")->execute([$attId]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// v928 track B: Collections (フォルダ階層)
// ─────────────────────────────────────────────────────

function refs_collections_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    // 各 collection の refs 件数も一緒に返す (deleted 除外)
    $st = $pdo->query("
        SELECT c.id, c.name, c.description, c.parent_id, c.icon, c.owner_user_id, c.created_at,
               u.display_name AS owner_name,
               (SELECT COUNT(*) FROM ref_collection_items ci JOIN refs r ON r.id = ci.ref_id
                 WHERE ci.collection_id = c.id AND r.deleted_at IS NULL) AS ref_count
          FROM ref_collections c LEFT JOIN users u ON u.id = c.owner_user_id
      ORDER BY COALESCE(c.parent_id, 0), c.sort_order, c.name");
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function refs_collections_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') throw new ApiException('bad_request', 'name 必要', 400);
    if (mb_strlen($name) > 200) $name = mb_substr($name, 0, 200);
    $desc = trim((string)($body['description'] ?? ''));
    $parentId = isset($body['parent_id']) && $body['parent_id'] !== '' ? (int)$body['parent_id'] : null;
    $icon = trim((string)($body['icon'] ?? '📁'));
    if (mb_strlen($icon) > 5) $icon = mb_substr($icon, 0, 5);
    if ($parentId) {
        $st = $pdo->prepare("SELECT id FROM ref_collections WHERE id = ?");
        $st->execute([$parentId]);
        if (!$st->fetchColumn()) throw new ApiException('bad_request', 'parent_id 不正', 400);
    }
    $ins = $pdo->prepare("INSERT INTO ref_collections
        (name, description, parent_id, icon, owner_user_id) VALUES (?,?,?,?,?)");
    $ins->execute([$name, $desc ?: null, $parentId, $icon ?: '📁', (int)$u['id']]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function refs_collection_detail(PDO $pdo, array $cfg, int $cid): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT c.*, u.display_name AS owner_name
                          FROM ref_collections c LEFT JOIN users u ON u.id = c.owner_user_id
                         WHERE c.id = ?");
    $st->execute([$cid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'コレクションなし', 404);
    json_response($r);
}

function refs_collection_edit(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT owner_user_id FROM ref_collections WHERE id = ?");
    $st->execute([$cid]);
    $ownerId = (int)$st->fetchColumn();
    if (!$ownerId) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($ownerId !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '作成者 or admin のみ編集可', 403);
    }
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('name', $body)) {
        $t = trim((string)$body['name']);
        if ($t === '') throw new ApiException('bad_request', 'name 空不可', 400);
        $sets[] = 'name = ?'; $args[] = mb_substr($t, 0, 200);
    }
    if (array_key_exists('description', $body)) {
        $sets[] = 'description = ?'; $args[] = trim((string)$body['description']) ?: null;
    }
    if (array_key_exists('parent_id', $body)) {
        $p = $body['parent_id'];
        $sets[] = 'parent_id = ?'; $args[] = $p === '' || $p === null ? null : (int)$p;
    }
    if (array_key_exists('icon', $body)) {
        $ic = trim((string)$body['icon']);
        $sets[] = 'icon = ?'; $args[] = mb_substr($ic, 0, 5) ?: '📁';
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $cid;
    $pdo->prepare("UPDATE ref_collections SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function refs_collection_delete(PDO $pdo, array $cfg, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT owner_user_id FROM ref_collections WHERE id = ?");
    $st->execute([$cid]);
    $ownerId = (int)$st->fetchColumn();
    if (!$ownerId) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($ownerId !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '作成者 or admin のみ削除可', 403);
    }
    // 子 collection があれば拒否 (先に移動して貰う)
    $stC = $pdo->prepare("SELECT COUNT(*) FROM ref_collections WHERE parent_id = ?");
    $stC->execute([$cid]);
    if ((int)$stC->fetchColumn() > 0) {
        throw new ApiException('conflict', 'サブフォルダが残っています。先に移動 or 削除してください', 409);
    }
    $pdo->prepare("DELETE FROM ref_collections WHERE id = ?")->execute([$cid]);
    json_response(['ok' => true]);
}

function refs_collection_add_ref(PDO $pdo, array $cfg, int $cid, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $ex1 = $pdo->prepare("SELECT 1 FROM ref_collections WHERE id = ?");
    $ex1->execute([$cid]);
    if (!$ex1->fetchColumn()) throw new ApiException('not_found', 'コレクションなし', 404);
    $ex2 = $pdo->prepare("SELECT 1 FROM refs WHERE id = ? AND deleted_at IS NULL");
    $ex2->execute([$refId]);
    if (!$ex2->fetchColumn()) throw new ApiException('not_found', '文献なし', 404);
    $ins = $pdo->prepare("INSERT IGNORE INTO ref_collection_items (collection_id, ref_id, added_by_user_id)
                          VALUES (?, ?, ?)");
    $ins->execute([$cid, $refId, (int)$u['id']]);
    json_response(['ok' => true]);
}

function refs_collection_remove_ref(PDO $pdo, array $cfg, int $cid, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    $pdo->prepare("DELETE FROM ref_collection_items WHERE collection_id = ? AND ref_id = ?")
        ->execute([$cid, $refId]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// v928 track B: Saved searches (個人別)
// ─────────────────────────────────────────────────────

function refs_saved_searches_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, name, filter_json, created_at FROM ref_saved_searches
                          WHERE owner_user_id = ? ORDER BY id DESC");
    $st->execute([(int)$u['id']]);
    $items = array_map(function ($r) {
        $r['filter'] = json_decode((string)$r['filter_json'], true) ?: [];
        unset($r['filter_json']);
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function refs_saved_searches_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') throw new ApiException('bad_request', 'name 必要', 400);
    if (mb_strlen($name) > 200) $name = mb_substr($name, 0, 200);
    $filter = $body['filter'] ?? [];
    if (!is_array($filter)) $filter = [];
    // 保存する field を限定 (信頼できる key のみ)
    $keep = ['q','tag','year','status','sort','collection_id','uncategorized','trash'];
    $safe = [];
    foreach ($keep as $k) if (isset($filter[$k])) $safe[$k] = $filter[$k];
    $ins = $pdo->prepare("INSERT INTO ref_saved_searches (owner_user_id, name, filter_json)
                          VALUES (?, ?, ?)");
    $ins->execute([(int)$u['id'], $name, json_encode($safe, JSON_UNESCAPED_UNICODE)]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function refs_saved_search_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT owner_user_id FROM ref_saved_searches WHERE id = ?");
    $st->execute([$id]);
    $ownerId = (int)$st->fetchColumn();
    if (!$ownerId) throw new ApiException('not_found', 'not found', 404);
    if ($ownerId !== (int)$u['id']) throw new ApiException('forbidden', '本人のみ削除可', 403);
    $pdo->prepare("DELETE FROM ref_saved_searches WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// v928 track B: Related items (双方向リンク)
// ─────────────────────────────────────────────────────

function refs_relations_list(PDO $pdo, array $cfg, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    // A 側も B 側も両方拾う (どちら経由で登録されていても同じ関係と見なす)
    $st = $pdo->prepare("
        (SELECT rr.b_ref_id AS other_id, rr.kind, rr.note, rr.created_at, rr.created_by_user_id,
                r.title, r.year, r.venue
           FROM ref_relations rr JOIN refs r ON r.id = rr.b_ref_id
          WHERE rr.a_ref_id = ? AND r.deleted_at IS NULL)
        UNION
        (SELECT rr.a_ref_id AS other_id, rr.kind, rr.note, rr.created_at, rr.created_by_user_id,
                r.title, r.year, r.venue
           FROM ref_relations rr JOIN refs r ON r.id = rr.a_ref_id
          WHERE rr.b_ref_id = ? AND r.deleted_at IS NULL)
        ORDER BY created_at DESC LIMIT 50");
    $st->execute([$refId, $refId]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function refs_relations_add(PDO $pdo, array $cfg, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $otherId = (int)($body['ref_id'] ?? 0);
    if ($otherId <= 0 || $otherId === $refId) throw new ApiException('bad_request', 'ref_id 不正', 400);
    $kind = (string)($body['kind'] ?? 'related');
    if (!in_array($kind, ['related','cites','same_topic'], true)) $kind = 'related';
    $note = trim((string)($body['note'] ?? '')) ?: null;
    if ($note && mb_strlen($note) > 500) $note = mb_substr($note, 0, 500);
    // 正規化: 小さい ID を a に (二重登録防止)
    $a = min($refId, $otherId);
    $b = max($refId, $otherId);
    $ex = $pdo->prepare("SELECT 1 FROM refs WHERE id IN (?, ?) AND deleted_at IS NULL");
    $ex->execute([$a, $b]);
    if ($ex->rowCount() < 2) {
        // rowCount は SELECT で使えないので別方法で
    }
    $stC = $pdo->prepare("SELECT COUNT(*) FROM refs WHERE id IN (?, ?) AND deleted_at IS NULL");
    $stC->execute([$a, $b]);
    if ((int)$stC->fetchColumn() < 2) throw new ApiException('not_found', '文献が存在せず', 404);
    $ins = $pdo->prepare("INSERT IGNORE INTO ref_relations (a_ref_id, b_ref_id, kind, note, created_by_user_id)
                          VALUES (?, ?, ?, ?, ?)");
    $ins->execute([$a, $b, $kind, $note, (int)$u['id']]);
    json_response(['ok' => true]);
}

function refs_relations_remove(PDO $pdo, array $cfg, int $refId, int $otherId): void {
    Auth::requireUser($pdo, $cfg);
    $a = min($refId, $otherId);
    $b = max($refId, $otherId);
    $pdo->prepare("DELETE FROM ref_relations WHERE a_ref_id = ? AND b_ref_id = ?")->execute([$a, $b]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// v929 helpers: item_type + extra_json
// ─────────────────────────────────────────────────────

const REFS_ITEM_TYPES = ['article','book','book_chapter','thesis','conference','patent','dataset','preprint','web','misc'];

function _refs_normalize_item_type(string $s): string {
    $s = strtolower(trim($s));
    // Zotero / crossref の別名をマップ
    $map = [
        'journal-article' => 'article',
        'journalArticle'  => 'article',
        'proceedings-article' => 'conference',
        'conferencePaper' => 'conference',
        'inproceedings'   => 'conference',
        'inbook'          => 'book_chapter',
        'bookSection'     => 'book_chapter',
        'phdthesis'       => 'thesis',
        'mastersthesis'   => 'thesis',
        'webpage'         => 'web',
        'website'         => 'web',
        'report'          => 'misc',
    ];
    if (isset($map[$s])) $s = $map[$s];
    return in_array($s, REFS_ITEM_TYPES, true) ? $s : 'article';
}

function _refs_extra_from_body(array $body): ?string {
    $extra = $body['extra'] ?? ($body['extra_json'] ?? null);
    if (is_string($extra) && $extra !== '') { $tmp = json_decode($extra, true); if (is_array($tmp)) $extra = $tmp; }
    if (!is_array($extra)) return null;
    // 許可 field (Zotero の CSL 由来と BibTeX 由来を主要だけ抜粋)
    $allowed = ['isbn','issn','publisher','edition','pages','volume','issue','number','series','address',
                'chapter','editor','thesis_type','institution','school','patent_number','application_number',
                'howpublished','organization','note','month','language'];
    $safe = [];
    foreach ($allowed as $k) {
        if (isset($extra[$k]) && $extra[$k] !== '' && $extra[$k] !== null) {
            $v = is_scalar($extra[$k]) ? mb_substr((string)$extra[$k], 0, 500) : $extra[$k];
            $safe[$k] = $v;
        }
    }
    return $safe ? json_encode($safe, JSON_UNESCAPED_UNICODE) : null;
}

// BibTeX 型を item_type から決める。
function _refs_bibtex_type(string $itemType): string {
    return [
        'article'      => 'article',
        'book'         => 'book',
        'book_chapter' => 'inbook',
        'thesis'       => 'phdthesis',
        'conference'   => 'inproceedings',
        'patent'       => 'patent',
        'dataset'      => 'misc',
        'preprint'     => 'misc',
        'web'          => 'misc',
        'misc'         => 'misc',
    ][$itemType] ?? 'article';
}

// v929: _refs_generate_bibtex を item_type + extra 対応にアップグレード。
//   (既存関数を上書き)
function _refs_generate_bibtex_v2(array $r): string {
    $itemType = (string)($r['item_type'] ?? 'article');
    $bibType  = _refs_bibtex_type($itemType);
    $keyBase  = 'ref';
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
    $lines = ['@' . $bibType . '{' . $key . ','];
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
    // venue field: item_type で名前変える (BibTeX 慣習)
    if (!empty($r['venue'])) {
        $venueField = $bibType === 'inproceedings' ? 'booktitle'
                   : ($bibType === 'inbook' ? 'booktitle'
                   : ($bibType === 'phdthesis' ? 'school'
                   : 'journal'));
        $lines[] = '  ' . $venueField . ' = {' . $esc($r['venue']) . '},';
    }
    // extra field を BibTeX 化
    if (!empty($r['extra_json'])) {
        $ex = json_decode((string)$r['extra_json'], true) ?: [];
        $map = [
            'isbn'=>'isbn', 'issn'=>'issn', 'publisher'=>'publisher', 'edition'=>'edition',
            'pages'=>'pages', 'volume'=>'volume', 'issue'=>'number', 'number'=>'number',
            'series'=>'series', 'address'=>'address', 'chapter'=>'chapter', 'editor'=>'editor',
            'institution'=>'institution', 'school'=>'school',
            'organization'=>'organization', 'note'=>'note', 'month'=>'month',
            'patent_number'=>'number',
        ];
        foreach ($map as $ek => $bk) {
            if (isset($ex[$ek]) && $ex[$ek] !== '') {
                $lines[] = '  ' . $bk . ' = {' . $esc((string)$ex[$ek]) . '},';
            }
        }
    }
    if (!empty($r['doi']))      $lines[] = '  doi = {' . $esc($r['doi']) . '},';
    if (!empty($r['arxiv_id'])) $lines[] = '  eprint = {' . $esc($r['arxiv_id']) . '},';
    if (!empty($r['url']))      $lines[] = '  url = {' . $esc($r['url']) . '},';
    $lines[] = '}';
    return implode("\n", $lines);
}

// ─────────────────────────────────────────────────────
// v929: CSL 引用生成 (APA / MLA / Chicago / IEEE)
// ─────────────────────────────────────────────────────

function _refs_author_short(array $a): string {
    $name = (string)($a['name'] ?? '');
    if ($name === '') return '';
    $parts = explode(' ', $name);
    if (count($parts) < 2) return $name;
    $family = array_pop($parts);
    $initial = mb_substr(implode(' ', $parts), 0, 1) . '.';
    return $family . ', ' . $initial;
}
function _refs_author_family(array $a): string {
    $name = (string)($a['name'] ?? '');
    $parts = explode(' ', $name);
    return end($parts) ?: $name;
}

function _refs_citation_apa(array $r, array $authors): string {
    // APA 7: Author, A. A. (Year). Title. Venue, volume(issue), pages. https://doi.org/...
    $names = array_map('_refs_author_short', $authors);
    if (count($names) === 1)      $auth = $names[0];
    elseif (count($names) === 2)  $auth = $names[0] . ' & ' . $names[1];
    elseif (count($names) <= 20)  $auth = implode(', ', array_slice($names, 0, -1)) . ', & ' . end($names);
    else                          $auth = implode(', ', array_slice($names, 0, 19)) . ', ... ' . end($names);
    $year = !empty($r['year']) ? '(' . (int)$r['year'] . ')' : '(n.d.)';
    $title = rtrim((string)$r['title'], '.');
    $venue = $r['venue'] ?? '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $vol = $ex['volume'] ?? ''; $iss = $ex['issue'] ?? $ex['number'] ?? ''; $pages = $ex['pages'] ?? '';
    $volPart = ($vol !== '') ? " *{$vol}*" . ($iss !== '' ? "({$iss})" : '') : '';
    $pagePart = ($pages !== '') ? ", {$pages}" : '';
    $doi = !empty($r['doi']) ? ' https://doi.org/' . $r['doi'] : (!empty($r['url']) ? ' ' . $r['url'] : '');
    return trim("$auth $year. $title. *$venue*$volPart$pagePart.$doi");
}

function _refs_citation_mla(array $r, array $authors): string {
    // MLA 9: Author. "Title." Venue, vol. X, no. Y, Year, pp. pages.
    $names = array_map(fn($a) => (string)($a['name'] ?? ''), $authors);
    if (count($names) === 1) $auth = $names[0];
    elseif (count($names) === 2) $auth = $names[0] . ' and ' . $names[1];
    elseif (count($names) > 0)   $auth = $names[0] . ', et al.';
    else                         $auth = '';
    $title = '"' . rtrim((string)$r['title'], '.') . '."';
    $venue = $r['venue'] ? '*' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $vol = $ex['volume'] ?? ''; $iss = $ex['issue'] ?? $ex['number'] ?? ''; $pages = $ex['pages'] ?? '';
    $year = !empty($r['year']) ? (string)(int)$r['year'] : '';
    $parts = array_filter([
        $auth,
        $title,
        $venue,
        $vol !== '' ? 'vol. ' . $vol : '',
        $iss !== '' ? 'no. ' . $iss : '',
        $year,
        $pages !== '' ? 'pp. ' . $pages : '',
    ]);
    return implode(', ', $parts) . '.';
}

function _refs_citation_chicago(array $r, array $authors): string {
    // Chicago (author-date): Author. Year. "Title." Venue vol (issue): pages.
    $names = array_map(fn($a) => (string)($a['name'] ?? ''), $authors);
    if (count($names) === 1) $auth = $names[0];
    elseif (count($names) <= 3) $auth = implode(', ', array_slice($names, 0, -1)) . ', and ' . end($names);
    else $auth = $names[0] . ', et al.';
    $year = !empty($r['year']) ? (int)$r['year'] : 'n.d.';
    $title = '"' . rtrim((string)$r['title'], '.') . '."';
    $venue = $r['venue'] ? ' *' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $vol = $ex['volume'] ?? ''; $iss = $ex['issue'] ?? $ex['number'] ?? ''; $pages = $ex['pages'] ?? '';
    $tail = ($vol !== '' ? ' ' . $vol : '') . ($iss !== '' ? ' (' . $iss . ')' : '');
    $tail .= $pages !== '' ? ': ' . $pages : '';
    $doi = !empty($r['doi']) ? '. https://doi.org/' . $r['doi'] : '';
    return "$auth. $year. $title$venue$tail.$doi";
}

function _refs_citation_ieee(array $r, array $authors, int $num = 1): string {
    // IEEE: [N] A. Author, B. Author, and C. Author, "Title," Venue, vol. X, no. Y, pp. Z, Year.
    $names = array_map(function ($a) {
        $n = (string)($a['name'] ?? '');
        if ($n === '') return '';
        $parts = explode(' ', $n);
        $family = array_pop($parts);
        $initial = implode(' ', array_map(fn($p) => mb_substr($p, 0, 1) . '.', $parts));
        return trim($initial . ' ' . $family);
    }, $authors);
    $auth = '';
    if (count($names) === 1) $auth = $names[0];
    elseif (count($names) <= 6) $auth = implode(', ', array_slice($names, 0, -1)) . ', and ' . end($names);
    else $auth = $names[0] . ' et al.';
    $title = '"' . rtrim((string)$r['title'], '.') . ',"';
    $venue = $r['venue'] ? ' *' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $parts = array_filter([
        $ex['volume'] ?? '' ? 'vol. ' . $ex['volume'] : '',
        $ex['issue']  ?? $ex['number'] ?? '' ? 'no. ' . ($ex['issue'] ?? $ex['number']) : '',
        $ex['pages']  ?? '' ? 'pp. ' . $ex['pages'] : '',
        !empty($r['year']) ? (string)(int)$r['year'] : '',
    ]);
    return "[$num] $auth, $title$venue, " . implode(', ', $parts) . '.';
}

function refs_citation(PDO $pdo, array $cfg, int $id): void {
    Auth::requireUser($pdo, $cfg);
    $style = strtolower((string)($_GET['style'] ?? 'apa'));
    $st = $pdo->prepare("SELECT * FROM refs WHERE id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $authors = $r['authors_json'] ? (json_decode((string)$r['authors_json'], true) ?: []) : [];
    $out = match ($style) {
        'mla'     => _refs_citation_mla($r, $authors),
        'chicago' => _refs_citation_chicago($r, $authors),
        'ieee'    => _refs_citation_ieee($r, $authors),
        default   => _refs_citation_apa($r, $authors),
    };
    json_response(['style' => $style, 'citation' => $out]);
}

// ─────────────────────────────────────────────────────
// v929: highlights (PDF ハイライト、簡易実装 = page + quote + comment + color)
// ─────────────────────────────────────────────────────

function refs_highlights_list(PDO $pdo, array $cfg, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 自分の全 highlight + 他人の共有 highlight
    $st = $pdo->prepare("SELECT h.id, h.page, h.quote_text, h.comment, h.color, h.is_shared,
                                h.user_id, h.created_at, h.updated_at,
                                u.display_name, u.avatar_url
                           FROM ref_highlights h JOIN users u ON u.id = h.user_id
                          WHERE h.ref_id = ? AND (h.user_id = ? OR h.is_shared = 1)
                       ORDER BY COALESCE(h.page, 0), h.id");
    $st->execute([$refId, $uid]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function refs_highlights_add(PDO $pdo, array $cfg, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $ex = $pdo->prepare("SELECT 1 FROM refs WHERE id = ?");
    $ex->execute([$refId]);
    if (!$ex->fetchColumn()) throw new ApiException('not_found', '文献なし', 404);
    $body = read_json_body();
    $page = isset($body['page']) && $body['page'] !== '' ? (int)$body['page'] : null;
    $quote = trim((string)($body['quote_text'] ?? ''));
    $comment = trim((string)($body['comment'] ?? ''));
    $color = (string)($body['color'] ?? 'yellow');
    if (!in_array($color, ['yellow','red','green','blue','purple'], true)) $color = 'yellow';
    $isShared = isset($body['is_shared']) ? (int)!!$body['is_shared'] : 1;
    if ($quote === '' && $comment === '') throw new ApiException('bad_request', 'quote か comment が必要', 400);
    $ins = $pdo->prepare("INSERT INTO ref_highlights
        (ref_id, user_id, page, quote_text, comment, color, is_shared) VALUES (?,?,?,?,?,?,?)");
    $ins->execute([$refId, (int)$u['id'], $page, $quote ?: null, $comment ?: null, $color, $isShared]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function refs_highlights_edit(PDO $pdo, array $cfg, int $refId, int $hid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM ref_highlights WHERE id = ? AND ref_id = ?");
    $st->execute([$hid, $refId]);
    $ownerId = (int)$st->fetchColumn();
    if (!$ownerId) throw new ApiException('not_found', 'not found', 404);
    if ($ownerId !== (int)$u['id']) throw new ApiException('forbidden', '本人のみ編集可', 403);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('page', $body))       { $sets[] = 'page = ?';       $args[] = $body['page'] === '' ? null : (int)$body['page']; }
    if (array_key_exists('quote_text', $body)) { $sets[] = 'quote_text = ?'; $args[] = trim((string)$body['quote_text']) ?: null; }
    if (array_key_exists('comment', $body))    { $sets[] = 'comment = ?';    $args[] = trim((string)$body['comment']) ?: null; }
    if (array_key_exists('color', $body)) {
        $c = (string)$body['color'];
        if (!in_array($c, ['yellow','red','green','blue','purple'], true)) $c = 'yellow';
        $sets[] = 'color = ?'; $args[] = $c;
    }
    if (array_key_exists('is_shared', $body))  { $sets[] = 'is_shared = ?';  $args[] = (int)!!$body['is_shared']; }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $hid;
    $pdo->prepare("UPDATE ref_highlights SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function refs_highlights_delete(PDO $pdo, array $cfg, int $refId, int $hid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM ref_highlights WHERE id = ? AND ref_id = ?");
    $st->execute([$hid, $refId]);
    $ownerId = (int)$st->fetchColumn();
    if (!$ownerId) throw new ApiException('not_found', 'not found', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($ownerId !== (int)$u['id'] && !$isAdmin) throw new ApiException('forbidden', '本人 or admin のみ削除可', 403);
    $pdo->prepare("DELETE FROM ref_highlights WHERE id = ?")->execute([$hid]);
    json_response(['ok' => true]);
}

// ─────────────────────────────────────────────────────
// v929: 世の中の文献管理システムからの import
//   - Zotero API 直接連携 (最強)
//   - CSL-JSON ファイル (Zotero / Mendeley / Papers ネイティブ)
//   - EndNote XML (Mendeley / EndNote export)
// ─────────────────────────────────────────────────────

// _refs_insert_shared: 型別の一括 insert ヘルパ。
//   $items: [ {doi?, arxiv_id?, title, item_type, authors: [{name}], year, venue, abstract, url, tags: [], extra: {}} ]
function _refs_insert_batch(PDO $pdo, int $uid, array $items): array {
    $added = 0; $skipped = 0; $results = [];
    foreach ($items as $it) {
        $title = trim((string)($it['title'] ?? ''));
        if ($title === '') { $skipped++; $results[] = ['status' => 'skip', 'reason' => 'title なし']; continue; }
        $doi = $it['doi'] ?? '';
        if ($doi !== '') $doi = _refs_normalize_doi((string)$doi);
        if ($doi !== '' && !preg_match('#^10\.\d{4,9}/#', $doi)) $doi = '';
        $arxiv = null;
        if (!empty($it['arxiv_id'])) $arxiv = _refs_normalize_arxiv((string)$it['arxiv_id']);
        // 既存チェック
        if ($doi !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([$doi]);
            if ($ex = (int)$st->fetchColumn()) { $skipped++; $results[] = ['status'=>'dup','existing_id'=>$ex,'title'=>$title]; continue; }
        }
        if ($arxiv) {
            $st = $pdo->prepare("SELECT id FROM refs WHERE arxiv_id = ? LIMIT 1");
            $st->execute([$arxiv]);
            if ($ex = (int)$st->fetchColumn()) { $skipped++; $results[] = ['status'=>'dup','existing_id'=>$ex,'title'=>$title]; continue; }
        }
        $itemType = _refs_normalize_item_type((string)($it['item_type'] ?? 'article'));
        $authors  = [];
        foreach ((array)($it['authors'] ?? []) as $a) {
            if (is_string($a) && trim($a) !== '') $authors[] = ['name' => trim($a)];
            elseif (is_array($a) && !empty($a['name'])) $authors[] = ['name' => trim((string)$a['name'])];
        }
        $tags = [];
        foreach ((array)($it['tags'] ?? []) as $t) {
            $t = trim((string)$t); if ($t !== '') $tags[] = $t;
        }
        $extraJson = null;
        if (!empty($it['extra']) && is_array($it['extra'])) {
            $safe = _refs_extra_from_body(['extra' => $it['extra']]);
            $extraJson = $safe;
        }
        $url = trim((string)($it['url'] ?? ''));
        if ($url !== '' && !preg_match('#^https?://#', $url)) $url = '';
        $ins = $pdo->prepare("INSERT INTO refs
            (doi, arxiv_id, semantic_scholar_id, title, item_type, authors_json, year, venue, abstract,
             citation_count, reference_count, url, tags_json, extra_json, added_by_user_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $ins->execute([
            $doi ?: null, $arxiv ?: null,
            !empty($it['ss_id']) ? (string)$it['ss_id'] : null,
            mb_substr($title, 0, 1000), $itemType,
            json_encode($authors, JSON_UNESCAPED_UNICODE),
            !empty($it['year']) ? (int)$it['year'] : null,
            !empty($it['venue']) ? mb_substr((string)$it['venue'], 0, 500) : null,
            !empty($it['abstract']) ? (string)$it['abstract'] : null,
            isset($it['citation_count'])  ? (int)$it['citation_count']  : null,
            isset($it['reference_count']) ? (int)$it['reference_count'] : null,
            $url ?: null,
            $tags ? json_encode($tags, JSON_UNESCAPED_UNICODE) : null,
            $extraJson,
            $uid,
        ]);
        $refId = (int)$pdo->lastInsertId();
        $row = $pdo->query("SELECT * FROM refs WHERE id = $refId")->fetch(PDO::FETCH_ASSOC);
        $pdo->prepare("UPDATE refs SET bibtex = ? WHERE id = ?")->execute([_refs_generate_bibtex_v2($row), $refId]);
        $added++; $results[] = ['status' => 'added', 'id' => $refId, 'title' => $title];
    }
    return ['added' => $added, 'skipped' => $skipped, 'total' => count($items), 'results' => $results];
}

// Zotero API: users/USER_ID/items or groups/GROUP_ID/items。 API key 認証。
//   v930 対応: fetch_all=1 で全ページループ、 sync_pdfs=1 で各 item の PDF attachment も同期。
function refs_import_zotero(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $apiKey  = trim((string)($body['api_key'] ?? ''));
    $userId  = trim((string)($body['user_id'] ?? ''));
    $groupId = trim((string)($body['group_id'] ?? ''));
    $limit   = min(100, max(10, (int)($body['limit'] ?? 100)));  // Zotero 標準の 1 ページ上限は 100
    $fetchAll = !empty($body['fetch_all']);
    $syncPdfs = !empty($body['sync_pdfs']);
    $maxItems = min(5000, max(50, (int)($body['max_items'] ?? 2000)));  // safety cap
    if ($apiKey === '') throw new ApiException('bad_request', 'api_key 必要 (https://www.zotero.org/settings/keys で発行)', 400);
    if ($userId === '' && $groupId === '') throw new ApiException('bad_request', 'user_id か group_id が必要', 400);
    $base = $groupId !== '' ? "https://api.zotero.org/groups/{$groupId}/items"
                            : "https://api.zotero.org/users/{$userId}/items";

    $collectedItems = [];      // meta rows
    $itemKeyToIndex = [];      // Zotero key → collectedItems index (PDF sync 用)
    $start = 0;
    $totalReported = null;
    while (true) {
        $url = $base . '?limit=' . $limit . '&start=' . $start . '&format=json&include=csljson,data';
        [$httpCode, $rawBody, $headerBlob] = _refs_zotero_curl($url, $apiKey);
        if ($httpCode === 403) throw new ApiException('forbidden', 'Zotero API: 認証失敗 (api_key / user_id 確認)', 403);
        if ($httpCode !== 200 || !$rawBody) throw new ApiException('upstream_error', 'Zotero API HTTP ' . $httpCode, 502);
        $arr = json_decode((string)$rawBody, true);
        if (!is_array($arr)) throw new ApiException('upstream_error', 'Zotero レスポンス不正', 502);
        // Total-Results ヘッダ
        if ($totalReported === null && preg_match('/Total-Results:\s*(\d+)/i', $headerBlob, $m)) {
            $totalReported = (int)$m[1];
        }
        foreach ($arr as $entry) {
            $csl = $entry['csljson'] ?? null;
            $data = $entry['data'] ?? null;
            if (!$csl) continue;
            $type = (string)($csl['type'] ?? '');
            if (in_array($type, ['attachment', 'note'], true)) continue;
            $it = _refs_csljson_to_local($csl);
            if (is_array($data) && !empty($data['tags'])) {
                foreach ($data['tags'] as $t) $it['tags'][] = (string)($t['tag'] ?? '');
            }
            $key = is_array($data) ? (string)($data['key'] ?? '') : '';
            $collectedItems[] = $it;
            if ($key !== '') $itemKeyToIndex[$key] = count($collectedItems) - 1;
        }
        if (!$fetchAll) break;
        if (count($arr) < $limit) break;  // これが最後のページ
        if (count($collectedItems) >= $maxItems) break;
        $start += $limit;
    }

    // insert
    $res = _refs_insert_batch($pdo, $uid, $collectedItems);

    // v930 PDF attachment 同期 (fetch_all + sync_pdfs 有効時)
    $pdfSynced = 0; $pdfSkipped = 0; $pdfErrors = 0;
    if ($syncPdfs && !empty($res['results'])) {
        // added / dup 両方対象 (dup も「PDF 未添付」なら補完する価値あり)
        foreach ($res['results'] as $r) {
            if (!in_array($r['status'], ['added', 'dup'], true)) continue;
            $refId = $r['status'] === 'added' ? (int)$r['id'] : (int)$r['existing_id'];
            if (!$refId) continue;
            // どの Zotero item から来たか逆引き … はしていないので、 tag で拾う: title 一致で
            // itemKeyToIndex を使うのは insertBatch 内で順序が保たれる前提になるが、 dup も skip
            // されて index がずれる。そこで items 配列の index を使わず、 title で逆引きする。
            $title = (string)($r['title'] ?? '');
            if ($title === '') continue;
            // 対応 Zotero key を探す
            $matchedKey = null;
            foreach ($itemKeyToIndex as $k => $i) {
                if (($collectedItems[$i]['title'] ?? '') === $title) { $matchedKey = $k; break; }
            }
            if (!$matchedKey) { $pdfSkipped++; continue; }
            // 既に refs.pdf_path があるなら skip
            $stChk = $pdo->prepare("SELECT pdf_path FROM refs WHERE id = ?");
            $stChk->execute([$refId]);
            $existingPdf = (string)$stChk->fetchColumn();
            if ($existingPdf !== '') { $pdfSkipped++; continue; }
            // Zotero children (attachments) 取得
            $childrenUrl = $base . '/' . $matchedKey . '/children?format=json';
            [$ccode, $cbody] = _refs_zotero_curl($childrenUrl, $apiKey);
            if ($ccode !== 200 || !$cbody) { $pdfErrors++; continue; }
            $children = json_decode((string)$cbody, true);
            if (!is_array($children)) { $pdfErrors++; continue; }
            // PDF attachment を探す (contentType application/pdf)
            $attKey = null;
            foreach ($children as $child) {
                $d = $child['data'] ?? [];
                if (($d['itemType'] ?? '') === 'attachment' &&
                    ($d['contentType'] ?? '') === 'application/pdf') {
                    $attKey = (string)($d['key'] ?? ''); break;
                }
            }
            if (!$attKey) { $pdfSkipped++; continue; }
            // PDF file download
            $fileUrl = ($groupId !== ''
                ? "https://api.zotero.org/groups/{$groupId}/items/{$attKey}/file"
                : "https://api.zotero.org/users/{$userId}/items/{$attKey}/file");
            [$fcode, $fbody] = _refs_zotero_curl_binary($fileUrl, $apiKey);
            if ($fcode !== 200 || !$fbody) { $pdfErrors++; continue; }
            // 保存
            $sha = hash('sha256', $fbody);
            $rel = '/uploads/refs/' . substr($sha, 0, 2) . '/' . $sha . '.pdf';
            $abs = '/var/www/labpay/public' . $rel;
            @mkdir(dirname($abs), 0775, true);
            if (file_put_contents($abs, $fbody) === false) { $pdfErrors++; continue; }
            @chmod($abs, 0644);
            // fulltext 抽出
            $ft = _refs_extract_pdf_fulltext($abs);
            $pdo->prepare("UPDATE refs SET pdf_path = ?, pdf_sha256 = ?, `fulltext` = ? WHERE id = ?")
                ->execute([$rel, $sha, $ft, $refId]);
            $pdfSynced++;
        }
    }
    $res['fetched_pages'] = $fetchAll ? ceil(count($collectedItems) / $limit) : 1;
    $res['zotero_total'] = $totalReported;
    $res['pdf_synced'] = $pdfSynced;
    $res['pdf_skipped'] = $pdfSkipped;
    $res['pdf_errors'] = $pdfErrors;
    json_response($res);
}

// Zotero API 用の curl ヘルパ (header と body を分離)。
function _refs_zotero_curl(string $url, string $apiKey): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HEADER => true,
        CURLOPT_HTTPHEADER => [
            'Zotero-API-Key: ' . $apiKey,
            'Zotero-API-Version: 3',
        ],
        CURLOPT_USERAGENT => 'LabPay/1.0',
    ]);
    $full = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if ($full === false) return [0, '', ''];
    $headerBlob = substr((string)$full, 0, $headerSize);
    $body = substr((string)$full, $headerSize);
    return [(int)$code, $body, $headerBlob];
}

// Zotero PDF ダウンロード用 (binary、 header 分離不要)。
function _refs_zotero_curl_binary(string $url, string $apiKey): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => [
            'Zotero-API-Key: ' . $apiKey,
            'Zotero-API-Version: 3',
        ],
        CURLOPT_USERAGENT => 'LabPay/1.0',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [(int)$code, $body === false ? '' : (string)$body];
}

// ─────────────────────────────────────────────────────
// v930: 参考文献リスト生成 (bibliography、複数 ref を CSL style で一括)
// ─────────────────────────────────────────────────────

function refs_bibliography(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $style = strtolower((string)($body['style'] ?? 'apa'));
    $ids = [];
    if (!empty($body['ref_ids']) && is_array($body['ref_ids'])) {
        foreach ($body['ref_ids'] as $x) if (ctype_digit((string)$x)) $ids[] = (int)$x;
    } elseif (!empty($body['collection_id'])) {
        // collection 全 refs を拾う
        $cid = (int)$body['collection_id'];
        $st = $pdo->prepare("SELECT ci.ref_id FROM ref_collection_items ci
                              JOIN refs r ON r.id = ci.ref_id
                             WHERE ci.collection_id = ? AND r.deleted_at IS NULL
                          ORDER BY r.year DESC, r.id DESC");
        $st->execute([$cid]);
        foreach ($st as $row) $ids[] = (int)$row['ref_id'];
    } elseif (!empty($body['tag'])) {
        $tag = trim((string)$body['tag']);
        $st = $pdo->prepare("SELECT id FROM refs WHERE deleted_at IS NULL AND tags_json LIKE ?
                              ORDER BY year DESC, id DESC");
        $st->execute(['%"' . str_replace('"', '', $tag) . '"%']);
        foreach ($st as $row) $ids[] = (int)$row['id'];
    }
    if (!$ids) throw new ApiException('bad_request', 'ref_ids か collection_id か tag が必要', 400);
    if (count($ids) > 500) $ids = array_slice($ids, 0, 500);
    $place = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT * FROM refs WHERE id IN ($place)");
    $st->execute($ids);
    // 元の順序を維持
    $rowsById = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $rowsById[(int)$r['id']] = $r;
    $lines = [];
    $num = 1;
    foreach ($ids as $id) {
        if (!isset($rowsById[$id])) continue;
        $r = $rowsById[$id];
        $authors = $r['authors_json'] ? (json_decode((string)$r['authors_json'], true) ?: []) : [];
        $lines[] = match ($style) {
            'mla'      => _refs_citation_mla($r, $authors),
            'chicago'  => _refs_citation_chicago($r, $authors),
            'ieee'     => _refs_citation_ieee($r, $authors, $num),
            'nature'   => _refs_citation_nature($r, $authors, $num),
            'science'  => _refs_citation_science($r, $authors, $num),
            'acm'      => _refs_citation_acm($r, $authors, $num),
            default    => _refs_citation_apa($r, $authors),
        };
        $num++;
    }
    json_response(['style' => $style, 'count' => count($lines), 'bibliography' => implode("\n\n", $lines)]);
}

// v930 追加 CSL styles

// Nature 系: 番号参照、 authors comma、太字 vol。
function _refs_citation_nature(array $r, array $authors, int $num): string {
    $names = array_map(fn($a) => (string)($a['name'] ?? ''), $authors);
    // Nature: 「Surname, F. M.」スタイル
    $names = array_map(function ($n) {
        $parts = explode(' ', $n);
        $family = array_pop($parts);
        $initials = implode(' ', array_map(fn($p) => mb_substr($p, 0, 1) . '.', $parts));
        return trim($family . ', ' . $initials);
    }, $names);
    $auth = count($names) > 5 ? $names[0] . ' et al.' : implode(', ', $names);
    $title = rtrim((string)$r['title'], '.');
    $venue = $r['venue'] ? ' *' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $vol = $ex['volume'] ?? '';
    $pages = $ex['pages'] ?? '';
    $year = !empty($r['year']) ? '(' . (int)$r['year'] . ')' : '';
    $tail = ($vol ? ' **' . $vol . '**' : '') . ($pages ? ', ' . $pages : '') . ' ' . $year;
    return "$num. $auth $title.$venue$tail.";
}

// Science 系: 番号参照、 vol., pp., year
function _refs_citation_science(array $r, array $authors, int $num): string {
    $names = array_map(function ($a) {
        $n = (string)($a['name'] ?? '');
        $parts = explode(' ', $n);
        $family = array_pop($parts);
        $initials = implode('. ', array_map(fn($p) => mb_substr($p, 0, 1), $parts));
        return trim($initials . '. ' . $family);
    }, $authors);
    $auth = count($names) > 5 ? $names[0] . ' et al.' : implode(', ', $names);
    $title = '"' . rtrim((string)$r['title'], '.') . '"';
    $venue = $r['venue'] ? ' *' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $vol = $ex['volume'] ?? '';
    $pages = $ex['pages'] ?? '';
    $year = !empty($r['year']) ? ' (' . (int)$r['year'] . ')' : '';
    $tail = ($vol ? ' **' . $vol . '**' : '') . ($pages ? ', ' . $pages : '') . $year;
    return "$num. $auth, $title$venue$tail.";
}

// ─────────────────────────────────────────────────────
// v931: Semantic Scholar 連携
//   https://api.semanticscholar.org/graph/v1
//   認証不要 (key 有ればレート上限 up)、 5000 req / 5 min。
// ─────────────────────────────────────────────────────

// 汎用 GET 呼び出し (key 有れば x-api-key ヘッダ付ける)。
function _refs_ss_get(string $url, array $cfg): array {
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    $key = (string)($cfg['semantic_scholar']['api_key'] ?? '');
    if ($key !== '') $headers[] = 'x-api-key: ' . $key;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'LabPay/1.0 (labpay@nkmr.io)',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [(int)$code, is_string($body) ? $body : ''];
}

function _refs_ss_post(string $url, array $payload, array $cfg): array {
    $ch = curl_init($url);
    $headers = ['Accept: application/json', 'Content-Type: application/json'];
    $key = (string)($cfg['semantic_scholar']['api_key'] ?? '');
    if ($key !== '') $headers[] = 'x-api-key: ' . $key;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'LabPay/1.0 (labpay@nkmr.io)',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [(int)$code, is_string($body) ? $body : ''];
}

// SS の paper node を local な meta shape に変換。
function _refs_ss_paper_to_meta(array $p): array {
    $authors = [];
    foreach ((array)($p['authors'] ?? []) as $a) {
        if (!empty($a['name'])) $authors[] = ['name' => (string)$a['name']];
    }
    $ext = (array)($p['externalIds'] ?? []);
    $doi = (string)($ext['DOI'] ?? '');
    $arx = (string)($ext['ArXiv'] ?? '');
    $venue = (string)($p['venue'] ?? '');
    return [
        'ss_id'          => (string)($p['paperId'] ?? ''),
        'title'          => (string)($p['title'] ?? ''),
        'authors'        => $authors,
        'year'           => isset($p['year']) ? (int)$p['year'] : null,
        'venue'          => $venue,
        'abstract'       => (string)($p['abstract'] ?? ''),
        'doi'            => $doi,
        'arxiv_id'       => $arx,
        'url'            => (string)($p['url'] ?? ($doi ? 'https://doi.org/' . $doi : '')),
        'citation_count' => isset($p['citationCount']) ? (int)$p['citationCount'] : null,
        'reference_count'=> isset($p['referenceCount']) ? (int)$p['referenceCount'] : null,
        'is_open_access' => (bool)($p['isOpenAccess'] ?? false),
    ];
}

// Semantic Scholar 検索 (キーワード + 任意年 / venue フィルタ)。
function refs_ss_search(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $q = trim((string)($body['query'] ?? ''));
    if ($q === '') throw new ApiException('bad_request', 'query 必要', 400);
    if (mb_strlen($q) > 200) $q = mb_substr($q, 0, 200);
    $limit = min(50, max(5, (int)($body['limit'] ?? 20)));
    $year = (int)($body['year'] ?? 0);
    $venue = trim((string)($body['venue'] ?? ''));
    $fields = 'paperId,title,authors,year,venue,abstract,externalIds,citationCount,referenceCount,isOpenAccess,url';
    $url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=' . urlencode($q)
         . '&limit=' . $limit . '&fields=' . urlencode($fields);
    if ($year > 0) $url .= '&year=' . $year;
    if ($venue !== '') $url .= '&venue=' . urlencode($venue);
    [$code, $rawBody] = _refs_ss_get($url, $cfg);
    if ($code === 429) throw new ApiException('rate_limited', 'Semantic Scholar rate limit — 少し待ってから再試行', 429);
    if ($code !== 200) throw new ApiException('upstream_error', 'Semantic Scholar HTTP ' . $code, 502);
    $j = json_decode((string)$rawBody, true);
    if (!is_array($j)) throw new ApiException('upstream_error', 'SS レスポンス不正', 502);
    $items = [];
    $seen = [];
    foreach ((array)($j['data'] ?? []) as $p) {
        $m = _refs_ss_paper_to_meta((array)$p);
        // 既存 refs にあるかチェック (DOI / arXiv / ss_id で)
        $existingId = null;
        if ($m['doi'] !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE doi = ? LIMIT 1");
            $st->execute([_refs_normalize_doi($m['doi'])]);
            $existingId = (int)$st->fetchColumn() ?: null;
        }
        if (!$existingId && $m['arxiv_id'] !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE arxiv_id = ? LIMIT 1");
            $st->execute([$m['arxiv_id']]);
            $existingId = (int)$st->fetchColumn() ?: null;
        }
        if (!$existingId && $m['ss_id'] !== '') {
            $st = $pdo->prepare("SELECT id FROM refs WHERE semantic_scholar_id = ? LIMIT 1");
            $st->execute([$m['ss_id']]);
            $existingId = (int)$st->fetchColumn() ?: null;
        }
        $m['existing_ref_id'] = $existingId;
        $items[] = $m;
    }
    json_response([
        'items' => $items,
        'total' => (int)($j['total'] ?? count($items)),
    ]);
}

// References (この論文が引用している論文一覧)
function refs_ss_references(PDO $pdo, array $cfg, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT doi, arxiv_id, semantic_scholar_id, title FROM refs WHERE id = ?");
    $st->execute([$refId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $ssRef = _refs_ss_paper_id_from_ref($r);
    if (!$ssRef) throw new ApiException('bad_request', 'DOI / arXiv / ss_id がないと Semantic Scholar 検索できません', 400);
    $fields = 'paperId,title,authors,year,venue,externalIds,citationCount,url';
    $url = 'https://api.semanticscholar.org/graph/v1/paper/' . rawurlencode($ssRef) . '/references?limit=100&fields=' . urlencode($fields);
    [$code, $rawBody] = _refs_ss_get($url, $cfg);
    if ($code === 429) throw new ApiException('rate_limited', 'SS rate limit', 429);
    if ($code === 404) throw new ApiException('not_found', 'この論文は Semantic Scholar に見つかりません', 404);
    if ($code !== 200) throw new ApiException('upstream_error', 'SS HTTP ' . $code, 502);
    $j = json_decode((string)$rawBody, true);
    $items = [];
    foreach ((array)($j['data'] ?? []) as $ent) {
        $cited = $ent['citedPaper'] ?? null;
        if (!$cited) continue;
        $m = _refs_ss_paper_to_meta((array)$cited);
        $m['existing_ref_id'] = _refs_ss_find_existing($pdo, $m);
        $items[] = $m;
    }
    json_response(['items' => $items]);
}

// Citations (この論文を引用している論文一覧)
function refs_ss_citations(PDO $pdo, array $cfg, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT doi, arxiv_id, semantic_scholar_id, title FROM refs WHERE id = ?");
    $st->execute([$refId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $ssRef = _refs_ss_paper_id_from_ref($r);
    if (!$ssRef) throw new ApiException('bad_request', 'DOI / arXiv / ss_id がないと検索できません', 400);
    $fields = 'paperId,title,authors,year,venue,externalIds,citationCount,url';
    $url = 'https://api.semanticscholar.org/graph/v1/paper/' . rawurlencode($ssRef) . '/citations?limit=100&fields=' . urlencode($fields);
    [$code, $rawBody] = _refs_ss_get($url, $cfg);
    if ($code === 429) throw new ApiException('rate_limited', 'SS rate limit', 429);
    if ($code === 404) throw new ApiException('not_found', 'この論文は SS に見つかりません', 404);
    if ($code !== 200) throw new ApiException('upstream_error', 'SS HTTP ' . $code, 502);
    $j = json_decode((string)$rawBody, true);
    $items = [];
    foreach ((array)($j['data'] ?? []) as $ent) {
        $citing = $ent['citingPaper'] ?? null;
        if (!$citing) continue;
        $m = _refs_ss_paper_to_meta((array)$citing);
        $m['existing_ref_id'] = _refs_ss_find_existing($pdo, $m);
        $items[] = $m;
    }
    json_response(['items' => $items]);
}

// ref から SS paper ID を生成するヘルパ (ss_id / DOI / arXiv の順で)。
function _refs_ss_paper_id_from_ref(array $r): ?string {
    if (!empty($r['semantic_scholar_id'])) return (string)$r['semantic_scholar_id'];
    if (!empty($r['doi']))                 return 'DOI:' . (string)$r['doi'];
    if (!empty($r['arxiv_id']))            return 'ARXIV:' . (string)$r['arxiv_id'];
    return null;
}

function _refs_ss_find_existing(PDO $pdo, array $m): ?int {
    if (!empty($m['doi'])) {
        $st = $pdo->prepare("SELECT id FROM refs WHERE doi = ? LIMIT 1");
        $st->execute([_refs_normalize_doi($m['doi'])]);
        $id = (int)$st->fetchColumn();
        if ($id) return $id;
    }
    if (!empty($m['arxiv_id'])) {
        $st = $pdo->prepare("SELECT id FROM refs WHERE arxiv_id = ? LIMIT 1");
        $st->execute([$m['arxiv_id']]);
        $id = (int)$st->fetchColumn();
        if ($id) return $id;
    }
    if (!empty($m['ss_id'])) {
        $st = $pdo->prepare("SELECT id FROM refs WHERE semantic_scholar_id = ? LIMIT 1");
        $st->execute([$m['ss_id']]);
        $id = (int)$st->fetchColumn();
        if ($id) return $id;
    }
    return null;
}

// Recommend: 与えられた ref_ids 相当の論文に「似た」論文を SS がおすすめ。
function refs_ss_recommend(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $refIds = [];
    foreach ((array)($body['ref_ids'] ?? []) as $x) if (ctype_digit((string)$x)) $refIds[] = (int)$x;
    if (!$refIds) throw new ApiException('bad_request', 'ref_ids 必要', 400);
    if (count($refIds) > 100) $refIds = array_slice($refIds, 0, 100);
    $place = implode(',', array_fill(0, count($refIds), '?'));
    $st = $pdo->prepare("SELECT doi, arxiv_id, semantic_scholar_id FROM refs WHERE id IN ($place)");
    $st->execute($refIds);
    $positives = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $pid = _refs_ss_paper_id_from_ref($r);
        if ($pid) $positives[] = $pid;
    }
    if (!$positives) throw new ApiException('bad_request', '選んだ refs に DOI / arXiv / ss_id が 1 つもなくて SS で引けません', 400);
    $limit = min(50, max(5, (int)($body['limit'] ?? 20)));
    $fields = 'paperId,title,authors,year,venue,abstract,externalIds,citationCount,url';
    $url = 'https://api.semanticscholar.org/recommendations/v1/papers?limit=' . $limit . '&fields=' . urlencode($fields);
    [$code, $rawBody] = _refs_ss_post($url, ['positivePaperIds' => $positives], $cfg);
    if ($code === 429) throw new ApiException('rate_limited', 'SS rate limit', 429);
    if ($code !== 200) throw new ApiException('upstream_error', 'SS HTTP ' . $code, 502);
    $j = json_decode((string)$rawBody, true);
    $items = [];
    foreach ((array)($j['recommendedPapers'] ?? []) as $p) {
        $m = _refs_ss_paper_to_meta((array)$p);
        $m['existing_ref_id'] = _refs_ss_find_existing($pdo, $m);
        $items[] = $m;
    }
    json_response(['items' => $items]);
}

// Enrich: 既存 ref に citation_count / reference_count / semantic_scholar_id を SS から取って埋める。
function refs_ss_enrich(PDO $pdo, array $cfg, int $refId): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT doi, arxiv_id, semantic_scholar_id FROM refs WHERE id = ?");
    $st->execute([$refId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    $pid = _refs_ss_paper_id_from_ref($r);
    if (!$pid) throw new ApiException('bad_request', 'DOI / arXiv / ss_id が必要', 400);
    $fields = 'paperId,citationCount,referenceCount';
    $url = 'https://api.semanticscholar.org/graph/v1/paper/' . rawurlencode($pid) . '?fields=' . urlencode($fields);
    [$code, $rawBody] = _refs_ss_get($url, $cfg);
    if ($code === 429) throw new ApiException('rate_limited', 'SS rate limit', 429);
    if ($code === 404) throw new ApiException('not_found', '未発見', 404);
    if ($code !== 200) throw new ApiException('upstream_error', 'SS HTTP ' . $code, 502);
    $j = json_decode((string)$rawBody, true);
    if (!is_array($j)) throw new ApiException('upstream_error', 'SS レスポンス不正', 502);
    $ssId = (string)($j['paperId'] ?? '');
    $cnt  = isset($j['citationCount'])  ? (int)$j['citationCount']  : null;
    $rcnt = isset($j['referenceCount']) ? (int)$j['referenceCount'] : null;
    $pdo->prepare("UPDATE refs SET semantic_scholar_id = COALESCE(?, semantic_scholar_id),
                                    citation_count = ?, reference_count = ? WHERE id = ?")
        ->execute([$ssId ?: null, $cnt, $rcnt, $refId]);
    json_response(['ok' => true, 'citation_count' => $cnt, 'reference_count' => $rcnt, 'semantic_scholar_id' => $ssId]);
}

// ACM SIG 系: 番号参照、会議論文向け、 Author. Year. Title. In Venue.
function _refs_citation_acm(array $r, array $authors, int $num): string {
    $names = array_map(fn($a) => (string)($a['name'] ?? ''), $authors);
    if (count($names) === 1) $auth = $names[0];
    elseif (count($names) <= 3) $auth = implode(', ', array_slice($names, 0, -1)) . ', and ' . end($names);
    else $auth = $names[0] . ' et al.';
    $year = !empty($r['year']) ? (int)$r['year'] : 'n.d.';
    $title = rtrim((string)$r['title'], '.');
    $venue = $r['venue'] ? ' In *' . $r['venue'] . '*' : '';
    $ex = !empty($r['extra_json']) ? (json_decode((string)$r['extra_json'], true) ?: []) : [];
    $pages = !empty($ex['pages']) ? ', ' . $ex['pages'] : '';
    $doi = !empty($r['doi']) ? '. https://doi.org/' . $r['doi'] : '';
    return "[$num] $auth. $year. $title.$venue$pages.$doi";
}

// CSL-JSON: Zotero / Mendeley / Papers の共通 export 形式。
function _refs_csljson_to_local(array $csl): array {
    $authors = [];
    foreach ((array)($csl['author'] ?? []) as $a) {
        if (is_array($a)) {
            $name = trim(((string)($a['given'] ?? '')) . ' ' . ((string)($a['family'] ?? '')));
            if ($name === '' && !empty($a['literal'])) $name = (string)$a['literal'];
            if ($name !== '') $authors[] = ['name' => $name];
        }
    }
    $year = null;
    if (isset($csl['issued']['date-parts'][0][0])) $year = (int)$csl['issued']['date-parts'][0][0];
    $extra = [];
    foreach (['ISBN'=>'isbn','ISSN'=>'issn','publisher'=>'publisher','edition'=>'edition',
              'page'=>'pages','volume'=>'volume','issue'=>'issue','collection-title'=>'series',
              'publisher-place'=>'address'] as $ck => $lk) {
        if (!empty($csl[$ck])) $extra[$lk] = (string)$csl[$ck];
    }
    $tags = [];
    // CSL: keyword は space or comma 区切り文字列
    if (!empty($csl['keyword'])) {
        foreach (preg_split('/[;,]/', (string)$csl['keyword']) as $t) {
            $t = trim($t); if ($t !== '') $tags[] = $t;
        }
    }
    return [
        'doi'       => $csl['DOI'] ?? '',
        'title'     => (string)($csl['title'] ?? ''),
        'item_type' => (string)($csl['type'] ?? 'article'),
        'authors'   => $authors,
        'year'      => $year,
        'venue'     => (string)($csl['container-title'] ?? $csl['event'] ?? ''),
        'abstract'  => (string)($csl['abstract'] ?? ''),
        'url'       => (string)($csl['URL'] ?? ''),
        'tags'      => $tags,
        'extra'     => $extra,
    ];
}

function refs_import_csljson(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $content = '';
    if (isset($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $content = (string)file_get_contents($_FILES['file']['tmp_name']);
    } else {
        $body = read_json_body();
        $content = (string)($body['csljson'] ?? '');
    }
    if ($content === '') throw new ApiException('bad_request', 'file か csljson 本文が必要', 400);
    if (strlen($content) > 10 * 1024 * 1024) throw new ApiException('bad_request', '10MB まで', 400);
    $arr = json_decode($content, true);
    if (!is_array($arr)) throw new ApiException('bad_request', 'CSL-JSON パース失敗', 400);
    // 単体 object か配列か両方対応
    if (isset($arr['title']) || isset($arr['author'])) $arr = [$arr];
    $items = [];
    foreach ($arr as $csl) {
        if (!is_array($csl)) continue;
        $items[] = _refs_csljson_to_local($csl);
    }
    if (!$items) throw new ApiException('bad_request', 'エントリが 0 件', 400);
    $res = _refs_insert_batch($pdo, (int)$u['id'], $items);
    json_response($res);
}

// EndNote XML: Mendeley / EndNote export の標準 XML。
function refs_import_endnote(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $content = '';
    if (isset($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $content = (string)file_get_contents($_FILES['file']['tmp_name']);
    } else {
        $body = read_json_body();
        $content = (string)($body['xml'] ?? '');
    }
    if ($content === '') throw new ApiException('bad_request', 'file か xml 本文が必要', 400);
    if (strlen($content) > 20 * 1024 * 1024) throw new ApiException('bad_request', '20MB まで', 400);
    libxml_use_internal_errors(true);
    $xml = @simplexml_load_string($content);
    if (!$xml) throw new ApiException('bad_request', 'XML パース失敗', 400);
    // 標準 EndNote XML の構造: <xml><records><record>...</record></records></xml>
    $records = $xml->xpath('//record');
    if (!$records) $records = $xml->xpath('//records/record');
    if (!$records) throw new ApiException('bad_request', 'record 要素なし', 400);
    $items = [];
    foreach ($records as $rec) {
        $title = trim((string)($rec->titles->title ?? ''));
        if ($title === '') continue;
        $authors = [];
        foreach ($rec->contributors->authors->author ?? [] as $a) {
            $n = trim((string)$a);
            if ($n !== '') $authors[] = $n;
        }
        $year = (int)($rec->dates->year ?? 0) ?: null;
        $venue = trim((string)($rec->{'secondary-title'} ?? $rec->titles->{'secondary-title'} ?? ''));
        $abstract = trim((string)($rec->abstract ?? ''));
        $doi = trim((string)($rec->{'electronic-resource-num'} ?? ''));
        $url = trim((string)($rec->{'urls'}->{'related-urls'}->url ?? ''));
        $extra = [];
        foreach (['isbn'=>'isbn','pages'=>'pages','volume'=>'volume','number'=>'issue','publisher'=>'publisher'] as $xk => $lk) {
            $v = trim((string)$rec->{$xk});
            if ($v !== '') $extra[$lk] = $v;
        }
        // EndNote type 番号 → item_type ざっくり
        $typeNum = (int)($rec['ref-type'] ?? 0);
        $typeMap = [17 => 'article', 6 => 'book', 5 => 'book_chapter', 32 => 'thesis',
                    10 => 'conference', 25 => 'patent', 12 => 'web'];
        $itemType = $typeMap[$typeNum] ?? 'article';
        $items[] = [
            'title' => $title, 'authors' => $authors, 'year' => $year, 'venue' => $venue,
            'abstract' => $abstract, 'doi' => $doi, 'url' => $url, 'tags' => [],
            'item_type' => $itemType, 'extra' => $extra,
        ];
    }
    if (!$items) throw new ApiException('bad_request', 'エントリが 0 件', 400);
    $res = _refs_insert_batch($pdo, (int)$u['id'], $items);
    json_response($res);
}


