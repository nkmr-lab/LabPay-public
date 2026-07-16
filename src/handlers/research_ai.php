<?php
// v1125 研究特化 AI サブスク (MVP)
//   200pt/60 件 (1 ヶ月)、 1000pt/無制限 (1 ヶ月)。研究特化 system prompt +
//   相談テンプレート library。 Scrapbox 連携は Phase 2。
//
// API:
//   GET  /api/research-ai                    → 自分の sub 状態 + テンプレート一覧 + 直近履歴
//   POST /api/research-ai/subscribe          → { plan: 'quota60' | 'unlimited' } pt 徴収 + sub 開始
//   POST /api/research-ai/chat               → { message, template_key? } → sub check → OpenAI 呼び + 履歴 + 使用回数減
//   GET  /api/research-ai/chats              → 履歴 (直近 100 件)

declare(strict_types=1);

const RAI_PLAN_QUOTA60_COST     = 200;
const RAI_PLAN_QUOTA60_MSGS     = 60;
const RAI_PLAN_UNLIMITED_COST   = 1000;
const RAI_SUB_DURATION_DAYS     = 30;

function rai_templates(): array {
    return [
        ['key' => 'theme_review',    'title' => '📝 研究テーマ相談',    'placeholder' => 'テーマ / 悩み / 方向性の入力', 'sys' => '研究計画に精通したメンター AI として、以下の研究テーマや悩みに対して、掘り下げるべき論点 + 隣接分野 + キーとなる先行研究 + 次の一歩を、Bullet で簡潔に提案してください。'],
        ['key' => 'exp_design',      'title' => '🧪 実験デザインチェック','placeholder' => 'RQ + 実験計画', 'sys' => '実験心理・HCI の査読者として、以下の実験計画の弱点 (交絡・バイアス・サンプルサイズ・生態妥当性・統計手法) を厳しく指摘し、改善案を出してください。'],
        ['key' => 'abstract_polish', 'title' => '✒️ アブスト磨き',       'placeholder' => 'アブスト原稿', 'sys' => '査読者視点で、以下のアブストラクトの (a) 主張の明快さ (b) 貢献の specificity (c) 動機の説得力を評価し、改善版を提示してください。'],
        ['key' => 'related_work',    'title' => '📚 関連研究整理',        'placeholder' => 'テーマ or キーワード', 'sys' => '以下のテーマに関連する研究の系譜を「基盤研究 → 現代の主流 → 最新動向」の 3 段で整理し、代表的な論文 (著者・年・要旨) を Bullet で挙げてください。学術的な確度を優先、不確かなら "確認要" と明記。'],
        ['key' => 'rebuttal',        'title' => '📮 リバッタル文起草',    'placeholder' => '査読コメント (原文)', 'sys' => '査読コメントに対する rebuttal を、defensive でなく建設的なトーンで、査読者の懸念を認めた上で本質的な反論 / 補足実験 / 修正約束を混ぜて起草してください。'],
        ['key' => 'kaken_writing',   'title' => '💴 科研費文章調整',       'placeholder' => '応募書類の下書き', 'sys' => '科研費応募書類の査読者として、以下の文章の (a) 学術的貢献の明確さ (b) 方法の実現可能性 (c) 波及効果を評価し、より通りやすい表現に書き直してください。'],
        ['key' => 'freetalk',        'title' => '💬 汎用チャット',         'placeholder' => '何でも質問', 'sys' => '研究に関する汎用アシスタント。質問に対して簡潔かつ正確に答えてください。'],
    ];
}

function route_research_ai(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')          { rai_status($pdo, $cfg);      return; }
    if ($sub === 'subscribe' && $method === 'POST'){ rai_subscribe($pdo, $cfg);   return; }
    if ($sub === 'chat' && $method === 'POST')     { rai_chat($pdo, $cfg);        return; }
    if ($sub === 'chats' && $method === 'GET')     { rai_chats($pdo, $cfg);       return; }
    throw new ApiException('not_found', "no research-ai route for $method $sub", 404);
}

