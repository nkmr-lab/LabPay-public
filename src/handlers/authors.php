<?php
// v1004 著者ページ /api/authors/{name}
//   name (URL-encoded) と 照合 して 論文要約 (paper_translates) と 論文全訳
//   (paper_full_translations) を 横断 検索、 その 著者 が 関わる 論文 を 一覧 で 返す。
//
//   名前 の 表記揺れ 対応 (中村さん指摘):
//     - 完全一致 (normalize 後)
//     - Last, First / First Last の 順序 揺れ
//     - "F. Last" / "First Last" の 短縮 揺れ (last 一致 + first 頭文字 一致)
//     - 姓名 / 苗字 名前 の 空白 / 全角半角 / ケース 揺れ
//
//   共有: is_shared=1 または 自分 が author の 論文 のみ 返す (要約 view と同じ 権限)。

declare(strict_types=1);

function route_authors(PDO $pdo, array $cfg, string $method, array $seg): void {
    // GET /api/authors/photos?names=a,b,c → 顔画像 の bulk lookup (v1006)
    if (($seg[1] ?? '') === 'photos' && $method === 'GET') {
        authors_photos_bulk($pdo, $cfg);
        return;
    }
    if (($seg[1] ?? '') === '') {
        throw new ApiException('not_found', 'authors requires name', 404);
    }
    $name = rawurldecode((string)$seg[1]);

    // v1006 GET /api/authors/{name}/photo は 従来通り photo_url を含む 情報返却
    // POST /api/authors/{name}/photo → 手動 アップロード
    // DELETE /api/authors/{name}/photo → 削除
    if (($seg[2] ?? '') === 'photo') {
        if ($method === 'POST')   { authors_photo_upload($pdo, $cfg, $name); return; }
        if ($method === 'DELETE') { authors_photo_delete($pdo, $cfg, $name); return; }
        throw new ApiException('method_not_allowed', 'use POST or DELETE for /photo', 405);
    }

    if ($method !== 'GET') throw new ApiException('method_not_allowed', 'author routes are GET', 405);
    authors_get($pdo, $cfg, $name);
}

function authors_get(PDO $pdo, array $cfg, string $name): void {
    $me = Auth::requireUser($pdo, $cfg);
    $uid = (int)$me['id'];
    $target = $name;
    $variants = authors_expand_name_variants($target);

    // 検索 は result_json に 対する LIKE で。 candidate rows を 取って PHP 側 で
    // 名前 変異 マッチ を 精査 する。
    // LIKE の 種 は 「target の 最も 短い 姓」 or 「full name」 を 使って 過剰 に 絞らない。
    $searchTokens = authors_search_tokens($target);
    if (!$searchTokens) {
        json_response(['name' => $target, 'name_variants' => [], 'affiliations' => [],
                       'emails' => [], 'papers' => []]);
        return;
    }
    $likeParts = [];
    $args = [];
    foreach ($searchTokens as $tok) {
        $likeParts[] = "result_json LIKE ?";
        $args[] = '%' . $tok . '%';
    }
    $likeSql = '(' . implode(' OR ', $likeParts) . ')';

    // 要約
    $sqlA = "SELECT id, share_token, user_id, pdf_name, result_json, is_shared, created_at, finished_at
               FROM paper_translates
              WHERE status='done' AND $likeSql AND (is_shared=1 OR user_id = ?)
              ORDER BY id DESC LIMIT 200";
    $stA = $pdo->prepare($sqlA);
    $stA->execute(array_merge($args, [$uid]));
    // 全訳
    $sqlB = "SELECT id, share_token, user_id, pdf_name, result_json, is_shared, created_at, finished_at
               FROM paper_full_translations
              WHERE status='done' AND $likeSql AND (is_shared=1 OR user_id = ?)
              ORDER BY id DESC LIMIT 200";
    $stB = $pdo->prepare($sqlB);
    $stB->execute(array_merge($args, [$uid]));

    $variantsSet = []; foreach ($variants as $v) $variantsSet[$v] = true;
    $affiliations = []; $emails = []; $papers = []; $seenSt = [];
    foreach ([['summary', $stA], ['translate', $stB]] as [$kind, $st]) {
        foreach ($st as $r) {
            $j = json_decode((string)$r['result_json'], true);
            if (!is_array($j)) continue;
            $authorsStr = (string)($j['authors'] ?? '');
            $matched = authors_string_matches($authorsStr, $variantsSet);
            if (!$matched) continue;
            $tok = (string)$r['share_token'];
            if (isset($seenSt[$kind . ':' . $tok])) continue;
            $seenSt[$kind . ':' . $tok] = true;
            // affiliations / emails は Front matter chapter から 取れる 可能性
            $auInfo = authors_lookup_in_chapters($j, $matched);
            if ($auInfo['affiliation']) $affiliations[] = $auInfo['affiliation'];
            if ($auInfo['email'])       $emails[]      = $auInfo['email'];
            $papers[] = [
                'kind'         => $kind,
                'share_token'  => $tok,
                'title'        => $kind === 'summary' ? ($j['title_ja'] ?? $r['pdf_name'])
                                                     : ($j['title_translated'] ?? $j['title_original'] ?? $r['pdf_name']),
                'title_orig'   => $j['title_orig'] ?? $j['title_original'] ?? null,
                'venue'        => $j['venue'] ?? null,
                'date'         => (string)($r['finished_at'] ?: $r['created_at']),
                'matched_name' => $matched,
            ];
        }
    }
    $papers = array_values(array_slice(
        array_reverse(usort_by_date($papers)),
        0, 100
    ));
    $photo = authors_photo_lookup($pdo, $target);   // v1006 手動 アップロード 済 なら 返す
    json_response([
        'name'          => $target,
        'name_variants' => array_values(array_unique(array_map(fn($p) => $p['matched_name'], $papers))),
        'affiliations'  => array_values(array_unique($affiliations)),
        'emails'        => array_values(array_unique($emails)),
        'photo_url'     => $photo,
        'papers'        => $papers,
    ]);
}

