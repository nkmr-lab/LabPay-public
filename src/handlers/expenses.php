<?php
// v1002 個人家計簿 (中村さん要望「個人の家計簿機能。 領収書を写真で手軽に読み込める」)。
//
//   GET  /api/expenses?year=YYYY&month=MM  → その月の一覧 + 合計 + カテゴリ別
//   GET  /api/expenses?days=30             → 直近 N 日の一覧 + 合計
//   POST /api/expenses                     → 新規 (JSON body: spent_at, amount, category, merchant, memo, image_data?)
//                                            image_data は base64 encoded の 領収書画像 (省略可)
//   GET  /api/expenses/{id}                → 詳細
//   PATCH  /api/expenses/{id}              → 更新
//   DELETE /api/expenses/{id}              → 削除
//   POST /api/expenses/ocr                 → 領収書画像を送って OCR 結果を返す (保存しない、 preview)
//                                            body: {image_data: "data:image/jpeg;base64,..."}
//   GET  /api/expenses/receipts/{filename} → 領収書画像 (認証済ユーザのみ、 本人 のみ)

declare(strict_types=1);

const EXPENSE_CATEGORIES = [
    '食費', '交通費', '交際費', '光熱費', '家賃',
    '趣味', '医療', '教育', '日用品', '衣服', '通信', 'その他',
];

const EXPENSE_RECEIPTS_DIR = '/var/www/labpay/public/uploads/expense_receipts';

function route_expenses(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    if ($sub === 'ocr' && $method === 'POST') {
        expenses_ocr($pdo, $cfg);
        return;
    }
    if ($sub === 'receipts' && ($seg[2] ?? '') !== '' && $method === 'GET') {
        expenses_receipt_serve($pdo, $cfg, (string)$seg[2]);
        return;
    }
    if ($sub === '' && $method === 'GET') {
        expenses_list($pdo, $cfg);
        return;
    }
    if ($sub === '' && $method === 'POST') {
        expenses_create($pdo, $cfg);
        return;
    }
    if ($sub !== '' && ctype_digit($sub)) {
        $id = (int)$sub;
        if ($method === 'GET')    { expenses_get($pdo, $cfg, $id); return; }
        if ($method === 'PATCH')  { expenses_update($pdo, $cfg, $id); return; }
        if ($method === 'DELETE') { expenses_delete($pdo, $cfg, $id); return; }
    }
    throw new ApiException('not_found', "no expenses route for $method $sub", 404);
}

function expenses_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $year  = isset($_GET['year'])  ? (int)$_GET['year']  : 0;
    $month = isset($_GET['month']) ? (int)$_GET['month'] : 0;
    $days  = isset($_GET['days'])  ? (int)$_GET['days']  : 0;
    if ($year > 0 && $month > 0) {
        $where = "spent_at BETWEEN ? AND LAST_DAY(?)";
        $start = sprintf('%04d-%02d-01', $year, $month);
        $args  = [$start, $start];
        $rangeLabel = sprintf('%d年%d月', $year, $month);
    } elseif ($days > 0) {
        $where = "spent_at >= (CURDATE() - INTERVAL ? DAY)";
        $args  = [$days];
        $rangeLabel = "直近 {$days} 日";
    } else {
        $y = (int)date('Y'); $m = (int)date('m');
        $where = "spent_at BETWEEN ? AND LAST_DAY(?)";
        $start = sprintf('%04d-%02d-01', $y, $m);
        $args  = [$start, $start];
        $rangeLabel = sprintf('%d年%d月', $y, $m);
    }
    // 一覧
    $items = $pdo->prepare("
        SELECT id, spent_at, amount, category, merchant, memo, image_path, created_at
          FROM expenses
         WHERE user_id = ? AND $where
         ORDER BY spent_at DESC, id DESC
         LIMIT 500");
    $items->execute(array_merge([$uid], $args));
    $rows = $items->fetchAll(PDO::FETCH_ASSOC);
    // 合計
    $total = 0; $byCat = [];
    foreach ($rows as &$r) {
        $r['amount'] = (int)$r['amount'];
        $total += $r['amount'];
        $c = $r['category'] ?: 'その他';
        $byCat[$c] = ($byCat[$c] ?? 0) + $r['amount'];
    }
    unset($r);
    arsort($byCat);
    json_response([
        'range_label' => $rangeLabel,
        'items'       => $rows,
        'total'       => $total,
        'by_category' => $byCat,
        'categories'  => EXPENSE_CATEGORIES,
    ]);
}

