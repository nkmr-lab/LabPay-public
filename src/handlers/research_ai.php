<?php
// v1125 研究特化 AI サブスク (MVP) → v1142 大改修:
//   件数 → トークン量課金、スレッド化 (会話単位で履歴管理)、共有 (他者もチャット投稿可)、
//   PDF / 画像 添付 (OpenAI Files API 経由)、ChatGPT / Claude 風の UX。

declare(strict_types=1);

// ── プランと料金 (v1142) ───────────────────────────────────────────
const RAI_SUB_DURATION_DAYS         = 30;
const RAI_LEGACY_QUOTA60_COST       = 200;   // 旧 quota60 (件数)
const RAI_LEGACY_QUOTA60_MSGS       = 60;
const RAI_LEGACY_UNLIMITED_COST     = 1000;
// 新: トークンチケット (使い切り)
const RAI_TOKENS_TICKET_S_COST      = 200;   // 200pt → 100k トークン
const RAI_TOKENS_TICKET_S_TOKENS    = 100_000;
const RAI_TOKENS_TICKET_L_COST      = 500;   // 500pt → 300k トークン
const RAI_TOKENS_TICKET_L_TOKENS    = 300_000;
// 新: 無制限だが週次上限
const RAI_UNLIMITED_WEEKLY_COST     = 1000;  // 1000pt / 30 日
const RAI_UNLIMITED_WEEKLY_LIMIT    = 500_000; // 1 週間 500k tokens

function rai_templates(): array {
    return [
        ['key' => 'theme_review',    'title' => '📝 研究テーマ相談',    'placeholder' => 'テーマ / 悩み / 方向性の入力', 'sys' => '研究計画に精通したメンター AI として、以下の研究テーマや悩みに対して、掘り下げるべき論点 + 隣接分野 + キーとなる先行研究 + 次の一歩を、 Bullet で簡潔に提案してください。'],
        ['key' => 'exp_design',      'title' => '🧪 実験デザインチェック','placeholder' => 'RQ + 実験計画', 'sys' => '実験心理・HCI の査読者として、以下の実験計画の弱点 (交絡・バイアス・サンプルサイズ・生態妥当性・統計手法) を厳しく指摘し、改善案を出してください。'],
        ['key' => 'abstract_polish', 'title' => '✒️ アブスト磨き',       'placeholder' => 'アブスト原稿', 'sys' => '査読者視点で、以下のアブストラクトの (a) 主張の明快さ (b) 貢献の specificity (c) 動機の説得力を評価し、改善版を提示してください。'],
        ['key' => 'related_work',    'title' => '📚 関連研究整理',        'placeholder' => 'テーマ or キーワード', 'sys' => '以下のテーマに関連する研究の系譜を「基盤研究 → 現代の主流 → 最新動向」の 3 段で整理し、代表的な論文 (著者・年・要旨) を Bullet で挙げてください。学術的な確度を優先、不確かなら "確認要" と明記。'],
        ['key' => 'rebuttal',        'title' => '📮 リバッタル文起草',    'placeholder' => '査読コメント (原文)', 'sys' => '査読コメントに対する rebuttal を、 defensive でなく建設的なトーンで、査読者の懸念を認めた上で本質的な反論 / 補足実験 / 修正約束を混ぜて起草してください。'],
        ['key' => 'kaken_writing',   'title' => '💴 科研費文章調整',       'placeholder' => '応募書類の下書き', 'sys' => '科研費応募書類の査読者として、以下の文章の (a) 学術的貢献の明確さ (b) 方法の実現可能性 (c) 波及効果を評価し、より通りやすい表現に書き直してください。'],
        ['key' => 'freetalk',        'title' => '💬 汎用チャット',         'placeholder' => '何でも質問', 'sys' => '研究に関する汎用アシスタント。質問に対して簡潔かつ正確に答えてください。'],
    ];
}

function route_research_ai(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')            { rai_status($pdo, $cfg);      return; }
    if ($sub === 'subscribe' && $method === 'POST')  { rai_subscribe($pdo, $cfg);   return; }
    if ($sub === 'threads' && $method === 'GET' && !isset($seg[2])) { rai_thread_list($pdo, $cfg); return; }
    if ($sub === 'threads' && $method === 'POST' && !isset($seg[2])) { rai_thread_create($pdo, $cfg); return; }
    if ($sub === 'threads' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        $tid = (int)$seg[2];
        if (!isset($seg[3]) && $method === 'GET')    { rai_thread_get($pdo, $cfg, $tid); return; }
        if (!isset($seg[3]) && $method === 'DELETE') { rai_thread_delete($pdo, $cfg, $tid); return; }
        if (($seg[3] ?? '') === 'share' && $method === 'PATCH')    { rai_thread_share($pdo, $cfg, $tid); return; }
        if (($seg[3] ?? '') === 'messages' && $method === 'POST')  { rai_thread_post_message($pdo, $cfg, $tid); return; }
        if (($seg[3] ?? '') === 'title' && $method === 'PATCH')    { rai_thread_rename($pdo, $cfg, $tid); return; }
    }
    if ($sub === 'uploads' && $method === 'POST' && !isset($seg[2])) { rai_upload($pdo, $cfg); return; }
    // 旧 API (v1125): freeform chat (thread なし)
    if ($sub === 'chat' && $method === 'POST')       { rai_legacy_chat($pdo, $cfg); return; }
    if ($sub === 'chats' && $method === 'GET')       { rai_legacy_chats($pdo, $cfg); return; }
    throw new ApiException('not_found', "no research-ai route for $method $sub", 404);
}

