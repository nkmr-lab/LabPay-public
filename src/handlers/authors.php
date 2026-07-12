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
    if (($seg[1] ?? '') === '' || $method !== 'GET') {
        throw new ApiException('not_found', 'authors requires name', 404);
    }
    $name = rawurldecode((string)$seg[1]);
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
    json_response([
        'name'          => $target,
        'name_variants' => array_values(array_unique(array_map(fn($p) => $p['matched_name'], $papers))),
        'affiliations'  => array_values(array_unique($affiliations)),
        'emails'        => array_values(array_unique($emails)),
        'papers'        => $papers,
    ]);
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