function expenses_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $b = read_json_body();
    $spentAt  = expenses_parse_date($b['spent_at'] ?? '');
    $amount   = (int)($b['amount'] ?? 0);
    $category = expenses_normalize_category($b['category'] ?? null);
    $merchant = mb_substr(trim((string)($b['merchant'] ?? '')), 0, 120);
    $memo     = mb_substr(trim((string)($b['memo']     ?? '')), 0, 500);
    if ($amount <= 0)   throw new ApiException('bad_request', '金額は 1 円 以上', 400);
    if ($amount > 100000000) throw new ApiException('bad_request', '金額が大きすぎます', 400);

    $imagePath = null; $ocrJson = null;
    if (!empty($b['image_data'])) {
        $imagePath = expenses_save_receipt_image((string)$b['image_data']);
    }
    if (!empty($b['ocr_json']) && is_array($b['ocr_json'])) {
        $ocrJson = json_encode($b['ocr_json'], JSON_UNESCAPED_UNICODE);
    }
    $ins = $pdo->prepare("
        INSERT INTO expenses (user_id, spent_at, amount, category, merchant, memo, image_path, ocr_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$uid, $spentAt, $amount, $category ?: null,
                   $merchant !== '' ? $merchant : null, $memo !== '' ? $memo : null,
                   $imagePath, $ocrJson]);
    json_response(['id' => (int)$pdo->lastInsertId()]);
}

function expenses_get(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT * FROM expenses WHERE id = ? AND user_id = ?");
    $st->execute([$id, (int)$u['id']]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'expense not found', 404);
    $r['amount']   = (int)$r['amount'];
    $r['ocr_json'] = $r['ocr_json'] ? json_decode((string)$r['ocr_json'], true) : null;
    json_response($r);
}

function expenses_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id FROM expenses WHERE id = ? AND user_id = ?");
    $st->execute([$id, $uid]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'expense not found', 404);
    $b = read_json_body();
    $sets = []; $vals = [];
    if (isset($b['spent_at'])) { $sets[] = 'spent_at=?'; $vals[] = expenses_parse_date($b['spent_at']); }
    if (isset($b['amount'])) {
        $a = (int)$b['amount'];
        if ($a <= 0 || $a > 100000000) throw new ApiException('bad_request', '金額不正', 400);
        $sets[] = 'amount=?'; $vals[] = $a;
    }
    if (isset($b['category'])) { $sets[] = 'category=?'; $vals[] = expenses_normalize_category($b['category']) ?: null; }
    if (isset($b['merchant'])) { $v = mb_substr(trim((string)$b['merchant']), 0, 120); $sets[] = 'merchant=?'; $vals[] = $v !== '' ? $v : null; }
    if (isset($b['memo']))     { $v = mb_substr(trim((string)$b['memo']),     0, 500); $sets[] = 'memo=?';     $vals[] = $v !== '' ? $v : null; }
    if (!$sets) { json_response(['id' => $id]); return; }
    $vals[] = $id; $vals[] = $uid;
    $pdo->prepare("UPDATE expenses SET " . implode(', ', $sets) . " WHERE id=? AND user_id=?")->execute($vals);
    json_response(['id' => $id]);
}

function expenses_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 画像ファイル も 削除
    $st = $pdo->prepare("SELECT image_path FROM expenses WHERE id=? AND user_id=?");
    $st->execute([$id, $uid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'expense not found', 404);
    if (!empty($r['image_path'])) {
        $abs = EXPENSE_RECEIPTS_DIR . '/' . basename($r['image_path']);
        @unlink($abs);
    }
    $pdo->prepare("DELETE FROM expenses WHERE id=? AND user_id=?")->execute([$id, $uid]);
    json_response(['deleted' => true]);
}

// v1002 OpenAI Vision で 領収書 画像 から 店名 / 日付 / 金額 / カテゴリ 推定 / 明細 を 抽出。
//   保存 は しない、 preview 用。 UI で 確認 して 「保存」 を 押した ら POST /api/expenses で 保存。
function expenses_ocr(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $b = read_json_body();
    $imgData = (string)($b['image_data'] ?? '');
    if ($imgData === '') throw new ApiException('bad_request', 'image_data required', 400);
    $apiKey = (string)($cfg['openai']['api_key'] ?? '');
    if ($apiKey === '') throw new ApiException('server_error', 'OpenAI API key not configured', 500);

    // data URL の 場合 は そのまま OpenAI に 渡す (Vision は data URL を 受け付ける)。
    // base64 のみ の 場合 は data URL に 包む。
    if (!preg_match('/^data:image\//', $imgData)) {
        $imgData = 'data:image/jpeg;base64,' . $imgData;
    }
    $catsCsv = implode(' / ', EXPENSE_CATEGORIES);
    $sys = 'あなたは日本のレシート/領収書から支出情報を抽出するアシスタントです。 JSON のみを返します。';
    $usr = <<<PROMPT
添付の画像は日本のレシート/領収書です。 以下の JSON を返してください:
{
  "merchant":     "店名 (できるだけ短く)",
  "spent_at":     "YYYY-MM-DD (発行日付)",
  "amount":       合計金額 (整数、円、カンマなし),
  "category_guess": "$catsCsv のいずれか",
  "line_items":   [{"name": "品目名", "price": 数値}, ...]  (抽出できれば、 なくても OK)
}
- 数値は必ず整数 (税込 total)。 「\\3,240」→3240。 少数点なし。
- 日付が抜けていたら今日の日付を推測せず null にする。
- カテゴリは商品/店の性質から最も近いものを 1 つ。 迷ったら「その他」。
- レシートでない画像なら {"error": "not a receipt"} を返す。
JSON 以外の前置きや解説は不要。
PROMPT;

    $payload = json_encode([
        'model' => 'gpt-4o-mini',
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'text',      'text' => $usr],
                ['type' => 'image_url', 'image_url' => ['url' => $imgData]],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0,
        'max_tokens'  => 800,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 45,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) {
        throw new ApiException('upstream_error', 'OpenAI Vision failed: HTTP ' . $status, 502);
    }
    $d = json_decode((string)$resp, true);
    $content = $d['choices'][0]['message']['content'] ?? '';
    $parsed  = json_decode((string)$content, true);
    if (!is_array($parsed)) {
        throw new ApiException('upstream_error', 'JSON parse failed on OpenAI response', 502);
    }
    if (!empty($parsed['error'])) {
        throw new ApiException('bad_request', 'レシートとして認識できませんでした: ' . (string)$parsed['error'], 400);
    }
    // 正規化
    $out = [
        'merchant'       => mb_substr((string)($parsed['merchant'] ?? ''), 0, 120),
        'spent_at'       => expenses_parse_date($parsed['spent_at'] ?? '', true),
        'amount'         => max(0, (int)($parsed['amount'] ?? 0)),
        'category_guess' => expenses_normalize_category($parsed['category_guess'] ?? null),
        'line_items'     => is_array($parsed['line_items'] ?? null) ? $parsed['line_items'] : [],
    ];
    json_response($out);
}