// ── サブスクリプション状態 ───────────────────────────────────────
function _rai_active_sub(PDO $pdo, int $uid): ?array {
    $st = $pdo->prepare("SELECT * FROM research_ai_subscriptions WHERE user_id = ? AND expires_at > NOW()");
    $st->execute([$uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    if (!$row) return null;
    // 週次リセット
    if (($row['plan'] ?? '') === 'unlimited_weekly' && $row['week_reset_at'] && strtotime($row['week_reset_at']) <= time()) {
        $newReset = date('Y-m-d H:i:s', strtotime('+7 days'));
        $pdo->prepare("UPDATE research_ai_subscriptions SET weekly_used = 0, week_reset_at = ? WHERE user_id = ?")
            ->execute([$newReset, $uid]);
        $row['weekly_used'] = 0;
        $row['week_reset_at'] = $newReset;
    }
    return $row;
}

function rai_status(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v1255 中村さん指示「研究特化 AI サブスク は なくして、 シンプル に AI サブスク 一本 に」
    //   → 研究特化 独自 サブスク の 新規購入 は 廃止 (rai_subscribe が 410 gone)、
    //     既存契約者 の 残 トークン だけ は grandfather で 使い切れる (subscription 情報 は 返す)、
    //     プラン 一覧 は 空配列 で 返し UI が 購入 ボタン を 出さない ように。
    $sub = _rai_active_sub($pdo, $uid);
    $aiSubActive = ai_sub_is_active($pdo, $uid);
    json_response([
        'subscription'    => $sub ? rai_shape_sub($sub) : null,   // grandfather 表示 用
        'ai_sub_active'   => $aiSubActive,
        'ai_sub_grants_unlimited' => $aiSubActive,
        'templates'       => rai_templates(),
        'plans'           => [],   // v1255 新規購入 経路 は 廃止、 空配列 返す
    ]);
}

function rai_shape_sub(array $sub): array {
    return [
        'plan'          => $sub['plan'],
        'quota_left'    => $sub['quota_left'] !== null ? (int)$sub['quota_left'] : null,
        'tokens_left'   => $sub['tokens_left'] !== null ? (int)$sub['tokens_left'] : null,
        'tokens_used'   => (int)($sub['tokens_used'] ?? 0),
        'weekly_limit'  => $sub['weekly_limit'] !== null ? (int)$sub['weekly_limit'] : null,
        'weekly_used'   => (int)($sub['weekly_used'] ?? 0),
        'week_reset_at' => $sub['week_reset_at'],
        'expires_at'    => $sub['expires_at'],
        'started_at'    => $sub['started_at'],
    ];
}

function rai_plans_public(): array {
    return [
        ['key' => 'tokens_ticket_s', 'cost' => RAI_TOKENS_TICKET_S_COST, 'tokens' => RAI_TOKENS_TICKET_S_TOKENS,
         'duration_days' => RAI_SUB_DURATION_DAYS,
         'label' => sprintf('%dpt / %dk トークン (%d 日)', RAI_TOKENS_TICKET_S_COST, RAI_TOKENS_TICKET_S_TOKENS / 1000, RAI_SUB_DURATION_DAYS),
         'hint'  => '軽く試したい向け'],
        ['key' => 'tokens_ticket_l', 'cost' => RAI_TOKENS_TICKET_L_COST, 'tokens' => RAI_TOKENS_TICKET_L_TOKENS,
         'duration_days' => RAI_SUB_DURATION_DAYS,
         'label' => sprintf('%dpt / %dk トークン (%d 日)', RAI_TOKENS_TICKET_L_COST, RAI_TOKENS_TICKET_L_TOKENS / 1000, RAI_SUB_DURATION_DAYS),
         'hint'  => '普段使い'],
        ['key' => 'unlimited_weekly', 'cost' => RAI_UNLIMITED_WEEKLY_COST, 'tokens' => null,
         'duration_days' => RAI_SUB_DURATION_DAYS,
         'weekly_limit' => RAI_UNLIMITED_WEEKLY_LIMIT,
         'label' => sprintf('%dpt / 週 %dk 上限 (%d 日)', RAI_UNLIMITED_WEEKLY_COST, RAI_UNLIMITED_WEEKLY_LIMIT / 1000, RAI_SUB_DURATION_DAYS),
         'hint'  => 'ヘビーユーザ向け、 週次自動リセット'],
    ];
}

function rai_subscribe(PDO $pdo, array $cfg): void {
    // v1255 中村さん指示「研究特化 AI サブスク は なくす」→ 新規購入 を 停止。
    //   誤って 叩かれて も ポイント を 引かない よう 410 gone 相当 で 拒否。
    //   ユーザ は #/ai-sub の 新 AI サブスク (1 週間 500pt) を 契約 する 導線 に。
    throw new ApiException('gone',
        '研究特化 AI サブスク の 新規購入 は 廃止 されました。 AI サブスク (#/ai-sub、 1 週間 500pt) を 契約 する と 研究特化 AI も 含めて 全 AI 機能 が 使い放題 に なります。',
        410);
}

// ── スレッド操作 ────────────────────────────────────────────────
function _rai_thread_visible(PDO $pdo, int $tid, int $uid): array {
    $st = $pdo->prepare("SELECT * FROM research_ai_threads WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$tid]);
    $th = $st->fetch(PDO::FETCH_ASSOC);
    if (!$th) throw new ApiException('not_found', 'thread not found', 404);
    if ((int)$th['owner_user_id'] === $uid) return $th;
    if ((int)$th['is_shared'] === 1) {
        $ids = json_decode($th['shared_user_ids'] ?: '[]', true) ?: [];
        if (in_array($uid, array_map('intval', $ids), true)) return $th;
    }
    throw new ApiException('forbidden', 'このスレッドを閲覧する権限がありません', 403);
}

function rai_thread_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v1150 fix: 旧 SQL は JSON_CONTAINS(..., CAST(? AS JSON)) を使っていたが、
    //   MariaDB では bind パラメータの CAST AS JSON が「Invalid JSON literal」で
    //   500 になっていた (中村さん報告)。 owner || is_shared の rough フィルタで
    //   まとめて取得し、 shared_user_ids の 判定は PHP で行う (スレッド数は 高々
    //   数百 なので パフォーマンス問題なし)。
    $st = $pdo->prepare("SELECT t.id, t.owner_user_id, u.display_name AS owner_name, u.avatar_url AS owner_avatar,
                                 t.title, t.template_key, t.is_shared, t.shared_user_ids,
                                 t.last_message_at, t.created_at
                            FROM research_ai_threads t JOIN users u ON u.id = t.owner_user_id
                           WHERE t.deleted_at IS NULL
                             AND (t.owner_user_id = ? OR t.is_shared = 1)
                           ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
                           LIMIT 300");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $items = [];
    foreach ($rows as $r) {
        $ownerUid = (int)$r['owner_user_id'];
        $shared = $r['shared_user_ids'] ? (json_decode($r['shared_user_ids'], true) ?: []) : [];
        $shared = array_map('intval', is_array($shared) ? $shared : []);
        $visible = ($ownerUid === $uid) || ((int)$r['is_shared'] === 1 && in_array($uid, $shared, true));
        if (!$visible) continue;
        $items[] = [
            'id'              => (int)$r['id'],
            'owner_user_id'   => $ownerUid,
            'owner_name'      => $r['owner_name'],
            'owner_avatar'    => $r['owner_avatar'],
            'title'           => $r['title'],
            'template_key'    => $r['template_key'],
            'is_shared'       => (int)$r['is_shared'] === 1,
            'shared_user_ids' => $shared,
            'last_message_at' => $r['last_message_at'],
            'created_at'      => $r['created_at'],
            'is_mine'         => $ownerUid === $uid,
        ];
        if (count($items) >= 100) break;
    }
    json_response(['items' => $items]);
}

function rai_thread_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? '新しいチャット'));
    if ($title === '') $title = '新しいチャット';
    if (mb_strlen($title) > 200) $title = mb_substr($title, 0, 200);
    $tplKey = trim((string)($body['template_key'] ?? 'freetalk'));
    // v1144 AI 結果から派生 (「この結果について AI と話す」ボタン)
    //   source_type / source_id を指定すると 該当 AI 結果の JSON を要約して
    //   seed_context として保存、 以降の会話で system prompt に前置きされる。
    $seedType = trim((string)($body['seed_source_type'] ?? ''));
    $seedId   = (int)($body['seed_source_id'] ?? 0);
    $seedContext = null;
    if ($seedType !== '' && $seedId > 0) {
        $seedContext = rai_build_seed_context($pdo, $seedType, $seedId, $uid);
    }
    $st = $pdo->prepare("INSERT INTO research_ai_threads
        (owner_user_id, title, template_key, last_message_at, seed_source_type, seed_source_id, seed_context)
        VALUES (?, ?, ?, NOW(), ?, ?, ?)");
    $st->execute([$uid, $title, $tplKey,
                  $seedType ?: null, $seedId ?: null, $seedContext]);
    $tid = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $tid]);
}

