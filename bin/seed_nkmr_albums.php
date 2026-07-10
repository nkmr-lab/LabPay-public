<?php
// v970 中村研 アルバム RAW → DB 一括 seed。 一回 だけ 実行。
//   nkmr_albums.js の RAW 部分 を そのまま この 下 に コピー、 parse して INSERT。
//   idempotent: 既存 URL は スキップ。

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

// タイトル から 場所 ラベル を 推測。 拾えたら 文字列、 拾え なければ null。
//   優先: 「@場所」 「＠場所」 (半角/全角) を 探す。 「 in 場所」 「 at 場所」 も 対応。
//   場所 末尾 の 記号 (、 ・ ( （) は カット、 「N人 の 括弧」 は 除外。
function extract_location(string $title): ?string {
    // カッコ内 の 参加者リスト を 一時的に 消す (「@沖縄（中川、松田）」 で 「沖縄（中川、松田）」 と 拾わない ため)
    $s = preg_replace('/[（(][^）)]*[）)]/u', '', $title) ?? $title;
    // @ / ＠ で 場所 を 取る
    if (preg_match('/[@＠]\s*([^\s,、・.。\-–—@＠]+)/u', $s, $m)) {
        return _location_clean($m[1]);
    }
    // 「 in X」 「 at X」 の 英語 スタイル
    if (preg_match('/\b(?:in|at)\s+([^\s,、\-]+)/i', $s, $m)) {
        return _location_clean($m[1]);
    }
    return null;
}
function _location_clean(string $s): ?string {
    $s = trim($s);
    // 前後 の 括弧 記号 除去
    $s = preg_replace('/^[「『（(【\[]+|[」』）)】\]]+$/u', '', $s);
    $s = trim($s);
    // 「宮古島（中川…」 の 残り が あれば カット
    $s = preg_replace('/[（(].*$/u', '', $s);
    // 短すぎ / 長すぎ は 除外
    $len = mb_strlen($s);
    if ($len < 1 || $len > 40) return null;
    return $s;
}

// 元 の nkmr_albums.js を 読み込んで RAW ブロック を 抽出。
$src = @file_get_contents(__DIR__ . '/../public/js/views/nkmr_albums.js');
if ($src === false) { fwrite(STDERR, "cannot read nkmr_albums.js\n"); exit(1); }

// String.raw`...` の 中身 を 抜く。 単純 な substring 検索 (バックティック 1 対)。
$startTag = "String.raw`";
$startPos = strpos($src, $startTag);
if ($startPos === false) { fwrite(STDERR, "String.raw not found\n"); exit(1); }
$rawStart = $startPos + strlen($startTag);
$rawEnd = strpos($src, "`;", $rawStart);
if ($rawEnd === false) { fwrite(STDERR, "closing backtick not found\n"); exit(1); }
$raw = substr($src, $rawStart, $rawEnd - $rawStart);

// parse: RAW を 行 単位 で 舐めて 「[(* SECTION]」 と 「[title url]」 を 拾う
$sections = [];
$curSection = '中村研アルバム';
$sections[$curSection] = [];
$lines = preg_split("/\r?\n/", $raw);
$secRe   = '/^\[\(\*\s*(.+?)\s*\]/';
$albumRe = '/\[(.+?)\s+(https?:\/\/\S+?)\]/';
foreach ($lines as $line) {
    if (preg_match($secRe, $line, $m)) {
        $curSection = trim($m[1]);
        if (!isset($sections[$curSection])) $sections[$curSection] = [];
        continue;
    }
    if (preg_match($albumRe, $line, $m)) {
        $title = trim($m[1]);
        $url   = $m[2];
        $flag = '';
        if (preg_match('/^\s*([\x{1F1E6}-\x{1F1FF}]+|[\x{1F300}-\x{1FAFF}])/u', $line, $fm)) {
            $flag = $fm[1];
        }
        $location = extract_location($title);
        $sections[$curSection][] = ['title' => $title, 'url' => $url, 'flag' => $flag, 'location' => $location];
    }
}

global $PDO;

$total = 0;
$inserted = 0;
$skipped = 0;
foreach ($sections as $section => $albums) {
    if (empty($albums)) continue;
    // 「中村研アルバム」 の 総集編 3 件 は 各 年度 と 重複、 かつ 「日常」 は 個別 年度 セクション で
    // 別 URL の エントリ が ある。 ユーザ 要望 で スキップ。
    if ($section === '中村研アルバム') continue;
    // 現在 の 最大 sort_order
    $maxSt = $PDO->prepare("SELECT COALESCE(MAX(sort_order), 0) FROM nkmr_albums WHERE section = ?");
    $maxSt->execute([$section]);
    $curMax = (int)$maxSt->fetchColumn();
    foreach ($albums as $a) {
        $total++;
        // 重複 (同 URL) は skip
        $chk = $PDO->prepare("SELECT COUNT(*) FROM nkmr_albums WHERE url = ?");
        $chk->execute([$a['url']]);
        if ((int)$chk->fetchColumn() > 0) { $skipped++; continue; }
        $curMax += 10;
        $ins = $PDO->prepare("INSERT INTO nkmr_albums (section, title, url, flag, location, sort_order)
                              VALUES (?, ?, ?, ?, ?, ?)");
        $ins->execute([$section, $a['title'], $a['url'], $a['flag'] ?: null, $a['location'] ?: null, $curMax]);
        $inserted++;
    }
}
echo "sections=" . count($sections)
   . " total_in_raw=$total inserted=$inserted skipped_dupe=$skipped\n";