// v1006 name_key: 表記揺れを 1 つに 畳む key。 name_variants で 生成する variant
//   のうち 「first last」 or 「last, first」 の 短縮 前 を 選ぶ (=  最も 正規化 の 種
//   に なる form)。 保存 / lookup で 同じ 関数 を 使う。
function authors_photo_name_key(string $name): string {
    return authors_normalize_name($name);
}

function authors_photo_lookup(PDO $pdo, string $name): ?string {
    $key = authors_photo_name_key($name);
    if ($key === '') return null;
    $st = $pdo->prepare("SELECT photo_path FROM author_photos WHERE name_key = ? LIMIT 1");
    $st->execute([$key]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row && $row['photo_path'] ? (string)$row['photo_path'] : null;
}

// v1006 GET /api/authors/photos?names=a,b,c → { photos: {name: url|null, ...} }
function authors_photos_bulk(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $raw = (string)($_GET['names'] ?? '');
    if ($raw === '') { json_response(['photos' => new stdClass()]); return; }
    $names = array_values(array_filter(array_map('trim', explode(',', $raw)), fn($s) => $s !== ''));
    if (!$names) { json_response(['photos' => new stdClass()]); return; }
    // 200 上限 で 保護
    $names = array_slice($names, 0, 200);
    $keys = array_map('authors_photo_name_key', $names);
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $st = $pdo->prepare("SELECT name_key, photo_path FROM author_photos WHERE name_key IN ($placeholders) AND photo_path IS NOT NULL");
    $st->execute($keys);
    $byKey = [];
    foreach ($st as $row) $byKey[(string)$row['name_key']] = (string)$row['photo_path'];
    $out = [];
    foreach ($names as $i => $n) {
        $k = $keys[$i];
        $out[$n] = $byKey[$k] ?? null;
    }
    json_response(['photos' => $out]);
}

// v1006 POST /api/authors/{name}/photo (multipart form: image=...)
//   認証必須。 誰でも 更新可 (LabPay 内部 SNS の 精神)、 uploaded_by_user_id を残す。
function authors_photo_upload(PDO $pdo, array $cfg, string $name): void {
    $me = Auth::requireUser($pdo, $cfg);
    $uid = (int)$me['id'];
    $key = authors_photo_name_key($name);
    if ($key === '') throw new ApiException('bad_request', 'name is empty', 400);
    if (!isset($_FILES['image']) || ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new ApiException('bad_request', 'image ファイル が 添付 されていません', 400);
    }
    $tmp  = $_FILES['image']['tmp_name'];
    $size = (int)($_FILES['image']['size'] ?? 0);
    if ($size <= 0 || $size > 5 * 1024 * 1024) {
        throw new ApiException('bad_request', 'ファイルサイズは 5MB まで', 400);
    }
    $info = @getimagesize($tmp);
    if (!$info || !in_array($info['mime'] ?? '', ['image/jpeg', 'image/png', 'image/webp'], true)) {
        throw new ApiException('bad_request', 'JPEG / PNG / WebP のみ 受け付けます', 400);
    }
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime']];

    // 保存先 (無ければ 作る)。 sha1(name_key + rand) で ハッシュ ファイル名。
    $dir = realpath(__DIR__ . '/../../public');
    if ($dir === false) throw new RuntimeException('public dir not found');
    $subdir = $dir . '/uploads/author_photos';
    if (!is_dir($subdir)) {
        if (!@mkdir($subdir, 0755, true) && !is_dir($subdir)) {
            throw new RuntimeException('failed to mkdir ' . $subdir);
        }
    }
    $hash = substr(sha1($key . '|' . bin2hex(random_bytes(6))), 0, 20);
    $fname = $hash . '.' . $ext;
    $dest = $subdir . '/' . $fname;
    if (!@move_uploaded_file($tmp, $dest)) {
        throw new RuntimeException('failed to save uploaded image');
    }
    @chmod($dest, 0644);
    $publicPath = '/uploads/author_photos/' . $fname;

    // 既存 photo は 上書き削除
    $prev = null;
    $st = $pdo->prepare("SELECT photo_path FROM author_photos WHERE name_key = ? LIMIT 1");
    $st->execute([$key]);
    if ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        $prev = (string)$row['photo_path'];
    }

    // upsert
    $sql = "INSERT INTO author_photos (name_key, name_original, photo_path, source, uploaded_by_user_id)
                 VALUES (?, ?, ?, 'manual', ?)
             ON DUPLICATE KEY UPDATE
                 name_original = VALUES(name_original),
                 photo_path    = VALUES(photo_path),
                 source        = 'manual',
                 uploaded_by_user_id = VALUES(uploaded_by_user_id)";
    $pdo->prepare($sql)->execute([$key, $name, $publicPath, $uid]);

    if ($prev && $prev !== $publicPath) {
        $prevFs = $dir . $prev;
        if (is_file($prevFs)) @unlink($prevFs);
    }

    json_response(['ok' => true, 'photo_url' => $publicPath]);
}

