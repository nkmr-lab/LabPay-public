<?php
// /api/ai/* — OpenAI 経由の 補助機能。 現状は スケジュール フリーフォーム 展開のみ。
// config/config.php の openai.api_key が 空のときは 503 で 黙って 断る。

declare(strict_types=1);

function route_ai(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'expand_schedule' && $method === 'POST') {
        ai_expand_schedule($pdo, $cfg);
        return;
    }
    json_error('not_found', "no ai route for $method $sub", 404);
}

function ai_assert_configured(array $cfg): void {
    $k = (string)($cfg['openai']['api_key'] ?? '');
    if ($k === '') {
        throw new ApiException('not_configured', 'OpenAI が 設定されていません (config.openai.api_key)', 503);
    }
}

// POST /api/ai/expand_schedule
//   body: { text: "明日 12 時から 渋谷駅前で ランチ 1 時間半" }
//   返値: { fields: { title, day_date, start_time, duration_minutes, ... } }
function ai_expand_schedule(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'text required', 400);
    if (mb_strlen($text) > 2000) throw new ApiException('bad_request', 'text too long', 400);

    $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
    $today = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $dow   = ['日','月','火','水','木','金','土'][(int)(new DateTimeImmutable('now', $tz))->format('w')];

    $system = <<<SYS
あなたは スケジュール 抽出器 です。 ユーザーの 日本語 フリーテキスト から、
以下の フィールドを 抽出して JSON で 返してください。 該当が 無い フィールドは null。

本日は {$today} ({$dow})。 「明日」 「来週月曜」 等の 相対日付は 本日 基準で 解釈。
時刻 が 明示されない 場合は null。 「お昼」 → 12:00、 「夕方」 → 17:00、 「夜」 → 19:00 と 推測。
場所 (location) は そのまま。 緯度経度 が 含まれて居れば 別途。

出力 JSON の フィールド (これ以外 出力しない):
- title (str, 必須): 短い 1 行 タイトル
- day_date (str "YYYY-MM-DD" or null): 開始日
- start_time (str "HH:MM" or null): 開始時刻
- duration_minutes (int or null): 所要時間 (分)
- end_date (str "YYYY-MM-DD" or null): 終了日 (複数日 跨ぐ場合)
- end_time (str "HH:MM" or null): 終了時刻
- location (str or null): 場所 名 (緯度経度 を 含む 場合は memo に 回す)
- memo (str or null): 補足情報
- url (str or null): http(s):// で 始まる URL があれば
- kind (str): flight, train, bus, taxi, car, walk, hotel, conf, meeting, meetup, food, fun, other の 中で 最も 適切な もの。 待ち合わせ系 (集合 / 待ち合わせ) は meetup。 食事は food。 観光・遊び は fun。 不明 は other
SYS;

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $text],
        ],
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0.1,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($resp === false || $status >= 500) {
        throw new ApiException('upstream_error', 'OpenAI: ' . ($err ?: 'HTTP ' . $status), 502);
    }
    if ($status >= 400) {
        $j = json_decode((string)$resp, true);
        $msg = $j['error']['message'] ?? ('HTTP ' . $status);
        throw new ApiException('upstream_error', 'OpenAI: ' . $msg, 502);
    }
    $j = json_decode((string)$resp, true);
    $content = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($content)) {
        throw new ApiException('upstream_error', 'OpenAI: empty content', 502);
    }
    $fields = json_decode($content, true);
    if (!is_array($fields)) {
        throw new ApiException('upstream_error', 'OpenAI: not JSON', 502);
    }

    // バリデーション + 正規化
    static $ALLOWED_KINDS = ['flight','train','bus','taxi','car','walk','hotel','conf','meeting','meetup','food','fun','other'];
    $out = [
        'title'            => isset($fields['title']) ? mb_substr((string)$fields['title'], 0, 200) : null,
        'day_date'         => ai_norm_date($fields['day_date'] ?? null),
        'start_time'       => ai_norm_time($fields['start_time'] ?? null),
        'duration_minutes' => isset($fields['duration_minutes']) && is_numeric($fields['duration_minutes'])
                                ? max(0, min(60 * 48, (int)$fields['duration_minutes'])) : null,
        'end_date'         => ai_norm_date($fields['end_date'] ?? null),
        'end_time'         => ai_norm_time($fields['end_time'] ?? null),
        'location'         => isset($fields['location']) ? mb_substr((string)$fields['location'], 0, 500) : null,
        'memo'             => isset($fields['memo']) ? mb_substr((string)$fields['memo'], 0, 2000) : null,
        'url'              => isset($fields['url']) && is_string($fields['url']) && preg_match('#^https?://#i', $fields['url'])
                                ? mb_substr($fields['url'], 0, 2000) : null,
        'kind'             => isset($fields['kind']) && in_array($fields['kind'], $ALLOWED_KINDS, true)
                                ? $fields['kind'] : 'other',
    ];
    json_response(['ok' => true, 'fields' => $out]);
}

function ai_norm_date($v): ?string {
    if (!is_string($v) || $v === '') return null;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
}
function ai_norm_time($v): ?string {
    if (!is_string($v) || $v === '') return null;
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $v, $m)) {
        $h = (int)$m[1]; $i = (int)$m[2];
        if ($h >= 0 && $h <= 23 && $i >= 0 && $i <= 59) {
            return sprintf('%02d:%02d', $h, $i);
        }
    }
    return null;
}