// 領収書画像 の 配信 (認証 済 + 本人 の のみ)。 image_path で DB に 保存 済 の ファイル 名 と 一致 必要。
function expenses_receipt_serve(PDO $pdo, array $cfg, string $filename): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!preg_match('/^[0-9a-f]{32,64}\.(jpg|jpeg|png|webp)$/', $filename)) {
        throw new ApiException('bad_request', 'invalid filename', 400);
    }
    $relPath = '/uploads/expense_receipts/' . $filename;
    $st = $pdo->prepare("SELECT 1 FROM expenses WHERE user_id=? AND image_path=? LIMIT 1");
    $st->execute([$uid, $relPath]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'not found or not yours', 404);
    $abs = EXPENSE_RECEIPTS_DIR . '/' . $filename;
    if (!is_file($abs)) throw new ApiException('not_found', 'file missing', 404);

    // conditional GET (30 日 キャッシュ)
    $mtime = filemtime($abs);
    $size  = filesize($abs);
    $etag  = '"' . dechex($mtime) . '-' . dechex($size) . '"';
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304); exit;
    }
    $mime = ['jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp'][pathinfo($filename, PATHINFO_EXTENSION)] ?? 'application/octet-stream';
    header_remove('Cache-Control');
    header('Cache-Control: private, max-age=2592000, immutable');
    header('ETag: ' . $etag);
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . $size);
    readfile($abs);
    exit;
}

// ─── helpers ────────────────────────────────────────────

function expenses_parse_date(mixed $v, bool $allowNull = false): ?string {
    $s = trim((string)$v);
    if ($s === '') return $allowNull ? null : date('Y-m-d');
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s;
    // YYYY/M/D 等 も 受け付け
    $t = @strtotime($s);
    if ($t === false) return $allowNull ? null : date('Y-m-d');
    return date('Y-m-d', $t);
}

function expenses_normalize_category(mixed $v): string {
    $s = trim((string)$v);
    if ($s === '') return '';
    // 完全一致
    if (in_array($s, EXPENSE_CATEGORIES, true)) return $s;
    // 部分一致 (最初 に 見つかった もの)
    foreach (EXPENSE_CATEGORIES as $c) {
        if (mb_strpos($s, $c) !== false || mb_strpos($c, $s) !== false) return $c;
    }
    return 'その他';
}

// base64 の 領収書画像 を 保存 して 相対パス を 返す。
function expenses_save_receipt_image(string $imgData): ?string {
    // data URL prefix を 剥がす
    if (preg_match('/^data:image\/([a-z]+);base64,(.+)$/i', $imgData, $m)) {
        $ext = strtolower($m[1]);
        $b64 = $m[2];
    } else {
        $ext = 'jpg';
        $b64 = $imgData;
    }
    if (!in_array($ext, ['jpg','jpeg','png','webp'], true)) $ext = 'jpg';
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 500) return null;
    if (strlen($bin) > 12 * 1024 * 1024) {
        throw new ApiException('bad_request', '画像が大きすぎます (上限 12MB)', 400);
    }
    @mkdir(EXPENSE_RECEIPTS_DIR, 0775, true);
    // 直接 HTTP アクセス 禁止
    $htaccess = EXPENSE_RECEIPTS_DIR . '/.htaccess';
    if (!file_exists($htaccess)) @file_put_contents($htaccess, "Require all denied\n");
    $name = hash('sha256', $bin) . '.' . ($ext === 'jpeg' ? 'jpg' : $ext);
    $path = EXPENSE_RECEIPTS_DIR . '/' . $name;
    if (!is_file($path) && @file_put_contents($path, $bin) === false) {
        throw new ApiException('server_error', '画像の保存に失敗しました', 500);
    }
    @chmod($path, 0640);
    return '/uploads/expense_receipts/' . $name;
}