// v1006 DELETE /api/authors/{name}/photo
function authors_photo_delete(PDO $pdo, array $cfg, string $name): void {
    Auth::requireUser($pdo, $cfg);
    $key = authors_photo_name_key($name);
    if ($key === '') throw new ApiException('bad_request', 'name is empty', 400);
    $st = $pdo->prepare("SELECT photo_path FROM author_photos WHERE name_key = ? LIMIT 1");
    $st->execute([$key]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) { json_response(['ok' => true, 'removed' => false]); return; }
    $prev = (string)($row['photo_path'] ?? '');
    $pdo->prepare("DELETE FROM author_photos WHERE name_key = ?")->execute([$key]);
    if ($prev !== '') {
        $dir = realpath(__DIR__ . '/../../public');
        if ($dir !== false) {
            $prevFs = $dir . $prev;
            if (is_file($prevFs)) @unlink($prevFs);
        }
    }
    json_response(['ok' => true, 'removed' => true]);
}

// 検索用 の LIKE トークン (最も 特定性 高い 部分文字列 を 使う。 目的 は 「対象を含む row を絞る」)。
function authors_search_tokens(string $name): array {
    $n = trim(preg_replace('/\s+/u', ' ', $name));
    if ($n === '') return [];
    $parts = preg_split('/\s+|,/u', $n);
    $parts = array_values(array_filter($parts, fn($x) => mb_strlen($x) >= 2));
    $out = [];
    if (count($parts) >= 1) $out[] = end($parts);   // 苗字 と 想定 する 最後 の 単語
    if (count($parts) >= 1) $out[] = $parts[0];     // 名 or 先頭単語
    return array_values(array_unique($out));
}