// v1144 AI 結果 (paper_review / resume_check / exp_plan / paper_summary /
//   paper_translate / paper_translate_full) を読み、 チャット context として
//   要約テキストを組み立てる。 元結果は 元テーブルから取得、 権限は 「元結果の
//   owner or share_token 経由で見えているユーザ」だが、 ここでは owner のみ許可
//   (share_token 対応は 将来 拡張)。
function rai_build_seed_context(PDO $pdo, string $sourceType, int $sourceId, int $uid): ?string {
    $sourceType = strtolower(preg_replace('/[^a-z_]/', '', $sourceType));
    $allowed = ['paper_review','resume_check','exp_plan','paper_summary','paper_translate','paper_translate_full'];
    if (!in_array($sourceType, $allowed, true)) return null;
    $ctx = "以下は、この会話で扱う「元 AI 結果」の要約です。 ユーザは この結果について 追加で質問したり、 理解を深めたり、 修正案を相談したいと考えています。 適宜この文脈を踏まえて答えてください。\n\n";
    try {
        if ($sourceType === 'paper_review') {
            $st = $pdo->prepare("SELECT pdf_name, target_venue, strictness, review_json FROM paper_reviews WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)$r['review_json'], true) ?: [];
            $ctx .= "【元: 論文査読】\n";
            $ctx .= "対象 PDF: {$r['pdf_name']} / 会議: {$r['target_venue']} / 厳しさ: {$r['strictness']}\n";
            if (!empty($rv['decision'])) $ctx .= "判定: {$rv['decision']} (Score {$rv['score']}/5)\n";
            if (!empty($rv['summary_one_line'])) $ctx .= "1 行要約: {$rv['summary_one_line']}\n";
            if (!empty($rv['plain_summary_for_student'])) $ctx .= "学生向け要約:\n{$rv['plain_summary_for_student']}\n";
            if (!empty($rv['weaknesses'])) $ctx .= "弱み:\n- " . implode("\n- ", array_slice($rv['weaknesses'], 0, 8)) . "\n";
            if (!empty($rv['comments_to_authors'])) $ctx .= "コメント: " . mb_substr($rv['comments_to_authors'], 0, 800) . "\n";
        } elseif ($sourceType === 'resume_check') {
            $st = $pdo->prepare("SELECT title, result_json FROM resume_checks WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)$r['result_json'], true) ?: [];
            $ctx .= "【元: 原稿チェック】\n";
            $ctx .= "タイトル: {$r['title']}\n";
            if (!empty($rv['summary_one_line'])) $ctx .= "1 行要約: {$rv['summary_one_line']}\n";
            if (!empty($rv['plain_summary_for_student'])) $ctx .= "学生向け要約:\n{$rv['plain_summary_for_student']}\n";
            if (!empty($rv['next_three_steps'])) $ctx .= "次の 3 ステップ:\n- " . implode("\n- ", $rv['next_three_steps']) . "\n";
            if (!empty($rv['comments_to_author'])) $ctx .= "総合コメント: " . mb_substr($rv['comments_to_author'], 0, 800) . "\n";
        } elseif ($sourceType === 'exp_plan') {
            $st = $pdo->prepare("SELECT title, result_json, result_strict_json, result_student_json FROM experiment_plan_checks WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)($r['result_student_json'] ?: $r['result_json'] ?: $r['result_strict_json']), true) ?: [];
            $ctx .= "【元: 実験計画書チェック】\n";
            $ctx .= "タイトル: {$r['title']}\n";
            if (!empty($rv['summary_one_line'])) $ctx .= "1 行要約: {$rv['summary_one_line']}\n";
            if (!empty($rv['plain_summary_for_student'])) $ctx .= "学生向け要約:\n{$rv['plain_summary_for_student']}\n";
            if (!empty($rv['top_priority_fixes'])) $ctx .= "優先修正:\n- " . implode("\n- ", array_slice($rv['top_priority_fixes'], 0, 8)) . "\n";
        } elseif ($sourceType === 'paper_summary') {
            $st = $pdo->prepare("SELECT pdf_name, result_json FROM paper_translates WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)$r['result_json'], true) ?: [];
            $ctx .= "【元: 論文要約】\n";
            $ctx .= "PDF: {$r['pdf_name']}\n";
            if (!empty($rv['summary_ja'])) $ctx .= "要約:\n" . mb_substr($rv['summary_ja'], 0, 1200) . "\n";
            if (!empty($rv['contributions'])) $ctx .= "貢献:\n- " . implode("\n- ", array_slice((array)$rv['contributions'], 0, 6)) . "\n";
        } elseif ($sourceType === 'paper_translate') {
            $st = $pdo->prepare("SELECT pdf_name, result_json FROM paper_translates WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)$r['result_json'], true) ?: [];
            $ctx .= "【元: 論文要約 (翻訳含む)】\n";
            $ctx .= "PDF: {$r['pdf_name']}\n";
            if (!empty($rv['summary_ja'])) $ctx .= mb_substr($rv['summary_ja'], 0, 1500) . "\n";
        } elseif ($sourceType === 'paper_translate_full') {
            $st = $pdo->prepare("SELECT pdf_name, translations_json FROM paper_full_translations WHERE id = ? AND user_id = ?");
            $st->execute([$sourceId, $uid]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            if (!$r) return null;
            $rv = json_decode((string)$r['translations_json'], true) ?: [];
            $ctx .= "【元: 論文全訳】\n";
            $ctx .= "PDF: {$r['pdf_name']}\n";
            if (is_array($rv) && !empty($rv)) {
                $first = $rv[0] ?? null;
                if ($first && isset($first['ja'])) $ctx .= "冒頭訳: " . mb_substr((string)$first['ja'], 0, 1200) . "\n";
                $ctx .= "章数: " . count($rv) . " 章\n";
            }
        }
    } catch (Throwable $e) {
        return null;
    }
    // 全体で 4000 字上限に (トークン節約)
    if (mb_strlen($ctx) > 4000) $ctx = mb_substr($ctx, 0, 4000) . "...(省略)";
    return $ctx;
}

function rai_thread_get(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $th = _rai_thread_visible($pdo, $tid, $uid);
    // メッセージ
    $st = $pdo->prepare("SELECT c.id, c.speaker_user_id, u.display_name AS speaker_name, u.avatar_url AS speaker_avatar,
                                 c.user_message, c.ai_response, c.tokens_prompt, c.tokens_completion, c.tokens_total,
                                 c.created_at
                            FROM research_ai_chats c LEFT JOIN users u ON u.id = c.speaker_user_id
                           WHERE c.thread_id = ?
                           ORDER BY c.id");
    $st->execute([$tid]);
    $messages = $st->fetchAll(PDO::FETCH_ASSOC);
    // attachments を chat_id ごとにまとめる
    $stA = $pdo->prepare("SELECT id, chat_id, kind, mime, filename, url FROM research_ai_attachments WHERE chat_id IN (SELECT id FROM research_ai_chats WHERE thread_id = ?)");
    $stA->execute([$tid]);
    $attByChat = [];
    foreach ($stA->fetchAll(PDO::FETCH_ASSOC) as $a) {
        $attByChat[(int)$a['chat_id']][] = $a;
    }
    foreach ($messages as &$m) {
        $m['id'] = (int)$m['id'];
        $m['speaker_user_id'] = $m['speaker_user_id'] !== null ? (int)$m['speaker_user_id'] : null;
        $m['tokens_total'] = $m['tokens_total'] !== null ? (int)$m['tokens_total'] : null;
        $m['attachments'] = $attByChat[$m['id']] ?? [];
    }
    unset($m);
    json_response([
        'thread' => [
            'id' => (int)$th['id'],
            'owner_user_id' => (int)$th['owner_user_id'],
            'title' => $th['title'],
            'template_key' => $th['template_key'],
            'is_shared' => (int)$th['is_shared'] === 1,
            'shared_user_ids' => $th['shared_user_ids'] ? (json_decode($th['shared_user_ids'], true) ?: []) : [],
            'created_at' => $th['created_at'],
            'is_mine' => (int)$th['owner_user_id'] === $uid,
            // v1144 AI 結果由来のスレッドか
            'seed_source_type' => $th['seed_source_type'] ?? null,
            'seed_source_id'   => $th['seed_source_id']   !== null ? (int)$th['seed_source_id'] : null,
            'has_seed_context' => !empty($th['seed_context']),
        ],
        'messages' => $messages,
    ]);
}

function rai_thread_delete(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $th = _rai_thread_visible($pdo, $tid, $uid);
    if ((int)$th['owner_user_id'] !== $uid) throw new ApiException('forbidden', 'オーナーのみ削除可', 403);
    $pdo->prepare("UPDATE research_ai_threads SET deleted_at = NOW() WHERE id = ?")->execute([$tid]);
    json_response(['ok' => true]);
}

function rai_thread_rename(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $th = _rai_thread_visible($pdo, $tid, $uid);
    if ((int)$th['owner_user_id'] !== $uid) throw new ApiException('forbidden', 'オーナーのみ改名可', 403);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) throw new ApiException('bad_request', 'title 1..200', 400);
    $pdo->prepare("UPDATE research_ai_threads SET title = ? WHERE id = ?")->execute([$title, $tid]);
    json_response(['ok' => true]);
}

function rai_thread_share(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $th = _rai_thread_visible($pdo, $tid, $uid);
    if ((int)$th['owner_user_id'] !== $uid) throw new ApiException('forbidden', 'オーナーのみ共有設定変更可', 403);
    $body = read_json_body();
    $isShared = !empty($body['is_shared']) ? 1 : 0;
    $ids = $body['shared_user_ids'] ?? [];
    if (!is_array($ids)) $ids = [];
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $ids = array_values(array_filter($ids, fn($v) => $v > 0 && $v !== $uid));
    $pdo->prepare("UPDATE research_ai_threads SET is_shared = ?, shared_user_ids = ? WHERE id = ?")
        ->execute([$isShared, json_encode($ids, JSON_UNESCAPED_UNICODE), $tid]);
    // 共有された人に通知
    if ($isShared && $ids) {
        global $CFG;
        $stO = $pdo->prepare("SELECT display_name FROM users WHERE id = ?");
        $stO->execute([$uid]);
        $ownerName = (string)$stO->fetchColumn();
        $tplTitle = (string)($th['title'] ?? 'AI チャット');
        foreach ($ids as $rid) {
            try { notify_safely($pdo, $CFG, (int)$rid, 'admin_notice',
                "🔬 {$ownerName} が研究 AI チャット「{$tplTitle}」を共有しました (投稿も可)",
                'research_ai_thread', $tid); } catch (Throwable $_) {}
        }
    }
    json_response(['ok' => true]);
}

// v1148 リファクタ: rai_thread_post_message が 150 行 超で見通し悪かったので
//   3 つの ヘルパに 分割: サブスク チェック / メッセージ組立 / OpenAI 呼び。
//   本体は オーケストレーション だけを 担う。

// ─ サブスクの残高 チェック (投稿前 に エラーで 弾く) ─
function _rai_assert_sub_available(array $sub): void {
    $plan = (string)$sub['plan'];
    if ($plan === 'quota60' && (int)$sub['quota_left'] <= 0) {
        throw new ApiException('forbidden', 'クォータ (件数) を使い切りました', 403);
    }
    if ($plan === 'tokens_ticket' && (int)($sub['tokens_left'] ?? 0) <= 0) {
        throw new ApiException('forbidden', 'トークンチケットを使い切りました。 追加購入してください', 403);
    }
    if ($plan === 'unlimited_weekly') {
        $used = (int)($sub['weekly_used'] ?? 0);
        $lim  = (int)($sub['weekly_limit'] ?? 0);
        if ($lim > 0 && $used >= $lim) {
            throw new ApiException('forbidden',
                '今週の利用上限に到達しました (' . date('n/j H:i', strtotime((string)$sub['week_reset_at'])) . ' にリセット)', 403);
        }
    }
}

// ─ サブスク トークン 減算 (投稿完了後、投稿者本人 の 分から) ─
function _rai_decrement_sub(PDO $pdo, int $uid, string $plan, int $tokTotal): void {
    if ($plan === 'quota60') {
        $pdo->prepare("UPDATE research_ai_subscriptions SET quota_left = quota_left - 1, tokens_used = tokens_used + ? WHERE user_id = ?")
            ->execute([$tokTotal, $uid]);
    } elseif ($plan === 'tokens_ticket') {
        $pdo->prepare("UPDATE research_ai_subscriptions SET tokens_left = GREATEST(0, tokens_left - ?), tokens_used = tokens_used + ? WHERE user_id = ?")
            ->execute([$tokTotal, $tokTotal, $uid]);
    } elseif ($plan === 'unlimited_weekly') {
        $pdo->prepare("UPDATE research_ai_subscriptions SET weekly_used = weekly_used + ?, tokens_used = tokens_used + ? WHERE user_id = ?")
            ->execute([$tokTotal, $tokTotal, $uid]);
    }
}

// ─ OpenAI に投げる messages 配列を構築 (system prompt + 履歴 + 今回の user + 添付) ─
function _rai_build_messages(PDO $pdo, array $th, int $uid, string $msg, array $attachIds): array {
    // template の sys prompt
    $tpl = null;
    foreach (rai_templates() as $t) if ($t['key'] === ($th['template_key'] ?? '')) { $tpl = $t; break; }
    if (!$tpl) foreach (rai_templates() as $t) if ($t['key'] === 'freetalk') { $tpl = $t; break; }
    // v1144 seed_context (元 AI 結果) を system prompt の前に加える
    $sysContent = $tpl['sys'];
    if (!empty($th['seed_context'])) {
        $sysContent = $th['seed_context'] . "\n\n---\n\n" . $sysContent;
    }
    $messages = [['role' => 'system', 'content' => $sysContent]];
    // 履歴 (直近 20 件、 user_message + ai_response を 交互 に)
    $stH = $pdo->prepare("SELECT user_message, ai_response FROM research_ai_chats WHERE thread_id = ? ORDER BY id LIMIT 20");
    $stH->execute([(int)$th['id']]);
    foreach ($stH->fetchAll(PDO::FETCH_ASSOC) as $h) {
        if (!empty($h['user_message'])) $messages[] = ['role' => 'user', 'content' => $h['user_message']];
        if (!empty($h['ai_response']))  $messages[] = ['role' => 'assistant', 'content' => $h['ai_response']];
    }
    // 今回投稿 (添付 は 画像 / PDF → OpenAI file_id を content 配列に)
    $stA = $pdo->prepare("SELECT openai_file_id FROM research_ai_attachments WHERE id = ? AND uploader_user_id = ?");
    $userContent = [];
    foreach ($attachIds as $aid) {
        $stA->execute([$aid, $uid]);
        $att = $stA->fetch(PDO::FETCH_ASSOC);
        if ($att && !empty($att['openai_file_id'])) {
            $userContent[] = ['type' => 'file', 'file' => ['file_id' => $att['openai_file_id']]];
        }
    }
    $userContent[] = ['type' => 'text', 'text' => $msg];
    $messages[] = ['role' => 'user', 'content' => count($userContent) === 1 ? $msg : $userContent];
    return $messages;
}

// ─ OpenAI chat.completions を叩いて (テキスト, プロンプトtok, 応答tok, 合計tok) を返す ─
function _rai_call_openai(string $model, string $apiKey, array $messages): array {
    $payloadArr = ['model' => $model, 'messages' => $messages];
    // gpt-5 系は max_completion_tokens、他は max_tokens (temperature 対応)
    if (preg_match('/^(gpt-5|o1|o3)/', $model)) {
        $payloadArr['max_completion_tokens'] = 4000;
    } else {
        $payloadArr['temperature'] = 0.4;
        $payloadArr['max_tokens'] = 4000;
    }
    $resp = ai_openai_call(json_encode($payloadArr, JSON_UNESCAPED_UNICODE), $apiKey);
    $aiText = $resp['choices'][0]['message']['content'] ?? '';
    if ($aiText === '') throw new ApiException('upstream_error', 'OpenAI 空応答', 502);
    $usage = $resp['usage'] ?? [];
    $tokPrompt     = (int)($usage['prompt_tokens']     ?? 0);
    $tokCompletion = (int)($usage['completion_tokens'] ?? 0);
    $tokTotal      = (int)($usage['total_tokens']      ?? ($tokPrompt + $tokCompletion));
    return [$aiText, $tokPrompt, $tokCompletion, $tokTotal];
}

// ── メッセージ投稿 (v1148 リファクタ: ヘルパに 分割してオーケストレーションだけ) ─────
function rai_thread_post_message(PDO $pdo, array $cfg, int $tid): void {
    $u = Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $uid = (int)$u['id'];
    $th = _rai_thread_visible($pdo, $tid, $uid);
    $body = read_json_body();
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') throw new ApiException('bad_request', 'message required', 400);
    if (mb_strlen($msg) > 8000) $msg = mb_substr($msg, 0, 8000);
    $attachIds = $body['attachment_ids'] ?? [];
    if (!is_array($attachIds)) $attachIds = [];
    $attachIds = array_values(array_filter(array_map('intval', $attachIds), fn($v) => $v > 0));

    // v1254 中村さん要望「研究特化 AI サブスク も 新 AI サブスク に 統合」
    //   新 AI サブスク (ai_subs、 1 週間 500pt) 契約中 なら 研究特化 サブスク の 有無 に
    //   関わらず 使い放題。 トークン カウンタ は 減らさず、 統計用 に ai_subs.covered_count を +1。
    //   契約中 で なければ 従来 の 研究特化 サブスク の 有無 を チェック する 二段構え。
    $aiSubActive = ai_sub_is_active($pdo, $uid);
    $sub = null;
    $plan = null;
    if (!$aiSubActive) {
        // トークン消費は「投稿者本人のサブスク」から引く (共有先が投稿すれば その人のトークン)
        $sub = _rai_active_sub($pdo, $uid);
        if (!$sub) throw new ApiException('forbidden', 'サブスク未加入。 まず AI サブスク (1 週間 500pt) を 契約 する か、 研究特化 サブスク を 購入 して ください', 403);
        _rai_assert_sub_available($sub);
        $plan = (string)$sub['plan'];
    }

    $messages = _rai_build_messages($pdo, $th, $uid, $msg, $attachIds);
    $model = (string)($cfg['openai']['model'] ?? 'gpt-5-mini');
    [$aiText, $tokPrompt, $tokCompletion, $tokTotal]
        = _rai_call_openai($model, (string)$cfg['openai']['api_key'], $messages);

    $pdo->beginTransaction();
    try {
        $stI = $pdo->prepare("INSERT INTO research_ai_chats
            (user_id, template_key, user_message, ai_response, thread_id, speaker_user_id, tokens_prompt, tokens_completion, tokens_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stI->execute([(int)$th['owner_user_id'], $th['template_key'], $msg, $aiText, $tid, $uid, $tokPrompt, $tokCompletion, $tokTotal]);
        $chatId = (int)$pdo->lastInsertId();
        // 添付を chat_id に紐付け
        if ($attachIds) {
            $place = implode(',', array_fill(0, count($attachIds), '?'));
            $pdo->prepare("UPDATE research_ai_attachments SET chat_id = ? WHERE id IN ($place) AND uploader_user_id = ?")
                ->execute(array_merge([$chatId], $attachIds, [$uid]));
        }
        // スレッドの last_message_at 更新
        $pdo->prepare("UPDATE research_ai_threads SET last_message_at = NOW() WHERE id = ?")->execute([$tid]);
        // v1148 リファクタ: サブスク減算は _rai_decrement_sub ヘルパに集約
        // v1254 新 AI サブスク で 覆われた 場合 は 研究特化 サブスク の トークン は 減らさず、
        //   統計用 に ai_subs.covered_count を +1 (covered_pt は per-request 料金 が ない ので 0 の まま)
        if ($aiSubActive) {
            $pdo->prepare("UPDATE ai_subs SET covered_count = covered_count + 1 WHERE user_id = ?")
                ->execute([$uid]);
        } else {
            _rai_decrement_sub($pdo, $uid, $plan, $tokTotal);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $sub2 = _rai_active_sub($pdo, $uid);
    json_response([
        'ok' => true,
        'chat_id' => $chatId,
        'response' => $aiText,
        'tokens_used_this_call' => $tokTotal,
        'subscription' => $sub2 ? rai_shape_sub($sub2) : null,
    ]);
}

// ── アップロード (画像 / PDF → サーバ保存 + OpenAI Files API) ────
function rai_upload(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $uid = (int)$u['id'];
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file が必要', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '30 MB まで', 400);
    $mime = strtolower((string)($f['type'] ?? ''));
    $name = (string)($f['name'] ?? 'upload');
    $ext  = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $kind = null;
    if (preg_match('#^image/#', $mime) || in_array($ext, ['png','jpg','jpeg','webp','gif'], true)) $kind = 'image';
    elseif ($mime === 'application/pdf' || $ext === 'pdf') $kind = 'pdf';
    else throw new ApiException('bad_request', '画像 or PDF のみ受け付けます', 400);

    // サーバ保存
    $publicDir = '/var/www/labpay/public';
    $subDir = '/uploads/research_ai/' . date('Y/m');
    @mkdir($publicDir . $subDir, 0775, true);
    $safeName = bin2hex(random_bytes(6)) . '.' . ($ext ?: ($kind === 'image' ? 'png' : 'pdf'));
    $rel = $subDir . '/' . $safeName;
    if (!move_uploaded_file($f['tmp_name'], $publicDir . $rel)) {
        throw new ApiException('server_error', 'ファイル保存に失敗', 500);
    }
    @chmod($publicDir . $rel, 0644);

    // OpenAI Files API に upload (user_data purpose)
    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = null;
    try {
        $fileId = ai_openai_upload_pdf($publicDir . $rel, $name, $apiKey);   // 汎用 (画像も可)
    } catch (Throwable $e) {
        // OpenAI 側で失敗しても、サーバ側は保持しておく (再 upload 可)
        fwrite(STDERR, "[rai_upload] OpenAI files failed: " . $e->getMessage() . "\n");
    }

    $pdo->prepare("INSERT INTO research_ai_attachments (uploader_user_id, kind, mime, size_bytes, filename, url, openai_file_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)")
        ->execute([$uid, $kind, $mime ?: ($kind === 'image' ? 'image/png' : 'application/pdf'),
                   (int)$f['size'], mb_substr($name, 0, 255), $rel, $fileId]);
    $aid = (int)$pdo->lastInsertId();
    json_response(['ok' => true, 'id' => $aid, 'kind' => $kind, 'url' => $rel, 'filename' => $name, 'openai_file_id' => $fileId]);
}

// ── 旧 API (v1125) 互換 ───────────────────────────────────────────
function rai_legacy_chat(PDO $pdo, array $cfg): void {
    // 従来の /api/research-ai/chat (thread 不使用の 1 発チャット) は動作継続。
    // 内部で thread を暗黙生成 → post_message に委譲、しても良いが、
    // v1142 では簡潔にレガシー用のショートパスとして残しつつ内部で thread 作成に流す。
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $tplKey = trim((string)($body['template_key'] ?? 'freetalk'));
    // 新しい scratch thread を作って POST message に流す
    $st = $pdo->prepare("INSERT INTO research_ai_threads (owner_user_id, title, template_key, last_message_at) VALUES (?, ?, ?, NOW())");
    $st->execute([(int)$u['id'], mb_substr((string)($body['message'] ?? '一発チャット'), 0, 60), $tplKey]);
    $tid = (int)$pdo->lastInsertId();
    // input body から必要フィールドを継承して post_message を呼ぶ
    $_POST_prev = $body;
    // 実装簡略化: 直接コール
    rai_thread_post_message($pdo, $cfg, $tid);
}
function rai_legacy_chats(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id, template_key, user_message, ai_response, created_at, thread_id FROM research_ai_chats WHERE user_id = ? ORDER BY id DESC LIMIT 100");
    $st->execute([(int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}