function _rai_active_sub(PDO $pdo, int $uid): ?array {
    $st = $pdo->prepare("SELECT * FROM research_ai_subscriptions WHERE user_id = ? AND expires_at > NOW()");
    $st->execute([$uid]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

function rai_status(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = _rai_active_sub($pdo, $uid);
    $st = $pdo->prepare("SELECT id, template_key, LEFT(user_message, 80) AS user_message_short, LEFT(ai_response, 200) AS ai_response_short, created_at FROM research_ai_chats WHERE user_id = ? ORDER BY id DESC LIMIT 10");
    $st->execute([$uid]);
    json_response([
        'subscription' => $sub ? [
            'plan'       => $sub['plan'],
            'quota_left' => $sub['quota_left'] !== null ? (int)$sub['quota_left'] : null,
            'expires_at' => $sub['expires_at'],
            'started_at' => $sub['started_at'],
        ] : null,
        'templates'   => rai_templates(),
        'plans'       => [
            ['key' => 'quota60',   'cost' => RAI_PLAN_QUOTA60_COST,   'msgs' => RAI_PLAN_QUOTA60_MSGS, 'duration_days' => RAI_SUB_DURATION_DAYS, 'label' => sprintf('%dpt / %d 件 (%d 日)', RAI_PLAN_QUOTA60_COST, RAI_PLAN_QUOTA60_MSGS, RAI_SUB_DURATION_DAYS)],
            ['key' => 'unlimited', 'cost' => RAI_PLAN_UNLIMITED_COST, 'msgs' => null, 'duration_days' => RAI_SUB_DURATION_DAYS, 'label' => sprintf('%dpt / 無制限 (%d 日)', RAI_PLAN_UNLIMITED_COST, RAI_SUB_DURATION_DAYS)],
        ],
        'recent_chats' => $st->fetchAll(PDO::FETCH_ASSOC),
    ]);
}

function rai_subscribe(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $plan = $body['plan'] ?? '';
    if (!in_array($plan, ['quota60','unlimited'], true)) throw new ApiException('bad_request', "plan は 'quota60' or 'unlimited'", 400);
    $cost = $plan === 'unlimited' ? RAI_PLAN_UNLIMITED_COST : RAI_PLAN_QUOTA60_COST;
    $quota = $plan === 'unlimited' ? null : RAI_PLAN_QUOTA60_MSGS;
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) throw new ApiException('insufficient_balance', "残高不足 (要 {$cost}pt、現在 {$bal}pt)", 400);
    $pdo->beginTransaction();
    try {
        Ledger::transfer($pdo, $uid, 1, $cost, 'ai_subscribe', 'research_ai_sub', $uid, "研究特化 AI サブスク ({$plan})");
        $expires = (new DateTime())->modify('+' . RAI_SUB_DURATION_DAYS . ' days')->format('Y-m-d H:i:s');
        // 既存があれば延長 (残 quota は加算、期限は max)
        $existing = _rai_active_sub($pdo, $uid);
        if ($existing) {
            // 既存 sub があれば期限を延長 (max)、quota は max
            $newQuota = null;
            if ($plan === 'unlimited' || $existing['plan'] === 'unlimited') {
                $newQuota = null;
            } else {
                $newQuota = ((int)$existing['quota_left']) + $quota;
            }
            $newExpires = max($existing['expires_at'], $expires);
            $newPlan = ($plan === 'unlimited' || $existing['plan'] === 'unlimited') ? 'unlimited' : 'quota60';
            $pdo->prepare("UPDATE research_ai_subscriptions SET plan = ?, quota_left = ?, expires_at = ?, cost_paid = cost_paid + ? WHERE user_id = ?")
                ->execute([$newPlan, $newQuota, $newExpires, $cost, $uid]);
        } else {
            $pdo->prepare("INSERT INTO research_ai_subscriptions (user_id, plan, quota_left, expires_at, cost_paid) VALUES (?, ?, ?, ?, ?)")
                ->execute([$uid, $plan, $quota, $expires, $cost]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    rai_status($pdo, $cfg);
}

function rai_chat(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') throw new ApiException('bad_request', 'message required', 400);
    if (mb_strlen($msg) > 4000) $msg = mb_substr($msg, 0, 4000);
    $tplKey = trim((string)($body['template_key'] ?? 'freetalk'));
    $tpl = null;
    foreach (rai_templates() as $t) if ($t['key'] === $tplKey) { $tpl = $t; break; }
    if (!$tpl) $tpl = rai_templates()[count(rai_templates()) - 1];   // freetalk
    // sub チェック
    $sub = _rai_active_sub($pdo, $uid);
    if (!$sub) throw new ApiException('forbidden', 'サブスク未加入。まず購入してください', 403);
    if ($sub['plan'] === 'quota60' && (int)$sub['quota_left'] <= 0) {
        throw new ApiException('forbidden', '今月のクォータを使い切りました', 403);
    }
    // OpenAI 呼び出し
    $payload = json_encode([
        'model'   => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $tpl['sys']],
            ['role' => 'user',   'content' => $msg],
        ],
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . (string)$cfg['openai']['api_key']],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT    => 60,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!$resp || $code >= 400) throw new ApiException('upstream_error', "OpenAI HTTP {$code}", 502);
    $j = json_decode((string)$resp, true);
    $aiText = $j['choices'][0]['message']['content'] ?? '';
    if ($aiText === '') throw new ApiException('upstream_error', 'OpenAI 空応答', 502);
    // 履歴保存 + quota 減
    $pdo->prepare("INSERT INTO research_ai_chats (user_id, template_key, user_message, ai_response) VALUES (?, ?, ?, ?)")
        ->execute([$uid, $tpl['key'], $msg, $aiText]);
    if ($sub['plan'] === 'quota60') {
        $pdo->prepare("UPDATE research_ai_subscriptions SET quota_left = quota_left - 1 WHERE user_id = ?")->execute([$uid]);
    }
    $sub2 = _rai_active_sub($pdo, $uid);
    json_response([
        'ok'         => true,
        'response'   => $aiText,
        'quota_left' => $sub2['quota_left'] !== null ? (int)$sub2['quota_left'] : null,
    ]);
}

function rai_chats(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, template_key, user_message, ai_response, created_at FROM research_ai_chats WHERE user_id = ? ORDER BY id DESC LIMIT 100");
    $st->execute([(int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}