// 名前 の 表記揺れ variants を 出力 (小文字 正規化 済 で 返す)。
function authors_expand_name_variants(string $name): array {
    $out = [];
    $add = function($s) use (&$out) {
        $n = authors_normalize_name($s);
        if ($n !== '') $out[] = $n;
    };
    $add($name);
    $stripped = trim($name);
    // 「Last, First」 → 「First Last」
    if (preg_match('/^([^,]+),\s*(.+)$/u', $stripped, $mm)) {
        $add(trim($mm[2]) . ' ' . trim($mm[1]));
    }
    // 「First Last」 → 「Last, First」 と 「F. Last」 も 追加
    $parts = preg_split('/\s+/u', $stripped);
    if (count($parts) >= 2) {
        $last  = end($parts);
        $first = $parts[0];
        $add($last . ', ' . $first);
        if (mb_strlen($first) > 1) $add(mb_substr($first, 0, 1) . '. ' . $last);
        // ミドル ネーム 除去
        $add($first . ' ' . $last);
    }
    return array_values(array_unique($out));
}

function authors_normalize_name(string $s): string {
    $s = mb_convert_kana($s, 'KVas', 'UTF-8');   // 全角→半角
    $s = preg_replace('/\s+/u', ' ', $s);
    $s = trim($s);
    return mb_strtolower($s, 'UTF-8');
}

// authors 文字列 (「A, B, C, and D」) を parse して 各 name が variants に 一致するか 判定。
//   一致 した 場合 は 元表記 (トリム 後) を 返す、 無ければ null。
function authors_string_matches(string $s, array $variantsSet): ?string {
    if ($s === '') return null;
    $clean = preg_replace('/,\s*and\s+/i', ', ', $s);
    $clean = preg_replace('/\s+and\s+/i', ', ', $clean);
    $names = preg_split('/[,;、]/u', $clean);
    foreach ($names as $n) {
        $n = trim($n);
        if ($n === '') continue;
        $norm = authors_normalize_name($n);
        if (isset($variantsSet[$norm])) return $n;
        // 部分 match (last name 一致 + first initial 一致)
        foreach ($variantsSet as $v => $_) {
            if (authors_soft_match($norm, $v)) return $n;
        }
    }
    return null;
}

// 例: "kelly mack" == "k. mack" (last 一致 + first 頭文字 一致)
function authors_soft_match(string $a, string $b): bool {
    $ap = preg_split('/\s+/u', $a);
    $bp = preg_split('/\s+/u', $b);
    if (count($ap) < 2 || count($bp) < 2) return false;
    if (end($ap) !== end($bp)) return false;
    $af = rtrim($ap[0], '.');
    $bf = rtrim($bp[0], '.');
    return mb_substr($af, 0, 1) === mb_substr($bf, 0, 1);
}

// Front matter (paper_full_translations) or 要約結果 に affiliation / email が 出て いる か
//   探す。 見つかれば 該当 著者 の {affiliation, email} を 返す。
function authors_lookup_in_chapters(array $j, string $matchedName): array {
    $out = ['affiliation' => null, 'email' => null];
    $chapters = $j['chapters'] ?? [];
    if (!is_array($chapters)) return $out;
    foreach ($chapters as $ch) {
        $ct = strtolower((string)($ch['chapter_title_original'] ?? ''));
        if (strpos($ct, 'front matter') === false && strpos($ct, 'title page') === false) continue;
        $text = (string)($ch['translation'] ?? '');
        // 名前 行 の 周辺 の email を 探す
        $lines = preg_split('/\r?\n/', $text);
        for ($i = 0; $i < count($lines); $i++) {
            $ln = $lines[$i];
            if (stripos($ln, $matchedName) === false) continue;
            // 次 5 行 以内 に email
            for ($j2 = $i; $j2 < min(count($lines), $i + 6); $j2++) {
                if (preg_match('/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/', $lines[$j2], $mm)) {
                    $out['email'] = $mm[0];
                    break;
                }
            }
            // 次 3 行 に affiliation
            for ($j2 = $i + 1; $j2 < min(count($lines), $i + 4); $j2++) {
                $cand = trim($lines[$j2]);
                if ($cand === '' || preg_match('/@/', $cand)) continue;
                if (mb_strlen($cand) < 4 || mb_strlen($cand) > 200) continue;
                $out['affiliation'] = $cand;
                break;
            }
            break;
        }
        if ($out['email'] || $out['affiliation']) break;
    }
    return $out;
}

function usort_by_date(array $papers): array {
    usort($papers, fn($a, $b) => strcmp((string)$b['date'], (string)$a['date']));
    return $papers;
}
