<?php
// v532 #161 体重・BMI 記録 (レコーディングダイエット)。個人ツール — public_read 等は出さない。
//   GET    /api/health/records?days=N   自分の直近 N 日 (default 90)
//   POST   /api/health/record            { weight_kg?, height_cm?, body_fat_pct?, memo?, recorded_at? }
//   DELETE /api/health/record/:id        起案者本人のみ削除可
//   GET    /api/health/summary           最新の身長 / 体重 / BMI + 前回比 + 全件数

declare(strict_types=1);

function route_health(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';

    if ($sub === 'records' && $method === 'GET') {
        $days = max(1, min(365, (int)($_GET['days'] ?? 90)));
        $st = $pdo->prepare("SELECT id, recorded_at, weight_kg, height_cm, body_fat_pct, memo
                               FROM health_records
                              WHERE user_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                              ORDER BY recorded_at ASC");
        $st->execute([$uid, $days]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['id']          = (int)$r['id'];
            $r['weight_kg']   = $r['weight_kg']    !== null ? (float)$r['weight_kg']    : null;
            $r['height_cm']   = $r['height_cm']    !== null ? (float)$r['height_cm']    : null;
            $r['body_fat_pct']= $r['body_fat_pct'] !== null ? (float)$r['body_fat_pct'] : null;
        }
        unset($r);
        json_response(['items' => $rows]);
        return;
    }

    if ($sub === 'record' && $method === 'POST') {
        $body = read_json_body();
        $weight = isset($body['weight_kg'])    && $body['weight_kg']    !== '' ? (float)$body['weight_kg']    : null;
        $height = isset($body['height_cm'])    && $body['height_cm']    !== '' ? (float)$body['height_cm']    : null;
        $bf     = isset($body['body_fat_pct']) && $body['body_fat_pct'] !== '' ? (float)$body['body_fat_pct'] : null;
        $memo   = isset($body['memo']) ? mb_substr(trim((string)$body['memo']), 0, 200) : null;
        if ($memo === '') $memo = null;
        if ($weight === null && $height === null && $bf === null) {
            throw new ApiException('bad_request', 'weight_kg / height_cm / body_fat_pct のどれか必須', 400);
        }
        // 値域チェック (人間として妥当な範囲)
        if ($weight !== null && ($weight < 20 || $weight > 300)) throw new ApiException('bad_request', 'weight_kg 範囲外', 400);
        if ($height !== null && ($height < 100 || $height > 250)) throw new ApiException('bad_request', 'height_cm 範囲外', 400);
        if ($bf !== null && ($bf < 1 || $bf > 60)) throw new ApiException('bad_request', 'body_fat_pct 範囲外', 400);
        $recordedAt = null;
        if (!empty($body['recorded_at'])) {
            try {
                $dt = new DateTime((string)$body['recorded_at']);
                $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
                $recordedAt = $dt->format('Y-m-d H:i:s');
            } catch (Throwable $_) {}
        }
        if ($recordedAt === null) $recordedAt = date('Y-m-d H:i:s');
        $st = $pdo->prepare("INSERT INTO health_records (user_id, recorded_at, weight_kg, height_cm, body_fat_pct, memo)
                             VALUES (?, ?, ?, ?, ?, ?)");
        $st->execute([(int)$uid, $recordedAt, $weight, $height, $bf, $memo]);
        json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
        return;
    }

    if ($sub === 'record' && $method === 'DELETE' && isset($seg[2])) {
        $rid = (int)$seg[2];
        $st = $pdo->prepare("SELECT user_id FROM health_records WHERE id = ?");
        $st->execute([$rid]);
        $owner = (int)$st->fetchColumn();
        if (!$owner) throw new ApiException('not_found', 'record not found', 404);
        if ($owner !== $uid) throw new ApiException('forbidden', '本人のみ削除可', 403);
        $pdo->prepare("DELETE FROM health_records WHERE id = ?")->execute([$rid]);
        json_response(['ok' => true]);
        return;
    }

    if ($sub === 'summary' && $method === 'GET') {
        // 最新の身長 + 体重 + 前回比 + BMI
        $stH = $pdo->prepare("SELECT height_cm FROM health_records WHERE user_id = ? AND height_cm IS NOT NULL ORDER BY recorded_at DESC LIMIT 1");
        $stH->execute([$uid]);
        $height = $stH->fetchColumn();
        $height = $height !== false ? (float)$height : null;
        $stW = $pdo->prepare("SELECT id, weight_kg, recorded_at FROM health_records WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY recorded_at DESC LIMIT 2");
        $stW->execute([$uid]);
        $weights = $stW->fetchAll(PDO::FETCH_ASSOC);
        $latest = $weights[0] ?? null;
        $prev   = $weights[1] ?? null;
        $bmi = null;
        if ($height && $latest && $latest['weight_kg']) {
            $m = $height / 100.0;
            $bmi = round($latest['weight_kg'] / ($m * $m), 1);
        }
        $stC = $pdo->prepare("SELECT COUNT(*) FROM health_records WHERE user_id = ?");
        $stC->execute([$uid]);
        $total = (int)$stC->fetchColumn();
        json_response([
            'height_cm'      => $height,
            'latest_weight'  => $latest ? (float)$latest['weight_kg'] : null,
            'latest_at'      => $latest ? $latest['recorded_at']      : null,
            'prev_weight'    => $prev   ? (float)$prev['weight_kg']   : null,
            'bmi'            => $bmi,
            'total_records'  => $total,
        ]);
        return;
    }

    json_error('not_found', "no health route for $method $sub", 404);
}
